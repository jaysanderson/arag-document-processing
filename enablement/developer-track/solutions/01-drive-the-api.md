# Solution 1 — Drive the API from the command line

This is a full, real transcript against a locally running instance
(`make dev`, `ARAG_MOCK=1`). Your ids, timestamps and durations will differ; the shapes
and status codes will not.

```bash
# 1. Upload
curl -sS -X POST 'http://localhost:8080/api/v1/documents?config=auto' \
     -H 'Content-Type: text/plain' -H 'X-Filename: receipt.txt' \
     --data-binary @public/samples/receipt.txt | tee /tmp/up.json | jq .
```

```json
{
  "document": {
    "id": "b07beea146114ccf8d126fda5e0eb11a", "resourceId": "b07beea146114ccf8d126fda5e0eb11a",
    "jobId": "d00733a3-ad19-4d99-baf1-de945d2accbf",
    "filename": "receipt.txt", "contentType": "text/plain", "bytes": 253,
    "status": "pending", "docType": "generic",
    "fields": [], "entities": [], "tags": [], "issues": []
  },
  "job": { "id": "d00733a3-ad19-4d99-baf1-de945d2accbf", "kind": "process-document", "status": "queued" }
}
```

```bash
ID=$(jq -r .document.id /tmp/up.json)
JOB=$(jq -r .job.id /tmp/up.json)

# 2. Watch the job
curl -sN "http://localhost:8080/api/v1/jobs/$JOB/events"
```

Ends with an `event: job` frame whose `status` is `succeeded`, having emitted
`process`, `classify`, `extract`, `entities`, `summary`, `validate`, `standardize` in
order.

```bash
# 3. Read the record
curl -sS "http://localhost:8080/api/v1/documents/$ID" | jq '{status, docType, fields: .fields | length, grounding: .meta.groundingScore, kv: .meta.kv}'
```

```json
{
  "status": "ready",
  "docType": "receipt",
  "fields": 8,
  "grounding": 0.88,
  "kv": {
    "schemaId": "dip_receipt_extraction",
    "written": true,
    "fields": 8,
    "writes": 1,
    "keys": {
      "merchant": "merchant", "transaction_date": "transaction_date", "currency": "currency",
      "subtotal": "subtotal", "tax": "tax", "total": "total",
      "payment_method": "payment_method", "items": "items"
    },
    "values": {
      "merchant": "BREW & BEAN CAFE", "transaction_date": "2027-09-09T00:00:00Z",
      "currency": "USD", "subtotal": 30.6, "tax": 2.78, "total": 33.38,
      "payment_method": "VISA", "items": ["Flat white           $5.50", "Almond croissant     $6.20", "Avocado toast       $14.90", "Sparkling water      $4.00"]
    }
  }
}
```

`docType: "receipt"` and `fields: 8` confirm the classifier and the extractor ran.
`meta.groundingScore` and `meta.kv` are new since this lab was first written (DP-46):
every extraction config now provisions **two** Knowledge Box objects — a search
configuration and a key-value schema — and every successful extraction writes the
record's fields into the kv schema in the same pass. `written: true` and `fields: 8`
(matching the field count above) confirm that write went through. Exercise 6 covers
filtering documents by these kv fields and correcting them.

```bash
# 4. Export all three formats
curl -sS -D - -o /dev/null "http://localhost:8080/api/v1/documents/$ID/export?format=json" | grep -i content-type
curl -sS -D - -o /dev/null "http://localhost:8080/api/v1/documents/$ID/export?format=xml"  | grep -i content-type
curl -sS -D - -o /dev/null "http://localhost:8080/api/v1/documents/$ID/export?format=csv"  | grep -i content-type
```

```
content-type: application/json; charset=utf-8
content-type: application/xml; charset=utf-8
content-type: text/csv; charset=utf-8
```

