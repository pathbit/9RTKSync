.PHONY: setup test test-container venv run status docker-build docker-run clean

# Cria o .env a partir do .env.example. Nunca sobrescreve um .env existente:
# ele carrega os seus segredos, e um `make setup` distraido nao pode apaga-los.
# O docker compose le esse .env sozinho, por estar ao lado do compose.
setup:
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

docker-run:
	docker run --rm -it --name 9rtk-sync -p 9091:9090 9rtksync:latest

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
