"""Servidor HTTP ultra-leve e dashboard web embutido do 9RTKSync."""

import json
import os
import threading
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Callable, Dict

from ..database import get_all_combos, get_all_connections
from ..models import ConnectionRecord


class DashboardHandler(BaseHTTPRequestHandler):
    """Handler HTTP para servir o dashboard e a API REST de sincronização."""

    sync_trigger_callback: Callable[[], Dict[str, Any]] = None
    db_path: str = ""
    router_url: str = ""

    def log_message(self, format, *args):
        # Desativa logs verbosos no stdout da console
        pass

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.serve_html()
        elif self.path == "/api/status":
            self.serve_api_status()
        elif self.path == "/healthz":
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
                    # Se o 9Router respondeu (mesmo 401/403/404), o serviço está no ar
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
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Página não encontrada")

    def do_POST(self):
        if self.path == "/api/sync":
            self.handle_sync_request()
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Endpoint não encontrado")

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
        try:
            conns = get_all_connections(self.db_path)
            combos = get_all_combos(self.db_path)
            payload = {
                "status": "online",
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
        except Exception as e:
            err_body = json.dumps({"error": str(e)}).encode("utf-8")
            self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(err_body)

    def handle_sync_request(self):
        if DashboardHandler.sync_trigger_callback:
            try:
                res = DashboardHandler.sync_trigger_callback()
                body = json.dumps({"success": True, "result": res}).encode("utf-8")
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                err = json.dumps({"success": False, "error": str(e)}).encode("utf-8")
                self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(err)
                return
        self.send_error(HTTPStatus.SERVICE_UNAVAILABLE, "Sincronizador não disponível")


def start_web_server(
    host: str,
    port: int,
    db_path: str,
    router_url: str = "",
    sync_callback: Callable[[], Dict[str, Any]] = None,
) -> HTTPServer:
    """Inicia o servidor HTTP em background thread."""
    DashboardHandler.db_path = db_path
    DashboardHandler.router_url = router_url
    DashboardHandler.sync_trigger_callback = sync_callback
    server = HTTPServer((host, port), DashboardHandler)

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server
