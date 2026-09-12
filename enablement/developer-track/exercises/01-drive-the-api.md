# Exercise 1 — Drive the API from the command line

**Time budget:** 15 minutes.
**Matches:** LAB.md Section 1.

## Task

Using only `curl` (no browser, no admin panel), against your locally running instance
(`make dev`, mock ARAG), perform the full document lifecycle for
`public/samples/receipt.txt`:

1. Upload it with `?config=auto`.
2. Watch (or poll) its job until it reaches a terminal status.
3. Fetch the canonical record and confirm the classifier assigned `docType: "receipt"`.
4. Export it in all three built-in formats (`json`, `xml`, `csv`).
5. Ask it: `"What is the total?"` and note the answer.
6. Delete it, then confirm a subsequent `GET` returns `404`.

## Acceptance criteria

- [ ] The upload returns `202 Accepted` with both a `document` and a `job` in the body.
- [ ] The job's terminal `status` is `succeeded` (not `failed` or `cancelled`).
- [ ] `GET /api/v1/documents/{id}` returns `docType: "receipt"` and `status: "ready"`.
- [ ] All three export formats return `200` with the correct `Content-Type`
      (`application/json; charset=utf-8`, `application/xml; charset=utf-8`,
      `text/csv; charset=utf-8`).
- [ ] The `ask` call returns a non-empty `answer` and a `sources` array containing
      `receipt.txt`.
- [ ] `DELETE` returns `204`; the follow-up `GET` returns `404`.

## Hints

- The document id and the ARAG resource id are the same string — you only need to
  capture one id from the upload response.
- `jq -r .document.id` / `jq -r .job.id` pull the two ids you need out of the upload
  response in one line each.
- The SSE stream (`GET /api/v1/jobs/{id}/events`) closes itself once the job reaches a
  terminal status — you don't need to `Ctrl-C` it, but on a slow terminal `curl -sN`
  without a timeout is fine too since the mock finishes in milliseconds.
- `export?format=` takes a query parameter, not a header — `Accept` is ignored here.

If you get stuck, [`solutions/01-drive-the-api.md`](../solutions/01-drive-the-api.md) has the exact command sequence with
real output.
