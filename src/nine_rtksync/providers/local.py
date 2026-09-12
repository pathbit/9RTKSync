"""Manipulador para provedores locais e compatíveis com OpenAI (Ollama, vLLM, LMStudio)."""

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from ..models import ConnectionRecord
from .base import BaseProvider

# Endpoints de catálogo, na ordem de tentativa: nativo do Ollama e o padrão OpenAI.
MODEL_CATALOG_PATHS = ("/api/tags", "/v1/models", "/models")
PROBE_TIMEOUT_SECONDS = 3.0


class LocalProvider(BaseProvider):
    """Monitor de integridade para instâncias locais e proxies compatíveis com OpenAI."""

    def can_handle(self, conn: ConnectionRecord) -> bool:
        return conn.is_local

    def discover_models(self, base_url: str, api_key: str = "") -> Tuple[List[str], str]:
        """Consulta o catálogo da instância local. Devolve (modelos, erro)."""
        if not base_url:
            return [], "baseUrl não declarada na conexão"

        root = base_url.rstrip("/")
        # Uma baseUrl no formato OpenAI já termina em /v1; a raiz serve /api/tags.
        origin = root[: -len("/v1")] if root.endswith("/v1") else root
        last_error = ""

        for path in MODEL_CATALOG_PATHS:
            target = f"{origin}{path}" if path.startswith("/api") else f"{root}{path}"
            try:
                req = urllib.request.Request(target, headers={"User-Agent": "9RTKSync-LocalProbe/1.0"})
                if api_key:
                    req.add_header("Authorization", f"Bearer {api_key}")
                with urllib.request.urlopen(req, timeout=PROBE_TIMEOUT_SECONDS) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
            except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError) as e:
                last_error = str(e)
                continue

            models = self._extract_model_names(payload)
            if models:
                return models, ""

        return [], last_error or "nenhum modelo retornado pela instância local"

    @staticmethod
    def _extract_model_names(payload: Any) -> List[str]:
        """Extrai nomes de modelo dos formatos do Ollama (/api/tags) e da OpenAI (/v1/models)."""
        if not isinstance(payload, dict):
            return []
        entries = payload.get("models") or payload.get("data") or []
        names = []
        for entry in entries:
            if isinstance(entry, str):
                names.append(entry)
            elif isinstance(entry, dict):
                name = entry.get("name") or entry.get("id") or entry.get("model")
                if name:
                    names.append(str(name))
        return names

    def check_and_refresh(
        self, conn: ConnectionRecord, margin_seconds: int = 900, **kwargs
    ) -> Tuple[bool, Optional[Dict[str, Any]], List[str]]:
        messages: List[str] = []
        data = dict(conn.data)
        modified = False

        # Remove qualquer trava de rate limit acidental
        if data.get("rateLimitedUntil"):
            del data["rateLimitedUntil"]
            data["backoffLevel"] = 0
            modified = True
            messages.append("Trava de rateLimitedUntil removida da conexão local")

        # Descobre os modelos servidos pela instância local, para o painel exibi-los.
        models, probe_error = self.discover_models(conn.base_url or "", conn.api_key or "")
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        if models:
            if data.get("discoveredModels") != models:
                data["discoveredModels"] = models
                modified = True
            messages.append(f"Instância local respondeu com {len(models)} modelo(s): {', '.join(models[:5])}")

            if data.get("testStatus") != "ok":
                data["testStatus"] = "ok"
                data["lastTested"] = now_iso
                modified = True
                messages.append("Status local marcado como operacional (ok)")
        else:
            # Sem resposta do catálogo a conexão não é dada como saudável às cegas:
            # é exatamente o caso "o Ollama local caiu e ninguém percebeu".
            messages.append(f"Instância local não respondeu ao catálogo de modelos: {probe_error}")
            if data.get("testStatus") != "unreachable":
                data["testStatus"] = "unreachable"
                data["lastError"] = probe_error
                data["lastTested"] = now_iso
                modified = True

        return modified, data if modified else None, messages
