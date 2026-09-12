# Local development

## Repo layout

```
src/
  types.ts        Shared types: ExtractedField, Entity, DocumentRecord, StageName, ...
  openapi.ts       OpenAPI 3.1 document — the single source of truth for /api/v1
  server.ts        App wiring: middleware, routes, docs, static, admin (createProduct())
  index.ts         Process entry point (reads env, calls createProduct, listens)
  routes/          One module per resource — thin HTTP handlers only
    documents.ts   upload / list / get / export / ask / delete
    jobs.ts        list / get / cancel / SSE events
    configs.ts     extraction-configs CRUD + schema catalogue
    admin.ts       login / health / config / usage / logs / provision / purge
  services/        Domain logic, no HTTP types
    documents.ts   Upload validation, the DocumentsService (create/list/export/ask/delete/purge)
    pipeline.ts     runPipeline(): process → classify → extract → entities → summary → validate → standardize
    schemas.ts      The 11 built-in ExtractionSchemas + custom config builder
    agents.ts       ARAG calls: classify, extractFields, enrichEntities, summarize, readPersistedFields
    configs.ts      ConfigsService: built-in + custom extraction configs, ARAG provisioning
    formats.ts      DocumentRecord → JSON / XML / CSV
    normalize.ts    Pure parseAmount / parseDateISO / normalizeCurrency helpers
public/            Operator app (static, hash-routed, vanilla JS/CSS) — consumes only /api/v1
  lib/core.js      Shared shell, router, fetch helper and UI primitives (used by admin/ too)
  views/           One module per screen: documents, document, configs, jobs, ask, settings, upload, welcome
admin/             Admin app (static, hash-routed) — consumes only /api/v1 (+ /api/v1/admin)
vendor/arag-platform/   Vendored platform (never edit in place — see below)
test/              Unit + integration + contract (test/*.test.ts) and e2e (test/e2e/*.spec.ts)
data/              DATA_DIR — JSON stores (gitignored)
```

## `make` targets

| Target | What it does |
|---|---|
| `make install` | `bun install --frozen-lockfile` (falls back to a normal install). Dev tooling only — the product has zero runtime dependencies. |
| `make dev` | Copies `.env.example` → `.env` if missing, then runs `node --watch src/index.ts` on `$PORT` (default 8080). Auto-selects `ARAG_MOCK=1` unless `.env` already has `ARAG_API_KEY=...`. |
| `make start` | `node src/index.ts` — no watch, production-style run. |
| `make test` | `node --test --test-reporter=spec 'test/*.test.ts'` — unit + integration + contract, mock ARAG. |
| `make coverage` | Same, with `--experimental-test-coverage`, gated at 80% lines on `src/**` (excluding `src/index.ts`). |
| `make e2e` | Wipes `data/e2e` and `test-results`, then Playwright (`test/e2e/*.spec.ts`) against a mock-backed server it boots itself. |
| `make lint` | `biome check .` |
| `make format` | `biome check --write .` |
| `make typecheck` | `tsc --noEmit -p tsconfig.json` |
| `make audit` | `scripts/audit.ts` — fails on any dependency advisory not explicitly accepted (with a reason and an expiry date), instead of the all-or-nothing of raw `bun audit`. The one current acceptance (a dev-only `@playwright/test` advisory, never run in CI or the image) expires 2026-12-01. |
| `make check` | `lint` + `typecheck` + `coverage` + `audit` — the pre-merge bar. |
| `make docs` | Regenerates `docs/developer/api-reference.md` from `openapi.json` via the platform's `openapi-to-md.ts`, then runs the link check (below). Never hand-edit that file. |
| `make links` | `scripts/link-check.ts` — verifies every relative link in `docs/`, `enablement/` and `showcase/` resolves to a real file. A CI gate; run it after any doc change. |
| `make showcase` | Wipes `data/showcase` and `showcase/out`, records the Playwright walkthrough (`showcase/record.spec.ts`) with video on. |
| `make smoke` | **Opt-in.** Runs `scripts/smoke.ts` against the real KB from `.env` credentials — uploads, processes, asserts, then deletes what it created. Never run in CI. |
| `make docker` | `docker build -t arag-doc-processing:local .` |
| `make fly-validate` | `fly config validate -c fly.toml` |
| `make mock` | Runs the in-process mock ARAG standalone (`vendor/arag-platform/src/arag/mock/cli.ts`) so you can point a real HTTP client at a fake Knowledge Box without running the whole product. |
| `make sync-platform` | Re-vendors the platform from `../arag-platform` (`cd ../arag-platform && make sync-platform TARGET=../arag-doc-processing`). |

## How the mock ARAG works

