"""Generic OAuth connection handler (Claude, GitHub, Kiro, Codex, Windsurf)."""

import json
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from ..models import ConnectionRecord
from .base import BaseProvider


class GenericOAuthProvider(BaseProvider):
    """Monitor and synchronizer for generic OAuth providers."""

    KNOWN_TOKEN_URLS = {
        "claude": "https://api.anthropic.com/v1/oauth/token",
        "github": "https://github.com/login/oauth/access_token",
        "kiro": "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken",
        "codex": "https://auth.openai.com/oauth/token",
        "kimi": "https://api.moonshot.cn/v1/oauth/token",
    }

    def __init__(self, discovery: Optional[Any] = None):
        self.discovery = discovery

    def can_handle(self, conn: ConnectionRecord) -> bool:
        return conn.is_oauth and conn.provider not in ("antigravity", "gemini-cli")

    def check_and_refresh(
        self, conn: ConnectionRecord, margin_seconds: int = 900, **kwargs
    ) -> Tuple[bool, Optional[Dict[str, Any]], List[str]]:
        messages: List[str] = []
        data = dict(conn.data)
        now_ms = int(time.time() * 1000)

        # 1. Check if matching credential was discovered on host
        if self.discovery:
            local = self.discovery.get_credential_for_provider(conn.provider)
            if local and local.get("accessToken") and local.get("accessToken") != data.get("accessToken"):
                data["accessToken"] = local["accessToken"]
                if local.get("refreshToken"):
                    data["refreshToken"] = local["refreshToken"]
                data["expiresAt"] = now_ms + (3599 * 1000)
                data["testStatus"] = "ok"
                src = local.get("source_path", "host")
                messages.append(f"Token synchronized from host local credential ({src})")
                return True, data, messages

        rem = conn.remaining_seconds

        if rem is None:
            messages.append("OAuth connection has no temporal expiry record (long-lived or unlimited token)")
            return False, None, messages

        if rem > margin_seconds:
            messages.append(f"Token valid for another {rem // 60} min ({rem}s remaining)")
            return False, None, messages

        # Reached renewal margin
        refresh_token = data.get("refreshToken")
        if not refresh_token:
            messages.append("Token expiring but no refreshToken stored in connection")
            return False, None, messages

        # Attempt renewal if token URL is known or client credentials exist
        token_url = self.KNOWN_TOKEN_URLS.get(conn.provider) or data.get("tokenUrl")
        client_id = data.get("clientId")
        client_secret = data.get("clientSecret")

        if token_url and client_id:
            try:
                body = {
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": client_id,
                }
                if client_secret:
                    body["client_secret"] = client_secret

                payload = urllib.parse.urlencode(body).encode("utf-8")
                req = urllib.request.Request(
                    token_url,
                    data=payload,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "application/json",
                        "User-Agent": "9rtksync/1.0",
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=15.0) as resp:
                    res_data = json.loads(resp.read().decode("utf-8"))
                    new_token = res_data.get("access_token") or res_data.get("accessToken")
                    if new_token:
                        data["accessToken"] = new_token
                        if res_data.get("refresh_token"):
                            data["refreshToken"] = res_data["refresh_token"]
                        now_ms = int(time.time() * 1000)
                        exp_in = int(res_data.get("expires_in", 3600))
                        data["expiresAt"] = now_ms + (exp_in * 1000)
                        data["testStatus"] = "ok"
                        messages.append(f"OAuth token renewed successfully via endpoint ({exp_in}s)")
                        return True, data, messages
            except Exception as e:
                messages.append(f"Automatic refresh attempt via endpoint returned: {e}")

        messages.append(f"Notice: Token expires in {rem}s and awaits on-demand gateway refresh")
        return False, None, messages

