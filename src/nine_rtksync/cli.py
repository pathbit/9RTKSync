"""Command line interface (CLI) for 9RTKSync."""

import argparse
import sys

from .config import Settings
from .daemon import SyncEngine, run_daemon
from .database import get_all_combos, get_all_connections
from .logs import setup_logging
from .web.server import start_web_server


def print_status_table(settings: Settings):
    """Render a formatted table displaying the status of all connections in terminal."""
    try:
        conns = get_all_connections(settings.db_path)
        combos = get_all_combos(settings.db_path)
    except Exception as e:
        print(f"[ERROR] Error querying SQLite database ({settings.db_path}): {e}", file=sys.stderr)
        sys.exit(1)

    print("\n" + "=" * 76)
    print("[*] 9RTKSYNC · 9ROUTER CONNECTIONS AND COMBOS STATUS")
    print(f"   Database: {settings.db_path}")
    print("=" * 76)

    print(f"\n[*] Registered Connections ({len(conns)}):")
    print(f"  {'PROVIDER':<16} {'NAME':<26} {'TYPE':<10} {'STATUS':<10} {'VALIDITY':<14}")
    print("  " + "-" * 74)

    for c in conns:
        tipo = "OAuth 2.0" if c.is_oauth else ("API Key" if c.has_api_key else "Other")
        rem = c.remaining_seconds
        if c.is_oauth:
            if rem is None:
                val_str = "No expiry"
            elif rem <= 0:
                val_str = "Expired!"
            else:
                val_str = f"{rem // 60} min ({rem}s)"
        else:
            val_str = "Unlimited"

        status_icon = "[ok]" if c.health_status in ("active", "no_expiration") else ("[!]" if c.health_status == "expirando_em_breve" or c.health_status == "expiring_soon" else "[ERROR]")
        print(f"  {c.provider:<16} {c.name[:25]:<26} {tipo:<10} {status_icon} {c.health_status:<7} {val_str:<14}")

    print(f"\n[*] Resilience & Fallback Combos ({len(combos)}):")
    print(f"  {'COMBO NAME':<26} {'TYPE':<12} {'CASCADE MODELS'}")
    print("  " + "-" * 74)

    for cb in combos:
        models = cb.get("models", [])
        print(f"  {cb['name']:<26} {cb['kind']:<12} {len(models)}: {', '.join(models[:3])}{'...' if len(models) > 3 else ''}")

    print("\n" + "=" * 76 + "\n")


def main():
    parser = argparse.ArgumentParser(
        prog="9RTKSync",
        description="9RTKSync · 9Router Universal Token & Connection Synchronizer",
    )
    parser.add_argument(
        "--db-path",
        dest="db_path",
        help="Path to 9Router SQLite database (data.sqlite)",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Display formatted table with connection status and exit",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Execute a single synchronization run and exit",
    )
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Run in continuous daemon mode (default)",
    )
    parser.add_argument(
        "--interval",
        type=int,
        help="Check interval in seconds for daemon mode (default: 300)",
    )
    parser.add_argument(
        "--margin",
        type=int,
        help="Prior renewal margin in seconds (default: 900)",
    )
    parser.add_argument(
        "--no-web",
        action="store_true",
        help="Disable embedded web dashboard",
    )
    parser.add_argument(
        "--port",
        type=int,
        help="Port for embedded web server (default: 9090)",
    )
    parser.add_argument(
        "--user",
        type=str,
        help="Username for web dashboard authentication (default: admin)",
    )
    parser.add_argument(
        "--password",
        type=str,
        help="Password for web dashboard authentication (default: pathbit)",
    )

    args = parser.parse_args()
    settings = Settings.from_env()

    # The file log must exist before any event from the sync engine.
    logger = setup_logging(settings.db_path)

    # Break-glass credential: generated once so the operator can get back into the
    # panel after forgetting the password set on the screen.
    #
    # O valor NAO vai para o log. Ele e uma credencial funcional, e o stdout do
    # container costuma ser coletado, encaminhado e lido por muita gente; fica
    # apenas no arquivo com modo 0600, e o log diz onde encontra-lo.
    recovery_hash, generated_now = settings.ensure_recovery_hash()
    if generated_now and recovery_hash:
        logger.warning(
            "[AUTH] Recovery credential generated for user 'admin'. Read it with: "
            "docker exec <container> cat %s  (or pin your own with DASHBOARD_RECOVERY_HASH)",
            settings.get_recovery_file_path(),
        )

    if args.db_path:
        settings.db_path = args.db_path
    if args.interval:
        settings.sync_interval = args.interval
    if args.margin:
        settings.refresh_margin = args.margin
    if args.no_web:
        settings.enable_web = False
    if args.port:
        settings.web_port = args.port
    if args.user:
        settings.dashboard_user = args.user
    if args.password:
        settings.dashboard_password = args.password

    if args.status:
        print_status_table(settings)
        return

    if args.once:
        engine = SyncEngine(settings)
        res = engine.sync_all()
        print(f"[*] Synchronization completed: {res['total_connections']} connections inspected, {res['normalized']} normalized, {res['refreshed']} renewed.")
        return

    # Daemon mode (default)
    run_daemon(settings)


if __name__ == "__main__":
    main()

