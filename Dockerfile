# syntax=docker/dockerfile:1.7
# Smriti: one image that serves the API and the built web UI.
# Stages: web (Node builds static files) -> deps (uv builds the venv) -> runtime (Python + venv + app).
# api-dev and web-dev are the same toolchains with source mounted, for `make dev` (dev/prod parity).

ARG PYTHON_VERSION=3.12.15-alpine3.24
ARG NODE_VERSION=22.23-alpine3.24
ARG UV_VERSION=0.11.27

FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

# ---- web: build the React UI ----
FROM node:${NODE_VERSION} AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- web-dev: Vite dev server; source is mounted at /web ----
FROM node:${NODE_VERSION} AS web-dev
WORKDIR /web
CMD ["sh", "-c", "npm ci --no-audit --no-fund && npm run dev -- --host 0.0.0.0 --port 5173"]

# ---- deps: locked Python dependencies in /app/.venv ----
FROM python:${PYTHON_VERSION} AS deps
COPY --from=uv /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY api/pyproject.toml api/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project

# ---- api-dev: dev dependencies (pytest) and reload; source is mounted at /app ----
FROM deps AS api-dev
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    SMRITI_DB_PATH=/data/smriti.db SMRITI_STATIC_DIR=""
RUN printf '#!/bin/sh\nexec python -m smriti "$@"\n' > /usr/local/bin/smriti && chmod +x /usr/local/bin/smriti
CMD ["sh", "-c", "uvicorn smriti.main:app --host 0.0.0.0 --port ${PORT:-8000} --reload --reload-dir /app/smriti"]

# ---- runtime: no uv, no Node, no build tools ----
FROM python:${PYTHON_VERSION} AS runtime
LABEL org.opencontainers.image.title="Smriti" \
      org.opencontainers.image.description="A personal tracker for your work and what you learn: plan the day, log time, keep a reading list and revisit ideas. Runs on your computer in one container with one SQLite file."
ARG APP_UID=1000
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/python3.12/site-packages/pip /usr/local/lib/python3.12/site-packages/pip-* /usr/local/bin/pip* \
 && adduser -D -H -u ${APP_UID} smriti && mkdir -p /data && chown smriti /data \
 && printf '#!/bin/sh\nexec python -m smriti "$@"\n' > /usr/local/bin/smriti && chmod +x /usr/local/bin/smriti
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH" \
    PORT=8000 SMRITI_DB_PATH=/data/smriti.db SMRITI_STATIC_DIR=/app/static
WORKDIR /app
COPY --from=deps /app/.venv ./.venv
COPY api/smriti ./smriti
COPY --from=web /web/dist ./static
USER smriti
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["sh", "-c", "exec uvicorn smriti.main:app --host 0.0.0.0 --port ${PORT} --no-server-header --no-access-log"]
