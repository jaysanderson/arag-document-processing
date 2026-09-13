# Exercise 1 — Drive the API from the command line

**Time budget:** 20 minutes.
**Matches:** LAB.md Section 1.

## Task

Using only `curl` (no browser, no admin panel), against your locally running instance
(`make dev`, mock ARAG), perform the full document lifecycle for
`public/samples/receipt.txt`:

1. Upload it with `?config=auto`.
2. Watch (or poll) its job until it reaches a terminal status.
3. Fetch the canonical record and confirm the classifier assigned `docType: "receipt"`.
4. Export it in all three built-in formats (`json`, `xml`, `csv`).
5. Ask it: `"What is the total?"` and note the answer and its citations.
6. Delete it, then confirm a subsequent `GET` returns `404`.

Every extraction config — this one included — now provisions a key-value schema
alongside its search configuration (DP-46), and every finished record carries a
grounding score and a key-value write summary in `meta`. You are not doing anything
extra to get these; step 3 already shows them. Exercise 6 (filtering and correcting
key-value fields) picks up from here.

## Acceptance criteria

- [ ] The upload returns `202 Accepted` with both a `document` and a `job` in the body.
- [ ] The job's terminal `status` is `succeeded` (not `failed` or `cancelled`).
- [ ] `GET /api/v1/documents/{id}` returns `docType: "receipt"` and `status: "ready"`.
- [ ] The record's `meta.groundingScore` is present, and `meta.kv.written` is `true`.
- [ ] All three export formats return `200` with the correct `Content-Type`
      (`application/json; charset=utf-8`, `application/xml; charset=utf-8`,
      `text/csv; charset=utf-8`).
- [ ] The `ask` call returns a non-empty `answer`, a `sources` array containing
      `receipt.txt`, and a non-empty `citations` array.
- [ ] `DELETE` (with a session cookie — see the hint below) returns `204`; the
      follow-up `GET` returns `404`.

## Hints

- The document id and the ARAG resource id are the same string — you only need to
  capture one id from the upload response.
- `jq -r .document.id` / `jq -r .job.id` pull the two ids you need out of the upload
  response in one line each.
- Everything up to and including the `ask` call is anonymous-friendly — no credential
  needed. `DELETE`, though, destroys shared state (it deletes the KB resource too), so
  it requires one: `curl -c cookies.txt -X POST .../api/v1/session` once, then pass
  `-b cookies.txt` on the `DELETE` call.
- The SSE stream (`GET /api/v1/jobs/{id}/events`) closes itself once the job reaches a
  terminal status — you don't need to `Ctrl-C` it, but on a slow terminal `curl -sN`
  without a timeout is fine too since the mock finishes in milliseconds.
- `export?format=` takes a query parameter, not a header — `Accept` is ignored here.

If you get stuck, [`solutions/01-drive-the-api.md`](../solutions/01-drive-the-api.md) has the exact command sequence with
real output.
