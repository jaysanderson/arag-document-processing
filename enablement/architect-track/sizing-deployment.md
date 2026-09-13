# Sizing and deployment guidance

**Time to work through: about 20 minutes to read.** Longer if you do the arithmetic
against your own expected volume and document mix — budget that separately.

Grounded in real numbers observed from a live pipeline run against Progress Agentic
RAG, and the actual configuration shipped in `fly.toml` / `src/server.ts`. Where a
number is a measurement rather than a fixed constant (ARAG timings vary with document
size, KB load and model choice), it's flagged as such — use it for planning-grade
estimates, not as an SLA.

Companion documents: [`WORKSHOP.md`](WORKSHOP.md) covers the reference architecture and
decision points these numbers fall out of; [`design-review-checklist.md`](design-review-checklist.md)
turns the reliability and cost implications below into a pre-deployment checklist;
[`key-value-schema-design.md`](key-value-schema-design.md) covers how to design
extraction-config schemas so the ceilings below don't bite later.

## The numbers this guide is built on

| Stage | Observed duration (live KB, two runs) | What it is |
|---|---|---|
| `process` | **6.7–7.8 s** | ARAG OCR/visual-layout/embedding processing, plus a `waitSearchable` gate now seeded with the document's own extracted text (DP-19) rather than a generic probe query |
| `classify` | 1.6–1.9 s | One `/ask` call with a small structured schema |
| `extract` | ~2.0 s | One `/ask` call against the schema's stored search configuration |
| `entities` | 2.1–2.4 s | One `/ask` call (run sequentially after `extract`, not concurrently) |
| `summary` | 1.8–2.6 s | One `/ask` call, longer output (a paragraph + tags) |
| `validate` | ~0 s | Deterministic, no model call |
| **Total** | **≈ 14 s per document** | End to end, from upload accepted to `status: "ready"` |

**Two caveats before you use this table for capacity planning.** First, it's one small
text document (`public/samples/invoice.txt`, ~1 KB) measured twice against one live
Knowledge Box — a reasonable planning basis, not a guarantee. Second, `process` is still
entirely ARAG-side work that scales with document size and page count, not with this
service's CPU: a 20-page scanned PDF will spend far longer in `process` than a 1 KB text
file does, even though the number above dropped sharply. The change that produced these
numbers (DP-19 in `DECISIONS.md`, folded into ARAG mechanic 4 in
`docs/architecture/arag-integration.md`) removed a *polling artefact* — a generic
probe query needing ~20 polls to see the resource become searchable, versus one seeded
with the document's own words hitting on the first attempt — it did not make ARAG's
underlying OCR/embedding work faster for a given document. Before this fix, `process`
alone measured ~37.8 s and the same small text file took ~50 s end to end; the
architecture point this guide makes — `process` is ARAG-side wait time, not local
CPU/RAM pressure on this service — holds regardless of which number is current.

Other fixed facts from the running configuration:

