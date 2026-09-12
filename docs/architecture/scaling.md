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

Real stage timings from live `make smoke` runs against the actual Progress Agentic RAG
Knowledge Box with `public/samples/invoice.txt` (not the mock, which completes every stage
in low single-digit milliseconds and is not representative of real throughput), measured
twice, before and after [DP-19](../../DECISIONS.md) (seeding the searchability probe with
the document's own extracted text instead of a generic query — see ARAG mechanic 4 in
[`arag-integration.md`](arag-integration.md)):

| Stage | Before DP-19 | After DP-19 |
|---|---|---|
| `process` (ARAG OCR/visual/layout/embeddings + searchable-gate poll) | 37.8 s | 6.7–7.8 s |
| `classify` | 2.2 s | 1.6–1.9 s |
| `extract` | 1.8 s | 2.0 s |
| `entities` | 1.8 s | 2.1–2.4 s |
| `summary` | 6.1 s | 1.8–2.6 s |
| `validate` / `standardize` | ~0 ms | 1–2 ms |
| **Total per document** | **≈ 50 s** | **≈ 14 s** |

`process` still dominates — it's mostly ARAG's own ingestion pipeline (OCR, visual layout,
embeddings), not this product's code — but it is no longer padded by a polling artefact:
seeding the readiness probe with the document's own text finds the resource on the first
`/find` call instead of needing ~20 polls of a generic query. Two caveats before treating
"≈ 14 s" as a general number: this is one small text document against one Knowledge Box,
and `process` is ARAG-side work that scales with document size and page count — a
multi-page scanned PDF with heavy visual extraction will take meaningfully longer than a
1 KB text file, however well the readiness probe is seeded.

With `concurrency: 2` and ≈14s per document end to end (post-DP-19, for a document like the
sample invoice):

- **Per instance:** 2 documents every ≈14s ≈ **8.6 documents/minute ≈ 514 documents/hour**
  (theoretical steady state for a document of this size; real-world traffic is bursty, and
  this ignores queueing delay once more than 2 documents are in flight — the 3rd+ document
  waits for a slot).
- **At `concurrency: 4`** (still I/O-bound, plausible on one machine): roughly double, ≈17
  documents/minute ≈ 1,000/hour, *if* the KB and generative model tolerate 4 concurrent
  `full_resource` extraction calls without added latency or errors — verify this against
  your own KB before relying on it.
- **Per document, wall-clock latency for the caller is unchanged by concurrency** — a
  single upload still takes ≈14s end to end from `202` to `status: "ready"` for a document
  like the sample invoice; concurrency only affects how many documents can be *in flight*
  at once, not how fast any one finishes. A larger or image-heavy document will take longer
  regardless of concurrency.

These numbers are a starting point for capacity planning, not a guarantee — real documents
vary, and `ARAG_TIMEOUT_MS` defaults to 60s per ARAG call, which the `process` stage can
still approach on a large scanned document even with a seeded readiness probe.

## Related

- [`deployment-topologies.md`](deployment-topologies.md) — the single-machine topology this maths assumes.
- [`limits.md`](limits.md) — the exact hard-coded numbers (concurrency, caps, job cap).
- [`arag-integration.md`](arag-integration.md) — why `process` takes as long as it does (the searchable gate).
