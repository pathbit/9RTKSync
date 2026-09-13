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
  * Lightweight web server on port `9090` (published on `9091`) featuring a modern interface, live account countdowns, real-time gateway health diagnostics, and manual sync triggers.
* **Resilience Combos Enforcement**
  * Keeps fallback combos registered and synchronized in SQLite (`arsenal-supremo`, `arsenal-rapido`, `arsenal-offline`, `claudegravity-fallback`, `claudegravity-thinking`) without primary key conflicts.
* **Strict Virtual Environment Execution**
  * All Python execution strictly isolated in dedicated virtual environments both in Docker containers (`/opt/venv`) and in local setups (`.venv`).

---

---

## 🔑 Signing in to the dashboard

| | |
| :--- | :--- |
| **Address** | `http://localhost:9091` |
| **User** | `admin` — or whatever you set in `DASHBOARD_USER` |
| **Password** | the value of `DASHBOARD_PASSWORD` in your `.env` |

There is **no factory password**, and that is deliberate: a fixed password shipped
in an image is public the moment the image is. You choose it once, in one place:

```bash
cp .env.example .env
# edit .env:
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=<a senha que voce escolher>
```

Then bring the stack up. That user and that password are what the panel accepts.

### Did not set a password, and now cannot get in?

On first boot with `DASHBOARD_PASSWORD` empty, the container generates a
**recovery credential** and writes it inside the data directory. Read it:

```bash
docker exec 9rtk-sync cat /app/data/db/.dashboard_recovery
```

Sign in as `admin` with that value, then set a real password on the screen. The
recovery credential keeps working afterwards — it is break-glass, and one that
stopped working the moment you set a password would be useless exactly when you
need it.

> **Português:** o painel pede usuário e senha. O usuário é `admin` (ou o que
> estiver em `DASHBOARD_USER`) e a senha é a que **você** definir em
> `DASHBOARD_PASSWORD` no `.env` — não existe senha de fábrica, porque um valor
> fixo publicado na imagem é uma credencial pública. Se subiu sem definir senha,
> use o comando acima para ler a credencial de recuperação e entre com ela.

## Running with Docker

### Configuração: `.env` a partir do exemplo

A configuração inteira vem de variáveis de ambiente, lidas de um `.env` ao lado
do `docker-compose.yml` — o Compose o encontra sozinho, sem nenhuma flag.

```bash
make setup      # cria o .env a partir do .env.example, sem sobrescrever um existente
```

O alvo lista, ao final, exatamente quais variáveis ficaram em branco e precisam
ser preenchidas. Preencha e suba a stack.

O `.env` **nunca** é versionado, e o `.env.example` não carrega nenhum valor de
segredo — um valor publicado num arquivo de exemplo é, por definição, uma
credencial pública. Um teste garante que toda variável exigida por um compose
existe no exemplo, para que `cp .env.example .env` nunca produza um `.env`
incompleto.

### Portas, e por que cada uma é diferente

Os três sincronizadores escutam na **mesma porta dentro do container** (`9090`)
e publicam em portas diferentes no host, para que os três possam rodar lado a
lado. O mesmo vale para os gateways: cada um tem a sua.

| Serviço | Porta interna | Publicada no host |
| :--- | :--- | :--- |
| 9Router | `20128` | `8081` |
| OmniRoute | `20128` | `8082` |
| LiteLLM | `4000` | `8083` |
| 9RTKSync (painel) | `9090` | `9091` |
| OminiRTkSync (painel) | `9090` | `9092` |
| LiteLlmRTKSync (painel) | `9090` | `9093` |

A stack dos artigos (`claudegravity`) fica com a **`20128`**, a porta padrão do
9Router. As stacks dos repositórios saem dessa faixa de propósito: assim você
roda o artigo e os três sincronizadores ao mesmo tempo, sem conflito.

Tudo preso a `127.0.0.1`: o gateway carrega credenciais reais e não deve ficar
acessível na rede local. Para mudar qualquer uma, altere o lado esquerdo do
mapeamento no compose — o lado direito é a porta interna, que o processo escuta.


