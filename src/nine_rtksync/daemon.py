"""Continuous synchronization and universal self-healing daemon for 9Router."""

import os
import signal
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

from .combos import sync_combos
from .config import Settings
from .cron import CronScheduler
from .database import get_all_connections, update_connection_data
from .discovery import HostDiscoveryEngine
from .models import ConnectionRecord
from .normalizer import normalize_connection_data
from .providers import ApiKeyProvider, BaseProvider, GenericOAuthProvider, GoogleProvider, LocalProvider
from .web.server import start_web_server


def log_msg(prefix: str, text: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [{prefix}] {text}", flush=True)


class SyncEngine:
    """Connection orchestration and synchronization engine."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.discovery = HostDiscoveryEngine(
            host_home=settings.host_home,
            extra_paths=settings.credential_paths,
        )
        self.providers: List[BaseProvider] = [
            GoogleProvider(credential_paths=settings.credential_paths, discovery=self.discovery),
            GenericOAuthProvider(discovery=self.discovery),
            ApiKeyProvider(discovery=self.discovery),
            LocalProvider(),
        ]

    def sync_all(self) -> Dict[str, Any]:
        """Execute a full synchronization cycle across all registered accounts."""
        if not os.path.exists(self.settings.db_path):
            log_msg("ERROR", f"SQLite database not found at: {self.settings.db_path}")
            return {"success": False, "error": "db_not_found"}

        summary = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "total_connections": 0,
            "normalized": 0,
            "refreshed": 0,
            "combos_synced": 0,
            "details": [],
        }

        # 1. Synchronize resilience and fallback combos
        try:
            combos_count = sync_combos(self.settings.db_path, module=self.settings.module)
            summary["combos_synced"] = combos_count
        except Exception as e:
            log_msg("WARNING", f"Failed to synchronize combos: {e}")

        # 2. Scan registered connections
        try:
            conns = get_all_connections(self.settings.db_path)
            summary["total_connections"] = len(conns)
        except Exception as e:
            log_msg("ERROR", f"Failed to read connections from SQLite: {e}")
            return {"success": False, "error": str(e)}

        for conn in conns:
            conn_detail = {
                "id": conn.id,
                "provider": conn.provider,
                "name": conn.name,
                "actions": [],
            }

            # A. Self-healing and format normalization
            normalized, new_data, norm_notes = normalize_connection_data(conn.data)
            if normalized:
                summary["normalized"] += 1
                conn.data = new_data
                for note in norm_notes:
                    log_msg("HEAL", f"[{conn.provider} · {conn.name}] {note}")
                    conn_detail["actions"].append(note)
                try:
                    update_connection_data(self.settings.db_path, conn.id, new_data)
                except Exception as e:
                    log_msg("ERROR", f"Failed to persist normalization to database: {e}")

            # B. OAuth renewal or liveness check
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
                            log_msg("SUCCESS", f"[{conn.provider} · {conn.name}] Credentials updated successfully in SQLite")
                    except Exception as e:
                        log_msg("FAILURE", f"[{conn.provider} · {conn.name}] Provider error: {e}")
                    break

            if not handled:
                log_msg("INFO", f"[{conn.provider} · {conn.name}] Provider without specific handler; format preserved")

            summary["details"].append(conn_detail)

        return summary


def run_daemon(settings: Settings):
    """Run the continuous daemon loop with signal handling and optional web server."""
    engine = SyncEngine(settings)
    running = True

    def handle_signal(sig, frame):
        nonlocal running
        print(f"\n[!] Signal {sig} received. Shutting down 9RTKSync gracefully...", flush=True)
        running = False

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    print("=" * 70, flush=True)
    print("⚡ 9RTKSYNC · 9ROUTER UNIVERSAL TOKEN & CONNECTION SYNCHRONIZER", flush=True)
    print(f"   SQLite DB:    {settings.db_path}", flush=True)
    print(f"   Gateway URL:  {settings.router_url}", flush=True)
    print(f"   Host Home:    {engine.discovery.host_home}", flush=True)
    print(f"   Interval:     {settings.sync_interval}s · Refresh Margin: {settings.refresh_margin}s", flush=True)
    print("=" * 70, flush=True)

    # Initial scan of available host credentials
    discovered = engine.discovery.discover_all()
    found_any = False
    for prov, info in discovered.items():
        if info:
            found_any = True
            log_msg("DISCOVERY", f"Host credential detected: [{prov}] -> {info.get('source_path')}")
    if not found_any:
        log_msg("DISCOVERY", f"No pre-existing local credentials detected in {engine.discovery.host_home}")

    # Initialize dedicated CronScheduler for continuous OAuth renewal
    cron_scheduler = CronScheduler(
        sync_callback=engine.sync_all,
        interval_seconds=settings.sync_interval,
        name="9RTKSync-CronScheduler",
    )

    # Start embedded web server if enabled
    if settings.enable_web:
        try:
            start_web_server(
                host=settings.web_host,
                port=settings.web_port,
                db_path=settings.db_path,
                router_url=settings.router_url,
                sync_callback=engine.sync_all,
                settings=settings,
                cron_scheduler=cron_scheduler,
            )
            print(f"🌐 Web Dashboard active at: http://{settings.web_host}:{settings.web_port}", flush=True)
        except Exception as e:
            print(f"⚠️ Could not start web dashboard on port {settings.web_port}: {e}", flush=True)

    # Start background scheduler
    cron_scheduler.start()

    while running:
        time.sleep(1)

    cron_scheduler.stop()
    print("[*] 9RTKSync terminated cleanly.", flush=True)

