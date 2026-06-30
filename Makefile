# ARAG Document Intelligence Studio — task runner.
# npm is NOT used anywhere in this project; everything runs on bare Node (TypeScript
# executed natively via --experimental-transform-types). There are zero deps to install.
#
# Usage:
#   make test      run the test suite
#   make dev       run the bridge with --watch (hot reload), serves UI at :8080
#   make start     run the bridge (production mode)
#   make smoke     run an end-to-end smoke test against the live KB (needs .env)
#   make help      list these targets

NODE := node --experimental-transform-types
BRIDGE := bridge

.PHONY: help install test dev start smoke

help:
	@grep -E '^#   make' Makefile | sed 's/^# //'

# Explicit no-op so muscle-memory `make install` doesn't reach for npm.
install:
	@echo "Nothing to install — this project is dependency-free (Node stdlib + native TS)."
	@echo "Requires Node >= 22.6. Run 'make test' to verify."

test:
	cd $(BRIDGE) && $(NODE) --test test/*.test.ts

dev:
	cd $(BRIDGE) && $(NODE) --watch src/index.ts

start:
	cd $(BRIDGE) && $(NODE) src/index.ts

smoke:
	$(NODE) scripts/smoke.ts
