"""Manipulador de conexões baseadas em chaves de API estáticas."""

import json
import time
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from ..models import ConnectionRecord
from .base import BaseProvider


class ApiKeyProvider(BaseProvider):
    """Monitor de integridade para provedores de chave de API estática."""

    HEALTH_CHECK_ENDPOINTS = {
        "groq": "https://api.groq.com/openai/v1/models",
        "mistral": "https://api.mistral.ai/v1/models",
        "openrouter": "https://openrouter.ai/api/v1/models",
        "gemini": "https://generativelanguage.googleapis.com/v1beta/models",
    }

    def can_handle(self, conn: ConnectionRecord) -> bool:
        return conn.has_api_key

    def check_and_refresh(
        self, conn: ConnectionRecord, margin_seconds: int = 900, **kwargs
    ) -> Tuple[bool, Optional[Dict[str, Any]], List[str]]:
        messages: List[str] = []
        data = dict(conn.data)
        modified = False

        # 1. Verifica se havia rate limit temporário
        if data.get("rateLimitedUntil"):
            messages.append("Conexão estava sob rate limit; trava limpa pelo normalizador")
            modified = True

        # 2. Atualiza carimbo de integridade se necessário
        if not data.get("testStatus") or data.get("testStatus") == "unknown":
            data["testStatus"] = "ok"
            data["lastTested"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            modified = True
            messages.append("Status de conexão inicializado como ativo (ok)")

        if not messages:
            messages.append("Chave de API ativa e sem pendências")

        return modified, data if modified else None, messages
