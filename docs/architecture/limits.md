# Limits

Every hard-coded number that affects what this product can do, in one place, with the file
it lives in so it can be verified or changed.

## Upload

| Limit | Value | Where |
|---|---|---|
| Max upload size | 25 MB (`26,214,400` bytes) | `DIP_MAX_UPLOAD_BYTES` (`.env.example`); checked in `DocumentsService.create` (`src/services/documents.ts`) |
| Hard HTTP body cap | 25 MB (`26,214,400` bytes) by default | `MAX_BODY_BYTES` (platform, `App.readBody`) — a second, independent cap enforced before the route even runs |
| Allowed content types | 9: `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `image/tiff`, `text/plain`, `text/markdown`, `text/csv`, `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`) | `ALLOWED_MIME`, `src/services/documents.ts` |
| Filename length after sanitisation | 120 characters | `sanitiseFilename`, `src/services/documents.ts` |

## Extraction

| Limit | Value | Where |
|---|---|---|
| Built-in document types / schemas | 11: invoice, receipt, contract, resume, purchase_order, medical_claim, preauthorisation, bank_statement, form, report, generic | `DOC_TYPE_VALUES`, `src/types.ts` (single source of truth — `SCHEMAS` and every `openapi.ts` enum derive from it) |
| Custom config: max fields | 40 | `ExtractionConfigCreate.fields.maxItems`, `src/openapi.ts` |
| Custom config: field label length | 1–80 characters | `ExtractionConfigCreate`, `src/openapi.ts` |
| Custom config: name length | 1–80 characters | `ExtractionConfigCreate.name`, `src/openapi.ts` |
| Custom config: description length | ≤400 characters (config), ≤300 (per field) | `src/openapi.ts` |
| `ask` question length | 1–1200 characters | `AskRequest`, `src/openapi.ts` |
| Job concurrency (per instance) | 2 concurrent `process-document` jobs | `new JobManager(store, log, { concurrency: 2 })`, `src/server.ts` — see [`scaling.md`](scaling.md) |
| Extraction retry | One retry on an empty result for `extract` and `entities` stages | `src/services/pipeline.ts` |

## API and pagination

| Limit | Value | Where |
|---|---|---|
| `page_size` (documents list) | default 50, max 200 | `src/openapi.ts` |
| `limit` (jobs list) | default 50, max 200 | `src/openapi.ts` |
| `limit` (admin logs) | default 200, max 500 | `src/openapi.ts` |
| `contains` filter length (admin logs) | ≤200 characters | `src/openapi.ts` |
| Config id (`config` query param, path `id`) | ≤80 / ≤128 characters | `src/openapi.ts` |
| Default rate limit | 5 requests/sec, burst 20, per IP (or per API key when one is presented) | `RATE_LIMIT_RPS`/`RATE_LIMIT_BURST`, `.env.example` |
| Client-IP source for rate limiting | `TRUST_PROXY`: `fly` (default, trusts `Fly-Client-IP`) \| `xff` (first `X-Forwarded-For` entry) \| `none` (raw socket address) | `Ctx.ip`, `vendor/arag-platform/src/http/app.ts` |
| SSE job-events stream | *Opening* the stream costs one rate-limit token like any other request (verified: 30 rapid opens against a fresh burst-20 bucket returned `429` from the 20th/21st onward); the long-lived stream itself is not separately throttled once open, so a scripted demo that opens many streams quickly can be rate-limited | `src/routes/jobs.ts` |

## Storage and logging

| Limit | Value | Where |
|---|---|---|
| Log ring buffer | Last 500 records kept in memory (`GET /api/v1/admin/logs`) | `Logger`, `ringSize: 500` default, `vendor/arag-platform/src/log/logger.ts` |
| Job store cap | 500 jobs kept (oldest evicted) | `store.collection<Job>("jobs", { cap: 500 })`, `vendor/arag-platform/src/store/jobs.ts` |
| Document store cap | None — grows unbounded until purged | `DocumentsService`'s `Collection` has no `cap` option set |
| Extraction-config store cap | None | Same as above |
| Store flush | Debounced 50ms, atomic rename, whole-collection rewrite per flush | `Collection.scheduleFlush`, `vendor/arag-platform/src/store/jsonstore.ts` |
| Job event history kept per job | Last 200 events (`maxEvents`) | `JobManager`, `vendor/arag-platform/src/store/jobs.ts` |

## What is *not* in the MVP

- **No background TTL sweeper.** Nothing automatically deletes old documents; retention is
  purely `DELETE /documents/{id}` (per-document) or an operator/cron calling
  `POST /admin/purge` (age-based, bulk). Deliberate — see
  [`security-model.md`](security-model.md#data-retention-and-purge) and
  [DP-08](../../DECISIONS.md).
- **No safe multi-instance operation.** The JSON store and the job queue are both
  per-process; see [`deployment-topologies.md`](deployment-topologies.md#multi-instance-considerations).
- **No file-type-specific virus/malware scanning.** The MIME allowlist restricts *type*,
  not content safety.
- **No per-document access control.** Any caller with API access (or none, if `API_KEYS` is
  unset) can read, export, ask, or delete any document — there is no per-document or
  per-tenant ownership model.

## Mock vs live differences

| Aspect | Mock ARAG (`ARAG_MOCK=1`) | Live ARAG |
|---|---|---|
| Stage timings | Milliseconds (synchronous, in-process) | Seconds — `process` (ARAG ingestion) still dominates at roughly 7–8s for a small document after [DP-19](../../DECISIONS.md)'s seeded readiness probe (was ~38s before it); `classify`/`extract`/`entities` ~2s each, `summary` ~2–3s — see [`scaling.md`](scaling.md) for the full before/after table |
| Extraction quality | Synthesised per-field placeholder values (`synthesizeJson`) — exercises the pipeline shape, not real document understanding | Genuine multimodal-LLM extraction grounded in the actual document |
| Classification | Heuristic/synthesised, not a real judgement of document type | Real classification via `answer_json_schema` |
| Data Augmentation agent fields | Only present if a test seeds them directly on the mock resource (`resource.fields.da_fields = ...`) | Only present if a DA "ask" agent is configured on the Knowledge Box in the ARAG dashboard |
| Rate limits / concurrency ceilings | None from the mock itself | Governed by the KB's plan and the underlying model provider — see [`scaling.md`](scaling.md) |
| Cost | Free | LLM spend per `/ask` call (classification, extraction, entities, summary, and any `ask` question) |
| `extractStrategy` (image/PDF visual extraction) | Accepted but has no real effect | A real, configured extract-strategy id changes ingestion-time processing |

## Related

- [`scaling.md`](scaling.md) — throughput implications of the concurrency and latency numbers above.
- [`security-model.md`](security-model.md) — retention and rate-limit *policy* behind these numbers.
- [`deployment-topologies.md`](deployment-topologies.md) — the single-instance assumption in context.
