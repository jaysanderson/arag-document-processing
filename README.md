# Document Processing

**Turn any document into a canonical, validated record — in under a minute, through one API call.**

Drop in a PDF, a photo of a form, or a text file. Document Processing uploads it to a
Progress Agentic RAG (ARAG) Knowledge Box, runs a multi-agent pipeline over it
(process → classify → extract → entities → summary → validate → standardize) and gives you
back a structured record: typed fields with confidence, named entities, a summary, topic
tags and validation issues — exportable as JSON, XML or CSV, and queryable in natural
language.

Built on the [shared ARAG platform](../arag-platform). API-first, zero runtime
dependencies, Apache-2.0.

```bash
make install        # bun installs dev tooling only (no npm, ever)
make dev            # http://localhost:8080 — uses the mock ARAG unless .env has credentials
```

Then open:

| Surface | URL | What it is |
|---|---|---|
| Demo | <http://localhost:8080/> | The studio: drop a document, watch the pipeline, read the record |
| Admin | <http://localhost:8080/admin/> | Health, KB test, extraction configs, jobs, logs, retention |
| API docs | <http://localhost:8080/api/v1/docs> | Redoc (and `/api/v1/swagger` to try it out) |
| OpenAPI | <http://localhost:8080/api/v1/openapi.json> | The spec every route is validated against |

## Sixty-second tour

```bash
# 1. Upload a document; you get the record and the job that is processing it.
curl -sS -X POST 'http://localhost:8080/api/v1/documents?config=auto' \
     -H 'Content-Type: text/plain' -H 'X-Filename: invoice.txt' \
     --data-binary @public/samples/invoice.txt | tee /tmp/up.json

ID=$(jq -r .document.id /tmp/up.json); JOB=$(jq -r .job.id /tmp/up.json)

# 2. Watch the pipeline live (or poll GET /api/v1/jobs/$JOB).
curl -sN "http://localhost:8080/api/v1/jobs/$JOB/events"

# 3. Read the canonical record, or export it.
curl -sS "http://localhost:8080/api/v1/documents/$ID" | jq .
curl -sS "http://localhost:8080/api/v1/documents/$ID/export?format=csv"

# 4. Ask the document a question.
curl -sS -X POST "http://localhost:8080/api/v1/documents/$ID/ask" \
     -H 'Content-Type: application/json' -d '{"question":"What is the total due?"}' | jq .

# 5. Clean up — deletes the record and the KB resource.
curl -sS -X DELETE "http://localhost:8080/api/v1/documents/$ID"
```

## What it extracts

Eleven built-in document types, each with its own extraction schema:
`invoice`, `receipt`, `purchase_order`, `contract`, `resume`, `medical_claim`,
`preauthorisation`, `bank_statement`, `form`, `report`, `generic`.

Not enough? `POST /api/v1/extraction-configs` with a list of field labels creates a custom
config, persists it, and provisions a stored ARAG search configuration so the model is
forced to return exactly those fields, grounded in the document. `GET /api/v1/schemas`
lists every built-in type and the fields it captures.

Three ways to decide what gets extracted, chosen with `?config=`:

- `auto` — an agent classifies the document, then the matching schema is used.
- `<config id>` — force a built-in or custom config (classification is skipped).
- `agent` — read fields an ARAG **Data Augmentation agent** already persisted on the
  resource, instead of extracting live.

## API

Everything lives under `/api/v1` and is described by [`src/openapi.ts`](src/openapi.ts).

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/documents` | Upload (multipart `file`, or raw body + `X-Filename`) → `202 {document, job}` |
| `GET` | `/documents` | List (paged, filter by `status` / `doc_type`) |
| `GET` | `/documents/{id}` | The canonical record |
| `GET` | `/documents/{id}/export` | `?format=json\|xml\|csv` |
| `POST` | `/documents/{id}/ask` | Grounded Q&A over one document |
| `DELETE` | `/documents/{id}` | Delete the record **and** the KB resource |
| `GET` | `/jobs`, `/jobs/{id}` | Processing jobs |
| `GET` | `/jobs/{id}/events` | Server-sent events for a running job |
| `DELETE` | `/jobs/{id}` | Cancel |
| `GET`/`POST` | `/extraction-configs` | List / create |
| `GET`/`DELETE` | `/extraction-configs/{id}` | Read / delete (built-ins are not deletable) |
| `GET` | `/schemas` | Document types and their fields |
| `POST` | `/session` | Same-origin session cookie for the demo UI |
| `GET` | `/admin/health`, `/admin/config`, `/admin/usage`, `/admin/logs` | Operator views |
| `POST` | `/admin/login`, `/admin/provision`, `/admin/purge` | Sign in, re-provision search configs, retention purge |

Errors are RFC 9457 `application/problem+json` with a `requestId` that ties back to the
logs. Uploads are limited by a MIME allowlist (pdf, png, jpeg, webp, tiff, txt, md, csv,
docx) and a size cap; filenames are sanitised.

## Configuration

Copy `.env.example` to `.env`. Without ARAG credentials, set `ARAG_MOCK=1` and everything
runs against the in-process mock Knowledge Box — no account, no LLM spend.

| Variable | Default | Notes |
|---|---|---|
| `ARAG_KB_ID`, `ARAG_API_KEY`, `ARAG_REGION` | — | Knowledge Box and service-account token. Required unless `ARAG_MOCK=1`. |
| `ARAG_GENERATIVE_MODEL` | `chatgpt-azure-4o` | Must be multimodal for visual extraction. |
| `DIP_EXTRACT_STRATEGY` | — | ARAG extract-strategy id applied to image/PDF uploads. |
| `DIP_MAX_UPLOAD_BYTES` | `26214400` | Upload cap (25 MB). |
| `ADMIN_TOKEN` | — | Required to open `/admin` and `/api/v1/admin/*`. |
| `API_KEYS` | — | When set, `/api/v1` requires `X-API-Key` (the demo UI uses a session cookie). |
| `DATA_DIR` | `./data` | JSON stores: documents, jobs, extraction configs. |

Full list with comments: [`.env.example`](.env.example).

## Development

```bash
make check          # Biome + tsc --noEmit + tests with the 80 % coverage gate
make e2e            # Playwright: demo + admin against a mock-backed server
make docs           # regenerate docs/developer/api-reference.md from the OpenAPI document
make showcase       # record the 2–3 minute walkthrough into showcase/out/
make smoke          # OPT-IN live run against the real KB (uploads, processes, deletes)
make docker         # build the container image
make fly-validate   # validate fly.toml
```

The platform is vendored in `vendor/arag-platform/` and must never be edited in place —
change the platform repo and re-run `make sync-platform`.

## Documentation

Start at [`docs/README.md`](docs/README.md): developer quickstart and API reference,
architecture and the ARAG mechanics that make this reliable, business walkthroughs,
product marketing, hands-on enablement labs, and the showcase script.

## Deploying

`Dockerfile` (node:22-slim, non-root, no build step) and `fly.toml` (app
`arag-doc-processing`, `data` volume mounted at `/data`) are ready to go:

```bash
fly secrets set ARAG_KB_ID=… ARAG_API_KEY=… ARAG_REGION=aws-us-east-2-1 \
                ADMIN_TOKEN=… DIP_EXTRACT_STRATEGY=…
fly deploy
```

See [`docs/architecture/deployment-topologies.md`](docs/architecture/deployment-topologies.md).

## Licence

Apache-2.0 — see [LICENSE](LICENSE). Contributions welcome: [CONTRIBUTING.md](CONTRIBUTING.md).
