.PHONY: rede-de-inferencia setup test test-container venv run status docker-build docker-run clean

# Cria o .env a partir do .env.example. Nunca sobrescreve um .env existente:
# ele carrega os seus segredos, e um `make setup` distraido nao pode apaga-los.
# O docker compose le esse .env sozinho, por estar ao lado do compose.
# A rede de inferencia e compartilhada pelos tres gateways e declarada como
# externa nos tres composes -- externa justamente para que nenhuma das stacks
# seja dona dela: qualquer uma pode subir primeiro, e derrubar uma nao leva a
# rede junto. O preco e que ela precisa existir antes do primeiro `up`, e o
# compose so diz "network declared as external, but could not be found".
rede-de-inferencia:
	@docker network inspect rtk-inference-net >/dev/null 2>&1 \
		|| docker network create rtk-inference-net >/dev/null \
		&& echo "rede rtk-inference-net pronta."

setup: rede-de-inferencia
	@if [ -f .env ]; then \
		echo ".env ja existe — preservado."; \
	else \
		cp .env.example .env; \
		echo ".env criado a partir de .env.example."; \
	fi
	@echo ""
	@echo "Preencha no .env antes de subir a stack:"
	@grep -nE '^[A-Z_]+=$$' .env | sed 's/^/   linha /' || echo "   (nada obrigatorio em branco)"
	@echo ""
	@echo "O painel usa DASHBOARD_USER e DASHBOARD_PASSWORD. Sem senha definida,"
	@echo "o primeiro acesso usa a credencial de recuperacao gerada no boot."


VENV ?= .venv
PYTHON ?= $(shell which $(VENV)/bin/python3 2>/dev/null || which python3 2>/dev/null)

# Run tests: uses local virtualenv if present; otherwise runs inside Docker container
test:
	@if [ -x "$(VENV)/bin/python3" ]; then \
		echo "Running tests in local virtual environment ($(VENV))..."; \
		PYTHONPATH=src $(VENV)/bin/python3 -m unittest discover -s tests -p "test_*.py"; \
	elif command -v python3 >/dev/null 2>&1; then \
		echo "Running tests with host python3..."; \
		PYTHONPATH=src python3 -m unittest discover -s tests -p "test_*.py"; \
	else \
		echo "Local Python not found. Running tests in Docker container..."; \
		$(MAKE) test-container; \
	fi

# Run tests strictly inside Docker container (zero host dependencies other than Docker)
test-container:
	docker run --rm -v "$$(pwd)":/app -w /app -e PYTHONPATH=/app/src python:3.14-alpine python3 -m unittest discover -s tests -p "test_*.py"

venv:
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install --upgrade pip
	$(VENV)/bin/pip install -e .

run:
	PYTHONPATH=src $(PYTHON) -m nine_rtksync.cli --daemon

status:
	PYTHONPATH=src $(PYTHON) -m nine_rtksync.cli --status

docker-build:
	docker build -t 9rtksync:latest -t ghcr.io/pathbit/9rtksync:latest .

# O bind em 127.0.0.1 nao e detalhe: este painel le o banco do gateway e mostra
# a saude das credenciais. Sem o prefixo, "-p PORTA:9090" publica em TODA
# interface -- o Wi-Fi do cafe, a VLAN do escritorio -- enquanto os composes
# deste repo publicam so no loopback. Comentario FORA da receita: linha iniciada
# por # dentro de um alvo vai para o shell e aparece na saida.
docker-run:
	docker run --rm -it --name 9rtk-sync -p 127.0.0.1:9091:9090 9rtksync:latest

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
