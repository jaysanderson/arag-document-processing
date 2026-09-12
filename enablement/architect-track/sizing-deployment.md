# Sizing and deployment guidance

Grounded in real numbers observed from a live pipeline run against Progress Agentic
RAG, and the actual configuration shipped in `fly.toml` / `src/server.ts`. Where a
number is a measurement rather than a fixed constant (ARAG timings vary with document
size, KB load and model choice), it's flagged as such — use it for planning-grade
estimates, not as an SLA.

Companion documents: [`WORKSHOP.md`](WORKSHOP.md) covers the reference architecture and
decision points these numbers fall out of; [`design-review-checklist.md`](design-review-checklist.md)
turns the reliability and cost implications below into a pre-deployment checklist.

## The numbers this guide is built on

| Stage | Observed duration (live run) | What it is |
|---|---|---|
| `process` | **~36 s** (dominant cost) | ARAG OCR/visual-layout/embedding processing, plus the `waitSearchable` gate after it |
| `classify` | ~2 s | One `/ask` call with a small structured schema |
| `extract` | ~2 s | One `/ask` call against the schema's stored search configuration |
| `entities` | ~2 s | One `/ask` call (run sequentially after `extract`, not concurrently) |
| `summary` | ~6 s | One `/ask` call, longer output (a paragraph + tags) |
| `validate` | ~0 s | Deterministic, no model call |
| **Total** | **~48–50 s per document** | End to end, from upload accepted to `status: "ready"` |

Other fixed facts from the running configuration:

- **Job concurrency: 2 per instance** (`new JobManager(store, log, { concurrency: 2 })`
  in `src/server.ts`) — a hard-coded constant today, not an environment variable.
- **Upload cap: 25 MB** (`DIP_MAX_UPLOAD_BYTES` default `26214400`).
- **State: JSON files on a Fly volume**, one file per collection (`documents.json`,
  `jobs.json`, `extraction-configs.json`), loaded fully into memory at boot and
  rewritten atomically on every write (`vendor/arag-platform/src/store/jsonstore.ts`).
  There is no external database.
- **Default deployment shape** (`fly.toml`): `shared-cpu-1x`, 1 GB RAM, a 1 GB volume,
  `min_machines_running = 1`.

On the mock ARAG (`ARAG_MOCK=1`, used for all automated tests and this lab) every stage
completes in single-digit milliseconds — the mock exists to make tests fast and
deterministic, not to model production latency. Use the table above, not the mock, for
capacity planning.

## Throughput maths

**Per-instance ceiling**, assuming every document takes the full ~50 s and concurrency
stays at the shipped value of 2:

```
documents/hour  = concurrency × (3600 s / seconds-per-document)
                = 2 × (3600 / 50)
                ≈ 144 documents/hour per instance

documents/day   ≈ 144 × 24 ≈ 3,456 documents/day per instance (continuous, no headroom)
```

Treat 3,456/day as a **theoretical ceiling**, not a planning number — it assumes zero
retries, no larger-than-average files (a multi-page PDF or a large image takes
meaningfully longer through `process` than the short text samples this figure is based
on), and continuous 24-hour arrival. A realistic planning number for a single default
instance is **1,000–1,500 documents/day**, leaving headroom for retries (`extract` and
`entities` each retry once on an empty result — see `src/services/pipeline.ts`), larger
files, and non-uniform arrival (a morning batch, not a perfectly flat rate).

**What actually gates throughput, in order:**

1. **`process` (the ~36 s ARAG step)** dominates total latency but does not itself
   consume this instance's CPU/RAM — it's wait time on ARAG's own OCR/embedding
   pipeline. The main cost to *this* instance during `process` is one open HTTP
   connection and poll loop per in-flight document.
2. **Job concurrency (2)** is the actual per-instance throughput lever. Raising it
   increases the number of documents processed in parallel, at the cost of more
   simultaneous outbound ARAG calls (subject to the KB's own rate limits — check these
   with the ARAG account before raising this aggressively) and more concurrent CPU work
   during the four model-call stages (`classify`/`extract`/`entities`/`summary`), which
   *do* consume local CPU for request/response handling and JSON parsing, even though
   the LLM inference itself happens on ARAG's side.
3. **The JSON store** is not a throughput bottleneck at the volumes this product
   targets (writes are debounced and batched — see `scheduleFlush()` in
   `jsonstore.ts`) but it is a **hard ceiling on horizontal scaling**: two instances
   each holding their own in-memory copy of `documents.json` and independently
   rewriting the same file on a shared volume is a correctness bug, not a performance
   one. This product is single-instance by construction today.

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
  If jobs accumulate indefinitely, memory grows accordingly; there is no built-in job
  eviction in this product (`Collection`'s `cap` option exists in the platform but is
  not currently set for the `jobs` collection here) — a genuinely long-running
  high-volume deployment should plan a periodic archival/cleanup process for the jobs
  store, not rely on eviction that isn't configured today.

## Volume sizing

The Fly volume backs `DATA_DIR` (`documents.json`, `jobs.json`,
`extraction-configs.json`) — nothing else needs persistent disk (uploads themselves live
in the ARAG Knowledge Box, not locally). `fly.toml` ships a 1 GB initial volume.

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
2. **Raise `JobManager` concurrency** (a one-line code change,
   `{ concurrency: 2 }` → a higher number) after confirming the ARAG KB's rate limits
   tolerate more simultaneous `/ask` and `/upload` calls. This is the single biggest
   throughput lever available without an architecture change.
3. **Move to a larger single-instance VM class** (`performance-1x`/`performance-2x`,
   more RAM) once either CPU contention from higher concurrency or memory pressure from
   collection size shows up in `GET /api/v1/admin/usage` and Fly's own metrics.
4. **Replace the JSON store with a real database** — the only path to running more than
   one instance. This is a genuine architecture change (a rewrite of the `Store`/
   `Collection` abstraction's backing implementation, likely Postgres, per the
   platform's own stated GA direction in `jsonstore.ts`'s docstring: "Good for MVP-scale
   state... the interface is small so it can be swapped for Postgres/Redis at GA").
   Budget this as a project, not a config change, and do it *before* volume/throughput
   pressure forces it under deadline.

## Deployment shapes

| | Small (pilot / low-volume) | Medium (departmental) | Large (needs a scale-out redesign) |
|---|---|---|---|
| **Target volume** | Up to ~200 docs/day | ~500–1,500 docs/day | 3,000+ docs/day sustained |
| **Fly VM** | `shared-cpu-1x`, 1 GB RAM (fly.toml default) | `shared-cpu-2x` or `performance-1x`, 2 GB RAM | `performance-2x`+, 4 GB+ RAM |
| **Job concurrency** | 2 (default) | 4 (code change; confirm ARAG rate limits) | 6–8, still single instance — do not attempt multi-instance without a shared-database rewrite |
| **Volume** | 1 GB (default) | 5 GB | 10 GB+, with active retention/purge scheduling mandatory |
| **Retention** | Manual purge acceptable | Scheduled purge (weekly+) recommended | Scheduled purge (daily) required |
| **Architecture change needed?** | No | No | Yes, if volume must exceed roughly 3,000–5,000 docs/day sustained — the JSON store and single-instance job model are the ceiling, not the VM size |

The "Large" column is intentionally the one where the honest answer is "this product,
as built, is not the right shape for that volume without the store rewrite in step 4
above" — a deployment conversation that reaches this column should become a roadmap
conversation with the product owner, not a bigger Fly plan.
