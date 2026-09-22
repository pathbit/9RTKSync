"""Static API key connection handler."""

from typing import Any, Dict, List, Optional, Tuple

from ..credential_check import (
    DEFAULT_TIMEOUT_SECONDS,
    STATE_INVALID,
    STATE_RATE_LIMITED,
    STATE_UNREACHABLE,
    STATE_VALID,
    check_api_key,
)
from ..models import ConnectionRecord
from .base import BaseProvider


class ApiKeyProvider(BaseProvider):
    """Health monitor for static API key providers.

    Validation is off by default in constructors that do not ask for it, so a
    test or a dry run never reaches out to the internet by accident.
    """

    def __init__(
        self,
        discovery: Optional[Any] = None,
        validate_credentials: bool = False,
        validation_timeout: float = DEFAULT_TIMEOUT_SECONDS,
        opener: Optional[Any] = None,
    ):
        self.discovery = discovery
        self.validate_credentials = validate_credentials
        self.validation_timeout = validation_timeout
        self.opener = opener

    def can_handle(self, conn: ConnectionRecord) -> bool:
        # Uma instancia local carrega uma chave de fachada, entao `has_api_key`
        # sozinho tambem casaria com ela. Como este provider vem antes do
        # LocalProvider na lista, o laco daria break aqui e o catalogo local
        # nunca seria descoberto -- e por isso que o Ollama local aparecia sem
        # modelo nenhum no painel.
        return conn.has_api_key and not conn.is_local

    def check_and_refresh(
        self, conn: ConnectionRecord, margin_seconds: int = 900, **kwargs
    ) -> Tuple[bool, Optional[Dict[str, Any]], List[str]]:
        messages: List[str] = []
        data = dict(conn.data)
        # `modified` decide se vale gravar no banco; `renewed` decide se conta
        # como renovacao no resumo do ciclo. Sao coisas diferentes: carimbar o
        # horario de uma verificacao muda a linha, mas nao renovou credencial
        # nenhuma -- e contar isso inflava o "N renovadas" do cron.
        modified = False
        renewed = False

        # 1. Check if newer API key was discovered on host
        if self.discovery:
            local = self.discovery.get_credential_for_provider(conn.provider)
            if local and local.get("apiKey") and local.get("apiKey") != data.get("apiKey"):
                data["apiKey"] = local["apiKey"]
                modified = True
                renewed = True
                src = local.get("source_path", "host")
                messages.append(f"API key synchronized from host local credential ({src})")

        # 2. Unlock and clean rate limiting
        if data.get("rateLimitedUntil"):
            del data["rateLimitedUntil"]
            data["backoffLevel"] = 0
            modified = True
            messages.append("Proactively removed rateLimitedUntil lock")

        # 3. Ask the provider whether the key still works.
        #
        # This used to stamp testStatus = "ok" unconditionally, which is why the
        # panel showed every API key as healthy: nothing had ever been verified,
        # and a revoked key stayed green until a real request failed.
        if self.validate_credentials:
            result = check_api_key(
                conn.provider,
                # `data` ja pode conter a chave recem-descoberta no passo 1;
                # usar `conn.api_key` mandaria a chave velha ao provedor e
                # gravaria "invalida" justamente quando ela acabou de ser
                # consertada.
                str(data.get("apiKey") or conn.api_key or ""),
                base_url=conn.base_url,
                timeout=self.validation_timeout,
                opener=self.opener,
            )
            data.update(result.to_dict())
            data["lastTested"] = result.checked_at
            modified = True

            if result.state == STATE_VALID:
                data["testStatus"] = "active"
                # A 4xx other than 401/403 still proves authentication went
                # through -- the probe sends an empty body on purpose, and the
                # provider only gets to complain about the body after it has
                # accepted the key. Saying just "accepted (HTTP 400)" made the
                # screen look wrong; the sentence now explains the number.
                messages.append(
                    f"Authentication accepted by the provider ({result.detail})"
                    if result.detail and "200" in str(result.detail)
                    else f"Authentication accepted; the probe request itself was refused ({result.detail})"
                )
            elif result.state == STATE_INVALID:
                # Do not claim health the provider just denied.
                data["testStatus"] = "invalid"
                messages.append(f"API key REJECTED by the provider ({result.detail})")
            elif result.state == STATE_RATE_LIMITED:
                messages.append(f"Provider rate limited the validation ({result.detail})")
            elif result.state == STATE_UNREACHABLE:
                messages.append(f"Key not verified: {result.detail}")
            else:
                messages.append(result.detail or "Credential not verifiable")

        if not messages:
            messages.append("API key unchanged")

        return renewed, data if modified else None, messages

