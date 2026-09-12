"""Servidor HTTP multi-thread e dashboard web embutido do 9RTKSync."""

import base64
import json
import os
import threading
import time
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Callable, Dict, Optional

from ..config import Settings
from ..database import get_all_combos, get_all_connections
from ..models import ConnectionRecord


class DashboardHandler(BaseHTTPRequestHandler):
    """Handler HTTP para servir o dashboard, API REST e agendador cron com Basic Auth."""

    settings: Optional[Settings] = None
    sync_trigger_callback: Optional[Callable[[], Dict[str, Any]]] = None
    cron_scheduler: Optional[Any] = None
    db_path: str = ""
    router_url: str = ""

    def log_message(self, format, *args):
        pass

    def check_auth(self) -> bool:
        if not self.settings:
            return True

        expected_user, expected_pass = self.settings.get_auth_credentials()
        auth_header = self.headers.get("Authorization", "")
        if not auth_header or not auth_header.startswith("Basic "):
            return False

        try:
            b64_val = auth_header[6:].strip()
            decoded = base64.b64decode(b64_val).decode("utf-8")
            if ":" not in decoded:
                return False
            user, pwd = decoded.split(":", 1)
            return user == expected_user and pwd == expected_pass
        except Exception:
            return False

    def require_auth(self) -> bool:
        if self.check_auth():
            return True

        self.send_response(HTTPStatus.UNAUTHORIZED)
        self.send_header("WWW-Authenticate", 'Basic realm="9RTKSync Dashboard"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"Autenticacao requerida. Credenciais padrao: admin / pathbit")
        return False

    def do_GET(self):
        if self.path == "/healthz":
            self.serve_healthz()
            return

        if not self.require_auth():
            return

        if self.path in ("/", "/index.html"):
            self.serve_html()
        elif self.path == "/api/status":
            self.serve_api_status()
        elif self.path == "/api/cron-status":
            self.serve_cron_status()
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Pagina nao encontrada")

    def do_POST(self):
        if not self.require_auth():
            return

        length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(length) if length > 0 else b"{}"

        if self.path == "/api/sync":
            self.handle_sync_request()
        elif self.path == "/api/test-gateway":
            self.handle_test_gateway()
        elif self.path == "/api/change-password":
            self.handle_change_password(raw_body)
        elif self.path == "/api/cron-run":
            self.handle_cron_run()
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Endpoint nao encontrado")

    def serve_healthz(self):
        db_ok = bool(self.db_path and os.path.exists(self.db_path))
        router_ok = True
        if self.router_url:
            try:
                req = urllib.request.Request(
                    self.router_url,
                    headers={"User-Agent": "9RTKSync-Healthcheck/1.0"},
                )
                with urllib.request.urlopen(req, timeout=3.0) as resp:
                    router_ok = resp.status < 500
            except urllib.error.HTTPError as e:
                router_ok = e.code < 500
            except Exception:
                router_ok = False

        if db_ok and router_ok:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"OK")
        else:
            reason = "DATABASE_NOT_READY" if not db_ok else "ROUTER_SERVICE_UNREACHABLE"
            self.send_response(HTTPStatus.SERVICE_UNAVAILABLE)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(reason.encode("utf-8"))

    def serve_html(self):
        html_path = os.path.join(os.path.dirname(__file__), "index.html")
        if os.path.exists(html_path):
            with open(html_path, "rb") as f:
                content = f.read()
        else:
            content = b"<h1>9RTKSync Dashboard</h1><p>index.html not found</p>"

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def serve_api_status(self):
        conns = []
        combos = []
        if self.db_path and os.path.exists(self.db_path):
            try:
                conns = get_all_connections(self.db_path)
            except Exception:
                conns = []
            try:
                combos = get_all_combos(self.db_path)
            except Exception:
                combos = []

        cron_info = self.cron_scheduler.get_status() if self.cron_scheduler else {"active": False}
        is_default = self.settings.is_default_password() if self.settings else False
        cur_user, _ = self.settings.get_auth_credentials() if self.settings else ("admin", "pathbit")

        payload = {
            "status": "online",
            "routerUrl": self.router_url,
            "dbPath": self.db_path,
            "currentUser": cur_user,
            "isDefaultPassword": is_default,
            "cron": cron_info,
            "connections": [
                {
                    "id": c.id,
                    "provider": c.provider,
                    "name": c.name,
                    "isOAuth": c.is_oauth,
                    "hasApiKey": c.has_api_key,
                    "expiresAtMs": c.expires_at_ms,
                    "remainingSeconds": c.remaining_seconds,
                    "healthStatus": c.health_status,
                    "updatedAt": c.updated_at,
                }
                for c in conns
            ],
            "combos": combos,
        }
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_cron_status(self):
        cron_info = self.cron_scheduler.get_status() if self.cron_scheduler else {"active": False}
        body = json.dumps(cron_info, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def handle_test_gateway(self):
        start_t = time.time()
        gateway_ok = False
        status_code = 0
        gateway_err = ""
        router_target = self.router_url

        try:
            req = urllib.request.Request(
                router_target,
                headers={"User-Agent": "9RTKSync-Tester/1.0"},
            )
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                status_code = resp.status
                gateway_ok = status_code < 500
        except urllib.error.HTTPError as e:
            status_code = e.code
            gateway_ok = e.code < 500
        except Exception as ex:
            gateway_err = str(ex)

        latency_ms = int((time.time() - start_t) * 1000)

        db_exists = bool(self.db_path and os.path.exists(self.db_path))
        conns_count = 0
        combos_count = 0
        if db_exists:
            try:
                conns = get_all_connections(self.db_path)
                combos = get_all_combos(self.db_path)
                conns_count = len(conns)
                combos_count = len(combos)
            except Exception:
                pass

        result = {
            "success": gateway_ok and db_exists,
            "gatewayUrl": router_target,
            "gatewayStatus": "online" if gateway_ok else "offline",
            "httpStatusCode": status_code,
            "latencyMs": latency_ms,
            "gatewayError": gateway_err if not gateway_ok else None,
            "dbStatus": "ok" if db_exists else "not_found",
            "dbPath": self.db_path,
            "connectionsCount": conns_count,
            "combosCount": combos_count,
            "message": "Gateway 9Router e banco SQLite 100% operacionais!" if (gateway_ok and db_exists) else "Falha ao conectar ao 9Router ou banco indisponivel",
        }

        body = json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_change_password(self, raw_body: bytes):
        try:
            data = json.loads(raw_body.decode("utf-8")) if raw_body else {}

            new_user = str(data.get("newUser") or "admin").strip()
            new_pass = str(data.get("newPassword") or "").strip()

            if not new_pass or len(new_pass) < 4:
                body = json.dumps({"success": False, "error": "A senha deve conter ao menos 4 caracteres."}).encode("utf-8")
                self.send_response(HTTPStatus.BAD_REQUEST)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            if self.settings:
                ok = self.settings.update_auth_credentials(new_user, new_pass)
                if ok:
                    body = json.dumps({
                        "success": True,
                        "message": "Credenciais atualizadas com sucesso! Utilize o novo usuario e senha nas proximas requisicoes.",
                        "newUser": new_user,
                    }).encode("utf-8")
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return

            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, "Nao foi possivel salvar credenciais")
        except Exception as e:
            body = json.dumps({"success": False, "error": str(e)}).encode("utf-8")
            self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def handle_sync_request(self):
        if DashboardHandler.sync_trigger_callback:
            try:
                res = DashboardHandler.sync_trigger_callback()
                body = json.dumps({"success": True, "result": res}).encode("utf-8")
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                err = json.dumps({"success": False, "error": str(e)}).encode("utf-8")
                self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(err)))
                self.end_headers()
                self.wfile.write(err)
                return
        self.send_error(HTTPStatus.SERVICE_UNAVAILABLE, "Sincronizador nao disponivel")

    def handle_cron_run(self):
        if DashboardHandler.cron_scheduler:
            try:
                entry = DashboardHandler.cron_scheduler.trigger_now()
                body = json.dumps({"success": True, "cycle": entry}).encode("utf-8")
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                err = json.dumps({"success": False, "error": str(e)}).encode("utf-8")
                self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(err)))
                self.end_headers()
                self.wfile.write(err)
                return
        self.handle_sync_request()


def start_web_server(
    host: str,
    port: int,
    db_path: str,
    router_url: str = "",
    sync_callback: Optional[Callable[[], Dict[str, Any]]] = None,
    settings: Optional[Settings] = None,
    cron_scheduler: Optional[Any] = None,
) -> HTTPServer:
    """Inicia o servidor HTTP em background thread com Basic Auth e Cron Scheduler."""
    DashboardHandler.db_path = db_path
    DashboardHandler.router_url = router_url
    DashboardHandler.sync_trigger_callback = sync_callback
    DashboardHandler.settings = settings
    DashboardHandler.cron_scheduler = cron_scheduler

    server = HTTPServer((host, port), DashboardHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server
