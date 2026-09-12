# Document Processing — task runner. bun installs dev tooling only; npm is never used.
BUN ?= bun
NODE ?= node
PORT ?= 8080
.PHONY: help install dev start test coverage e2e lint format typecheck check docs showcase smoke docker fly-validate mock sync-platform

help:
	@echo "make install       bun install (dev tooling, exact pins)"
	@echo "make dev           run with --watch on :$(PORT) (ARAG_MOCK=1 unless .env has credentials)"
	@echo "make start         run in production mode"
	@echo "make test          unit + integration + contract tests (node:test, mock ARAG)"
	@echo "make coverage      tests with the 80% line-coverage gate on src/"
	@echo "make e2e           Playwright (demo + admin) against a mock-backed server"
	@echo "make lint          Biome check"
	@echo "make typecheck     tsc --noEmit"
	@echo "make check         lint + typecheck + coverage"
	@echo "make docs          regenerate docs/developer/api-reference.md from openapi.json"
	@echo "make showcase      record the showcase walkthrough (video + screenshots)"
	@echo "make smoke         OPT-IN live end-to-end run against the real KB (needs .env)"
	@echo "make docker        build the container image"
	@echo "make fly-validate  validate fly.toml"

install:
	$(BUN) install --frozen-lockfile || $(BUN) install

dev:
	@test -f .env || cp .env.example .env
	@if grep -qE '^ARAG_API_KEY=.+' .env 2>/dev/null; then \
		PORT=$(PORT) $(NODE) --watch src/index.ts; \
	else \
		ARAG_MOCK=1 PORT=$(PORT) $(NODE) --watch src/index.ts; \
	fi

start:
	$(NODE) src/index.ts

test:
	$(NODE) --test --test-reporter=spec 'test/*.test.ts'

coverage:
	$(NODE) --test --experimental-test-coverage --test-coverage-include='src/**' --test-coverage-exclude='src/index.ts' --test-coverage-lines=80 'test/*.test.ts'

# PW_DISABLE_TS_ESM=1: Playwright's ESM TypeScript loader hangs on Node >= 26; the CJS transform works everywhere.
e2e:
	rm -rf data/e2e test-results
	PW_DISABLE_TS_ESM=1 $(BUN)x playwright test

lint:
	$(BUN)x biome check .

format:
	$(BUN)x biome check --write .

typecheck:
	$(BUN)x tsc --noEmit -p tsconfig.json

check: lint typecheck coverage

docs:
	$(NODE) scripts/gen-api-reference.ts docs/developer/api-reference.md

showcase:
	rm -rf data/showcase showcase/out
	PW_DISABLE_TS_ESM=1 SHOWCASE=1 $(BUN)x playwright test showcase/record.spec.ts --config playwright.config.ts

smoke:
	$(NODE) scripts/smoke.ts

docker:
	docker build -t arag-doc-processing:local .

fly-validate:
	fly config validate -c fly.toml

mock:
	$(NODE) vendor/arag-platform/src/arag/mock/cli.ts

sync-platform:
	cd ../arag-platform && $(MAKE) sync-platform TARGET=../arag-doc-processing