```bash
# 5. Ask it a question — phrase it using the document's own vocabulary
curl -sS -X POST "http://localhost:8080/api/v1/documents/$ID/ask" \
     -H 'Content-Type: application/json' -d '{"question":"What is the total?"}' | jq .
```

```json
{
  "answer": "BREW & BEAN CAFE\n09/09/2027 14:32\nFlat white           $5.50\n… TOTAL               $33.38\nVISA ending 4417 — APPROVED",
  "sources": ["receipt.txt"],
  "citations": [
    {
      "paragraphId": "b07beea146114ccf8d126fda5e0eb11a/f/file/0-250",
      "text": "BREW & BEAN CAFE\n09/09/2027 14:32\n… TOTAL               $33.38\nVISA ending 4417 — APPROVED",
      "start": 0,
      "end": 250
    }
  ],
  "ms": 21
}
```

`citations[]` on `POST /documents/{id}/ask` is also new since this lab was written —
each entry names the paragraph and character range the answer was grounded in,
alongside the plain-text `sources` list that was already there.

```bash
# 6. Delete and confirm — DELETE destroys shared state (the KB resource too), so it
#    needs a credential even though everything above didn't. A session cookie is the
#    lowest-friction one: bootstrap it once, reuse it for any later write in this lab.
curl -sS -c /tmp/dip-cookies.txt -X POST http://localhost:8080/api/v1/session > /dev/null
curl -sS -b /tmp/dip-cookies.txt -o /dev/null -w '%{http_code}\n' \
     -X DELETE "http://localhost:8080/api/v1/documents/$ID"
curl -sS -o /dev/null -w '%{http_code}\n' "http://localhost:8080/api/v1/documents/$ID"
```

```
204
404
```

## Notes on the choices

- **Why `DELETE` needs a credential but nothing before it did**: uploads, reads,
  exports and `ask` all stay anonymous-friendly by design, so the quickstart works with
  zero setup — but `DELETE` also deletes the underlying Knowledge Box resource, a
  genuine write to shared state, so it goes through the `requireWriter` guard
  (`src/routes/guards.ts`). A session cookie is only one of four equivalent ways to
  satisfy it: a seeded `API_KEYS` entry, an API key minted through Settings → API keys
  or `POST /api/v1/admin/api-keys`, the `ADMIN_TOKEN` as a bearer token, or this session
  cookie from `POST /api/v1/session`. The session cookie is the lowest-friction one for
  a `curl` transcript, which is why the exercise uses it — it is not the only option.
- **Why `?config=auto`**: it's the default, and it exercises the classifier, not just
  the extractor — the record you get back demonstrates the whole pipeline, not a
  shortcut.
- **Why phrase the question using the document's own words** ("What is the total?"
  rather than, say, "How much did the customer pay?"): the mock ARAG's `/ask` retrieves
  by keyword overlap before it "reads" the (whole, via `full_resource`) document, same
  as the real Knowledge Box's retrieval step. A question that shares no vocabulary with
  the source text can come back as "not enough data" even though the answer is right
  there — this is the same "seed the retrieval query with real text" mechanic
  `buildQuerySeed()` exists to solve for the pipeline's own internal agent calls
  (`docs/architecture/arag-integration.md`, mechanic 3). It's a good habit for `ask`
  callers too.
- **Why check the `Content-Type` header on each export**, not just the status code: the
  contract (`src/openapi.ts`'s `/api/v1/documents/{id}/export` operation) documents
  three distinct response content types for one endpoint — verifying only `200` would
  miss a regression where, say, the CSV export started returning
  `application/octet-stream`.
- **Why look at `meta.kv` here at all**, when the task only asks you to notice
  `docType`: this is the field Exercise 6's filtering and correction work reads and
  writes, and `meta.kv.written` is the quickest signal that the kv projection — not just
  the extraction — actually happened. It's cheaper to notice it now than to debug a
  "why doesn't my filter match" question later without having seen a working example.
