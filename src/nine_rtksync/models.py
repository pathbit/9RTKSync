"""Data models for connections, credentials, and health states in 9Router."""

import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Margem em que uma credencial ja conta como "expirando" na tela. Vale para a
# conexao e para a chave virtual, para que o mesmo prazo pinte o mesmo amarelo
# nos dois cartoes.
EXPIRING_SOON_SECONDS = 900


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

    # Provider names that suggest a local / OpenAI-compatible instance. A marker
    # alone is not proof: "ollama" is also the name of Ollama Cloud, which is a
    # hosted service and must never be probed on /api/tags.
    LOCAL_PROVIDER_MARKERS = ("ollama", "vllm", "lmstudio", "llamacpp", "localai", "openai-compatible")
    LOCAL_HOSTS = ("localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal", ".local")

    @property
    def is_local(self) -> bool:
        """Whether the connection really points at an instance on this machine.

        Classification is driven by the address, not by the provider name. Only
        when no address is declared does a marker like "openai-compatible" --
        which has no hosted counterpart -- stand on its own.
        """
        base_url = str(self.base_url or "").lower()
        if base_url:
            return any(host in base_url for host in self.LOCAL_HOSTS)

        # No address: "openai-compatible" only exists as a self-hosted endpoint,
        # whereas "ollama" without a baseUrl is the cloud account.
        return "openai-compatible" in self.provider.lower()

    @property
    def base_url(self) -> Optional[str]:
        """Provider base URL, when declared.

        9Router keeps it inside providerSpecificData, not at the root of data --
        reading only the root is why local instances used to show no models.
        """
        specific = self.data.get("providerSpecificData")
        if isinstance(specific, dict):
            nested = specific.get("baseUrl") or specific.get("baseURL")
            if nested:
                return nested
        return self.data.get("baseUrl") or self.data.get("baseURL") or None

    @property
    def local_models(self) -> list:
        """Models discovered on the local instance during the last sweep."""
        models = self.data.get("discoveredModels") or self.data.get("models") or []
        if isinstance(models, str):
            return [models]
        return [str(m) for m in models if m]

    @property
    def egress_binding(self) -> Optional[str]:
        """Proxy pool this connection egresses through, when one is bound.

        Read-only: the binding is owned by the gateway, and 9Router keeps it in
        ``providerSpecificData`` as ``proxyPoolId`` plus the per-connection
        ``connectionProxyEnabled`` switch. It is surfaced here because an
        account that shares one outbound address with every other account is
        the state operators most want to notice, and nothing in the panel used
        to show it.
        """
        specific = self.data.get("providerSpecificData")
        if not isinstance(specific, dict):
            return None
        if specific.get("connectionProxyEnabled") is not True:
            return None
        pool = specific.get("proxyPoolId")
        return str(pool) if pool else None

    @property
    def egress_status(self) -> str:
        """One of: ``bound`` (own pool), ``shared`` (gateway default), ``unknown``."""
        specific = self.data.get("providerSpecificData")
        if not isinstance(specific, dict):
            return "unknown"
        if specific.get("connectionProxyEnabled") is True and specific.get("proxyPoolId"):
            return "bound"
        return "shared"

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
    def last_refresh_at(self) -> Optional[str]:
        """Quando a credencial foi renovada/verificada pela ultima vez.

        lastRefreshAt e gravado na renovacao de OAuth; lastTested, na validacao
        da credencial. Sem expor isto, o painel diz "0 renovadas" e nao ha como
        saber se a ultima renovacao foi ha um minuto ou ha uma semana.
        """
        return (
            self.data.get("lastRefreshAt")
            or self.data.get("credentialCheckedAt")
            or self.data.get("lastTested")
            or None
        )

    @property
    def credential_state(self) -> Optional[str]:
        """Result of the last live credential probe, when one was recorded.

        Written by credential_check.py, never by the gateway.
        """
        state = self.data.get("credentialState")
        return str(state) if state else None

    @property
    def rate_limit_active(self) -> bool:
        """Whether the rate-limit hold is still in force right now.

        `rateLimitedUntil` guarda o instante em que a janela do provedor se
        reabre -- é um prazo, não uma bandeira. Tratar a mera presença do campo
        como "limitada" deixava a conexão amarela para sempre depois do primeiro
        429, já que nada apaga a marca quando o prazo vence.
        """
        from .normalizer import parse_iso_or_str_to_ms

        until = parse_iso_or_str_to_ms(self.data.get("rateLimitedUntil"))
        if until is None:
            return False
        return until > int(time.time() * 1000)

    @property
    def health_status(self) -> str:
        """Semantic classification of connection health.

        A live probe outranks everything else: a key the provider rejects is
        broken no matter what the gateway last stamped. Local instances are
        classified before the API-key branch because they carry a facade key
        and would otherwise never reach their own test.
        """
        probed = self.credential_state
        if probed in ("invalid", "rate_limited", "unreachable"):
            return probed

        if self.is_local:
            # A local instance is only healthy when its model catalog answered.
            estado = self.data.get("testStatus")
            if estado == "unreachable":
                return "unknown"
            # Conexao recem-criada nunca foi sondada, e com CRON_ENABLED=0 pode
            # nunca ser: dizer "ativa" e alegar uma saude que ninguem verificou.
            return "active" if estado in ("active", "ok", "success") else "not_checked"

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
            if self.rate_limit_active:
                return "rate_limited"
            # Never probed yet: say so instead of claiming health nobody verified.
            return "active" if probed == "valid" else "not_checked"

        # 9Router writes "ok", OmniRoute writes "active"; both mean healthy.
        return "active" if self.data.get("testStatus") in ("ok", "active", "success") else "unknown"


