# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Both surfaces are now a signed-in workspace, not a demo.** `public/` is a hash-routed
  app with a Progress-branded shell and a left sidebar — Documents, Configs, Ask, Jobs,
  Settings — replacing the single page of four numbered cards. `admin/` is an operator
  product in the same shell with its own navigation (Overview, Connection, Configs, Jobs,
  Logs, Usage, Branding, Security), replacing six tabs on one page. Designed in
  `design/PRODUCT-EXPERIENCE.md` (D-28).
- **The record leads with the evidence.** A document's detail page opens on a trust strip
  that states how many of its fields carry a quote found in the document — a claim with a
  denominator, never a bare percentage — and every field row keeps the model's confidence,
  our verification of the quote and the deterministic validation apart. A `Source &
  evidence` tab marks each quote inside the document's own extracted text.
- **Documents is a working queue**: search over the extracted values (not just filenames),
  status/type/review filters, sortable columns, selection with bulk export and delete,
  pagination, and rows that move on their own while a pipeline runs.
- The demo's image-generation prompt gallery moved to `docs/business/walkthrough-demo.md`,
  where a reference belongs.

### Added
- The official Progress Agentic RAG wordmarks in `public/brand/`, used by default on both
  surfaces. `BRAND_*` still overrides them; status, verification and grounding colours are
  never branded.
- `GET /api/v1/documents/{id}/text` — the document's own extracted text, which
  `Evidence.start`/`end` index into. Without it, "show me where this value came from" could
  not be built.
- `GET /api/v1/documents/{id}/source` — the original uploaded file, streamed back from the
  Knowledge Box resource for the source preview.
- `POST /api/v1/documents/{id}/reprocess` — re-run the pipeline over the existing resource;
  the recovery action for every failed and degraded record. Optional `?config=`.
- `POST /api/v1/documents/bulk-delete` and `POST /api/v1/documents/bulk-export` (one JSON
  array, one XML root or one CSV for a whole selection).
- `POST /api/v1/documents/sample` and `GET /api/v1/samples` — the bundled sample catalogue
  behind the first-run flow, so "try it with a sample" is one call.
- `GET /api/v1/stats` and `GET /api/v1/settings` — workspace counters and the effective,
  secret-free runtime settings (accepted types, upload ceiling, connection, model).
- `GET /api/v1/documents` gained `q`, `sort`, `order`, `date_from`, `date_to`, `config`,
  `degraded`, `has_issues`, `min_grounding` and a repeated `doc_type`, plus collection-wide
  `facets` in the response.
- `GET /api/v1/jobs` gained `page`, `page_size`, `sort`, `order` and `q`, and a paged
  response.
- `PUT /api/v1/extraction-configs/{id}` (the id survives an edit, so `meta.config` on
  already-processed documents keeps resolving) and
  `POST /api/v1/extraction-configs/{id}/provision`; `documentCount` on every config.
- `POST /api/v1/admin/purge` gained `dryRun`, so the confirmation can state the exact blast
  radius; `GET /api/v1/admin/security` reports the posture without ever returning a key.
- `AskResponse.citations[]` — the retrieval paragraphs behind an answer.
- `public/ui-ext.css`: 22 new `.dip-*` components. Fifteen are general-purpose and are
  proposed to the platform kit.

## [1.0.0] - 2026-09-12

First API-first release. The prototype ("Document Intelligence Studio") becomes a
versioned, documented, tested product on the shared ARAG platform.

### Added
- **Versioned API `/api/v1`** described by an OpenAPI 3.1 document authored in
  `src/openapi.ts`, served at `/api/v1/openapi.json` with Redoc (`/api/v1/docs`) and
  Swagger UI (`/api/v1/swagger`). Every route is validated from the spec and covered by
  contract tests.
  - `documents`: upload (multipart `file` or raw body + `X-Filename`, `config=auto|agent|<id>`)
    returning `202 {document, job}`; paged and filterable list; canonical record; export as
    JSON/XML/CSV; grounded per-document ask; delete (record **and** KB resource).
  - `jobs`: list, get, cancel, and Server-Sent Events for the live pipeline.
  - `extraction-configs`: list, create, get, delete. Built-in and custom, persisted, each
    backed by a stored ARAG search configuration. Built-ins are not deletable.
  - `schemas`: the document-type catalogue and the fields each schema captures.
  - `session`: a same-origin cookie so the demo UI works when API keys are enforced.
