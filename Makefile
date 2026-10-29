# ============================================================================
# AI Innovators Expedition — London Hackathon Starter Makefile
# Works with GNU Make on macOS and Linux. On Windows use WSL2 (Ubuntu), or run
# the `.venv/bin/python -m ...` commands shown below directly.
# ============================================================================

SHELL := /bin/bash
PYTHON := .venv/bin/python
ADK := .venv/bin/adk
PORT ?= 8000

# .env is read by Make as KEY=value lines: do not quote values, no spaces around '='.
ifneq (,$(wildcard ./.env))
    include .env
    export
endif

PACK ?= $(SEED_PACK)

UI_PORT ?= 8080

.PHONY: help setup check-venv seed dev ui eval eval-validate test deploy test-remote delete

help:
	@echo "AI Innovators Expedition — Starter Commands:"
	@echo "  make setup                    Create Python 3.12 .venv with uv and install dependencies"
	@echo "  make seed PACK=t08            Load Seed Pack data into BigQuery & Cloud Storage"
	@echo "  make dev                      Launch local ADK Web UI (http://127.0.0.1:$(PORT))"
	@echo "  make ui                       Launch VoltMotion Mobility Command Center UI (http://127.0.0.1:$(UI_PORT))"
	@echo "  make eval [PACK=t08]          Run the golden evaluation cases (live Gemini calls)"
	@echo "  make eval-validate [PACK=t08] Validate eval files only (no Gemini calls)"
	@echo "  make test                     Run fast offline unit tests (pytest)"
	@echo "  make deploy [PACK=t08]        Deploy/update the agent on Vertex AI Agent Runtime"
	@echo "                                (ARGS=--create-new forces a second, new agent)"
	@echo "  make test-remote [PROMPT=..]  Send a live verification query to the deployed agent"
	@echo "  make delete [RESOURCE=..]     Delete the deployed agent (default: the one saved by make deploy)"

setup:
	@command -v uv >/dev/null 2>&1 || { \
		echo "ERROR: 'uv' is not installed. Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh"; \
		exit 1; }
	uv venv --python 3.12 .venv
	uv pip install --python $(PYTHON) -r pyproject.toml

check-venv:
	@test -x $(PYTHON) || { echo "ERROR: $(PYTHON) not found. Run 'make setup' first."; exit 1; }

seed: check-venv
	@if [ -z "$(PACK)" ]; then \
		echo "ERROR: Set PACK=<id> (e.g. make seed PACK=t08) or set SEED_PACK in .env"; \
		exit 1; \
	fi
	@$(PYTHON) -c 'import runpy, sys; from app.loader import resolve_pack_directory; d = resolve_pack_directory(sys.argv[1]); runpy.run_path(str(d / "load.py"), run_name="__main__")' "$(PACK)"

dev: check-venv
	$(ADK) web . --port $(PORT)

ui: check-venv
	.venv/bin/uvicorn app.web_app:app --host 127.0.0.1 --port $(UI_PORT)

eval: check-venv
	@if [ -n "$(PACK)" ]; then \
		SEED_PACK="$(PACK)" $(PYTHON) -m eval.run_eval --pack "$(PACK)"; \
	else \
		$(PYTHON) -m eval.run_eval; \
	fi

eval-validate: check-venv
	@if [ -n "$(PACK)" ]; then \
		SEED_PACK="$(PACK)" $(PYTHON) -m eval.run_eval --pack "$(PACK)" --validate-only; \
	else \
		$(PYTHON) -m eval.run_eval --validate-only; \
	fi

test: check-venv
	$(PYTHON) -m pytest -q

deploy: check-venv
	@if [ -n "$(PACK)" ]; then \
		SEED_PACK="$(PACK)" $(PYTHON) -m deploy.deploy --pack "$(PACK)" $(ARGS); \
	else \
		$(PYTHON) -m deploy.deploy $(ARGS); \
	fi

test-remote: check-venv
	$(PYTHON) -m deploy.test_remote $(if $(PROMPT),--message "$(PROMPT)",)

delete: check-venv
	$(PYTHON) -m deploy.delete $(if $(RESOURCE),--resource-name "$(RESOURCE)",)
