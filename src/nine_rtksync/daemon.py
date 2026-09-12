"""Daemon de sincronização contínua e auto-cura universal para o 9Router."""

import os
import signal
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

from .combos import sync_combos
from .config import Settings
from .database import get_all_connections, update_connection_data
from .models import ConnectionRecord
from .normalizer import normalize_connection_data
from .providers import ApiKeyProvider, BaseProvider, GenericOAuthProvider, GoogleProvider
from .web.server import start_web_server


def log_msg(prefix: str, text: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [{prefix}] {text}", flush=True)


class SyncEngine:
    """Motor de orquestração de conexões e sincronização."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.providers: List[BaseProvider] = [
            GoogleProvider(credential_paths=settings.credential_paths),
            GenericOAuthProvider(),
            ApiKeyProvider(),
        ]

    def sync_all(self) -> Dict[str, Any]:
        """Executa uma rodada completa de sincronização em todas as contas cadastradas."""
        if not os.path.exists(self.settings.db_path):
            log_msg("ERRO", f"Banco SQLite não encontrado em: {self.settings.db_path}")
            return {"success": False, "error": "db_not_found"}

        summary = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "total_connections": 0,
            "normalized": 0,
            "refreshed": 0,
            "combos_synced": 0,
            "details": [],
        }

        # 1. Sincroniza combos de resiliência e fallback
        try:
            combos_count = sync_combos(self.settings.db_path, module=self.settings.module)
            summary["combos_synced"] = combos_count
        except Exception as e:
            log_msg("AVISO", f"Falha ao sincronizar combos: {e}")

        # 2. Varre conexões registradas
        try:
            conns = get_all_connections(self.settings.db_path)
            summary["total_connections"] = len(conns)
        except Exception as e:
            log_msg("ERRO", f"Falha ao ler conexões do SQLite: {e}")
            return {"success": False, "error": str(e)}

        for conn in conns:
            conn_detail = {
                "id": conn.id,
                "provider": conn.provider,
                "name": conn.name,
                "actions": [],
            }

            # A. Auto-cura e normalização de formato
            normalized, new_data, norm_notes = normalize_connection_data(conn.data)
            if normalized:
                summary["normalized"] += 1
                conn.data = new_data
                for note in norm_notes:
                    log_msg("CURA", f"[{conn.provider} · {conn.name}] {note}")
                    conn_detail["actions"].append(note)
                try:
                    update_connection_data(self.settings.db_path, conn.id, new_data)
                except Exception as e:
                    log_msg("ERRO", f"Falha ao gravar normalização no banco: {e}")

            # B. Renovação OAuth ou teste de liveness
            handled = False
            for p in self.providers:
                if p.can_handle(conn):
                    handled = True
                    try:
                        renewed, refreshed_data, ref_notes = p.check_and_refresh(
                            conn, margin_seconds=self.settings.refresh_margin
                        )
                        for note in ref_notes:
                            log_msg("STATUS", f"[{conn.provider} · {conn.name}] {note}")
                            conn_detail["actions"].append(note)

                        if renewed and refreshed_data:
                            summary["refreshed"] += 1
                            update_connection_data(self.settings.db_path, conn.id, refreshed_data)
                            log_msg("SUCESSO", f"[{conn.provider} · {conn.name}] Credenciais atualizadas com sucesso no SQLite")
                    except Exception as e:
                        log_msg("FALHA", f"[{conn.provider} · {conn.name}] Erro no provedor: {e}")
                    break

            if not handled:
                log_msg("INFO", f"[{conn.provider} · {conn.name}] Provedor sem manipulador específico; formato preservado")

            summary["details"].append(conn_detail)

        return summary


def run_daemon(settings: Settings):
    """Executa o daemon perpétuo com tratamento de sinais e servidor web opcional."""
    engine = SyncEngine(settings)
    running = True

    def handle_signal(sig, frame):
        nonlocal running
        print(f"\n[!] Sinal {sig} recebido. Encerrando 9RTKSync graciosamente...", flush=True)
        running = False

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    print("=" * 70, flush=True)
    print("⚡ 9RTKSYNC · 9ROUTER UNIVERSAL TOKEN & CONNECTION SYNCHRONIZER", flush=True)
    print(f"   Banco SQLite: {settings.db_path}", flush=True)
    print(f"   Gateway URL:  {settings.router_url}", flush=True)
    print(f"   Intervalo: {settings.sync_interval}s · Margem de Renovação: {settings.refresh_margin}s", flush=True)
    print("=" * 70, flush=True)

    # Inicia servidor web embutido se habilitado
    if settings.enable_web:
        try:
            start_web_server(
                host=settings.web_host,
                port=settings.web_port,
                db_path=settings.db_path,
                router_url=settings.router_url,
                sync_callback=engine.sync_all,
            )
            print(f"🌐 Dashboard Web ativo em: http://{settings.web_host}:{settings.web_port}", flush=True)
        except Exception as e:
            print(f"⚠️ Não foi possível iniciar o dashboard web na porta {settings.web_port}: {e}", flush=True)

    # Primeira passada síncrona imediata
    engine.sync_all()

    while running:
        for _ in range(settings.sync_interval):
            if not running:
                break
            time.sleep(1)
        if running:
            engine.sync_all()

    print("[*] 9RTKSync finalizado com sucesso.", flush=True)