- **Admin panel** at `/admin/`: sign-in, health with a live KB connection test (extract
  strategy and generative model), extraction configs with provisioning status and a
  re-provision action, jobs with detail and cancel, log inspection, effective configuration
  with secrets redacted, and a retention purge.
- **Admin API**: `GET /api/v1/admin/{health,config,usage,logs}` and
  `POST /api/v1/admin/{login,provision,purge}`.
- **Demo app** at `/` rebuilt on the shared UI kit: dropzone, six text samples and four
  image samples, extraction-config selector and manager modal, live pipeline timeline,
  canonical record with confidence bars, entities, validation issues, JSON/XML/CSV export
  buttons, "Ask this document", prompt gallery for generating test documents, and a source
  preview.
- **Persistence** under `DATA_DIR`: documents, jobs and custom extraction configs survive a
  restart (previously in-memory and browser `localStorage`).
- **Three new extraction schemas** — `medical_claim`, `preauthorisation`, `bank_statement` —
  bringing the built-in catalogue to eleven, plus the custom-schema builder.
- **Ingestion-time visual extraction**: `DIP_EXTRACT_STRATEGY` is applied to image and PDF
  uploads.
- **Data Augmentation agent path** (`config=agent`): read fields an ARAG DA "ask" agent
  persisted on the resource instead of extracting live, with a documented fallback.
- **Tests**: 41 `node:test` cases (unit, integration against the mock ARAG, contract) at
  98.5 % line coverage on `src/`, 6 Playwright specs across the demo and admin, and
  `make smoke` for an opt-in live run that cleans up after itself.
- **Ops**: `Dockerfile` (node:22-slim, non-root, no build step), `fly.toml` for app
  `arag-doc-processing` with a `data` volume at `/data`, GitHub Actions CI, and a Makefile
  covering install/dev/start/test/coverage/e2e/lint/typecheck/check/docs/showcase/smoke/
  docker/fly-validate.
- **Documentation**: developer, architecture, business and product-marketing docs;
  developer and architect enablement tracks; and a recorded showcase.

### Changed
- The pipeline now runs as a platform job (`kind: process-document`); the SSE stream is a
  *view* of that job, so a disconnecting client no longer abandons an in-flight extraction.
  The old `GET /api/process` (a GET with side effects) is gone.
- ARAG access goes through the shared platform `AragClient`; the hand-rolled client is
  removed. The stdlib HTTP server is replaced by the platform `App`.
- Every agent call now targets `POST /ask` with `resource_filters: [rid]` instead of
  `POST /resource/{rid}/ask`: the per-resource endpoint rejects `full_resource` grounding
  upstream (HTTP 500/503). See `docs/architecture/arag-integration.md`.
- TypeScript is erasable-syntax only and runs natively on Node ≥ 22.18; the removed
  `--experimental-transform-types` flag is no longer used anywhere.
- Custom extraction configs are stored server-side instead of being re-registered from
  browser `localStorage` on every page load.

### Fixed
- Errors are RFC 9457 `application/problem+json` with a `requestId` linking to the logs;
  ARAG failures never leak the KB URL, token or raw upstream body.
- Uploads are restricted by a MIME allowlist (pdf, png, jpeg, webp, tiff, txt, md, csv,
  docx) and a size cap; filenames are sanitised before they reach the Knowledge Box or a
  `Content-Disposition` header.
- The classifier's token budget was raised: a truncated structured response is invalid JSON
  and silently demoted every document to `generic`.
- Multipart uploads from browsers are parsed with the original `Content-Type`, so
  mixed-case boundaries (`----WebKitFormBoundary…`) are no longer discarded.

### Security
- `ADMIN_TOKEN` protects `/admin` and `/api/v1/admin/*` (constant-time compare, HttpOnly
  cookie); optional `API_KEYS` protect the public API; per-IP token-bucket rate limiting
  with a configurable `TRUST_PROXY`; security headers and a CSP; secrets redacted from
  `/api/v1/admin/config` and from every log line.
- Uploaded documents can be removed from the Knowledge Box on demand
  (`DELETE /api/v1/documents/{id}`) or in bulk by age (`POST /api/v1/admin/purge`).

[1.0.0]: https://github.com/progress/arag-doc-processing/releases/tag/v1.0.0
