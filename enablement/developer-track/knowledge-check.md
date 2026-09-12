# Developer track — knowledge check

15 questions. Try to answer from memory before revealing each answer; every answer
points at the file (and, where useful, the exact function) that proves it.

---

**1. Why does the pipeline wait for `waitSearchable` after `waitProcessed`, instead of
just polling until the resource status is `PROCESSED`?**

<details><summary>Answer</summary>

Because a resource's status flips to `PROCESSED` a few seconds *before* it actually
becomes retrievable. Extracting immediately after `PROCESSED` reliably returns empty
results. `waitSearchable` is a cheap `/find` poll that gates on actual retrievability,
not just the status field — and, since platform v0.1.3 (DP-19 in `DECISIONS.md`), it is
seeded with a real probe query rather than a generic one: the pipeline fetches
`extractedText` as soon as the resource is `PROCESSED` and passes it as
`waitSearchable`'s `query`, the same query-seeding idea `buildQuerySeed` applies to
every later agent call. A generic probe needed roughly 20 polls to see the resource on
the live KB; a seeded one hit on the first attempt, cutting the `process` stage from
~38 s to ~7 s in measurement. See the comment above stage 1 in `src/services/pipeline.ts`
and mechanic 4 in `docs/architecture/arag-integration.md`.
</details>

---

**2. Why are money fields (`subtotal`, `tax`, `total`, …) declared as JSON `string` in
every extraction schema, never as `number`?**

<details><summary>Answer</summary>

Forcing the model to emit a JSON `number` for a currency-formatted value like
`"$96,000.00"` is unreliable in practice — it frequently comes back as `0`. Declaring
the field as a string (`money()` in `src/services/schemas.ts`) captures the value
exactly as written, and `validateNormalize` in `src/services/agents.ts` deterministically
parses it into a number afterwards, keeping the original in `field.raw`. This is
robustness by construction, not a workaround left in by accident — it's documented as
one of the two "robustness choices" in `docs/architecture/arag-integration.md`.
</details>

---

**3. What happens if one pipeline stage (say, `entities`) throws?**

<details><summary>Answer</summary>

Nothing fatal. Every stage in `runPipeline` is wrapped by `ctx.stage(..., { soft: true,
... })`. A `soft` stage's failure is recorded as a stage error and emitted as an event,
but the pipeline continues with the best record it has — the job still reaches
`succeeded` with `status: "ready"`, just missing (or partially missing) that stage's
contribution. Only a genuinely fatal condition — the document record itself going
missing from the store — throws all the way out and fails the job (see the `try/catch`
in `DocumentsService`'s job handler in `src/services/documents.ts`). This is DP-09 in
`DECISIONS.md`: "a flaky entity or summary call should not lose a successful
extraction."
</details>

---

**4. `POST /api/v1/documents/{id}/ask` scopes a question to one document. Why is there
no equivalent "ask the whole knowledge base" endpoint?**

<details><summary>Answer</summary>

Because every uploaded document here becomes its own self-contained canonical record,
not a shared corpus to search across — the product's value proposition is "turn *this*
document into a validated record," not "build a searchable library." Scoping is done
with `resource_filters: [rec.resourceId]` on `/ask`
(`DocumentsService.ask` in `src/services/documents.ts`), which also means one caller's
documents never leak into another caller's answers by accident, since there is no code
path that omits the filter.
</details>

---

**5. Why does every agent call use `POST /ask` with `resource_filters: [resourceId]`,
never `POST /resource/{id}/ask`, even though the latter reads more naturally for
"ask about this one resource"?**

<details><summary>Answer</summary>

Verified live against the real Knowledge Box: the per-resource endpoint answers HTTP
500/503 the moment `rag_strategies: [{ name: "full_resource" }]` is present in the
request, while `/ask` + `resource_filters` accepts the identical payload and answers
correctly. Since `full_resource` grounding (the whole document in context, not just
retrieved snippets) is essential to reliable extraction, `resource_filters` on `/ask` is
the only usable shape — this is DP-03 in `DECISIONS.md` and mechanic 5 in
`arag-integration.md`.
</details>

---

**6. Why does `buildQuerySeed` use the document's own extracted text rather than a
fixed instruction like `"list all fields"` as the retrieval query?**

<details><summary>Answer</summary>

Even with `full_resource` grounding, ARAG's retrieval step still runs *first* to locate
the resource — an instruction-style query shares no vocabulary with the document and
can return `no_retrieval_data`, meaning the model never gets the document at all. Seeding
the query with the document's own opening text (`buildQuerySeed` in
`src/services/agents.ts`) guarantees a retrieval hit, after which `full_resource`
supplies the whole document as context regardless of which paragraph actually matched.
</details>

---

**7. Why does `document.id` equal `document.resourceId`?**

<details><summary>Answer</summary>

A deliberate design decision (DP-01): one opaque id for API callers, no separate mapping
table between "our id" and "ARAG's id," and `DELETE /api/v1/documents/{id}` can delete
the KB resource directly without a lookup. The consequence: if a document is ever
re-ingested, it gets a *new* id — you can't re-upload into the same id, so the old
record must be deleted first.
</details>

---