Official multi-architecture Docker images (`linux/amd64` and `linux/arm64`) are published automatically to the GitHub Container Registry (GHCR):

```bash
docker pull ghcr.io/pathbit/9rtksync:latest
```

### Docker Compose Example

Add `9rtksync` to your `docker-compose.yml` alongside [9Router](https://github.com/decolua/9router):

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
      # Sem esta linha o fluxo de login e redirecionado para a porta interna,
      # que nao existe no host.
      - NEXT_PUBLIC_BASE_URL=http://localhost:8081
      - NODE_ENV=production
      # Sem valor de fallback: um default publicado em arquivo de exemplo vira
      # a senha real de toda implantacao que so copiou e colou.
      - INITIAL_PASSWORD=${INITIAL_PASSWORD:?defina INITIAL_PASSWORD no .env}
      - JWT_SECRET=${JWT_SECRET:?defina JWT_SECRET no .env (openssl rand -hex 32)}
    volumes:
      - 9router_data:/app/data
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:20128/dashboard"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 20s

  9rtk-sync:
    # Mesmo uid do gateway: os dois compartilham o volume de dados.
    user: "1000:1000"
    image: ghcr.io/pathbit/9rtksync:latest
    container_name: 9rtk-sync
    hostname: 9rtk-sync
    networks:
      - 9rtksync-net
    restart: unless-stopped
    ports:
      - "127.0.0.1:9091:9090"
    volumes:
      - 9router_data:/app/data
      - ${HOME}:/root/host:ro
      - 9rtksync_logs:/app/logs
    environment:
      - HOST_HOME=/root/host
      - DB_PATH=/app/data/db/data.sqlite
      - ROUTER_URL=${ROUTER_URL:-http://9rtk-router:20128}
      - SYNC_INTERVAL=${SYNC_INTERVAL:-300}
      - REFRESH_MARGIN=${REFRESH_MARGIN:-900}
      - ENABLE_WEB_DASHBOARD=${ENABLE_WEB_DASHBOARD:-1}
      - WEB_PORT=${WEB_PORT:-9090}
      - DASHBOARD_USER=${DASHBOARD_USER:-admin}
      - DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD:-}
      - LOG_DIR=${LOG_DIR:-/app/logs}
      - LOG_RETENTION_DAYS=${LOG_RETENTION_DAYS:-30}
    depends_on:
      9rtk-router:
        condition: service_healthy
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
    # Rede propria da stack. Na rede default, duas stacks no mesmo daemon
    # resolvem o mesmo nome curto e nao da para saber a qual gateway o
    # sincronizador se conectou.
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

# Run continuous background daemon with web dashboard on port 9090 (published on 9091)
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
| `WEB_PORT` | `9090` | HTTP port for the web dashboard |
| `WEB_HOST` | `0.0.0.0` | Network binding interface for the dashboard web server |
| `DASHBOARD_USER` | `admin` | HTTP Basic Auth username for web dashboard access |
| `DASHBOARD_PASSWORD` | *(vazio)* | Panel password. Left empty, the first sign-in uses the recovery credential generated on first boot. |
| `ANTIGRAVITY_TOKEN_PATH` | auto | Custom path for Antigravity OAuth token file |

---

## Web Dashboard

When running with `ENABLE_WEB_DASHBOARD=1`, access the dashboard in your browser:

👉 **http://localhost:9091**

Dashboard capabilities:
* Live operational metrics (Total Connections, OAuth Accounts, API Keys, Resilience Combos).
* Six domain cards, in the same order as the sibling panels: gateway connection, scheduler, monitored connections, virtual keys, registered models, resilience combos.
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

# docker-compose.test.yml nao tem servico de teste: e uma bancada viva
# (gateway real + este sincronizador) para conferir a stack de ponta a ponta.
docker compose -f docker-compose.test.yml up -d
docker compose -f docker-compose.test.yml down -v
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
