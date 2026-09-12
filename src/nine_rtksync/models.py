"""Data models for connections, credentials, and health states in 9Router."""

import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class ConnectionRecord:
    """Represents a row from the providerConnections table in 9Router SQLite."""
    id: str
    provider: str
    name: str
    created_at: str
    updated_at: str
    data_raw: str
    data: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if self.data_raw and not self.data:
            try:
                self.data = json.loads(self.data_raw)
            except Exception:
                self.data = {}

    @property
    def is_oauth(self) -> bool:
        """Check whether the connection uses an OAuth token flow."""
        return bool(self.data.get("refreshToken") or self.data.get("accessToken"))

    @property
    def has_api_key(self) -> bool:
        """Check whether the connection is authenticated via static API key."""
        return bool(self.data.get("apiKey"))

    @property
    def access_token(self) -> Optional[str]:
        return self.data.get("accessToken")

    @property
    def refresh_token(self) -> Optional[str]:
        return self.data.get("refreshToken")

    @property
    def api_key(self) -> Optional[str]:
        return self.data.get("apiKey")

    # Provider names that identify a local / OpenAI-compatible instance.
    LOCAL_PROVIDER_MARKERS = ("ollama", "vllm", "lmstudio", "llamacpp", "localai", "openai-compatible")

    @property
    def is_local(self) -> bool:
        """Whether the connection points at a local instance (Ollama, vLLM, LM Studio...).

        A local instance usually needs a facade API key, so checking has_api_key
        alone would classify it as a cloud provider.
        """
        provider = self.provider.lower()
        if any(marker in provider for marker in self.LOCAL_PROVIDER_MARKERS):
            return True
        base_url = str(self.data.get("baseUrl") or "")
        return any(host in base_url for host in ("localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"))

    @property
    def base_url(self) -> Optional[str]:
        """Provider base URL, when declared."""
        return self.data.get("baseUrl") or self.data.get("baseURL") or None

    @property
    def local_models(self) -> list:
        """Models discovered on the local instance during the last sweep."""
        models = self.data.get("discoveredModels") or self.data.get("models") or []
        if isinstance(models, str):
            return [models]
        return [str(m) for m in models if m]

    @property
    def expires_at_ms(self) -> Optional[int]:
        """Return normalized expiration timestamp in epoch milliseconds, if applicable."""
        val = self.data.get("expiresAt")
        if isinstance(val, (int, float)) and val > 0:
            # If epoch is in seconds (e.g. 1.7e9), convert to milliseconds
            if val < 1e11:
                return int(val * 1000)
            return int(val)
        return None

    @property
    def remaining_seconds(self) -> Optional[int]:
        """Seconds remaining before credential expires."""
        exp = self.expires_at_ms
        if exp is None:
            return None
        now_ms = int(time.time() * 1000)
        return int((exp - now_ms) / 1000)

    @property
    def is_expired(self) -> bool:
        """Check whether the credential has already expired."""
        rem = self.remaining_seconds
        return rem is not None and rem <= 0

    @property
    def health_status(self) -> str:
        """Semantic classification of connection health."""
        if self.is_oauth:
            rem = self.remaining_seconds
            if rem is None:
                return "no_expiration"
            if rem <= 0:
                return "expired"
            if rem < 900:
                return "expiring_soon"
            return "active"
        if self.has_api_key:
            if self.data.get("rateLimitedUntil"):
                return "rate_limited"
            return "active"
        if self.is_local:
            # A local instance is only healthy when its model catalog answered.
            return "unknown" if self.data.get("testStatus") == "unreachable" else "active"
        # 9Router writes "ok", OmniRoute writes "active"; both mean healthy.
        return "active" if self.data.get("testStatus") in ("ok", "active") else "unknown"
