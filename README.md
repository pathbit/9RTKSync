# 9RTKSync · 9Router Universal Token & Connection Synchronizer

[![CI](https://github.com/pathbit/9RTKSync/actions/workflows/ci.yml/badge.svg)](https://github.com/pathbit/9RTKSync/actions/workflows/ci.yml)
[![Release and Docker Package](https://github.com/pathbit/9RTKSync/actions/workflows/release.yml/badge.svg)](https://github.com/pathbit/9RTKSync/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python Version](https://img.shields.io/badge/python-3.14.7-blue.svg)](https://www.python.org/ftp/python/3.14.7/python-3.14.7-macos11.pkg)
[![Docker Package](https://img.shields.io/badge/docker-ghcr.io%2Fpathbit%2F9rtksync-blue)](https://github.com/pathbit/9RTKSync/pkgs/container/9rtksync)

**`9RTKSync`** (*9Router Universal Token & Connection Synchronizer*) is a high-availability self-healing guardian for [9Router](https://github.com/decolua/9router) gateways. It eliminates sudden disconnects, premature OAuth token expirations, date format corruptions, and lingering rate-limit locks, keeping all connected accounts healthy and persistent.


## Documentation

The full documentation lives in the [project wiki](../../wiki): installation, the complete
environment-variable contract, the dashboard, authentication and break-glass recovery,
persistent logging, architecture, troubleshooting, and the upstream gateway fixes.

Wiki pages are generated from [`docs/wiki/`](docs/wiki) — edit them there and open a pull
request; a push to `master` republishes the wiki automatically.

---

## Core Features

* **Numeric Expiration Self-Healing**
  * 9Router natively writes the `expiresAt` field as an ISO date string (for example `"2026-09-12T11:54:08.336Z"`). This breaks internal numeric validations and causes false HTTP 503 errors.
  * `9RTKSync` continuously inspects the SQLite database and automatically converts string timestamps into valid millisecond epoch integers.
* **Universal Proactive OAuth Renewal**
  * **Google Antigravity** and **Gemini CLI** connections: renews before expiration (15-minute margin) and synchronizes host tokens generated locally (`~/.gemini/`).
  * **Claude OAuth, GitHub Copilot, OpenAI Codex, AWS Kiro, Codeium Windsurf**: monitors token validity and triggers renewal before gateway downtime occurs.
* **Rate-Limit Lock Clearing**
  * Automatically purges expired `rateLimitedUntil` locks and resets backoff counters as soon as cooldown periods finish.
* **Built-in Web Dashboard**
  * Lightweight web server on port `9190` featuring a modern interface, live account countdowns, real-time gateway health diagnostics, and manual sync triggers.
* **Resilience Combos Enforcement**
  * Keeps fallback combos registered and synchronized in SQLite (`arsenal-supremo`, `arsenal-rapido`, `arsenal-offline`, `claudegravity-fallback`, `claudegravity-thinking`) without primary key conflicts.
* **Strict Virtual Environment Execution**
  * All Python execution strictly isolated in dedicated virtual environments both in Docker containers (`/opt/venv`) and in local setups (`.venv`).

---

## Running with Docker

Official multi-architecture Docker images (`linux/amd64` and `linux/arm64`) are published automatically to the GitHub Container Registry (GHCR):

```bash
docker pull ghcr.io/pathbit/9rtksync:latest
```

### Docker Compose Example

Add `router-sync` to your `docker-compose.yml` alongside [9Router](https://github.com/decolua/9router):

```yaml
services:
  9router:
    image: decolua/9router:latest
    container_name: claudegravity-router
    restart: unless-stopped
    ports:
      - "127.0.0.1:20128:20128"
    volumes:
      - 9router_data:/app/data
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:20128/dashboard"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 20s

  9rtksync:
    image: ghcr.io/pathbit/9rtksync:latest
    container_name: router-sync
    restart: unless-stopped
    ports:
      - "127.0.0.1:9190:9190"
    volumes:
      - 9router_data:/app/data
      - ${HOME}:/root/host:ro
    environment:
      - HOST_HOME=/root/host
      - DB_PATH=/app/data/db/data.sqlite
      - ROUTER_URL=http://9router:20128
      - SYNC_INTERVAL=${SYNC_INTERVAL:-300}
      - REFRESH_MARGIN=${REFRESH_MARGIN:-900}
      - ENABLE_WEB_DASHBOARD=${ENABLE_WEB_DASHBOARD:-1}
      - WEB_PORT=${WEB_PORT:-9190}
      - DASHBOARD_USER=${DASHBOARD_USER:-admin}
      - DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD:-pathbit}
    depends_on:
      9router:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "/opt/venv/bin/python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9190/healthz', timeout=3)"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  9router_data:
```

---

## Local Development in Virtual Environment

Following standard environment isolation, local runs strictly use a Python virtual environment with [Python 3.14.7](https://www.python.org/ftp/python/3.14.7/python-3.14.7-macos11.pkg):

### 1. Clone the Repository

```bash
git clone https://github.com/pathbit/9RTKSync.git
cd 9RTKSync
```

### 2. Create and Activate the Virtual Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e .
```

### 3. Configure Environment Variables (.env)

Copy the official template to create your local `.env` file (the `.env` file is strictly ignored by git):

```bash
cp .env.example .env
```

### 4. Available CLI Commands

```bash
# View current status of 9Router connections and combos
9RTKSync --status --db-path /path/to/data.sqlite

# Run an immediate one-shot synchronization pass
9RTKSync --once --db-path /path/to/data.sqlite

# Run continuous background daemon with web dashboard on port 9190
9RTKSync --daemon --db-path /path/to/data.sqlite
```

---

## Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `DB_PATH` | `/app/data/db/data.sqlite` | Absolute path to the 9Router SQLite database |
| `ROUTER_URL` | `http://127.0.0.1:20128` | Base URL of the 9Router gateway for diagnostics and integration |
| `SYNC_INTERVAL` | `300` | Sync and background cron loop interval in seconds |
| `REFRESH_MARGIN` | `900` | Proactive token renewal margin in seconds before expiration |
| `ENABLE_WEB_DASHBOARD` | `1` | Enable the embedded web dashboard (`1` to enable, `0` to disable) |
| `WEB_PORT` | `9190` | HTTP port for the web dashboard |
| `WEB_HOST` | `0.0.0.0` | Network binding interface for the dashboard web server |
| `DASHBOARD_USER` | `admin` | HTTP Basic Auth username for web dashboard access |
| `DASHBOARD_PASSWORD` | `pathbit` | Default HTTP Basic Auth password for web dashboard access |
| `ANTIGRAVITY_TOKEN_PATH` | auto | Custom path for Antigravity OAuth token file |

---

## Web Dashboard

When running with `ENABLE_WEB_DASHBOARD=1`, access the dashboard in your browser:

👉 **http://localhost:9190**

Dashboard capabilities:
* Live operational metrics (Total Connections, OAuth Accounts, API Keys, Resilience Combos).
* Real-time countdown meters with visual health badges for every connection.
* Gateway diagnostic card with millisecond latency testing (`POST /api/test-gateway`).
* Password change modal for credential rotation (`POST /api/change-password`).
* Manual sync trigger via REST API (`POST /api/sync` and `POST /api/cron-run`).

---

## Unit and Integration Testing

You can run the test suite with zero installations on your host machine (Docker only), or locally via your virtual environment.

### Option 1. Container Testing (Zero Host Installation)

The only requirement is Docker. Nothing else needs to be installed on your machine:

```bash
# Direct shell test runner
./run_tests.sh

# Or via Makefile target
make test-container

# Or via Docker Compose
docker compose -f docker-compose.test.yml run --rm test
```

### Option 2. Local Virtual Environment (Optional Prerequisites)

If you prefer testing directly on your host with Python 3.14+:

```bash
source .venv/bin/activate
make test
# Or directly
PYTHONPATH=src python3 -m unittest discover -s tests -p "test_*.py"
```

---

## Contributing and Branch Protection

* The `master` branch is protected. All contributions must be submitted through Pull Requests and pass all CI checks.
* For bug reports or new provider requests, please open an issue in [GitHub Issues](https://github.com/pathbit/9RTKSync/issues).
* Official upstream gateway: [9Router on GitHub](https://github.com/decolua/9router).

---

## 📄 License

Distributed under the MIT License. The full text is available in [LICENSE](https://github.com/pathbit/9RTKSync/blob/master/LICENSE).

In practice: use, copy, modify, and distribute freely, including commercially, provided that copyright and license notices accompany copies. The software is provided as is, without warranty.

---

Developed with ❤️ by [Pathbit](https://pathbit.co/)
