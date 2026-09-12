# Scaling

## Where the limits are, in order of what you'll hit first

1. **In-process job concurrency (2).** `JobManager` is constructed with `concurrency: 2`
   (`src/server.ts`) — at most two `process-document` jobs run at once per instance;
   everything else queues in memory. This is the first ceiling on throughput, and it is a
   single line to change (see below) — but raising it just shifts the bottleneck to ARAG
   latency/rate limits (below), not the process.
2. **ARAG round-trip latency**, not local CPU. Every pipeline stage but `validate` is a
   network call to the Knowledge Box; the process itself does string parsing and JSON
   shuffling, which is fast. See the real timings below.
3. **The JSON store.** `Collection` keeps the whole collection in memory and rewrites the
   entire file on every flush (debounced 50ms). Fine at MVP scale (hundreds to low
   thousands of documents/jobs); rewriting a large file on every write becomes the
   bottleneck well before ARAG does at higher volumes. See
   [`extension-points.md`](../developer/extension-points.md#swap-the-store).
4. **Single-instance ceiling.** Because jobs run in-process and the store isn't shared
   safely across processes (see
   [`deployment-topologies.md`](deployment-topologies.md#multi-instance-considerations)),
   vertical scaling (a bigger machine, a higher `concurrency`) is the only lever until the
   store and job queue are replaced — there is no safe way to add a second instance today.

## What to change first

To raise throughput on a single instance, in order of effort:

1. **Raise `JobManager` concurrency** (`src/server.ts`, `new JobManager(store, log, {
   concurrency: 2 })`). Since the work is I/O-bound (waiting on ARAG), a higher number
   (4–8) is reasonable on a single machine before local resource pressure (open sockets,
   memory for in-flight `Buffer`s) becomes the constraint — watch `GET
   /api/v1/admin/usage`'s `aragMs`/`aragErrors` and the KB's own rate limits while doing
   this.
2. **Check ARAG's own concurrency/rate limits for the Knowledge Box and generative model.**
   Raising local concurrency past what the KB or the underlying model provider allows
   produces `429`/`5xx` from ARAG, which the pipeline handles gracefully (soft stages) but
   which shows up as more documents landing with partial fields and validation issues
   rather than faster completion.
3. **Move the store off JSON files** — only worth doing once document/job volume is large
   enough that flush time or memory footprint is measurably the bottleneck (well past MVP
   scale); see the extension point above.
4. **Only then consider horizontal scaling**, which requires replacing the store and moving
   job execution to a real queue — see
   [`deployment-topologies.md`](deployment-topologies.md#multi-instance-considerations).

## Rough throughput maths

Real stage timings from a live smoke run against the actual Progress Agentic RAG Knowledge
Box (not the mock, which completes every stage in low single-digit milliseconds and is not
representative of real throughput):

| Stage | ~Time |
|---|---|
| `process` (ARAG OCR/visual/layout/embeddings + searchable-gate poll) | ~36 s |
| `classify` | ~2 s |
| `extract` | ~2 s |
| `entities` | ~2 s |
| `summary` | ~6 s |
| `validate` / `standardize` | negligible (no ARAG call) |
| **Total per document** | **~48 s** |

`process` dominates — it's mostly ARAG's own ingestion pipeline (OCR, visual layout,
embeddings) plus the `waitProcessed`/`waitSearchable` poll loop, not this product's code.

With `concurrency: 2` and ~48s per document end to end:

- **Per instance:** 2 documents every ~48s ≈ **2.5 documents/minute ≈ 150 documents/hour**
  (theoretical steady state; real-world traffic is bursty, and this ignores queueing delay
  once more than 2 documents are in flight — the 3rd+ document waits for a slot).
- **At `concurrency: 4`** (still I/O-bound, plausible on one machine): ~5 documents/minute
  ≈ 300/hour, *if* the KB and generative model tolerate 4 concurrent `full_resource`
  extraction calls without added latency or errors — verify this against your own KB before
  relying on it.
- **Per document, wall-clock latency for the caller is unchanged by concurrency** — a
  single upload still takes ~48s end to end from `202` to `status: "ready"`; concurrency
  only affects how many documents can be *in flight* at once, not how fast any one finishes.

These numbers are a starting point for capacity planning, not a guarantee — real documents
vary (a multi-page PDF with heavy visual extraction takes longer than a short text file;
`ARAG_TIMEOUT_MS` defaults to 60s per ARAG call, which the `process` stage alone can
approach on a large scanned document).

## Related

- [`deployment-topologies.md`](deployment-topologies.md) — the single-machine topology this maths assumes.
- [`limits.md`](limits.md) — the exact hard-coded numbers (concurrency, caps, job cap).
- [`arag-integration.md`](arag-integration.md) — why `process` takes as long as it does (the searchable gate).
