"""Manipulador de credenciais Google (Antigravity e Gemini CLI)."""

import json
import os
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from ..models import ConnectionRecord
from .base import BaseProvider


class GoogleProvider(BaseProvider):
    """Gerenciador de OAuth para Google Antigravity e Gemini CLI."""

    OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"

    def __init__(self, credential_paths: Optional[List[str]] = None, discovery: Optional[Any] = None):
        self.credential_paths = credential_paths or []
        self.discovery = discovery

    def can_handle(self, conn: ConnectionRecord) -> bool:
        return conn.provider in ("antigravity", "gemini-cli")

    def find_local_credential_file(self) -> Optional[str]:
        """Localiza arquivo de token montado do host."""
        if self.discovery:
            disc = self.discovery.discover_google()
            if disc and disc.get("source_path"):
                return disc["source_path"]
        for p in self.credential_paths:
            if p and os.path.exists(p) and os.path.isfile(p):
                return p
        return None

    def read_local_credential(self) -> Optional[Dict[str, Any]]:
        """Lê o arquivo de token local se presente."""
        if self.discovery:
            disc = self.discovery.discover_google()
            if disc and disc.get("accessToken"):
                return {
                    "access_token": disc.get("accessToken"),
                    "refresh_token": disc.get("refreshToken"),
                    "client_id": disc.get("clientId"),
                    "client_secret": disc.get("clientSecret"),
                    "expiry": disc.get("expiry"),
                }
        path = self.find_local_credential_file()
        if not path:
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            tok = data.get("access_token") or data.get("accessToken") or data.get("token")
            if tok and "access_token" not in data:
                data["access_token"] = tok
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    def discover_client_secrets(self, conn: ConnectionRecord) -> Tuple[str, str]:
        """Extrai clientId e clientSecret do próprio payload ou de variáveis."""
        client_id = conn.data.get("clientId") or os.environ.get("GOOGLE_CLIENT_ID", "")
        client_secret = conn.data.get("clientSecret") or os.environ.get("GOOGLE_CLIENT_SECRET", "")
        if client_id and client_secret:
            return client_id, client_secret

        # Tenta descobrir no arquivo local do host
        local = self.read_local_credential()
        if local:
            client_id = local.get("client_id") or local.get("clientId") or client_id
            client_secret = local.get("client_secret") or local.get("clientSecret") or client_secret

        # Fallback: descobrir nos arquivos de provedores do 9Router se estiver rodando no mesmo container/volume
        candidate_files = [
            "/app/open-sse/providers/registry/antigravity.js",
            "/app/data/shared.js",
        ]
        for fpath in candidate_files:
            if os.path.exists(fpath):
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        content = f.read()
                    import re
                    m_id = re.search(r'clientId:\s*["\']([^"\']+)["\']', content)
                    m_sec = re.search(r'clientSecret:\s*["\']([^"\']+)["\']', content)
                    if m_id and not client_id:
                        client_id = m_id.group(1)
                    if m_sec and not client_secret:
                        client_secret = m_sec.group(1)
                except Exception:
                    pass

        return client_id, client_secret

    def refresh_oauth_token(
        self, refresh_token: str, client_id: str, client_secret: str
    ) -> Tuple[bool, Optional[Dict[str, Any]], str]:
        """Dispara requisição HTTPS padrão para oauth2.googleapis.com."""
        payload = urllib.parse.urlencode({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        }).encode("utf-8")

        req = urllib.request.Request(
            self.OAUTH_TOKEN_URL,
            data=payload,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "9rtksync/1.0",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=20.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return True, data, "OK"
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")[:300]
            return False, None, f"HTTP {e.code}: {err_body}"
        except Exception as e:
            return False, None, str(e)

    def check_and_refresh(
        self, conn: ConnectionRecord, margin_seconds: int = 900, **kwargs
    ) -> Tuple[bool, Optional[Dict[str, Any]], List[str]]:
        messages: List[str] = []
        data = dict(conn.data)

        # 1. Verifica se há token local mais novo no host
        local = self.read_local_credential()
        if local and local.get("access_token") and local.get("access_token") != data.get("accessToken"):
            data["accessToken"] = local["access_token"]
            if local.get("refresh_token"):
                data["refreshToken"] = local["refresh_token"]
            # Recalcula validade
            now_ms = int(time.time() * 1000)
            data["expiresAt"] = now_ms + (3599 * 1000)
            data["testStatus"] = "ok"
            messages.append("Token atualizado a partir de arquivo de credencial local do host")
            return True, data, messages

        # 2. Avalia necessidade de renovação
        rem = conn.remaining_seconds
        needs_refresh = False

        if rem is None:
            needs_refresh = True
            messages.append("expiresAt ausente ou corrompido")
        elif rem <= margin_seconds:
            needs_refresh = True
            messages.append(f"Validade próxima do fim ({rem}s restantes <= {margin_seconds}s)")

        if not needs_refresh:
            messages.append(f"Token válido por mais {rem // 60} min")
            return False, None, messages

        # 3. Executa a renovação OAuth
        refresh_token = data.get("refreshToken")
        if not refresh_token and local:
            refresh_token = local.get("refresh_token")

        if not refresh_token:
            messages.append("refreshToken não disponível para renovação automática")
            return False, None, messages

        client_id, client_secret = self.discover_client_secrets(conn)
        if not client_id or not client_secret:
            messages.append("clientId ou clientSecret não localizados para este provedor")
            return False, None, messages

        ok, resp, err = self.refresh_oauth_token(refresh_token, client_id, client_secret)
        if not ok:
            messages.append(f"Falha na renovação OAuth: {err}")
            return False, None, messages

        now_ms = int(time.time() * 1000)
        expires_in = int(resp.get("expires_in", 3599))
        data["accessToken"] = resp["access_token"]
        if resp.get("refresh_token"):
            data["refreshToken"] = resp["refresh_token"]
        data["expiresAt"] = now_ms + (expires_in * 1000)
        data["testStatus"] = "ok"
        data["backoffLevel"] = 0
        messages.append(f"Access token renovado com sucesso (validade: {expires_in}s)")

        return True, data, messages
