# Quickstart

Runs entirely against the in-process mock ARAG by default — no Progress Agentic RAG
account, no credentials, no LLM spend.

## 1. Clone and install

```bash
git clone <repo-url> arag-doc-processing
cd arag-doc-processing
make install        # bun installs dev tooling only (no npm, ever)
```

## 2. Run it

```bash
make dev             # http://localhost:8080 — ARAG_MOCK=1 unless .env has real credentials
```

`make dev` copies `.env.example` to `.env` on first run, then checks whether `ARAG_API_KEY`
is set. If it isn't, it starts with `ARAG_MOCK=1` automatically — the whole pipeline runs
against an in-process fake Knowledge Box.

Open:

| Surface | URL |
|---|---|
| Operator app | <http://localhost:8080/> — Documents, Configs, Ask, Jobs, Settings |
| Admin app | <http://localhost:8080/admin/> — Overview, Connection, Configs, Jobs, Logs, Usage, Branding, Security |
| Redoc | <http://localhost:8080/api/v1/docs> |
| Swagger UI (try it out) | <http://localhost:8080/api/v1/swagger> |
| OpenAPI document | <http://localhost:8080/api/v1/openapi.json> |

## 3. Upload a document

Multipart or raw body both work; this uses a raw body with `X-Filename` (what
`curl --data-binary` and the operator app's upload dropzone send):

```bash
curl -sS -X POST 'http://localhost:8080/api/v1/documents?config=auto' \
     -H 'Content-Type: text/plain' -H 'X-Filename: invoice.txt' \
     --data-binary @public/samples/invoice.txt | tee /tmp/up.json
```

```json
{
  "document": {
    "id": "b3ab630aaf4046a296d61ab669970d35",
    "resourceId": "b3ab630aaf4046a296d61ab669970d35",
    "jobId": "e77d10ff-aa55-4516-9921-55f45cc0a19c",
    "filename": "invoice.txt",
    "contentType": "text/plain",
    "bytes": 1137,
    "status": "pending",
    "docType": "generic",
    "fields": [], "entities": [], "tags": [], "issues": [],
    "meta": { "processedAt": "2026-09-12T02:46:03.172Z", "schema": "generic_extraction",
              "model": "chatgpt-azure-4o", "durationsMs": {} },
    "createdAt": "2026-09-12T02:46:03.172Z", "updatedAt": "2026-09-12T02:46:03.172Z"
  },
  "job": { "id": "e77d10ff-aa55-4516-9921-55f45cc0a19c", "kind": "process-document",
           "status": "queued", "progress": 0, "...": "…" }
}
```

`202 Accepted`, a `Location` header pointing at the document, the document as it is *right
now* (`status: "pending"`), and the job that will process it. The document id is the same
string as the ARAG resource id (see [DP-01](../../DECISIONS.md)).

## 4. Record the pipeline

```bash
ID=$(jq -r .document.id /tmp/up.json); JOB=$(jq -r .job.id /tmp/up.json)
curl -sN "http://localhost:8080/api/v1/jobs/$JOB/events"
```

Streams `event: event` (one per pipeline stage — `process → classify → extract → entities →
summary → validate → standardize`) then `event: job` with the finished job. Against the
mock the whole run typically completes in well under a second; see
[`architecture/scaling.md`](../architecture/scaling.md) for real ARAG timings. Full event
shapes and a browser `EventSource` example are in
[`examples.md`](examples.md#watching-a-job-with-sse).

## 5. Read the canonical record

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID" | jq '{status, docType, fields: (.fields|length), summary}'
```

```json
{ "status": "ready", "docType": "invoice", "fields": 12,
  "summary": "ACME ROBOTICS PTY LTD Unit 7, 142 Burwood Road, Hawthorn VIC 3122, Australia ABN 51 824 753 556." }
```

## 6. Export it

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID/export?format=csv"
```

```
document_id,filename,doc_type,field_key,field_label,value,confidence
b3ab630aaf4046a296d61ab669970d35,invoice.txt,invoice,vendor_name,Vendor,ACME ROBOTICS PTY LTD,0.95
...
```

`format` is `json` (the canonical record, default), `xml`, or `csv` (one row per field).
See every format's full output in [`examples.md`](examples.md#export-formats).

## 7. Ask it a question

```bash
curl -sS -X POST "http://localhost:8080/api/v1/documents/$ID/ask" \
     -H 'Content-Type: application/json' -d '{"question":"What is the total due?"}' | jq .
```

```json
{ "answer": "... TOTAL DUE:         $116,160.00 AUD ...", "sources": ["invoice.txt"], "ms": 2 }
```

## 8. Clean up

Deleting is a destructive verb, so it always requires a credential — even with `API_KEYS`
unset (see [`architecture/security-model.md`](../architecture/security-model.md#authentication)).
Get a session cookie first, the same way the operator app does at page load:

```bash
curl -sS -c /tmp/cookies.txt -X POST http://localhost:8080/api/v1/session
curl -sS -b /tmp/cookies.txt -X DELETE "http://localhost:8080/api/v1/documents/$ID"
```

Deletes the local record **and** the ARAG resource (`DELETE /kb/{kb}/resource/{rid}`).
Always delete test uploads — there is no background retention sweep (see
[`architecture/limits.md`](../architecture/limits.md)).

## Pointing at a real Knowledge Box

Copy `.env.example` to `.env` and fill in:

```bash
ARAG_KB_ID=<your-kb-uuid>
ARAG_API_KEY=<service-account token>
ARAG_REGION=aws-us-east-2-1        # or set ARAG_BASE_URL directly
ARAG_GENERATIVE_MODEL=chatgpt-azure-4o   # must be multimodal for image/PDF extraction
DIP_EXTRACT_STRATEGY=<extract-strategy-id>   # optional: ingestion-time visual-LLM extraction
```

Leave `ARAG_MOCK` unset (or `0`). `make dev` will detect `ARAG_API_KEY` and run against the
real KB. `assertAragEnv()` fails fast at boot if credentials are required but missing.
The ARAG mechanics that make extraction reliable — `full_resource` grounding, the
searchable-gate, query seeding — are documented once, verbatim, in
[`architecture/arag-integration.md`](../architecture/arag-integration.md); read that before
tuning anything against a live KB.

For an opt-in end-to-end run against the real KB that also deletes what it created:

```bash
make smoke
```

## Next

- [`examples.md`](examples.md) — every request shape, every export format, error handling, client snippets.
- [`local-dev.md`](local-dev.md) — repo layout, every `make` target, debugging.
- [`extension-points.md`](extension-points.md) — add a document type, a pipeline stage, an export format.
- [`api-reference.md`](api-reference.md) — the full generated API reference.
