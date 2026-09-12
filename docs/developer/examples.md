# Examples

Every request and response below was run against a live `make dev` instance
(`ARAG_MOCK=1`). Full route and schema definitions: [`api-reference.md`](api-reference.md) or
<http://localhost:8080/api/v1/docs>.

## Uploading a document

### Raw body + `X-Filename`

What `curl --data-binary` and the demo's dropzone send:

```bash
curl -sS -X POST 'http://localhost:8080/api/v1/documents?config=auto' \
     -H 'Content-Type: text/plain' -H 'X-Filename: invoice.txt' \
     --data-binary @public/samples/invoice.txt
```

### Multipart form data

```bash
curl -sS -X POST 'http://localhost:8080/api/v1/documents?config=auto' \
     -F 'file=@public/samples/receipt.txt;type=text/plain'
```

```json
{
  "document": { "id": "f727bea71b6b46c99e1176f142231945", "filename": "receipt.txt", "status": "pending", "...": "…" },
  "job": { "id": "09e39d79-ebaf-4e18-a7f6-31c0b22d3527", "status": "queued", "...": "…" }
}
```

Both shapes are accepted on the same endpoint; multipart also accepts a `config` form
field as an alternative to the `?config=` query parameter. Note for route authors: the
multipart body is parsed by the route itself, not the platform's generic body parser —
see [`extension-points.md`](extension-points.md#adding-a-route) for why.

Content type is resolved from the declared `Content-Type` (or the multipart part's), falling
back to the file extension, and must be in the allowlist (`src/services/documents.ts`,
`ALLOWED_MIME`): `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `image/tiff`,
`text/plain`, `text/markdown`, `text/csv`, `.docx`. Anything else is a `415`. See
[`architecture/limits.md`](../architecture/limits.md) for the full allowlist and the 25 MB
size cap.

## Watching a job with SSE

### `curl -N`

```bash
JOB=$(jq -r .job.id /tmp/up.json)
curl -sN "http://localhost:8080/api/v1/jobs/$JOB/events"
```

```
: connected

event: event
data: {"ts":"2026-09-12T02:46:03.172Z","stage":"process","status":"start","message":"Progress Agentic RAG is processing the document (OCR, visual layout, embeddings)…"}

event: event
data: {"ts":"2026-09-12T02:46:03.173Z","stage":"process","status":"progress","message":"status: PROCESSED (poll 1)"}

event: event
data: {"ts":"2026-09-12T02:46:03.174Z","stage":"process","status":"ok","ms":2}

event: event
data: {"ts":"2026-09-12T02:46:03.176Z","stage":"extract","status":"start","message":"Extracting invoice fields with the visual LLM…"}

event: event
data: {"ts":"2026-09-12T02:46:03.177Z","stage":"extract","status":"ok","ms":2}

event: event
data: {"ts":"2026-09-12T02:46:03.180Z","stage":"standardize","status":"ok","message":"Canonical record ready (JSON · XML · CSV)","data":{"fields":12}}

event: job
data: {"job":{"id":"e77d10ff-aa55-4516-9921-55f45cc0a19c","kind":"process-document","status":"succeeded","progress":1,"...":"…"}}
```

Two event names: `event` (a `JobEvent` — `stage`, `status` of `start | progress | ok | error
| skip`, optional `ms` and `message`) and `job` (the full job object, sent on every status
change and once more when it reaches a terminal status, which also closes the stream). A
late subscriber gets every past event replayed first, so refreshing a browser tab never
loses pipeline history. The pipeline itself keeps running even if nobody is listening — SSE
is a *view* of the job, not the job itself ([DP-02](../../DECISIONS.md)).

### Browser `EventSource`

```html
<script>
  const es = new EventSource(`/api/v1/jobs/${jobId}/events`);
  es.addEventListener("event", (e) => {
    const ev = JSON.parse(e.data);
    console.log(ev.stage, ev.status, ev.message ?? "");
  });
  es.addEventListener("job", (e) => {
    const { job } = JSON.parse(e.data);
    if (["succeeded", "failed", "cancelled"].includes(job.status)) es.close();
  });
</script>
```

This is exactly the pattern `public/app.js` uses to drive the `<arag-job-timeline>` element
in the demo.

## The canonical record

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID" | jq .
```

```json
{
  "id": "b3ab630aaf4046a296d61ab669970d35",
  "resourceId": "b3ab630aaf4046a296d61ab669970d35",
  "filename": "invoice.txt",
  "contentType": "text/plain",
  "bytes": 1137,
  "status": "ready",
  "docType": "invoice",
  "docTypeConfidence": 0.92,
  "fields": [
    { "key": "vendor_name", "label": "Vendor", "value": "ACME ROBOTICS PTY LTD", "confidence": 0.95 },
    { "key": "invoice_date", "label": "Invoice Date", "value": "2026-06-15", "confidence": 0.85, "raw": "15/06/2026" },
    { "key": "total", "label": "Total", "value": 116160, "confidence": 0.95, "raw": "$116,160.00" }
  ],
  "entities": [
    { "text": "Software Corporation", "type": "ORG" },
    { "text": "$96,000.00", "type": "MONEY" }
  ],
  "summary": "ACME ROBOTICS PTY LTD Unit 7, 142 Burwood Road, Hawthorn VIC 3122, Australia ABN 51 824 753 556.",
  "tags": ["document", "invoice", "sample"],
  "issues": [],
  "meta": {
    "processedAt": "2026-09-12T02:46:03.180Z",
    "schema": "invoice_extraction",
    "model": "chatgpt-azure-4o",
    "sourceChars": 1136,
    "config": "invoice",
    "forced": false,
    "searchConfiguration": "dip_invoice_extraction",
    "durationsMs": {}
  },
  "createdAt": "2026-09-12T02:46:03.172Z",
  "updatedAt": "2026-09-12T02:46:03.180Z"
}
```

(Truncated for length — `fields` has 12 entries for a typical invoice.) Note `invoice_date`:
extracted as `"15/06/2026"`, normalised to ISO `"2026-06-15"`, with the original preserved in
`raw`. `total` was captured as the string `"$116,160.00"` by the model and parsed to the
number `116160` — see [`arag-integration.md`](../architecture/arag-integration.md) for why
amounts are extracted as strings in the first place.

## Export formats

### JSON (default) — the record itself, pretty-printed

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID/export?format=json"
```

### XML

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID/export?format=xml"
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<document id="b3ab630aaf4046a296d61ab669970d35" type="invoice">
  <filename>invoice.txt</filename>
  <contentType>text/plain</contentType>
  <resourceId>b3ab630aaf4046a296d61ab669970d35</resourceId>
  <status>ready</status>
  <summary>ACME ROBOTICS PTY LTD Unit 7, 142 Burwood Road, Hawthorn VIC 3122, Australia ABN 51 824 753 556.</summary>
  <fields>
    <field key="vendor_name" label="Vendor" confidence="0.95">ACME ROBOTICS PTY LTD</field>
    <field key="total" label="Total" confidence="0.95">116160</field>
    <field key="line_items" label="Line Items" confidence="0.85">
      <item>Industrial 3D Printer (Model X9)      2    $48,000.00  $96,000.00</item>
      <item>On-site Installation &amp; Calibration    1     $3,200.00   $3,200.00</item>
    </field>
  </fields>
  <entities>
    <entity type="ORG">Software Corporation</entity>
    <entity type="MONEY">$96,000.00</entity>
  </entities>
  <tags><tag>document</tag><tag>invoice</tag><tag>sample</tag></tags>
  <meta>
    <processedAt>2026-09-12T02:46:03.180Z</processedAt>
    <schema>invoice_extraction</schema>
    <model>chatgpt-azure-4o</model>
  </meta>
</document>
```

Values are XML-escaped (`&`, `<`, `>`, `"`, `'`); array fields (`line_items`) become one
`<item>` per entry.

### CSV — one row per extracted field (long format)

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID/export?format=csv"
```

```csv
document_id,filename,doc_type,field_key,field_label,value,confidence
b3ab630aaf4046a296d61ab669970d35,invoice.txt,invoice,vendor_name,Vendor,ACME ROBOTICS PTY LTD,0.95
b3ab630aaf4046a296d61ab669970d35,invoice.txt,invoice,invoice_date,Invoice Date,2026-06-15,0.85
b3ab630aaf4046a296d61ab669970d35,invoice.txt,invoice,total,Total,116160,0.95
b3ab630aaf4046a296d61ab669970d35,invoice.txt,invoice,line_items,Line Items,"Industrial 3D Printer (Model X9)      2    $48,000.00  $96,000.00; On-site Installation & Calibration    1     $3,200.00   $3,200.00",0.85
```

Long format keeps documents with wildly different schemas in one spreadsheet-friendly
shape. Cells containing a comma, quote or newline are quoted; array values are joined with
`; `. All three formats set `Content-Disposition: attachment` with the original filename's
base name and the export extension.

## Ask this document

```bash
curl -sS -X POST "http://localhost:8080/api/v1/documents/$ID/ask" \
     -H 'Content-Type: application/json' -d '{"question":"What is the total due?"}' | jq .
```

```json
{
  "answer": "... TOTAL DUE:         $116,160.00 AUD ...",
  "sources": ["invoice.txt"],
  "ms": 2
}
```

`question` is required, 1–1200 characters. The answer is grounded to this one document via
`resource_filters` + `full_resource` (see
[`arag-integration.md`](../architecture/arag-integration.md#key-arag-mechanics)); a question
outside the document is answered "I don't have that information" per the system prompt in
`services/documents.ts`.

## Custom extraction configs

Define exactly the fields you want, independent of the 11 built-in document types:

```bash
curl -sS -X POST 'http://localhost:8080/api/v1/extraction-configs' \
     -H 'Content-Type: application/json' \
     -d '{
           "name": "Insurance Card",
           "description": "Fields from a health insurance membership card",
           "fields": [
             { "label": "Member Name", "required": true },
             { "label": "Member ID",   "required": true },
             { "label": "Group Number" },
             { "label": "Plan Type" }
           ]
         }'
```

```json
{
  "id": "cfg_5088a08b",
  "name": "Insurance Card",
  "docType": "generic",
  "description": "Fields from a health insurance membership card",
  "builtin": false,
  "aragConfig": "dip_custom_insurance_card",
  "provisioned": true,
  "fields": [
    { "key": "member_name", "label": "Member Name", "type": "string", "required": true },
    { "key": "member_id", "label": "Member ID", "type": "string", "required": true },
    { "key": "group_number", "label": "Group Number", "type": "string", "required": false },
    { "key": "plan_type", "label": "Plan Type", "type": "string", "required": false }
  ],
  "createdAt": "2026-09-12T02:46:47.047Z",
  "updatedAt": "2026-09-12T02:46:47.047Z"
}
```

`201 Created` with a `Location` header. `key` defaults to a slug of `label` when omitted.
Creating the config immediately provisions a stored ARAG search configuration
(`dip_custom_insurance_card`) that pins the model, `full_resource` grounding, the grounding
prompt and an `answer_json_schema` built from these fields (see
[`arag-integration.md`](../architecture/arag-integration.md#stored-search-configurations)).
Use the returned `id` as `config` on upload:

```bash
curl -sS -X POST 'http://localhost:8080/api/v1/documents?config=cfg_5088a08b' \
     -H 'Content-Type: text/plain' -H 'X-Filename: card.txt' --data-binary @some-card.txt
```

This skips auto-classification entirely (`meta.forced: true`, `meta.config: "Insurance
Card"`) and forces exactly those four fields. Built-in configs are addressed by document
type directly: `?config=invoice`, `?config=medical_claim`, etc. — see
[`GET /api/v1/schemas`](api-reference.md#get-apiv1schemas) for the full list. Built-in
configs cannot be deleted (`409`); a custom one is removed with `DELETE
/api/v1/extraction-configs/{id}` (also deletes its ARAG search configuration) — like every
destructive verb in this API, that call requires a credential even with `API_KEYS` unset;
see [Deleting things](#deleting-things) below.

## `config=agent` — reading Data Augmentation agent output

```bash
curl -sS -X POST 'http://localhost:8080/api/v1/documents?config=agent' \
     -H 'Content-Type: text/plain' -H 'X-Filename: agent-test.txt' \
     --data-binary @public/samples/contract.txt
```

This skips live extraction and instead reads fields an ARAG **Data Augmentation "ask"
agent** already persisted on the resource. Against the mock (or any resource without agent
output), the `classify` stage emits a `skip` event and the pipeline falls back to live
extraction — real output from the job's event log:

```json
{"ts":"2026-09-12T02:47:02.031Z","stage":"classify","status":"start","message":"Reading fields written by the ARAG Data Augmentation agent…"}
{"ts":"2026-09-12T02:47:02.032Z","stage":"classify","status":"ok","ms":1}
{"ts":"2026-09-12T02:47:02.032Z","stage":"classify","status":"skip","message":"No DA-agent fields on this resource yet — using live extraction."}
{"ts":"2026-09-12T02:47:02.032Z","stage":"classify","status":"start","message":"Classifying document type…"}
```

Details in [`arag-integration.md`](../architecture/arag-integration.md#data-augmentation-agents).

## Deleting things

`DELETE /api/v1/documents/{id}`, `DELETE /api/v1/jobs/{id}` (cancel) and
`DELETE /api/v1/extraction-configs/{id}` are destructive, so they always require a
credential — an API key, the admin token, or a same-origin session cookie — **even when
`API_KEYS` is unset** (uploads and reads stay open either way). Get a session first:

```bash
curl -sS -c /tmp/cookies.txt -X POST http://localhost:8080/api/v1/session
curl -sS -b /tmp/cookies.txt -X DELETE "http://localhost:8080/api/v1/documents/$ID"
```

```
HTTP/1.1 204 No Content
```

Without a credential, the same call returns a real, verified `401`:

```json
{
  "type": "https://arag.dev/problems/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Destructive operations require a credential: send an API key (X-API-Key or Authorization: Bearer), the admin token, or call POST /api/v1/session first to obtain a same-origin session cookie.",
  "instance": "/api/v1/documents/8294398cb4c94bed94fe6d8230b32818",
  "requestId": "0b9c281d-6b3b-4473-be62-f717884fdf55"
}
```

## Pagination and filtering

```bash
curl -sS "http://localhost:8080/api/v1/documents?page=1&page_size=5&status=ready&doc_type=invoice"
```

```json
{ "items": [ /* up to 5 DocumentRecord objects */ ], "page": 1, "page_size": 5, "total": 2, "next_page": false }
```

`page_size` maxes out at 200 (STANDARDS §2). `status` is one of `pending | processing |
ready | failed`; `doc_type` is any of the 11 built-in types. `GET /api/v1/jobs` filters by
`status` (`queued | running | succeeded | failed | cancelled`) and `ref` (the document id
that submitted the job), with `limit` up to 200.

## Error handling

Every error is RFC 9457 `application/problem+json`, with a `requestId` that ties back to
`GET /api/v1/admin/logs`. Real examples:

**404 — unknown document:**

```bash
curl -sS "http://localhost:8080/api/v1/documents/doesnotexist"
```

```json
{
  "type": "https://arag.dev/problems/not-found",
  "title": "Not found",
  "status": 404,
  "detail": "Document not found",
  "instance": "/api/v1/documents/doesnotexist",
  "requestId": "0b765968-6b0a-44ad-bcbf-993a7d1a1a75"
}
```

**415 — disallowed content type:**

```json
{
  "type": "https://arag.dev/problems/unsupported-media-type",
  "title": "Unsupported media type",
  "status": 415,
  "detail": "Content type \"application/zip\" is not accepted. Allowed: application/pdf, image/png, image/jpeg, image/webp, image/tiff, text/plain, text/markdown, text/csv, application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "instance": "/api/v1/documents",
  "requestId": "cac1fecc-86b8-40cb-a30c-78736926dbb6"
}
```

**400 — schema validation failure**, note the `errors` array pointing at the offending field:

```json
{
  "type": "https://arag.dev/problems/validation",
  "title": "Validation failed",
  "status": 400,
  "detail": "Invalid body: /question is required",
  "instance": "/api/v1/documents/b3ab630aaf4046a296d61ab669970d35/ask",
  "requestId": "0bcac0fd-e8cd-453a-8b2a-1fd2eb8a78fa",
  "errors": [{ "path": "/question", "message": "is required" }]
}
```

**401 — missing/incorrect admin token** on an admin route when `ADMIN_TOKEN` is set:

```json
{ "type": "https://arag.dev/problems/unauthorized", "title": "Unauthorized", "status": 401,
  "detail": "Admin token required", "instance": "/api/v1/admin/health", "requestId": "..." }
```

If `ADMIN_TOKEN` is unset entirely, admin routes answer `403` instead ("Admin access is
disabled"). **429 — rate limited** (also problem+json) carries a `Retry-After` header;
default limits are 5 requests/sec with a burst of 20 per IP or API key
(`RATE_LIMIT_RPS`/`RATE_LIMIT_BURST`), verified by hammering `/api/v1/schemas` 30 times in a
row against a fresh bucket: the 21st request onward returned `429` until the bucket refilled.

## Minimal clients (standard library only)

### Node (built-in `fetch`, Node ≥ 18)

```js
const BASE = "http://localhost:8080";

const res = await fetch(`${BASE}/api/v1/documents?config=auto`, {
  method: "POST",
  headers: { "Content-Type": "text/plain", "X-Filename": "invoice.txt" },
  body: await (await import("node:fs/promises")).readFile("public/samples/invoice.txt"),
});
const { document, job } = await res.json();

let jobRec;
do {
  jobRec = await (await fetch(`${BASE}/api/v1/jobs/${job.id}`)).json();
  if (!["succeeded", "failed", "cancelled"].includes(jobRec.status)) await new Promise((r) => setTimeout(r, 1000));
} while (!["succeeded", "failed", "cancelled"].includes(jobRec.status));

const record = await (await fetch(`${BASE}/api/v1/documents/${document.id}`)).json();
console.log(record.status, record.docType, record.fields.length);
await fetch(`${BASE}/api/v1/documents/${document.id}`, { method: "DELETE" });
```

Run against the local mock server, this prints `ready invoice 12`.

### Python (`urllib`, standard library only)

```python
import json, time, urllib.request

BASE = "http://localhost:8080"

def request(method, path, data=None, headers=None):
    body = data if isinstance(data, (bytes, type(None))) else json.dumps(data).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=body, method=method, headers=headers or {})
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None

with open("public/samples/invoice.txt", "rb") as f:
    out = request("POST", "/api/v1/documents?config=auto", data=f.read(),
                  headers={"Content-Type": "text/plain", "X-Filename": "invoice.txt"})
doc_id, job_id = out["document"]["id"], out["job"]["id"]

while True:
    job = request("GET", f"/api/v1/jobs/{job_id}")
    if job["status"] in ("succeeded", "failed", "cancelled"):
        break
    time.sleep(1)

record = request("GET", f"/api/v1/documents/{doc_id}")
print(record["status"], record["docType"], len(record["fields"]))
request("DELETE", f"/api/v1/documents/{doc_id}")
```

Also prints `ready invoice 12` against the local mock server. Both snippets were run
against `make dev` to produce that output.