**8. Extraction retries once if the model returns zero fields. Why is the retry
triggered by "empty result," rather than by an HTTP error from ARAG?**

<details><summary>Answer</summary>

An empty `answer_json` isn't a network or server error — the call succeeds, but the
model came back with nothing usable, most often because of residual indexing lag right
after `waitSearchable` passes. `runPipeline`'s extract and entities stages both check
`if (f.length === 0)` and retry once after a short sleep — this guards specifically
against a timing race, not a failure the HTTP client would ever see or retry on its own.
</details>

---

**9. Why are the entity and summary agent calls run sequentially rather than
concurrently, even though they're independent?**

<details><summary>Answer</summary>

Two simultaneous `full_resource` generations against the *same* resource have been
observed to make one of the two calls return empty. `runPipeline` deliberately runs
`entities` then `summary` in sequence, trading roughly two seconds of extra latency for
reliability — a comment directly above that section in `src/services/pipeline.ts`
explains the trade-off.
</details>

---

**10. What is the difference between `?config=auto`, `?config=<id>`, and
`?config=agent` on `POST /api/v1/documents`?**

<details><summary>Answer</summary>

- `auto` (the default): an agent classifies the document first, then the matching
  built-in schema is used — classification and extraction are both live model calls.
- `<config id>` (a built-in doc type or a custom config id): forces that schema and
  skips classification entirely (`record.meta.forced = true`).
- `agent`: skips *live extraction* altogether and instead reads fields an ARAG **Data
  Augmentation "ask" agent** already persisted on the resource (via
  `Agents.readPersistedFields`, a plain `getResource` call, not an `/ask` call). If the
  resource carries no agent output, the pipeline logs a `classify` `skip` event and
  falls back to live extraction.

See `runPipeline` in `src/services/pipeline.ts` for exactly where these three paths
diverge.
</details>

---

**11. A custom extraction config is created via `POST /api/v1/extraction-configs`.
What two things happen as part of that one call, and why does the response already say
`"provisioned": true` without a separate provisioning step?**

<details><summary>Answer</summary>

`ConfigsService.create` (1) persists the config to the `extraction-configs` collection
under `DATA_DIR` and (2) immediately provisions it as a stored ARAG search configuration
(`ensureExtractionConfig`, which `POST`s — falling back to `PATCH` on 409 — a
`kind: "ask"` configuration named `dip_custom_<slug>`). Provisioning is idempotent by
design (STANDARDS §2: "provisioning endpoints are idempotent by design (safe to
re-run)"), which is also why `POST /api/v1/admin/provision` can be called at any time
(boot, after a KB reset, after a model change) without side effects beyond
re-establishing the same configuration.
</details>

---

**12. Why do the built-in extraction schemas live as *stored ARAG search
configurations* rather than being sent inline as part of every extraction request?**

<details><summary>Answer</summary>

So the model, the grounding prompt and the JSON Schema live server-side in the
Knowledge Box, inspectable and tunable directly in the ARAG dashboard, and shared by
every client of that KB — not duplicated in this product's own code and drifting out of
sync with what's actually configured. Extraction then only needs to send the
per-request bits (`query`, `resource_filters`, `max_tokens`, `temperature`) plus the
`search_configuration` name.
</details>

---

**13. Why does the upload path validate the MIME type against an explicit allowlist
before anything reaches ARAG, rather than letting ARAG reject unsupported files?**

<details><summary>Answer</summary>

Two reasons: it's a security boundary (arbitrary bytes should never reach the Knowledge
Box unchecked — the prototype this product replaced pushed anything uploaded straight
into the KB), and it's a better failure mode for the caller — a `415` with the full
allowlist in the problem detail, returned instantly, versus an opaque upstream error
after a network round trip. See `ALLOWED_MIME` and `DocumentsService.create` in
`src/services/documents.ts`.
</details>

---

**14. `GET /api/v1/jobs/{id}/events` replays past events before streaming new ones.
Why does that matter for a client that connects to a job already in progress, or one
that reconnects after a disconnect?**

<details><summary>Answer</summary>

The job itself — not the SSE connection — is the unit of work; the stream is only a
*view* of it (`registerJobRoutes` in `src/routes/jobs.ts`: "for (const e of job.events)
sse.send(...)" before subscribing to new events). A client that opens the stream late,
or reconnects after a drop, still sees the complete history of the pipeline from stage
one, and then picks up live events exactly where the job currently is — it never misses
a stage, and it never has to guess whether it "arrived too late."
</details>

---

**15. What does `assert.deepEqual(testing.checkResponse(openapi, path, method, status,
body), [])` actually verify, and why does nearly every integration test in
`test/api.test.ts` call it?**

<details><summary>Answer</summary>

It validates the actual response body against the JSON Schema declared for that exact
operation/status pair in `src/openapi.ts`, and returns a list of schema-mismatch
errors — an empty array means "this response really matches the documented contract,"
not just "the test's own hand-written assertions happened to pass." Calling it on every
response is what makes these **contract** tests rather than plain integration tests:
STANDARDS §8 requires spec-lint-clean, every-route-documented, and
success-responses-validate as three separate, mandatory checks, and this one line
covers the third.
</details>