- **Job concurrency: 2 per instance** (`new JobManager(store, log, { concurrency: 2 })`
  in `src/server.ts`) — a hard-coded constant today, not a settings-store value (it
  isn't one of the keys DP-52 put in the `limits` group — see below).
- **Upload cap: 25 MB by default**, not a fixed ceiling any more. `limits.maxUploadBytes`
  (env default `DIP_MAX_UPLOAD_BYTES`/`26214400`) is one of the settings DP-52 made
  live: an operator can raise or lower it with `PATCH /api/v1/admin/settings`, it takes
  effect immediately with no restart, and `GET /api/v1/admin/settings`'s
  `applied.limits.maxUploadBytes` shows what's actually enforced right now — which may
  no longer match `fly.toml`/the deployed env var. Size for the *effective* value, and
  confirm what it currently is before assuming the shipped default.
- **Rate limiting is the same story.** `limits.rateLimitRps` and `limits.rateLimitBurst`
  are also environment-defaulted, store-overridable, live settings (DP-52). They don't
  change ARAG-side throughput — job concurrency is still what gates document
  processing — but they change how many concurrent callers this instance accepts
  before answering `429`, which matters when a customer's own integration retries
  aggressively. Check `applied.limits` for the numbers actually in force, not the env
  var alone.
- **State: JSON files on a Fly volume**, one file per collection
  (`documents.json`, `jobs.json`, `extraction-configs.json`, and — since the real
  API-key store and DP-52's settings layering — `settings.json`, `apikeys.json`,
  `audit.json`, plus `generators.json` and `runtime.json`), loaded fully into
  memory at boot and rewritten atomically on every write
  (`vendor/arag-platform/src/store/jsonstore.ts`). There is no external database. See
  "Memory and CPU guidance" below for how the audit log and job store grow.
- **Default deployment shape** (`fly.toml`): `shared-cpu-1x`, 1 GB RAM, a 1 GB volume,
  `min_machines_running = 1`.

On the mock ARAG (`ARAG_MOCK=1`, used for all automated tests and this lab) every stage
completes in single-digit milliseconds — the mock exists to make tests fast and
deterministic, not to model production latency. Use the table above, not the mock, for
capacity planning.

## Throughput maths

**Per-instance ceiling**, assuming every document takes the full ~14 s and concurrency
stays at the shipped value of 2:

```
documents/hour  = concurrency × (3600 s / seconds-per-document)
                = 2 × (3600 / 14)
                ≈ 514 documents/hour per instance

documents/day   ≈ 514 × 24 ≈ 12,343 documents/day per instance (continuous, no headroom)
```

Treat 12,343/day as a **theoretical ceiling**, not a planning number — it assumes zero
retries, uniformly small documents (per the caveats above, a multi-page PDF or a large
image takes meaningfully longer through `process` than the 1 KB text sample this figure
is based on), and continuous 24-hour arrival. A realistic planning number for a single
default instance handling similarly small/medium documents is now **5,000–7,000
documents/day**, leaving headroom for retries (`extract` and `entities` each retry once
on an empty result — see `src/services/pipeline.ts`), larger files, and non-uniform
arrival (a morning batch, not a perfectly flat rate). This is roughly 3.5× the
~1,000–1,500/day this same instance could plan for before DP-19 — worth restating to a
customer whose sizing conversation happened before that change landed.

**What actually gates throughput, in order:**

1. **`process`** is still the single largest individual stage (~7 s of ~14 s total) and
   is still ARAG-side wait time, not local CPU/RAM pressure on this service — but it no
   longer *dominates* the way it used to (previously ~36 s of ~50 s, roughly
   three-quarters of total latency; now roughly half). The four model-call stages
   (`classify`/`extract`/`entities`/`summary`, ~2 s each) now collectively take about as
   long as `process` itself, so total latency is spread more evenly across five ARAG
   round-trips than it was before. The main cost to *this* instance during any of them
   is one open HTTP connection/poll loop per in-flight document, not sustained CPU.
2. **Job concurrency (2)** is the actual per-instance throughput lever, and — per the
   maths above — already delivers a meaningfully higher ceiling than before with zero
   configuration change. Raising it further increases the number of documents processed
   in parallel, at the cost of more simultaneous outbound ARAG calls (subject to the
   KB's own rate limits — check these with the ARAG account before raising this
   aggressively) and more concurrent CPU work during the four model-call stages, which
   *do* consume local CPU for request/response handling and JSON parsing, even though
   the LLM inference itself happens on ARAG's side.
3. **The JSON store** is not a throughput bottleneck at the volumes this product
   targets (writes are debounced and batched — see `scheduleFlush()` in
   `jsonstore.ts`) but it is a **hard ceiling on horizontal scaling**: two instances
   each holding their own in-memory copy of `documents.json` and independently
   rewriting the same file on a shared volume is a correctness bug, not a performance
   one. This product is single-instance by construction today — and, notably, this
   constraint is now the *first* thing to bite at high sustained volume, not raw
   per-document latency, precisely because per-document latency improved so much.

## Knowledge Box ceilings

Everything above sizes for document *volume*. There is a second, independent ceiling
that has nothing to do with volume: how many distinct document types a deployment can
support, bounded by the Knowledge Box itself, not by this service's CPU, memory or
concurrency.

Every extraction config provisions **two** Knowledge Box objects under the same id
(`dip_<schema>`): a stored search configuration and a key-value schema (DP-46,
`DECISIONS.md`). The Knowledge Box enforces two ceilings on these: **20 key-value
schemas per Knowledge Box, and 50 fields per key-value schema**, checked before the
provisioning call is made. Each extraction config consumes **one** schema slot.
Starting a Data Augmentation generator agent for a config consumes a **second** slot
(`dip_<schema>_gen`, DP-54) — but only when an agent is actually started; it's
provisioned on demand, not for every config at boot, so it doesn't cost a slot until
someone turns it on.

The arithmetic that matters for a sizing conversation:

```
11 built-in document types (DOC_TYPE_VALUES, src/types.ts) ship provisioned
  → 11 of 20 key-value schema slots are consumed before a single custom
    config is created
9 slots remain for custom extraction configs
  → fewer than 9 if any of those configs also runs a generator agent
    (each running agent costs a second slot: dip_<schema>_gen)
```

**A customer who wants many custom document types will hit the 20-schema ceiling long
before they hit any throughput ceiling in this document.** A sizing conversation
should establish the number of *distinct document types* the customer needs up front —
it bounds the deployment sooner and harder than documents/day does. The remedy is a
second Knowledge Box (a separate `kbId`/deployment) or deleting unused extraction
configs to free a slot — **not** a bigger machine, higher concurrency or more RAM; none
of those move this ceiling. The product checks the ceiling before making the
provisioning call, and the error names the remedy directly (DP-46: "...already holds
20 key-value schemas… delete an unused extraction configuration"). The 50-fields
ceiling is rarely the binding one for a normal document type, but worth naming when a
customer proposes an unusually wide schema — see
[`key-value-schema-design.md`](key-value-schema-design.md) and
`design-review-checklist.md`'s key-value section for schema-design guidance.

**The per-document ARAG call budget now includes a key-value write, not just the five
model-call stages in the latency table above.** After the pipeline finishes, the
verified record is written to the resource's key-value field — one more Knowledge Box
call per document. It's a KB write, not a model call: it costs latency and
rate-limit budget against the KB, not tokens. A human field correction
(`PUT /api/v1/documents/{id}/fields/{key}`) and a reprocess each write again, so a
document that's corrected once and reprocessed once has made three key-value writes,
not one — budget rate-limit headroom accordingly for document types reviewers correct
often.

**Key-value filtering has its own, separate sizing consequence.** Key-value filtering
is eventually consistent (DP-55) — measured live, a value readable on the record
instantly was still not returned by a `/find` key-value filter roughly 66 seconds
later, with no status to wait on. The sizing consequence: a filtered list screen
(`GET /api/v1/documents?kv=…`) runs a `/find` against the Knowledge Box on **every
page load**, in addition to the local scan an unfiltered list already does. An
unfiltered list is a local-only read; a filtered one costs one extra Knowledge Box
round trip every time the page loads or the filter changes. Each list response reports
which system answered which half — `filters.knowledgeBox` (the Knowledge-Box-side
match) versus `filters.local` (the local list) — so the cost is attributable per
request. Note that `GET /api/v1/admin/usage` does **not** break this out: it reports one
`aragCalls` counter across every kind of ARAG call, so a deployment whose users lean on
key-value filters will see `aragCalls` climb without the usage payload saying why. If
that distinction matters, it has to come from the request log.

## Memory and CPU guidance

- **CPU**: the four model-call stages are I/O-bound (waiting on ARAG), not
  CPU-intensive locally — `shared-cpu-1x` is adequate for the shipped concurrency of 2.
  Raising concurrency past roughly 4–6 concurrent jobs on a single `shared-cpu-1x`
  instance risks contention on JSON parsing/serialisation and the event loop generally;
  move to a dedicated/performance CPU class before pushing concurrency higher than
  that.
- **Memory**: the whole `documents` collection lives in memory as a `Map`. Estimate
  **3–5 KB per `DocumentRecord`** as JSON (a dozen extracted fields, a handful of
  entities, a short summary, few or no issues) — so 10,000 records is roughly 30–50 MB
  resident, and 500,000 records is roughly 1.5–2.5 GB. Add Node's own baseline (~60–100
  MB) and headroom for concurrent request handling and job execution. The default 1 GB
  instance comfortably holds tens of thousands of records; plan a memory bump well
  before the collection reaches six figures.
- **The `jobs` collection** grows with every upload too, including its full event log
  per job (one entry per stage transition, small — well under 1 KB per job typically).
  Verified in `vendor/arag-platform/src/store/jobs.ts`: `JobManager` caps the `jobs`
  collection at **500** by default (`store.collection<Job>("jobs", { cap: opts.cap ?? 500 })`),
  and `Collection.put()` evicts the oldest entries by `createdAt` once the cap is
  exceeded — so this collection is self-bounding for memory, and does not need a
  cleanup job of its own.
- **The `audit` collection does not share that safety net's purpose.** It's also
  capped by default — **5000** entries (`AuditService` → `store.collection<AuditEntry>("audit",
  { cap: deps.cap ?? 5000 })` in `src/services/audit.ts`, and `new AuditService({ store,
  log })` in `src/server.ts` doesn't override it), evicted the same FIFO way. That cap
  bounds memory too, but it also means the audit trail — settings edits, API-key
  create/revoke, config create/edit/delete/provision, every field correction, every
  purge and every document delete, none of which has anywhere else to be recorded —
  **silently rolls off the oldest entries once 5,000 accumulate.** A deployment that
  cares about "who changed what" for compliance reasons should treat 5,000 entries as
  a rolling window, not a retention policy, and export `GET /api/v1/admin/audit`
  (it pages by a stable sequence cursor) on a schedule well before that cap is likely
  to be reached — see "What to change first for scale" below.

## Volume sizing

The Fly volume backs `DATA_DIR` (`documents.json`, `jobs.json`,
`extraction-configs.json`, plus the smaller `settings.json`, `apikeys.json`,
`audit.json`, `generators.json` and `runtime.json` — see "Other fixed facts"
above) — nothing else needs persistent disk (uploads themselves live in the ARAG
Knowledge Box, not locally). `fly.toml` ships a
1 GB initial volume. `documents.json` is the collection that actually drives the sizing
table below; the others stay small (`audit.json` is capped at 5,000 entries by
default — see "Memory and CPU guidance").

| Records held | Approx. `documents.json` size | Recommended volume |
|---|---|---|
| Up to ~50,000 | Up to ~250 MB | 1 GB (default) is fine |
| ~50,000–500,000 | ~250 MB – 2.5 GB | 5–10 GB, with monitoring |
| 500,000+ | 2.5 GB+ | Reconsider retention policy before reconsidering volume size (see below) |

Atomic writes (`jsonstore.ts` writes to a temp file then renames) transiently need
roughly double the collection's on-disk size during a rewrite — factor that into volume
headroom, not just the steady-state file size.

**The real lever past a few hundred thousand records is retention, not disk.** This
product has no automatic TTL sweeper by design (`DECISIONS.md` DP-08) — every retained
document is a deliberate choice, exercised through `POST /api/v1/admin/purge
{olderThanDays}`. A deployment expecting sustained high volume should schedule this
call (a cron hitting the admin API) rather than growing the volume indefinitely; see
`design-review-checklist.md`'s data-protection section.

## What to change first for scale

In order of effort, cheapest first:

1. **Schedule `admin/purge`.** Free, immediate, bounds both memory and disk growth.
   Do this before touching anything else if retention policy allows it.
2. **Export the audit log before its 5,000-entry cap rolls it over.** Also free,
   also immediate: a scheduled `GET /api/v1/admin/audit` pull (paged by its sequence
   cursor) into external storage, on whatever cadence keeps the customer's
   change-history requirement inside 5,000 entries between pulls. Unlike the `jobs`
   cap, which is a deliberate memory bound, the audit cap is a compliance risk if
   nobody is reading it — do this before a customer asks "who deleted that document
   last month" and the answer has already rolled off.
3. **Raise `JobManager` concurrency** (a one-line code change,
   `{ concurrency: 2 }` → a higher number) after confirming the ARAG KB's rate limits
   tolerate more simultaneous `/ask` and `/upload` calls. This is the single biggest
   throughput lever available without an architecture change — though with the current
   per-document latency (~14 s), the default concurrency of 2 already supports a
   meaningfully higher volume than it used to, so don't reach for this lever until an
   actual, measured volume need justifies it.
4. **Move to a larger single-instance VM class** (`performance-1x`/`performance-2x`,
   more RAM) once either CPU contention from higher concurrency or memory pressure from
   collection size shows up in `GET /api/v1/admin/usage` and Fly's own metrics.
5. **Replace the JSON store with a real database** — the only path to running more than
   one instance. This is a genuine architecture change (a rewrite of the `Store`/
   `Collection` abstraction's backing implementation, likely Postgres, per the
   platform's own stated GA direction in `jsonstore.ts`'s docstring: "Good for MVP-scale
   state... the interface is small so it can be swapped for Postgres/Redis at GA").
   Budget this as a project, not a config change, and do it *before* volume/throughput
   pressure forces it under deadline.

## Deployment shapes

Target-volume ranges below assume documents broadly similar in size to the sample used
to measure `process` (short text/simple forms); a deployment ingesting mostly
multi-page scanned PDFs should plan closer to the bottom of each range, or treat "Large"
as starting sooner.

| | Small (pilot / low-volume) | Medium (departmental) | Large (needs a scale-out redesign) |
|---|---|---|---|
| **Target volume** | Up to ~700 docs/day | ~1,500–5,000 docs/day | 8,000+ docs/day sustained |
| **Fly VM** | `shared-cpu-1x`, 1 GB RAM (fly.toml default) | `shared-cpu-2x` or `performance-1x`, 2 GB RAM | `performance-2x`+, 4 GB+ RAM |
| **Job concurrency** | 2 (default) | 2–4 (raise only if measured volume needs it; confirm ARAG rate limits) | 6–8, still single instance — do not attempt multi-instance without a shared-database rewrite |
| **Volume** | 1 GB (default) | 5 GB | 10 GB+, with active retention/purge scheduling mandatory |
| **Retention** | Manual purge acceptable | Scheduled purge (weekly+) recommended | Scheduled purge (daily) required |
| **Architecture change needed?** | No | No | Yes, if volume must exceed roughly 8,000–10,000 docs/day sustained — the JSON store and single-instance job model are the ceiling, not the VM size |

The "Large" column is intentionally the one where the honest answer is "this product,
as built, is not the right shape for that volume without the store rewrite in step 5
above" — a deployment conversation that reaches this column should become a roadmap
conversation with the product owner, not a bigger Fly plan. Note how much higher this
threshold sits than it used to (previously ~3,000–5,000/day): the per-document latency
improvement in DP-19 raised the ceiling substantially, but it didn't remove it — at
enough sustained volume, the single-instance JSON store is still the wall, just a
further-away one.
