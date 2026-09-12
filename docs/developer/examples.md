# Examples

Every request and response below was run against a live `make dev` instance
(`ARAG_MOCK=1`). Full route and schema definitions: [`api-reference.md`](api-reference.md) or
<http://localhost:8080/api/v1/docs>.

## Uploading a document

### Raw body + `X-Filename`

What `curl --data-binary` and the operator app's upload dropzone send:

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

This is exactly the pattern `public/views/document.js` uses to drive the live Pipeline tab,
and `admin/admin.js` uses for the `<arag-job-timeline>` element in a job's drawer.

## The canonical record

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID" | jq .
```

```json
{
  "id": "0bef696b45cc4bc6b04367b8cf752170",
  "resourceId": "0bef696b45cc4bc6b04367b8cf752170",
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
    "processedAt": "2026-09-12T03:17:02.042Z",
    "schema": "invoice_extraction",
    "model": "chatgpt-azure-4o",
    "sourceChars": 1136,
    "config": "invoice",
    "forced": false,
    "searchConfiguration": "dip_invoice_extraction",
    "durationsMs": { "process": 3, "classify": 3, "extract": 3, "entities": 3, "summary": 1, "validate": 0, "standardize": 0 }
  },
  "createdAt": "2026-09-12T03:17:02.029Z",
  "updatedAt": "2026-09-12T03:17:02.042Z"
}
```

(Truncated for length — `fields` has 12 entries for a typical invoice.) Note `invoice_date`:
extracted as `"15/06/2026"`, normalised to ISO `"2026-06-15"`, with the original preserved in
`raw`. `total` was captured as the string `"$116,160.00"` by the model and parsed to the
number `116160` — see [`arag-integration.md`](../architecture/arag-integration.md) for why
amounts are extracted as strings in the first place.

If a pipeline stage failed but the run still finished (soft-failure degradation, see
[`architecture.md`](../architecture/architecture.md#the-job--sse-model)), `meta` also
carries a `stageErrors` array — one `"<stage>: <message>"` string per failed stage — and
the same failures appear in `issues` with `severity: "error"`. It's only present when at
least one stage actually failed; a clean run has no `stageErrors` key at all.

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
<document id="0bef696b45cc4bc6b04367b8cf752170" type="invoice">
  <filename>invoice.txt</filename>
  <contentType>text/plain</contentType>
  <resourceId>0bef696b45cc4bc6b04367b8cf752170</resourceId>
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
0bef696b45cc4bc6b04367b8cf752170,invoice.txt,invoice,vendor_name,Vendor,ACME ROBOTICS PTY LTD,0.95
0bef696b45cc4bc6b04367b8cf752170,invoice.txt,invoice,invoice_date,Invoice Date,2026-06-15,0.85
0bef696b45cc4bc6b04367b8cf752170,invoice.txt,invoice,total,Total,116160,0.95
0bef696b45cc4bc6b04367b8cf752170,invoice.txt,invoice,line_items,Line Items,"Industrial 3D Printer (Model X9)      2    $48,000.00  $96,000.00; On-site Installation & Calibration    1     $3,200.00   $3,200.00",0.85
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
  "citations": [
    { "paragraphId": "0-0-0", "text": "TOTAL DUE:         $116,160.00 AUD", "start": 604, "end": 638 }
  ],
  "ms": 3
}
```

