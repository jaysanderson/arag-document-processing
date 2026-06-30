# Document Intelligence Studio — on Progress Agentic RAG

A demo-grade **document processing** application built on **Progress Agentic RAG (ARAG)**.
Drop in a document and watch it move, live, through a multi-stage pipeline:

```
Drop a document
   ↓ ingest        upload to the ARAG Knowledge Box
   ↓ process       ARAG runs OCR · visual layout · embeddings (then waits for search readiness)
   ↓ classify      an agent picks the document type (invoice · contract · résumé · receipt · PO · form · report · generic)
   ↓ extract       schema-driven visual-LLM extraction — the right fields for that type, grounded in the page
   ↓ entities      named-entity enrichment (people · orgs · money · dates · IDs · …)
   ↓ summary       one-paragraph abstractive summary + topic tags
   ↓ validate      deterministic normalization (amounts→numbers, dates→ISO, currency→ISO) + consistency checks
   ↓ standardize   one canonical record → JSON · XML · CSV
   ↓ ask           grounded Q&A over the document
```

Everything is grounded in the document via ARAG's `full_resource` retrieval and forced
structured output (`answer_json_schema`), with temperature 0 for repeatable demos.

## Why it's a good ARAG demo

- **Custom visual-LLM extraction** — per-document-type JSON Schemas drive the multimodal
  model (`chatgpt-azure-4o`) to extract exactly the right fields, grounded in the page.
- **Data-augmentation agents** — classify → extract → enrich entities → summarize →
  validate/normalize, each a focused, grounded ARAG call (see [`bridge/src/agents.ts`](bridge/src/agents.ts)).
- **Standardized output** — one canonical record, serialized to **JSON, XML, and CSV**
  (see [`bridge/src/formats.ts`](bridge/src/formats.ts)).
- **Grounded, deterministic, honest** — answers cite the source document; off-document
  questions are declined rather than hallucinated.

## Run it

Requires **Node ≥ 22.6**. This project is **dependency-free** — no `npm install`, no build
step. TypeScript runs natively via `--experimental-transform-types`.

```bash
cp .env.example .env       # then paste your ARAG_TOKEN
make dev                   # hot-reload server + UI at http://localhost:8080
# or
make start                 # production mode
make test                  # unit tests (formats, normalization, validation, schemas)
make smoke                 # end-to-end run against the live KB (uploads, processes, deletes)
```

Open **http://localhost:8080**, drop a file (or click a sample), and watch the pipeline run.

## Configuration

All config is environment-driven (see [`.env.example`](.env.example)):

| Variable | Purpose |
|---|---|
| `ARAG_KB_URL` | KB base URL, `https://<region>.dp.progress.cloud/api/v1/kb/<id>` |
| `ARAG_TOKEN` | Nuclia service-account JWT (sent as `X-NUCLIA-SERVICEACCOUNT: Bearer …`) |
| `ARAG_GENERATIVE_MODEL` | Generative model (default `chatgpt-azure-4o`, multimodal) |
| `ARAG_RERANKER` | `predict` (grounded) or `noop` (fast) |
| `ARAG_TIMEOUT_MS` | Per-request timeout to ARAG |
| `PORT`, `MAX_UPLOAD_BYTES`, `LOG_LEVEL` | Bridge server settings |

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness + KB id + model |
| `POST` | `/api/ingest` | Upload raw file bytes → `{ resourceId }` |
| `GET` | `/api/process?id=&filename=&type=` | **SSE** stream of pipeline stage events → final record |
| `GET` | `/api/record?id=` | Fetch the finished canonical record |
| `GET` | `/api/export?id=&format=json\|xml\|csv` | Download a standardized export |
| `POST` | `/api/ask` | Grounded Q&A over a document |

## Deploy (Fly.io)

```bash
cd bridge
fly launch --no-deploy          # once; app name arag-doc-processing
fly secrets set ARAG_KB_URL=… ARAG_TOKEN=…
fly deploy
```

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module map and the key ARAG
mechanics that make the demo reliable (full-resource grounding, query seeding, the
PROCESSED-vs-searchable gate, and string-amounts-then-normalize).

---

Built dependency-free on bare Node + native TypeScript, in the spirit of the sibling
`arag-voice` project.
