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
    "id": "…", "resourceId": "…", "jobId": "…",
    "filename": "receipt.txt", "contentType": "text/plain",
    "status": "pending", "docType": "generic",
    "fields": [], "entities": [], "tags": [], "issues": []
  },
  "job": { "id": "…", "kind": "process-document", "status": "queued" }
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
curl -sS "http://localhost:8080/api/v1/documents/$ID" | jq '{status, docType, fields: .fields | length}'
```

```json
{ "status": "ready", "docType": "receipt", "fields": 8 }
```

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
  "ms": 2
}
```

```bash
# 6. Delete and confirm
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE "http://localhost:8080/api/v1/documents/$ID"
curl -sS -o /dev/null -w '%{http_code}\n' "http://localhost:8080/api/v1/documents/$ID"
```

```
204
404
```

## Notes on the choices

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
