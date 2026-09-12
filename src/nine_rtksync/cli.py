"""Interface de linha de comando (CLI) do 9rtksync."""

import argparse
import sys

from .config import Settings
from .daemon import SyncEngine, run_daemon
from .database import get_all_combos, get_all_connections
from .web.server import start_web_server


def print_status_table(settings: Settings):
    """Renderiza tabela formatada com o estado de todas as conexões no terminal."""
    try:
        conns = get_all_connections(settings.db_path)
        combos = get_all_combos(settings.db_path)
    except Exception as e:
        print(f"❌ Erro ao consultar banco SQLite ({settings.db_path}): {e}", file=sys.stderr)
        sys.exit(1)

    print("\n" + "=" * 76)
    print("⚡ 9RTKSYNC · STATUS DAS CONEXÕES E COMBOS DO 9ROUTER")
    print(f"   Banco de Dados: {settings.db_path}")
    print("=" * 76)

    print(f"\n🔌 Conexões Registradas ({len(conns)}):")
    print(f"  {'PROVEDOR':<16} {'NOME':<26} {'TIPO':<10} {'STATUS':<10} {'VALIDADE':<14}")
    print("  " + "-" * 74)

    for c in conns:
        tipo = "OAuth 2.0" if c.is_oauth else ("API Key" if c.has_api_key else "Outro")
        rem = c.remaining_seconds
        if c.is_oauth:
            if rem is None:
                val_str = "Sem expiração"
            elif rem <= 0:
                val_str = "Expirado!"
            else:
                val_str = f"{rem // 60} min ({rem}s)"
        else:
            val_str = "Ilimitado"

        status_icon = "✅" if c.health_status in ("ativo", "sem_expiracao") else ("⚠️" if c.health_status == "expirando_em_breve" else "❌")
        print(f"  {c.provider:<16} {c.name[:25]:<26} {tipo:<10} {status_icon} {c.health_status:<7} {val_str:<14}")

    print(f"\n🔀 Combos de Resiliência e Fallback ({len(combos)}):")
    print(f"  {'NOME DO COMBO':<26} {'TIPO':<12} {'MODELOS NA CASCATA'}")
    print("  " + "-" * 74)

    for cb in combos:
        models = cb.get("models", [])
        print(f"  {cb['name']:<26} {cb['kind']:<12} {len(models)}: {', '.join(models[:3])}{'...' if len(models) > 3 else ''}")

    print("\n" + "=" * 76 + "\n")


def main():
    parser = argparse.ArgumentParser(
        prog="9RTKSync",
        description="9RTKSync · 9Router Universal Token & Connection Sync",
    )
    parser.add_argument(
        "--db-path",
        dest="db_path",
        help="Caminho para o banco SQLite do 9Router (data.sqlite)",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Exibe tabela com status de todas as conexões e encerra",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Executa uma rodada única de sincronização e encerra",
    )
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Executa em modo daemon contínuo (padrão)",
    )
    parser.add_argument(
        "--interval",
        type=int,
        help="Intervalo de checagem em segundos no modo daemon (padrão: 300)",
    )
    parser.add_argument(
        "--margin",
        type=int,
        help="Margem de renovação prévia em segundos (padrão: 900)",
    )
    parser.add_argument(
        "--no-web",
        action="store_true",
        help="Desativa o dashboard web embutido",
    )
    parser.add_argument(
        "--port",
        type=int,
        help="Porta do servidor web embutido (padrão: 9190)",
    )
    parser.add_argument(
        "--user",
        type=str,
        help="Usuário para autenticação no dashboard web (padrão: admin)",
    )
    parser.add_argument(
        "--password",
        type=str,
        help="Senha para autenticação no dashboard web (padrão: pathbit)",
    )

    args = parser.parse_args()
    settings = Settings.from_env()

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
        print(f"[*] Sincronização concluída: {res['total_connections']} conexões inspecionadas, {res['normalized']} normalizadas, {res['refreshed']} renovadas.")
        return

    # Modo daemon (padrão)
    run_daemon(settings)


if __name__ == "__main__":
    main()