`question` is required, 1–1200 characters. The answer is grounded to this one document via
`resource_filters` + `full_resource` (see
[`arag-integration.md`](../architecture/arag-integration.md#key-arag-mechanics)); a question
outside the document is answered "I don't have that information" per the system prompt in
`services/documents.ts`. `sources` names the resource(s) the answer drew on; `citations` (an
empty array when retrieval returned nothing) is the retrieval paragraph itself, which is
what the operator app's **Open in source** link uses to jump into the Source & evidence tab
— a source name alone is not something a reviewer can open and check.

## Custom extraction configs

Define exactly the fields you want, independent of the 11 built-in document types.
Creating a config writes a real stored search configuration into the Knowledge Box, so —
like the other write operations covered in
[Credentials for write operations](#credentials-for-write-operations) — it requires a
credential even when `API_KEYS` is unset. Get a session first:

```bash
curl -sS -c /tmp/cookies.txt -X POST http://localhost:8080/api/v1/session
curl -sS -b /tmp/cookies.txt -X POST 'http://localhost:8080/api/v1/extraction-configs' \
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
  "id": "cfg_7361fcb2",
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
  "createdAt": "2026-09-12T03:10:12.291Z",
  "updatedAt": "2026-09-12T03:10:12.291Z"
}
```

`201 Created` with a `Location` header. `key` defaults to a slug of `label` when omitted.
Creating the config immediately provisions a stored ARAG search configuration
(`dip_custom_insurance_card`) that pins the model, `full_resource` grounding, the grounding
prompt and an `answer_json_schema` built from these fields (see
[`arag-integration.md`](../architecture/arag-integration.md#stored-search-configurations)).
To confirm exactly what got provisioned — straight from the Knowledge Box, not a local
reconstruction — an admin can read it back:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
     http://localhost:8080/api/v1/admin/search-configurations | jq '.items[] | select(.name=="dip_custom_insurance_card")'
```

Use the returned `id` as `config` on upload — uploading itself needs no credential:

```bash
curl -sS -X POST 'http://localhost:8080/api/v1/documents?config=cfg_7361fcb2' \
     -H 'Content-Type: text/plain' -H 'X-Filename: card.txt' --data-binary @some-card.txt
```

This skips auto-classification entirely (`meta.forced: true`, `meta.config: "Insurance
Card"`) and forces exactly those four fields. Built-in configs are addressed by document
type directly: `?config=invoice`, `?config=medical_claim`, etc. — see
[`GET /api/v1/schemas`](api-reference.md#get-apiv1schemas) for the full list. Built-in
configs cannot be deleted (`409`); a custom one is removed with `DELETE
/api/v1/extraction-configs/{id}` (also deletes its ARAG search configuration) — again
requiring a credential; see [Credentials for write operations](#credentials-for-write-operations) below.

## Editing and re-provisioning a config

`PUT /api/v1/extraction-configs/{id}` replaces a custom config's name, description and
fields in place, keeping its id — which is what the operator app's field-builder **Edit**
screen calls, so that `meta.config` on every document already processed with it stays
meaningful. Delete-and-recreate would break that reference; `PUT` does not:

```bash
curl -sS -b /tmp/cookies.txt -X PUT 'http://localhost:8080/api/v1/extraction-configs/cfg_7361fcb2' \
     -H 'Content-Type: application/json' \
     -d '{"name": "Insurance Card", "fields": [
           { "label": "Member Name", "required": true },
           { "label": "Member ID",   "required": true },
           { "label": "Group Number" }
         ]}'
```

Built-in configs answer `409` — they cannot be edited, only read; create a custom config
with the fields you want instead. Either kind can be re-provisioned on its own, without
touching the others:

```bash
curl -sS -b /tmp/cookies.txt -X POST 'http://localhost:8080/api/v1/extraction-configs/cfg_7361fcb2/provision'
```

```json
{ "ok": true, "aragConfig": "dip_custom_insurance_card" }
```

Idempotent — safe to call any time. `POST /api/v1/admin/provision` (admin token required)
does the same for every config at once; the per-config route is the finer-grained action an
operator reaches for to fix the one config that did not take, without re-sending the other
twelve.

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

## Credentials for write operations

A handful of routes change shared state and so always require a credential — an API key,
the admin token, or a same-origin session cookie — **even when `API_KEYS` is unset**:
creating or replacing a custom extraction config (`POST`/`PUT /api/v1/extraction-configs`),
the three deletes (single document, bulk documents, a custom config), and reprocessing a
document (it spends model calls). Uploads and every read stay open either way
(`src/routes/guards.ts`, `requireWriter`). Get a session first, the same way the operator
app does at page load:

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
  "detail": "This operation requires a credential: send an API key (X-API-Key or Authorization: Bearer), the admin token, or call POST /api/v1/session first to obtain a same-origin session cookie.",
  "instance": "/api/v1/extraction-configs",
  "requestId": "4a799aa7-def5-440f-af5a-0bc0df4fe3dd"
}
```

## Pagination, search and filtering

```bash
curl -sS "http://localhost:8080/api/v1/documents?page=1&page_size=5&status=ready&doc_type=invoice"
```

```json
{ "items": [ /* up to 5 DocumentRecord objects */ ], "page": 1, "page_size": 5, "total": 2, "next_page": false,
  "facets": { "total": 24, "status": { "ready": 20, "processing": 1, "failed": 1, "pending": 2 },
              "docType": { "invoice": 9, "receipt": 3, "...": "…" }, "degraded": 2, "needsReview": 3 } }
```

`page_size` maxes out at 200 (STANDARDS §2). This is what the Documents screen's filter bar
and stat strip call — every parameter is optional and combines with the others as `AND`:

| Param | Notes |
|---|---|
| `q` | Case-insensitive substring over the filename, summary, tags and extracted field values — finds a document by the supplier on it, not only by the name it was uploaded under |
| `status` | `pending \| processing \| ready \| failed` |
| `doc_type` | Any of the 11 built-in types |
| `sort`, `order` | `sort` is `created_at` (default) \| `filename` \| `doc_type` \| `status` \| `fields` \| `grounding`; `order` is `asc` \| `desc` (default `desc`) |
| `date_from`, `date_to` | Inclusive range over `createdAt`, ISO 8601 or `YYYY-MM-DD` |
| `config` | Only documents extracted with this extraction-config id |
| `degraded` | `true` selects records that finished with a failed stage (`meta.stageErrors`) |
| `has_issues` | `true` selects records carrying at least one validation issue |
| `min_grounding` | `0`–`1`; records with no grounding score are excluded, not treated as `0` |

`facets` reports counts across the *whole* collection, not just the current page — it is
what lets the stat strip and the filter dropdowns show numbers without a second round trip.

`GET /api/v1/jobs` takes the equivalent shape: `status` (`queued | running | succeeded |
failed | cancelled`), `ref` (the document id that submitted the job), `page`/`page_size`
(preferred) or `limit` (kept for compatibility), `sort` (`created_at` default | `duration` |
`status`), `order`, and `q` (matches the job id, its kind, or the document id it refers
to). The response is paged the same way: `{ items, page, page_size, total, next_page }`.

## Bulk actions on a selection of documents

Both take the same shape as a single export or delete, just with an array of ids — this is
what the Documents screen's bulk bar calls once a selection is made:

```bash
curl -sS -b /tmp/cookies.txt -X POST 'http://localhost:8080/api/v1/documents/bulk-export' \
     -H 'Content-Type: application/json' \
     -d '{"ids": ["0bef696b45cc4bc6b04367b8cf752170", "f727bea71b6b46c99e1176f142231945"], "format": "csv"}'
```

CSV emits one row per extracted field across every selected record (so a spreadsheet can
reconcile a whole batch in one pass); JSON returns an array of records; XML wraps them in a
`<documents>` root. Ids that don't exist are skipped and named in the `X-Skipped-Ids`
response header rather than failing the whole export.

```bash
curl -sS -b /tmp/cookies.txt -X POST 'http://localhost:8080/api/v1/documents/bulk-delete' \
     -H 'Content-Type: application/json' \
     -d '{"ids": ["0bef696b45cc4bc6b04367b8cf752170", "doesnotexist"]}'
```

```json
{ "deleted": ["0bef696b45cc4bc6b04367b8cf752170"], "failed": [{ "id": "doesnotexist", "error": "Document not found" }] }
```

Best-effort: each id is attempted and reported separately, so one missing document doesn't
abandon the rest of the selection. Both routes need the same credential as a single
delete/export (export is a read, so it stays open; delete requires a writer credential).

## Reprocessing a document

The recovery action for a failed or degraded record: the file is already in the Knowledge
Box, so this re-runs the pipeline over the existing resource rather than asking for a
re-upload.

```bash
curl -sS -b /tmp/cookies.txt -X POST "http://localhost:8080/api/v1/documents/$ID/reprocess"
```

`202` with the reset record (`status` back to `pending`, `fields`/`evidence`/`issues`/
`meta.stageErrors` cleared) and the new job to watch — the same shape as the original
upload response. Pass `?config=<id>` to force a different extraction config on the retry,
which is also how a config change gets tested against a document already on file. `409` if
the document is already queued or processing.

## The document's own text and its original file

Two routes exist so a client can show an evidence quote *in* the document, not just quote
it back:

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID/text"
```

```json
{ "text": "GLOBEX SUPPLY CO PTY LTD\nLevel 3, 88 Collins Street...", "chars": 1284, "truncated": false }
```

This is the exact text every extraction stage read, and what `Evidence.start`/`Evidence.end`
are offsets into — the operator app's Source & evidence tab highlights each evidence quote
by slicing this string at those offsets. `max_chars` (default 200000, max 2000000) caps the
response; `truncated: true` means there was more.

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID/source" -o original.pdf
```

Streams the original uploaded bytes back from the Knowledge Box with a `Content-Type`
matching `contentType` and `Content-Disposition: inline`. Answers `404` when the resource no
longer holds the file, which is the operator app's cue to hide the "Original file" toggle
and fall back to showing the extracted text only.

## Workspace stats, settings and samples

Three read-only, credential-free routes back the parts of the operator app that don't need
an admin token:

```bash
curl -sS "http://localhost:8080/api/v1/stats"
```

```json
{ "documents": { "total": 24, "ready": 20, "degraded": 2, "failed": 1, "pending": 1 },
  "byDocType": { "invoice": 9, "receipt": 3 }, "groundingScore": 0.91,
  "fields": 210, "issues": 6, "jobs": { "succeeded": 21, "failed": 1, "running": 1, "queued": 1 } }
```

`GET /api/v1/settings` returns the non-secret runtime configuration the Settings screen
shows — connection state, extraction defaults, upload limits, effective branding; the
extract-strategy id itself and every credential stay behind `GET /api/v1/admin/config`.
`GET /api/v1/samples` lists the bundled sample documents (id, title, description, the
static URL the bytes come from, and the document type each is expected to classify as) —
the catalogue behind "Try with a sample" on the welcome screen. `POST
/api/v1/documents/sample` (body `{"sampleId": "invoice"}`) reads one of them server-side
and runs it through the ordinary upload path in one call, which is what the welcome
screen's guided-sample button does rather than fetching the bytes itself first.

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
  "instance": "/api/v1/documents/0bef696b45cc4bc6b04367b8cf752170/ask",
  "requestId": "ea136591-f793-431f-891d-ffbd8e96122a",
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

## Admin: security posture and a dry-run purge

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8080/api/v1/admin/security
```

```json
{ "apiKeys": { "count": 2, "hints": ["…a1b2", "…9f04"] }, "adminTokenSet": true,
  "sessionTtlSec": 43200, "cors": [], "rateLimit": { "rps": 5, "burst": 20 },
  "maxUploadBytes": 26214400, "writesRequireCredential": true,
  "headers": { "csp": true, "hsts": true, "nosniff": true },
  "retention": { "defaultOlderThanDays": 30 } }
```

Values only — a key or token is never returned, only how many are configured and the last
few characters of each, which is what the admin app's Security screen shows so an operator
can tell two keys apart without ever seeing either in full.

Retention purge always supports a dry run, which is how the Security screen's **Preview**
button states the exact blast radius before **Purge** is even clickable:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -X POST http://localhost:8080/api/v1/admin/purge \
     -H 'Content-Type: application/json' -d '{"olderThanDays": 30, "dryRun": true}'
```

```json
{ "olderThanDays": 30, "dryRun": true, "wouldDelete": 4,
  "oldest": "2026-06-01T02:46:03.172Z", "newest": "2026-06-28T11:02:44.001Z",
  "ids": ["...", "...", "...", "..."], "deleted": [], "failed": [] }
```

Nothing is deleted while `dryRun: true`. Drop it (or set it to `false`) to actually purge —
the response then reports `deleted`/`failed` instead of `wouldDelete`.

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

// Deleting is a destructive verb — it needs a credential even with API_KEYS unset.
const sessionRes = await fetch(`${BASE}/api/v1/session`, { method: "POST" });
const cookie = sessionRes.headers.get("set-cookie").split(";")[0];
await fetch(`${BASE}/api/v1/documents/${document.id}`, { method: "DELETE", headers: { Cookie: cookie } });
console.log("deleted", document.id);
```

Run against the local mock server, this prints `ready invoice 12` followed by `deleted
<document id>`.

### Python (`urllib`, standard library only)

```python
import json, time, urllib.request

BASE = "http://localhost:8080"

def request(method, path, data=None, headers=None):
    body = data if isinstance(data, (bytes, type(None))) else json.dumps(data).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=body, method=method, headers=headers or {})
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
        return (json.loads(raw) if raw else None), resp.headers.get("Set-Cookie", "")

with open("public/samples/invoice.txt", "rb") as f:
    out, _ = request("POST", "/api/v1/documents?config=auto", data=f.read(),
                      headers={"Content-Type": "text/plain", "X-Filename": "invoice.txt"})
doc_id, job_id = out["document"]["id"], out["job"]["id"]

while True:
    job, _ = request("GET", f"/api/v1/jobs/{job_id}")
    if job["status"] in ("succeeded", "failed", "cancelled"):
        break
    time.sleep(1)

record, _ = request("GET", f"/api/v1/documents/{doc_id}")
print(record["status"], record["docType"], len(record["fields"]))

# Deleting is a destructive verb — it needs a credential even with API_KEYS unset.
_, cookie = request("POST", "/api/v1/session")
request("DELETE", f"/api/v1/documents/{doc_id}", headers={"Cookie": cookie.split(";")[0]})
```

Also prints `ready invoice 12` against the local mock server. Both snippets were run
against `make dev` to produce that output.
