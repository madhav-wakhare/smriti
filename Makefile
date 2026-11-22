# Smriti. Every command runs in Docker; the host needs only Docker.
#   make up       build and run Smriti
#   make dev      run with live reload (API + Vite)
#   make help     list commands

SHELL := /bin/bash
COMPOSE := docker compose
DEV := docker compose -f compose.yaml -f compose.dev.yaml
PORT := $(or $(shell [ -f .env ] && sed -n 's/^SMRITI_PORT=//p' .env),8090)

.DEFAULT_GOAL := help
.PHONY: help env up down restart logs status dev dev-down test lock lock-web import backup purge shell

help: ## List commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36mmake %-9s\033[0m %s\n", $$1, $$2}'

env: ## Create .env from .env.example
	@[ -f .env ] || { cp .env.example .env && echo "Created .env"; }
	@mkdir -p data import

up: env ## Build the image and run Smriti
	$(COMPOSE) up -d --build
	@for i in $$(seq 1 30); do curl -fs http://localhost:$(PORT)/api/health >/dev/null && break; sleep 1; done
	@curl -fs http://localhost:$(PORT)/api/health >/dev/null && echo "Smriti is running: http://localhost:$(PORT)" || { echo "Smriti did not start: make logs"; exit 1; }

down: ## Stop Smriti
	$(COMPOSE) down

restart: env ## Rebuild and restart
	$(COMPOSE) up -d --build --force-recreate

logs: ## Follow logs (JSON lines on stdout)
	$(COMPOSE) logs -f smriti

status: ## Container state and health
	@$(COMPOSE) ps
	@curl -fs http://localhost:$(PORT)/api/health && echo || echo "Not reachable on port $(PORT)"

dev: env ## Run API and web UI with live reload
	$(DEV) up --build

dev-down: ## Stop the dev containers
	$(DEV) down

test: env ## Run the API tests in the dev image
	$(DEV) run --rm --no-deps smriti pytest -q /app/tests

lock: ## Re-lock Python dependencies (writes api/uv.lock)
	docker run --rm -v "$(CURDIR)/api:/src" -w /src ghcr.io/astral-sh/uv:0.11.27-python3.12-alpine uv lock

lock-web: ## Re-lock web dependencies (writes web/package-lock.json)
	docker run --rm -v "$(CURDIR)/web:/web" -w /web node:22.23-alpine3.24 npm install --package-lock-only --no-audit --no-fund

import: env ## Import an Arc database: put it at import/arc.db first
	$(COMPOSE) run --rm smriti smriti import-arc /import/arc.db

backup: ## Copy the database to data/backups
	$(COMPOSE) run --rm smriti smriti backup /data/backups

purge: ## Remove trash older than SMRITI_TRASH_DAYS
	$(COMPOSE) run --rm smriti smriti purge-trash

shell: ## Shell in the running container
	$(COMPOSE) exec smriti sh
