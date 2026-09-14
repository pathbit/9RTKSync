# Installation

Two supported paths: Docker (recommended) and a local Python virtual environment.

---

## Docker Compose

The official image is published to GHCR by GitHub Actions:

```bash
docker pull ghcr.io/pathbit/9rtksync:latest
```

A working `docker-compose.yml` alongside the gateway:

```yaml
name: 9rtksync-stack

services:
  9rtk-router:
    image: decolua/9router:latest
    container_name: 9rtk-router
    hostname: 9rtk-router
    networks:
      - 9rtksync-net
    restart: unless-stopped
    ports:
      # 20128 dentro do container; 8081 no host, para nao disputar a porta
      # padrao do 9Router com a stack do artigo.
      - "127.0.0.1:8081:20128"
    environment:
      - DATA_DIR=/app/data
      - PORT=20128
      - HOSTNAME=0.0.0.0
      # Without this line the login flow is redirected to the internal port,
      # which does not exist on the host.
      - NEXT_PUBLIC_BASE_URL=http://localhost:8081
    volumes:
      - 9router_data:/app/data

  9rtk-sync:
    # Same uid as the gateway. Both share the volume, and this service creates
    # db/ on startup: as root those directories are born root-owned and
    # 9router -- which runs as `node` (1000) -- loses write access to its own
    # volume ("EACCES: permission denied, mkdir '/app/data/db/backups'").
    user: "1000:1000"
    image: ghcr.io/pathbit/9rtksync:latest
    container_name: 9rtk-sync
    hostname: 9rtk-sync
    networks:
      - 9rtksync-net
    restart: unless-stopped
    ports:
      # Internal port 9090 (same in OminiRTKSync); published on 9091.
      # The 127.0.0.1 bind keeps the panel and the SQLite file off the internet.
      - "127.0.0.1:9091:9090"
    volumes:
      - 9router_data:/app/data
      - ${HOME}:/root/host:ro
      - 9rtksync_logs:/app/logs
    environment:
      - HOST_HOME=/root/host
      - DB_PATH=/app/data/db/data.sqlite
      - ROUTER_URL=http://9rtk-router:20128
      - SYNC_INTERVAL=300
      - REFRESH_MARGIN=900
      - WEB_PORT=9090
      - DASHBOARD_USER=admin
      - DASHBOARD_PASSWORD=change-me
      - LOG_DIR=/app/logs
      - LOG_RETENTION_DAYS=30
    depends_on:
      - 9rtk-router
    healthcheck:
      test: ["CMD", "/opt/venv/bin/python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9090/healthz', timeout=3)"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  9router_data:
  9rtksync_logs:

networks:
  9rtksync-net:
    name: 9rtksync-net
    # The stack gets its own network. On the default network two stacks on the
    # same daemon resolve the same short name, and there is no telling which
    # gateway the synchronizer connected to.
```

Then open **http://localhost:9091**.

### Why these details matter

- **`9router_data` is shared.** The synchronizer reads and writes the same SQLite file the
  gateway uses; without the shared volume it has nothing to heal.
- **`${HOME}` is mounted read-only.** Antigravity and Gemini CLI credentials live in the host
  home (`~/.gemini/`, `~/.config/antigravity/`). Read-only is enough — the synchronizer never
  writes there.
- **The port is bound to `127.0.0.1`.** The panel reads credential metadata; it must not be
  reachable from the internet.
- **A named volume for the logs.** Otherwise they die with the container. See [Logging](Logging).

---

## Local virtual environment

Requires Python 3.11+ (3.14 is what CI pins).

```bash
git clone https://github.com/pathbit/9RTKSync.git
cd 9RTKSync

python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e .
```

### Commands

```bash
# Connection and combo status, no changes written
9RTKSync --status --db-path ~/.9router/data/db/data.sqlite

# One immediate synchronization pass
9RTKSync --once --db-path ~/.9router/data/db/data.sqlite

# Continuous daemon with the dashboard
9RTKSync --daemon --db-path ~/.9router/data/db/data.sqlite

# Daemon without the web server
9RTKSync --daemon --no-web
```

`--db-path` is optional: without it the synchronizer probes the usual locations. See
[Configuration](Configuration).

---

## Running the tests

```bash
source .venv/bin/activate
PYTHONPATH=src python3 -m unittest discover -s tests -p "test_*.py"
```

Or with no local install at all:

```bash
./run_tests.sh
```

---

## Upgrading

```bash
docker compose pull 9rtk-sync
docker compose up -d 9rtk-sync
```

State that survives upgrades lives in the data volume: `.dashboard_auth.json` (screen-set
credentials), `.dashboard_recovery` (break-glass hash) and `ui_prefs.sqlite` (interface
language). None of them are stored in the gateway's own database.

## Configuration: `.env` from the example

Everything is configured by environment variable, read from a `.env` next to the
compose file — Compose finds it on its own, with no flag.

```bash
make setup      # creates .env from .env.example, never overwriting an existing one
```

The target then lists exactly which variables were left blank. Fill them in and
bring the stack up.

`.env` is never versioned, and `.env.example` carries no secret value — a value
published in an example file is a public credential by definition. A test
guarantees every variable a compose requires exists in the example, so
`cp .env.example .env` never produces an incomplete `.env`.

## Ports

The three synchronizers listen on the **same port inside the container**
(`9090`) and publish on different host ports, so all three can run side by side.
Same for the gateways.

| Service | Inside | Published |
| :--- | :--- | :--- |
| 9Router | `20128` | `8081` |
| OmniRoute | `20128` | `8082` |
| LiteLLM | `4000` | `8083` |
| 9RTKSync panel | `9090` | `9091` |
| OminiRTkSync panel | `9090` | `9092` |
| LiteLlmRTKSync panel | `9090` | `9093` |

The article stack (`claudegravity`) keeps **`20128`**, 9Router's default port.
The repository stacks stay out of that range on purpose, so you can run the
article and all three synchronizers at once without a conflict.

All bound to `127.0.0.1`: the gateway holds real credentials and should not be
reachable from the local network.
