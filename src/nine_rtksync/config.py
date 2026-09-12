"""Configurações globais e carregamento de variáveis de ambiente para o 9rtksync."""

import os
import sys
from dataclasses import dataclass
from typing import List


def _is_truthy(val: str) -> bool:
    return str(val or "").strip().lower() in ("1", "true", "yes", "on")


@dataclass
class Settings:
    """Configurações de execução do sincronizador."""
    db_path: str
    sync_interval: int = 300
    refresh_margin: int = 900
    enable_web: bool = True
    web_host: str = "0.0.0.0"
    web_port: int = 9190
    module: str = "all"
    credential_paths: List[str] = None

    @classmethod
    def from_env(cls) -> "Settings":
        home = os.path.expanduser("~")
        default_paths = [
            os.environ.get("ANTIGRAVITY_TOKEN_PATH", ""),
            "/root/.gemini/jetski-standalone-oauth-token",
            os.path.join(home, ".gemini", "jetski-standalone-oauth-token"),
            os.path.join(home, ".config", "antigravity", "jetski-standalone-oauth-token"),
        ]
        valid_paths = [p for p in default_paths if p]

        # Descoberta de banco SQLite do 9Router
        db_path = os.environ.get("DB_PATH", "")
        if not db_path:
            candidate_dbs = [
                "/app/data/db/data.sqlite",
                "/app/data/data.sqlite",
                os.path.join(home, ".9router", "data", "db", "data.sqlite"),
                os.path.join(home, ".9router", "data.sqlite"),
            ]
            for candidate in candidate_dbs:
                if os.path.exists(candidate):
                    db_path = candidate
                    break
            if not db_path:
                db_path = candidate_dbs[0]

        return cls(
            db_path=db_path,
            sync_interval=int(os.environ.get("SYNC_INTERVAL", "300")),
            refresh_margin=int(os.environ.get("REFRESH_MARGIN", "900")),
            enable_web=os.environ.get("ENABLE_WEB_DASHBOARD", "1") not in ("0", "false", "no"),
            web_host=os.environ.get("WEB_HOST", "0.0.0.0"),
            web_port=int(os.environ.get("WEB_PORT", "9190")),
            module=os.environ.get("MODULE", "all"),
            credential_paths=valid_paths,
        )
