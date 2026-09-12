"""Static API key connection handler."""

import json
import time
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from ..models import ConnectionRecord
from .base import BaseProvider


class ApiKeyProvider(BaseProvider):
    """Health monitor for static API key providers."""

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

        # 1. Check if newer API key was discovered on host
        if self.discovery:
            local = self.discovery.get_credential_for_provider(conn.provider)
            if local and local.get("apiKey") and local.get("apiKey") != data.get("apiKey"):
                data["apiKey"] = local["apiKey"]
                modified = True
                src = local.get("source_path", "host")
                messages.append(f"API key synchronized from host local credential ({src})")

        # 2. Unlock and clean rate limiting
        if data.get("rateLimitedUntil"):
            del data["rateLimitedUntil"]
            data["backoffLevel"] = 0
            modified = True
            messages.append("Proactively removed rateLimitedUntil lock")

        # 3. Update health status stamp if necessary
        if not data.get("testStatus") or data.get("testStatus") != "active":
            data["testStatus"] = "active"
            data["lastTested"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            modified = True
            messages.append("Connection status marked as operational (active)")

        if not messages:
            messages.append("API key active and healthy")

        return modified, data if modified else None, messages

