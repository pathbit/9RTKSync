# ==============================================================================
# 9RTKSync: 9Router Universal Token & Connection Sync
# Imagem oficial baseada em Python 3.14 Alpine
# ==============================================================================

FROM python:3.14-alpine

LABEL org.opencontainers.image.title="9RTKSync"
LABEL org.opencontainers.image.description="9Router Universal Token & Connection Synchronizer"
LABEL org.opencontainers.image.authors="Eliel Sousa <eliel@pathbit.co>"
LABEL org.opencontainers.image.source="https://github.com/pathbit/9RTKSync"

WORKDIR /app

# Criação obrigatória e isolada do Virtual Environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV VIRTUAL_ENV="/opt/venv"

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/src
ENV DB_PATH=/app/data/db/data.sqlite
ENV ROUTER_URL=http://127.0.0.1:20128
ENV SYNC_INTERVAL=300
ENV REFRESH_MARGIN=900
ENV WEB_PORT=9190
ENV WEB_HOST=0.0.0.0
ENV ENABLE_WEB_DASHBOARD=1

COPY src/ /app/src/
COPY pyproject.toml /app/

# Instalação do pacote dentro do virtual environment
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e .

EXPOSE 9190

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD /opt/venv/bin/python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9190/healthz', timeout=3)" || exit 1

ENTRYPOINT ["/opt/venv/bin/python3", "-m", "nine_rtksync"]
CMD ["--daemon"]
