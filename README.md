# 9rtksync · 9Router Token & Connection Sync

[![CI](https://github.com/pathbit/9rtksync/actions/workflows/ci.yml/badge.svg)](https://github.com/pathbit/9rtksync/actions/workflows/ci.yml)
[![Release and Docker Package](https://github.com/pathbit/9rtksync/actions/workflows/release.yml/badge.svg)](https://github.com/pathbit/9rtksync/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python Version](https://img.shields.io/badge/python-3.14.7-blue.svg)](https://www.python.org/ftp/python/3.14.7/python-3.14.7-macos11.pkg)
[![Docker Package](https://img.shields.io/badge/docker-ghcr.io%2Fpathbit%2F9rtksync-blue)](https://github.com/pathbit/9rtksync/pkgs/container/9rtksync)

O **`9rtksync`** (*9Router Token & Connection Synchronizer*) é um guardião de alta disponibilidade e auto-cura para gateways **9Router**. Ele elimina de forma definitiva desconexões súbitas, expiração prematura de tokens OAuth, corrupção de formatos de data e bloqueios residuais de *rate limit*, mantendo **qualquer conta conectada ativa e saudável**.

---

## Recursos Principais

* **Auto-Cura Numérica de Expiração**
  * O 9Router nativamente grava o campo `expiresAt` como texto ISO (ex: `"2026-09-12T11:54:08.336Z"`). Isso quebra validações numéricas internas gerando falsos erros HTTP 503.
  * O `9rtksync` monitora o banco SQLite e converte automaticamente strings para epoch em milissegundos numéricos válidos.
* **Renovação Preventiva Universal de OAuth**
  * Conexões **Google Antigravity** e **Gemini CLI**: renova antes da expiração (margem de 15 minutos) e sincroniza tokens gerados localmente no host (`~/.gemini/`).
  * Conexões **Claude OAuth, GitHub Copilot, OpenAI Codex, AWS Kiro, Codeium Windsurf**: monitora validade de tokens e executa auto-renovação antes que o gateway sofra interrupção.
* **Desbloqueio de Travas de Rate Limit**
  * Remove automaticamente travas obsoletas de `rateLimitedUntil` e zera penalidades de backoff assim que o período de espera expira.
* **Dashboard Web Embutido**
  * Servidor web nativo ultra-leve na porta `9190` com interface visual moderna, contagem regressiva de validade de cada conta e acionador de sincronização manual via navegador.
* **Garantia de Combos de Resiliência**
  * Mantém cadastrados e atualizados no SQLite os combos de fallback (`arsenal-supremo`, `arsenal-rapido`, `arsenal-offline`, `claudegravity-fallback`, `claudegravity-thinking`) sem conflitos de chave única.

---

## Como Executar via Docker

O pacote oficial do Docker é publicado automaticamente pelo GitHub Actions no GitHub Container Registry (GHCR):

```bash
# Baixar a imagem mais recente
docker pull ghcr.io/pathbit/9rtksync:latest
```

### Exemplo de Uso no Docker Compose

Adicione o serviço `9rtksync` ao seu `docker-compose.yml` junto ao 9Router:

```yaml
services:
  9router:
    image: decolua/9router:latest
    container_name: 9router
    ports:
      - "127.0.0.1:20128:20128"
    volumes:
      - 9router_data:/app/data

  9rtksync:
    image: ghcr.io/pathbit/9rtksync:latest
    container_name: 9rtksync
    restart: unless-stopped
    ports:
      - "127.0.0.1:9190:9190"
    volumes:
      - 9router_data:/app/data
      - ${HOME}/.gemini:/root/.gemini:ro
    environment:
      - DB_PATH=/app/data/db/data.sqlite
      - SYNC_INTERVAL=300
      - REFRESH_MARGIN=900
      - ENABLE_WEB_DASHBOARD=1
      - WEB_PORT=9190
    depends_on:
      - 9router

volumes:
  9router_data:
```

---

## Como Executar Localmente (Sem Docker)

O `9rtksync` utiliza exclusivamente a biblioteca padrão do Python (sem dependências externas pesadas):

### 1. Clonar o Repositório

```bash
git clone https://github.com/pathbit/9rtksync.git
cd 9rtksync
```

### 2. Instalação Local

```bash
pip install -e .
```

### 3. Comandos Disponíveis

```bash
# Exibir tabela com status de todas as contas e combos
9rtksync --status --db-path /caminho/para/data.sqlite

# Executar uma rodada imediata de sincronização e sair
9rtksync --once --db-path /caminho/para/data.sqlite

# Executar em modo daemon contínuo com dashboard web
9rtksync --daemon --db-path /caminho/para/data.sqlite
```

---

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `DB_PATH` | `/app/data/db/data.sqlite` | Caminho do arquivo SQLite do 9Router |
| `SYNC_INTERVAL` | `300` | Intervalo em segundos entre varreduras no modo daemon |
| `REFRESH_MARGIN` | `900` | Margem prévia em segundos para renovação de tokens |
| `ENABLE_WEB_DASHBOARD` | `1` | Ativa o dashboard web embutido (`1` para sim, `0` para não) |
| `WEB_PORT` | `9190` | Porta do dashboard web HTTP |
| `WEB_HOST` | `0.0.0.0` | Interface de rede para o servidor web |
| `ANTIGRAVITY_TOKEN_PATH` | auto | Caminho customizado para arquivo de token do Antigravity |

---

## Dashboard Web

Ao rodar com `ENABLE_WEB_DASHBOARD=1`, acesse no navegador:

👉 **http://localhost:9190**

Recursos do painel:
* Métricas em tempo real (Total de Conexões, Contas OAuth, Chaves de API, Combos).
* Tabela de conexões com tempo restante de cada token e badges de saúde.
* Tabela de combos e cascatas de modelos ativos.
* Botão **Sincronizar Agora** para forçar sincronização sob demanda via API REST (`POST /api/sync`).

---

## Testes Unitários

Execute a suíte de testes completa:

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -p "test_*.py"
```

---

## Contribuição e Proteção da Branch Master

* A branch `master` é protegida. Toda alteração deve ser submetida via Pull Request e aprovada pela suíte de CI.
* Para reportar problemas ou sugerir novos provedores, utilize os formulários em [Issues](https://github.com/pathbit/9rtksync/issues).

---

## Licença

Este projeto é distribuído sob a licença [MIT](LICENSE).
Desenvolvido pela engenharia da **PathBit**.
