"""Modelos de dados para conexões, credenciais e estados de saúde no 9Router."""

import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class ConnectionRecord:
    """Representa uma linha da tabela providerConnections no SQLite do 9Router."""
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
        """Indica se a conexão utiliza fluxo de tokens OAuth."""
        return bool(self.data.get("refreshToken") or self.data.get("accessToken"))

    @property
    def has_api_key(self) -> bool:
        """Indica se a conexão é autenticada por chave estática de API."""
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

    # Nomes de provedor que identificam uma instancia local / compativel com OpenAI.
    LOCAL_PROVIDER_MARKERS = ("ollama", "vllm", "lmstudio", "llamacpp", "localai", "openai-compatible")

    @property
    def is_local(self) -> bool:
        """Indica se a conexao aponta para uma instancia local (Ollama, vLLM, LM Studio...).

        Uma instancia local costuma exigir uma chave de API de fachada, entao
        checar apenas has_api_key a classificaria como provedor de nuvem.
        """
        provider = self.provider.lower()
        if any(marker in provider for marker in self.LOCAL_PROVIDER_MARKERS):
            return True
        base_url = str(self.data.get("baseUrl") or "")
        return any(host in base_url for host in ("localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"))

    @property
    def base_url(self) -> Optional[str]:
        """URL base do provedor, quando declarada."""
        return self.data.get("baseUrl") or self.data.get("baseURL") or None

    @property
    def local_models(self) -> list:
        """Modelos descobertos na instancia local na ultima varredura."""
        models = self.data.get("discoveredModels") or self.data.get("models") or []
        if isinstance(models, str):
            return [models]
        return [str(m) for m in models if m]

    @property
    def expires_at_ms(self) -> Optional[int]:
        """Devolve a expiração normalizada em milissegundos epoch, se aplicável."""
        val = self.data.get("expiresAt")
        if isinstance(val, (int, float)) and val > 0:
            # Se for epoch em segundos (ex: 1.7e9), converte para milissegundos
            if val < 1e11:
                return int(val * 1000)
            return int(val)
        return None

    @property
    def remaining_seconds(self) -> Optional[int]:
        """Segundos restantes de validade da credencial."""
        exp = self.expires_at_ms
        if exp is None:
            return None
        now_ms = int(time.time() * 1000)
        return int((exp - now_ms) / 1000)

    @property
    def is_expired(self) -> bool:
        """Determina se a credencial já expirou."""
        rem = self.remaining_seconds
        return rem is not None and rem <= 0

    @property
    def health_status(self) -> str:
        """Classificação semântica do estado da conexão."""
        if self.is_oauth:
            rem = self.remaining_seconds
            if rem is None:
                return "sem_expiracao"
            if rem <= 0:
                return "expirado"
            if rem < 900:
                return "expirando_em_breve"
            return "ativo"
        if self.has_api_key:
            if self.data.get("rateLimitedUntil"):
                return "rate_limited"
            return "ativo"
        if self.is_local:
            return "ativo"
        # O gateway usa "ok" e o OmniRoute usa "active"; ambos significam saudavel.
        return "ativo" if self.data.get("testStatus") in ("ok", "active") else "desconhecido"
