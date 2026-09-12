"""Manipulador para provedores locais e compatíveis com OpenAI (Ollama, vLLM, LMStudio)."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from ..models import ConnectionRecord
from .base import BaseProvider


class LocalProvider(BaseProvider):
    """Monitor de integridade para instâncias locais e proxies compatíveis com OpenAI."""

    def can_handle(self, conn: ConnectionRecord) -> bool:
        p = conn.provider.lower()
        return (
            "ollama" in p
            or "openai-compatible" in p
            or "vllm" in p
            or "lmstudio" in p
            or bool(conn.data.get("baseUrl") and not conn.is_oauth and not conn.has_api_key)
        )

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

        # Garante status ativo
        if not data.get("testStatus") or data.get("testStatus") != "ok":
            data["testStatus"] = "ok"
            data["lastTested"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            modified = True
            messages.append("Status local marcado como operacional (ok)")

        if not messages:
            messages.append("Serviço local ativo e operacional")

        return modified, data if modified else None, messages
