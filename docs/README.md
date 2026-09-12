# Document Processing — documentation

Start here. Pages are grouped by audience; every page links back to its neighbours.

## Developer

Build with the API, run it locally, extend it.

| Page | What it covers |
|---|---|
| [`developer/quickstart.md`](developer/quickstart.md) | Clone → install → run against the mock ARAG → upload → record → export → ask, with real, verified `curl` output. |
| [`developer/api-reference.md`](developer/api-reference.md) | The full API reference. **Generated** by `make docs` from [`../src/openapi.ts`](../src/openapi.ts) — do not hand-edit. |
| [`developer/examples.md`](developer/examples.md) | Every request shape (multipart/raw upload, SSE, every export format, ask, custom configs, `config=agent`, pagination, errors), plus minimal Node and Python clients. |
| [`developer/extension-points.md`](developer/extension-points.md) | Where to add a document type, a pipeline stage, an export format, a route, swap the store, or hook mock ARAG behaviour in tests. |
| [`developer/local-dev.md`](developer/local-dev.md) | Repo layout, every `make` target, how the mock ARAG works, running one test, `DATA_DIR`, debugging. |
| [`developer/contributing.md`](developer/contributing.md) | The API-first and vendored-platform rules, conventional commits, the `make check`/`make e2e` bar — points at the root [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the rest. |

## Architecture

How it's built and why, for engineers evaluating, extending, or operating it.

| Page | What it covers |
|---|---|
| [`architecture/architecture.md`](architecture/architecture.md) | System overview with a Mermaid diagram, module map, request lifecycle, the job/SSE model. |
| [`architecture/arag-integration.md`](architecture/arag-integration.md) | Every ARAG endpoint used and the five hard-won mechanics that make extraction reliable. |
| [`architecture/data-flow.md`](architecture/data-flow.md) | A document's journey end to end, with a sequence diagram: what's stored where, what leaves the process. |
| [`architecture/deployment-topologies.md`](architecture/deployment-topologies.md) | Local (mock), single Fly machine with a volume, and what breaks under multiple instances. |
| [`architecture/security-model.md`](architecture/security-model.md) | Threat model, auth, upload safety, rate limiting, secrets, retention, and what to do before exposing this publicly. |
| [`architecture/scaling.md`](architecture/scaling.md) | Where the limits are, what to change first, and real-world throughput maths. |
| [`architecture/limits.md`](architecture/limits.md) | Every hard number — upload caps, schema counts, pagination limits, store caps — in one place. |

## Business

What it does, whether it fits, and how to see it in action — no code required.

| Page | What it covers |
|---|---|
| [`business/overview.md`](business/overview.md) | What the product does and why it matters, in plain language. |
| [`business/when-to-use.md`](business/when-to-use.md) | Good fits, poor fits, and honest alternatives. |
| [`business/walkthrough-demo.md`](business/walkthrough-demo.md) | A click-by-click tour of the demo (`/`) for a non-engineer. |
| [`business/walkthrough-admin.md`](business/walkthrough-admin.md) | The same for the admin panel (`/admin/`): health, jobs, logs, retention. |
| [`business/faq.md`](business/faq.md) | Cost, accuracy, data handling, languages, failure behaviour, scale — the questions evaluators ask. |

## Product marketing

| Page | What it covers |
|---|---|
| [`product-marketing/positioning.md`](product-marketing/positioning.md) | The one-liner, name options and recommendation, personas, use cases, competitive framing. |
| [`product-marketing/partner-pitch.md`](product-marketing/partner-pitch.md) | The pitch for a partner or systems integrator building a practice around this product. |
| [`product-marketing/launch-blog.md`](product-marketing/launch-blog.md) | The public launch announcement. |

## Elsewhere in the repo

- [`../README.md`](../README.md) — the sixty-second tour and top-level project summary.
- [`../DECISIONS.md`](../DECISIONS.md) — product-level decisions made while building this MVP.
- [`../AUDIT.md`](../AUDIT.md) — the audit of the prototype this product replaced.
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md), [`../SECURITY.md`](../SECURITY.md) — contribution workflow and vulnerability reporting.
