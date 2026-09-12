"""Handler for local and OpenAI-compatible providers (Ollama, vLLM, LMStudio)."""

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from ..models import ConnectionRecord
from .base import BaseProvider

# Catalog endpoints, in attempt order: Ollama-native and the OpenAI standard.
MODEL_CATALOG_PATHS = ("/api/tags", "/v1/models", "/models")
PROBE_TIMEOUT_SECONDS = 3.0


class LocalProvider(BaseProvider):
    """Health monitor for local instances and OpenAI-compatible proxies."""

    def can_handle(self, conn: ConnectionRecord) -> bool:
        return conn.is_local

    def discover_models(self, base_url: str, api_key: str = "") -> Tuple[List[str], str]:
        """Query the local instance catalog.

        Returns ``(models, error)``. An **empty error means the instance
        answered**, even with an empty catalog: a freshly installed Ollama with
        no model pulled is online, and reporting it as unreachable would light
        up the panel for a service that is working.
        """
        if not base_url:
            return [], "baseUrl not declared on the connection"

        root = base_url.rstrip("/")
        # An OpenAI-shaped baseUrl already ends in /v1; the root serves /api/tags.
        origin = root[: -len("/v1")] if root.endswith("/v1") else root
        last_error = ""
        answered = False

        for path in MODEL_CATALOG_PATHS:
            target = f"{origin}{path}" if path.startswith("/api") else f"{root}{path}"
            try:
                req = urllib.request.Request(target, headers={"User-Agent": "9RTKSync-LocalProbe/1.0"})
                if api_key:
                    req.add_header("Authorization", f"Bearer {api_key}")
                with urllib.request.urlopen(req, timeout=PROBE_TIMEOUT_SECONDS) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                # The host answered, this path just is not the right one — keep trying.
                last_error = str(e)
                continue
            except (urllib.error.URLError, OSError) as e:
                # Nothing is listening: trying the remaining paths only multiplies the
                # timeout (3 endpoints x 3s) on every sweep. Give up now.
                return [], str(e)
            except ValueError as e:
                last_error = str(e)
                continue

            # Chegar aqui significa resposta HTTP valida e JSON parseavel: o
            # servico esta de pe, tendo modelo ou nao.
            answered = True
            models = self._extract_model_names(payload)
            if models:
                return models, ""

        if answered:
            return [], ""
        return [], last_error or "no model returned by the local instance"

    @staticmethod
    def _extract_model_names(payload: Any) -> List[str]:
        """Extract model names from the Ollama (/api/tags) and OpenAI (/v1/models) shapes."""
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

        # Remove any accidental rate limit locks
        if data.get("rateLimitedUntil"):
            del data["rateLimitedUntil"]
            data["backoffLevel"] = 0
            modified = True
            messages.append("Removed rateLimitedUntil lock from local connection")

        # Discover the models the local instance serves, so the panel can show them.
        models, probe_error = self.discover_models(conn.base_url or "", conn.api_key or "")
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        # Erro vazio significa que a instancia respondeu -- com catalogo cheio ou
        # vazio. Uma instalacao recem-feita, sem modelo baixado, esta no ar.
        if models or not probe_error:
            # Inclui o caso de esvaziar: uma instancia que tinha modelos e
            # passou a nao ter precisa deixar de exibi-los, senao a tela mostra
            # para sempre um catalogo que nao existe mais.
            if data.get("discoveredModels") != models:
                data["discoveredModels"] = models
                modified = True
            if models:
                messages.append(
                    f"Local instance answered with {len(models)} model(s): {', '.join(models[:5])}"
                )
            else:
                messages.append("Local instance answered with an empty model catalog")

            if data.get("testStatus") != "active":
                data["testStatus"] = "active"
                data["lastTested"] = now_iso
                modified = True
                messages.append("Local status marked as operational (active)")
        else:
            # With no catalog response the connection is not assumed healthy: this is
            # exactly the "the local Ollama went down and nobody noticed" case.
            messages.append(f"Local instance did not answer the model catalog: {probe_error}")
            if data.get("testStatus") != "unreachable":
                data["testStatus"] = "unreachable"
                data["lastError"] = probe_error
                data["lastTested"] = now_iso
                modified = True

        # Uma sondagem local nunca renova credencial: ela descobre catalogo e
        # estado. O primeiro elemento e a contagem de renovacao do ciclo, entao
        # aqui e sempre False; o dado segue para ser gravado assim mesmo.
        return False, data if modified else None, messages

