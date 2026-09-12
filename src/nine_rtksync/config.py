"""Global settings and environment variable loading for 9RTKSync."""

import os
import sys
from dataclasses import dataclass
from typing import List, Optional, Tuple

from .auth import (
    RECOVERY_FILE_NAME,
    ensure_recovery_hash,
    read_stored_credentials,
    read_db_credentials,
    write_db_credentials,
    validate_password_strength,
    resolve_recovery_hash,
    verify_credentials,
)


def _is_truthy(val: str) -> bool:
    return str(val or "").strip().lower() in ("1", "true", "yes", "on")


def load_dotenv(dotenv_path: str = ".env") -> None:
    """Load variables from a .env file into os.environ if they are not already set."""
    if not os.path.isfile(dotenv_path):
        return
    try:
        with open(dotenv_path, "r", encoding="utf-8") as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip()
                if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                    v = v[1:-1]
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception:
        pass


@dataclass
class Settings:
    """Runtime configuration for 9RTKSync synchronizer."""
    db_path: str
    sync_interval: int = 300
    refresh_margin: int = 900
    enable_web: bool = True
    host_home: str = ""
    web_host: str = "0.0.0.0"
    web_port: int = 9090
    router_url: str = "http://127.0.0.1:20128"
    module: str = "all"
    credential_paths: List[str] = None
    dashboard_user: str = "admin"
    # Sem senha de fabrica: um valor estatico e, por definicao, uma credencial
    # publica. O primeiro acesso e feito com a credencial de recuperacao, que e
    # sorteada no primeiro boot e gravada com modo 0600.
    dashboard_password: str = ""
    cron_interval: int = 300
    cron_enabled: bool = True
    # Validação viva das credenciais: pergunta ao provedor se a chave ainda é
    # aceita, em vez de pintar a linha de verde só porque existe uma chave.
    validate_credentials: bool = True
    validation_timeout: float = 8.0
    # Quando DASHBOARD_USER/DASHBOARD_PASSWORD vêm explicitamente do ambiente, elas
    # passam a ser a fonte de verdade e o arquivo salvo pela tela é ignorado. É o
    # que permite operar 100% headless (Docker, Kubernetes, CI) sem abrir o painel.
    dashboard_auth_from_env: bool = False

    def get_recovery_file_path(self) -> str:
        """Caminho do arquivo que guarda o hash de recuperação gerado localmente."""
        return os.path.join(os.path.dirname(self.get_auth_file_path()), RECOVERY_FILE_NAME)

    def get_recovery_hash(self) -> str:
        """Hash de recuperação em vigor (ambiente ou gerado no primeiro boot)."""
        return resolve_recovery_hash(self.get_recovery_file_path())

    def ensure_recovery_hash(self) -> Tuple[str, bool]:
        """Garante a existência do hash de recuperação. Devolve (hash, foi_gerado_agora)."""
        return ensure_recovery_hash(self.get_recovery_file_path())

    def get_stored_credentials(self) -> Optional[Tuple[str, str]]:
        """Credenciais gravadas pela tela, ou None quando o ambiente é autoritativo."""
        if self.dashboard_auth_from_env:
            return None
        # O SQLite do painel e a fonte de verdade; o .dashboard_auth.json so
        # existe para nao trancar quem ja tinha senha antes desta mudanca.
        return read_db_credentials(self.get_prefs_path()) or read_stored_credentials(
            self.get_auth_file_path()
        )

    def verify_credentials(self, user: str, password: str) -> bool:
        """Valida um par usuário/senha, incluindo a credencial de recuperação."""
        return verify_credentials(
            user,
            password,
            stored=self.get_stored_credentials(),
            factory_user=self.dashboard_user,
            factory_password=self.dashboard_password,
            recovery_hash=self.get_recovery_hash(),
        )

    def get_prefs_path(self) -> str:
        """Banco SQLite do painel, onde vivem preferencias e credenciais."""
        from .prefs import resolve_prefs_path

        return resolve_prefs_path(os.path.dirname(self.get_auth_file_path()))

    def has_stored_password(self) -> bool:
        """Se ja existe senha definida pelo usuario no banco do painel."""
        if self.dashboard_auth_from_env:
            return True
        return read_db_credentials(self.get_prefs_path()) is not None

    def get_auth_file_path(self) -> str:
        """Return the filesystem path for persisted dashboard credentials."""
        base_dir = os.environ.get("DATA_DIR", "")
        if not base_dir and self.db_path:
            base_dir = os.path.dirname(self.db_path)
        if not base_dir or not os.path.exists(base_dir):
            base_dir = os.path.expanduser("~")
        return os.path.join(base_dir, ".dashboard_auth.json")

    def get_auth_credentials(self) -> tuple[str, str]:
        """Get active dashboard credentials (explicit env -> persisted file -> defaults)."""
        # Explicit env wins over the file: without this, a single password change
        # through the screen would leave DASHBOARD_USER/DASHBOARD_PASSWORD inert forever.
        if self.dashboard_auth_from_env:
            return self.dashboard_user, self.dashboard_password

        auth_file = self.get_auth_file_path()
        if os.path.exists(auth_file):
            try:
                import json
                with open(auth_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                u = data.get("user") or self.dashboard_user
                p = data.get("password") or self.dashboard_password
                if u and p:
                    return str(u), str(p)
            except Exception:
                pass
        return self.dashboard_user, self.dashboard_password

    def is_default_password(self) -> bool:
        """Se o painel ainda roda sem senha propria.

        O aviso de seguranca depende disto: ele some assim que existe uma senha
        gravada no SQLite, e nao quando o texto deixa de ser "pathbit".
        """
        return not self.has_stored_password()

    def check_password_strength(self, new_pass: str) -> list:
        """Chaves de traducao das regras de senha que o valor nao cumpre."""
        return validate_password_strength(new_pass)

    def update_auth_credentials(self, user: str, new_pass: str) -> bool:
        """Grava as credenciais do painel no SQLite, como hash.

        Recusa senha fraca: a politica de forca e obrigatoria. Em modo headless
        o ambiente e imutavel pela tela, e gravar aqui criaria estado fantasma
        que get_auth_credentials nunca leria.
        """
        if self.dashboard_auth_from_env:
            return False

        new_pass = (new_pass or "").strip()
        if validate_password_strength(new_pass):
            return False

        final_user = (user or "").strip() or "admin"
        if not write_db_credentials(self.get_prefs_path(), final_user, new_pass):
            return False

        self.dashboard_user = final_user
        self.dashboard_password = new_pass
        # O arquivo em texto puro perde a razao de existir assim que a senha
        # passa a viver no banco.
        try:
            os.remove(self.get_auth_file_path())
        except OSError:
            pass
        return True

    @classmethod
    def from_env(cls, env_file: str = ".env") -> "Settings":
        load_dotenv(env_file)
        host_home = os.environ.get("HOST_HOME", "")
        if not host_home:
            if os.path.exists("/root/host") and os.path.isdir("/root/host"):
                host_home = "/root/host"
            elif os.path.exists("/host") and os.path.isdir("/host"):
                host_home = "/host"
            else:
                host_home = os.path.expanduser("~")

        default_paths = [
            os.environ.get("ANTIGRAVITY_TOKEN_PATH", ""),
            os.path.join(host_home, ".gemini", "oauth_creds.json"),
            os.path.join(host_home, ".gemini", "jetski-standalone-oauth-token"),
            os.path.join(host_home, ".config", "antigravity", "jetski-standalone-oauth-token"),
            "/root/.gemini/jetski-standalone-oauth-token",
        ]
        valid_paths = [p for p in default_paths if p]

        # SQLite database discovery for 9Router and OmniRoute
        db_path = os.environ.get("DB_PATH", "")
        if not db_path:
            candidate_dbs = [
                "/app/data/db/data.sqlite",
                "/app/data/data.sqlite",
                "/app/data/storage.sqlite",
                os.path.join(host_home, ".9router", "data", "db", "data.sqlite"),
                os.path.join(host_home, ".9router", "data.sqlite"),
                os.path.join(host_home, ".omniroute", "data", "storage.sqlite"),
                os.path.join(host_home, ".omniroute", "storage.sqlite"),
            ]
            for candidate in candidate_dbs:
                if os.path.exists(candidate):
                    db_path = candidate
                    break
            if not db_path:
                db_path = candidate_dbs[0]

        # Quem manda no modo "credencial gerida pelo ambiente" e a SENHA, nunca o
        # nome de usuario: nome sozinho nao e credencial. Com a regra anterior,
        # o docker-compose de exemplo (DASHBOARD_USER=admin e
        # DASHBOARD_PASSWORD vazia) marcava a autenticacao como autoritativa do
        # ambiente, e o painel recusava para sempre definir a senha pela tela.
        # A instalacao ficava presa na credencial de recuperacao e o aviso de
        # seguranca nunca sumia, porque nunca havia senha gravada no SQLite.
        env_user = os.environ.get("DASHBOARD_USER")
        env_pass = os.environ.get("DASHBOARD_PASSWORD")
        d_user = env_user or "admin"
        d_pass = env_pass or ""
        auth_from_env = bool(d_pass)

        sync_int = int(os.environ.get("SYNC_INTERVAL", "300"))
        cron_int = int(os.environ.get("CRON_INTERVAL", str(sync_int)))
        cron_on = os.environ.get("CRON_ENABLED", "1") not in ("0", "false", "no")
        validate_on = os.environ.get("CREDENTIAL_CHECK_ENABLED", "1") not in ("0", "false", "no")

        return cls(
            db_path=db_path,
            host_home=host_home,
            sync_interval=sync_int,
            refresh_margin=int(os.environ.get("REFRESH_MARGIN", "900")),
            enable_web=os.environ.get("ENABLE_WEB_DASHBOARD", "1") not in ("0", "false", "no"),
            web_host=os.environ.get("WEB_HOST", "0.0.0.0"),
            web_port=int(os.environ.get("WEB_PORT", "9090")),
            router_url=os.environ.get("ROUTER_URL", "http://127.0.0.1:20128"),
            module=os.environ.get("MODULE", "all"),
            credential_paths=valid_paths,
            dashboard_user=d_user,
            dashboard_password=d_pass,
            cron_interval=cron_int,
            cron_enabled=cron_on,
            validate_credentials=validate_on,
            validation_timeout=float(os.environ.get("CREDENTIAL_CHECK_TIMEOUT", "8")),
            dashboard_auth_from_env=auth_from_env,
        )