@dataclass
class VirtualKeyRecord:
    """Uma linha de ``apiKeys`` vista pela lente do painel.

    Chave virtual nao se renova: ela nasce e vale ate ser desativada. Por isso a
    coluna "ultima renovacao" da tabela carrega aqui a data de EMISSAO -- e o
    unico carimbo de tempo que a chave tem, e a coluna existe para casar com a
    dos irmaos.

    O material do token nunca chega a este objeto: ``get_all_api_keys`` sequer
    le a coluna ``key``.
    """

    data: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "VirtualKeyRecord":
        return cls(data=dict(row))

    @property
    def id(self) -> str:
        return str(self.data.get("id") or "")

    @property
    def name(self) -> str:
        """Como a chave se identifica na tela: o nome dado a ela, senao o id.

        O id e um UUID -- identifica sem revelar nada. O prefixo do token seria
        mais reconhecivel e esta fora de questao: e um pedaco do segredo.
        """
        return str(self.data.get("name") or self.id)

    @property
    def issued_at(self) -> Optional[str]:
        return self.data.get("createdAt")

    @property
    def machine_id(self) -> str:
        """A maquina a que o 9Router amarrou esta chave.

        Nao e credencial: e uma impressao digital da instalacao, que o proprio
        gateway devolve em ``POST /api/keys``. Aparece no modal porque e ela que
        explica por que uma chave copiada para outra maquina deixa de funcionar.
        """
        return str(self.data.get("machineId") or "")

    @property
    def revoked(self) -> bool:
        """Se o gateway ja recusa esta chave.

        O ``apiKeys`` do 9Router tem uma bandeira so (``isActive``): nao ha
        coluna de revogacao nem de banimento, entao desativada e o unico caminho
        pelo qual uma chave deixa de ser aceita aqui.
        """
        return self.data.get("isActive") is False

    @property
    def remaining_seconds(self) -> Optional[int]:
        """Sempre ``None``: a chave do 9Router nao tem prazo.

        Nao ha coluna de expiracao em ``apiKeys`` -- a chave vale ate alguem
        desativa-la. Isso e "sem expiracao" de verdade, e nao o dado ausente com
        que o OAuth precisa ter cautela.
        """
        return None

    @property
    def health_status(self) -> str:
        """Estado da chave, no mesmo vocabulario que as conexoes usam."""
        if self.revoked:
            return "invalid"
        return "no_expiration"


@dataclass
class RegisteredModelRecord:
    """Um modelo do catalogo do gateway, com a conexao que o serve.

    Modelo nao tem saude propria nem validade propria: ele responde enquanto a
    credencial da conexao que o publica for aceita. Por isso status, validade
    restante e ultima renovacao sao HERDADOS da conexao dona -- e o modal diz de
    qual conexao vieram, para que ninguem leia a linha como um veredito sobre o
    modelo em si.
    """

    data: Dict[str, Any] = field(default_factory=dict)
    connection: Optional[ConnectionRecord] = None

    @classmethod
    def from_entry(
        cls, entry: Dict[str, Any], connection: Optional[ConnectionRecord] = None
    ) -> "RegisteredModelRecord":
        return cls(data=dict(entry), connection=connection)

    @property
    def id(self) -> str:
        return str(self.data.get("id") or "")

    @property
    def name(self) -> str:
        return str(self.data.get("name") or self.id)

    @property
    def provider(self) -> str:
        return str(self.data.get("provider") or "")

    @property
    def source(self) -> str:
        """De onde o gateway tirou esta entrada do catalogo."""
        return str(self.data.get("source") or "")

    @property
    def supported_endpoints(self) -> List[str]:
        return [str(e) for e in (self.data.get("supportedEndpoints") or [])]

    @property
    def connection_name(self) -> Optional[str]:
        return self.connection.name if self.connection else None

    @property
    def health_status(self) -> str:
        # Sem conexao dona identificada (o catalogo estatico do gateway inclui
        # provedores que ninguem cadastrou aqui) nao ha o que afirmar: dizer
        # "ativo" seria inventar uma sondagem que nunca houve.
        return self.connection.health_status if self.connection else "not_checked"

    @property
    def remaining_seconds(self) -> Optional[int]:
        return self.connection.remaining_seconds if self.connection else None

    @property
    def last_refresh_at(self) -> Optional[str]:
        return self.connection.last_refresh_at if self.connection else None
