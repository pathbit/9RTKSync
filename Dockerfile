# ==============================================================================
# 9RTKSync: 9Router Token & Connection Sync
# Imagem oficial baseada em Python 3.14 Alpine
# ==============================================================================

FROM python:3.14-alpine

LABEL org.opencontainers.image.title="9RTKSync"
LABEL org.opencontainers.image.description="9Router Universal Token & Connection Synchronizer"
LABEL org.opencontainers.image.authors="Eliel Sousa <eliel@pathbit.co>"
LABEL org.opencontainers.image.source="https://github.com/pathbit/9RTKSync"

WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/src
ENV DB_PATH=/app/data/db/data.sqlite
ENV SYNC_INTERVAL=300
ENV REFRESH_MARGIN=900
ENV WEB_PORT=9190
ENV WEB_HOST=0.0.0.0
ENV ENABLE_WEB_DASHBOARD=1

COPY src/ /app/src/
COPY pyproject.toml /app/

EXPOSE 9190

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9190/healthz', timeout=3)" || exit 1

ENTRYPOINT ["python3", "-m", "nine_rtksync"]
CMD ["--daemon"]