`ARAG_MOCK=1` starts [`startMockArag()`](../../vendor/arag-platform/src/arag/mock/server.ts)
in-process — a deterministic stand-in for a Knowledge Box implementing upload, resource
status/extracted text, `/find`, `/ask` (NDJSON, `answer_json_schema`, `full_resource`),
search configurations, and delete. Uploaded text is echoed back as "extracted text";
structured extraction is synthesised per-field from the schema (`synthesizeJson` in
`vendor/arag-platform/src/arag/mock/fixtures.ts`) rather than genuinely understanding the
document — good enough to exercise the whole pipeline shape, not a substitute for testing
against a real KB before shipping a schema change. By default resources go `PROCESSED`
immediately and are searchable immediately; tests that need to observe a "running" job pass
`processingMs` / `searchableLagMs` to `startMockArag`/`createProduct({ mock: {...} })`. Tests
override specific answers with `answerHook` — see
[`extension-points.md`](extension-points.md#the-answerhook-seam-mock-arag-behaviour-in-tests).

## Running one test file

```bash
node --test test/formats.test.ts
node --test test/pipeline.test.ts
```

`node --test` accepts one or more file paths directly; no separate flag is needed to select
a single file. Add `--test-name-pattern='<regex>'` to run a single `test()` inside a file.

## Playwright notes

- `PW_CHANNEL` selects the browser channel; `make e2e` and `make showcase` don't set it, so
  Playwright falls back to `channel: "chrome"` locally (`playwright.config.ts`) unless `CI`
  is set, in which case it uses the bundled Chromium.
- `PW_DISABLE_TS_ESM=1` (set by both `make e2e` and `make showcase`) forces Playwright's CJS
  TypeScript transform. Its ESM TypeScript loader hangs on Node ≥ 26 — this machine's local
  Node version — so the Makefile always sets it for you; only relevant if you invoke
  `bunx playwright test` directly.
- The operator-app (`test/e2e/app.spec.ts`), admin (`admin.spec.ts`) and branding
  (`branding.spec.ts`) specs share one mock-backed server and global state (jobs, documents,
  configs — the admin spec purges them), so `playwright.config.ts` pins `workers: 1` and
  `fullyParallel: false`. Don't try to parallelise them.
- `reuseExistingServer: !process.env.CI` — locally, Playwright will reuse a server you
  already have running on the configured port instead of starting its own.

## `DATA_DIR` and resetting state

Every store (`documents.json`, `jobs.json`, `extraction-configs.json`) lives under
`DATA_DIR` (default `./data`, `make dev` effectively uses `./data` too since `.env.example`
sets `DATA_DIR=./data`). Reset all local state:

```bash
rm -rf data          # or: rm -rf data/dev if you've set DATA_DIR=./data/dev
```

The server creates the directory on boot if it's missing. `test/*.test.ts` uses a fresh
`mkdtempSync` directory per run (never your `data/`); `make e2e` and `make showcase` use
`data/e2e` and `data/showcase` respectively and wipe them before running.

## Debugging

- `LOG_LEVEL=debug make dev` — logs every ARAG request (`arag.request`: method, path,
  status, ms) alongside the one `http` line per request. Secrets are redacted by key name
  (`*token*`, `*key*`, `*secret*`, `*password*`, `authorization`, `cookie`) wherever they
  appear in logged fields.
- `GET /api/v1/admin/logs?level=&contains=&limit=` (bearer `ADMIN_TOKEN`, or the admin
  panel's Logs tab) reads the last up-to-500 in-memory log records — the same ring buffer
  the process logs to stdout, filterable by level and a substring:

  ```bash
  curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
       'http://localhost:8080/api/v1/admin/logs?level=warn&limit=50'
  ```

- `GET /api/v1/admin/config` (admin) shows the effective, secret-redacted environment plus
  store file paths and every registered route — useful for confirming which `.env` actually
  took effect.
- `GET /api/v1/admin/usage` (admin) shows request/ARAG-call counters and job counts by
  status — a quick way to tell whether a stuck run is a slow ARAG call or a hung process.
- `GET /api/v1/admin/search-configurations` (admin) reads the stored `dip_*` search
  configurations straight from the Knowledge Box — the actual model, RAG strategy, prompt
  and `answer_json_schema` extraction is running against, not a local reconstruction. Useful
  for confirming a config really provisioned the way you expect, or diagnosing why
  extraction against a real KB behaves differently than the schema in `schemas.ts` implies.
- The admin app's Jobs screen shows the same job timeline as the operator app's Pipeline
  tab, for any job, including ones the operator app never rendered (e.g. one you drove
  entirely with curl).

## Related

- [`extension-points.md`](extension-points.md) — where to add code.
- [`contributing.md`](contributing.md) — workflow and the API-first / vendored-platform rules.
- [`../architecture/limits.md`](../architecture/limits.md) — hard numbers referenced above (log ring size, job cap, upload cap).
