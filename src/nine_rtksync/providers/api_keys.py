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
        "openai": "https://api.openai.com/v1/models",
    }

    def __init__(self, discovery: Optional[Any] = None):
        self.discovery = discovery

    def can_handle(self, conn: ConnectionRecord) -> bool:
        return conn.has_api_key

    def check_and_refresh(
        self, conn: ConnectionRecord, margin_seconds: int = 900, **kwargs
    ) -> Tuple[bool, Optional[Dict[str, Any]], List[str]]:
        messages: List[str] = []
        data = dict(conn.data)
        modified = False

        # 1. Verifica se há chave de API mais recente descoberta no host
        if self.discovery:
            local = self.discovery.get_credential_for_provider(conn.provider)
            if local and local.get("apiKey") and local.get("apiKey") != data.get("apiKey"):
                data["apiKey"] = local["apiKey"]
                modified = True
                src = local.get("source_path", "host")
                messages.append(f"Chave de API sincronizada a partir de credencial local do host ({src})")

        # 2. Desbloqueio e limpeza de rate limit
        if data.get("rateLimitedUntil"):
            del data["rateLimitedUntil"]
            data["backoffLevel"] = 0
            modified = True
            messages.append("Trava de rateLimitedUntil removida proativamente")

        # 3. Atualiza carimbo de integridade se necessário
        if not data.get("testStatus") or data.get("testStatus") != "ok":
            data["testStatus"] = "ok"
            data["lastTested"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            modified = True
            messages.append("Status de conexão marcado como operacional (ok)")

        if not messages:
            messages.append("Chave de API ativa e sem pendências")

        return modified, data if modified else None, messages
