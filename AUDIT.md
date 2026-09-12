# AUDIT — Document Processing (`arag-doc-processing`)

Audited 2026-09-12 against the GitHub repo (1 commit, `188ac7e`) **and** the code actually running on Fly
(`arag-doc-processing`, deployed 2026-07-17), which is newer than the repo.

## Stack

| Item | Value |
|---|---|
| Runtime | Node ≥ 22.6, TypeScript executed natively via `--experimental-transform-types` |
| Dependencies | **Zero** runtime and dev dependencies (Node stdlib `http`, `fs`, `crypto`) |
| Frontend | Static `public/` (vanilla JS + CSS), served by the bridge; no build |
| Tests | `node --test`, 3 files, 15 tests (formats, normalize, agents) |
| Deploy | `bridge/Dockerfile` (`node:22-slim`), `bridge/fly.toml`, region `iad`, 512 MB |
| Config | `ARAG_KB_URL`, `ARAG_TOKEN`, `ARAG_GENERATIVE_MODEL`, `ARAG_RERANKER`, `ARAG_TIMEOUT_MS`, `PORT`, `MAX_UPLOAD_BYTES`, `LOG_LEVEL` (+ `ARAG_EXTRACT_STRATEGY` in the deployed build) |

## ARAG features used (verified against docs.rag.progress.cloud)

- `POST /kb/{kb}/upload` (simple upload, `X-FILENAME` base64) — deployed build adds `?extract_strategy=<id>` for images/PDFs (ingestion-time **visual-LLM extract strategy**).
- `GET /kb/{kb}/resource/{rid}?show=basic|extracted&extracted=text` — processing status polling and extracted text.
- `POST /kb/{kb}/find` with `resource_filters` — cheap "is it searchable yet" gate.
- `POST /kb/{kb}/ask` (NDJSON) with `answer_json_schema` (structured extraction), `rag_strategies:[{name:"full_resource"}]`, `resource_filters`, `temperature:0`, `max_tokens`, `generative_model`, `reranker`, and `citations:true` for Q&A. Docs confirm `answer_json_schema` disables `citations`, which the code already handles.
- Deployed build: `POST /kb/{kb}/search_configurations/{name}` (`kind:"ask"`) — one stored config per extraction schema (`dip_<schema>`), then `/ask` with `search_configuration`.
- Deployed build: reads fields persisted by a **Data Augmentation "ask" agent** (JSON text field or key-value field) as an alternative to live extraction.
- `DELETE /kb/{kb}/resource/{rid}` (smoke-test cleanup).

## Architecture

`bridge/src`: `config` → `arag` (only ARAG client) → `agents` (classify / extract / entities / summarize / validateNormalize) → `pipeline` (stage orchestration, SSE events) → `server` (stdlib HTTP: static UI + 6 JSON/SSE endpoints) → `index`. `schemas.ts` holds 8 (repo) / 11 (deployed) extraction schemas; `formats.ts` serializes the canonical `DocRecord` to JSON/XML/CSV. Finished records live in an in-memory `Map`.

## What works

- The pipeline design is sound and the four "ARAG mechanics" in `docs/ARCHITECTURE.md` (full_resource grounding, query seeding, PROCESSED≠searchable gate, strings-then-normalize for amounts) are real, documented hard-won behaviour worth keeping verbatim.
- Live deployment is healthy (`/api/health` 200, KB connected, 14 records in memory, extract strategy configured).
- `formats.ts`, `normalize.ts` and `validateNormalize` are pure, deterministic and tested; XML escaping and CSV quoting are correct.
- Path-traversal guard on static serving; upload size cap; secrets only server-side.

## What is broken or weak

1. **Repo ≠ production.** ~700 lines of deployed code (custom extraction configs, stored search configurations, extract strategy, DA-agent field ingestion, image samples, prompt gallery, document preview) never made it to GitHub. The repo is not the source of truth. Deployed source was retrieved and will be merged.
2. **Toolchain rot.** `--experimental-transform-types` no longer exists in Node 26 (this machine); `make test` fails outright. Under `--experimental-strip-types` the code fails on TypeScript parameter properties (`AragError`). Must move to erasable-only TS syntax.
3. **Tests fail** (1 of 3 files) because of (2); coverage of `arag.ts`, `pipeline.ts`, `server.ts` is zero — there is no HTTP test, no NDJSON parsing test, no ARAG mock.
4. **Not API-first.** Endpoints are unversioned (`/api/ingest`, `/api/process?id=`), the SSE stream carries the whole workflow, and there is no OpenAPI spec. `GET /api/process` has side effects (runs a pipeline on GET).
5. **No persistence.** Records and custom configs vanish on restart/redeploy; the UI works around it by re-registering configs from `localStorage` on every load (and re-provisions ARAG search configurations each time).
6. **No admin surface, no auth, no rate limiting.** Anyone can upload arbitrary files into the KB and create search configurations.
7. **Security gaps:** `X-Filename` header used unsanitised for `Content-Disposition`; no content-type allowlist; uploads are never deleted from the KB (data retention); CORS not defined; no request IDs.
8. **Process robustness:** SSE handler ignores client disconnect for the running pipeline (keeps calling ARAG); the classifier caps `maxTokens: 60`, which can truncate the JSON and silently drop the classification to `generic`.
9. Duplicate `.env` search paths (`bridge/.env` and repo `.env`) but `.env.example` sits at the root only; README says `cp .env.example .env`, Makefile runs from `bridge/`.
10. `package.json` `scripts` reference the removed Node flag; `docs/` has one file; no `LICENSE`, `CONTRIBUTING`, `SECURITY`, CI, changelog.

## Security review

| Area | Finding | Action |
|---|---|---|
| Secrets | Env-only, never logged, never to browser | Keep |
| Input validation | Filename/content-type unchecked; JSON bodies partially checked | Validate against OpenAPI schemas; allowlist MIME types |
| Auth | None on any route | Admin token on `/admin` + `/api/v1/admin/*`; optional API keys on public API |
| Rate limiting | None | Token bucket per IP on public routes |
| Data retention | Uploaded documents stay in the KB forever | Configurable TTL + admin purge |
| Supply chain | Zero deps (excellent) | Keep zero runtime deps; dev deps pinned |
| Headers | No CSP / HSTS / nosniff | Add via platform middleware |

## Keep vs rewrite

| Keep (port into platform/product) | Rewrite |
|---|---|
| Pipeline stage model and the ARAG mechanics (query seed, searchable gate, full_resource, string amounts) | HTTP layer → versioned REST API from an OpenAPI 3.1 spec, jobs resource, SSE as a *view* of a job |
| `schemas.ts` (all 11 deployed schemas + custom config builder) | In-memory stores → persisted stores (`DATA_DIR`, JSON files) |
| `formats.ts`, `normalize.ts`, `validateNormalize`, `fieldsFromObject` | ARAG client → shared platform client (typed, NDJSON parser, retries, timeouts, mockable) |
| Deployed UI ideas (config manager, image samples, preview, prompt gallery) | UI rebuilt on the shared UI kit, consuming only `/api/v1` |
| `Dockerfile` / `fly.toml` shape | Node flag → unflagged type stripping; tests → node:test + coverage + contract + Playwright |
