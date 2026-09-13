# Developer track — knowledge check

18 questions, about 25 minutes. Try to answer from memory before revealing each answer;
every answer points at the file (and, where useful, the exact function) that proves it.

---

**1. Why does the pipeline wait for `waitSearchable` after `waitProcessed`, instead of just
polling until the resource status is `PROCESSED`?**

<details><summary>Answer</summary>

Because a resource's status flips to `PROCESSED` a few seconds *before* it actually becomes
retrievable. Extracting immediately after `PROCESSED` reliably returns empty results.
`waitSearchable` is a cheap `/find` poll that gates on actual retrievability, not just the
status field — and, since DP-19, it is seeded with a real probe query rather than a generic
one: the pipeline fetches `extractedText` as soon as the resource is `PROCESSED` and passes
it as `waitSearchable`'s `query`, the same query-seeding idea `buildQuerySeed` applies to
every later agent call. A generic probe needed roughly 20 polls to see the resource on the
live KB; a seeded one hit on the first attempt, cutting the `process` stage from ~38 s to
~7 s in measurement. See the comment above stage 1 in `src/services/pipeline.ts` and
mechanic 4 in `docs/architecture/arag-integration.md`.
</details>

---

**2. Why are money fields declared as JSON `string` in every extraction schema, never as
`number` — and why does the same field then report `kvType: "float"`?**

<details><summary>Answer</summary>

Two different questions with two different right answers, which is why both annotations sit
on one field.

`type` is what the **model** is asked for. Forcing a model to emit a JSON `number` for a
currency-formatted value like `"$96,000.00"` is unreliable in practice — it frequently comes
back as `0`. Declaring a string (`money()` in `src/services/schemas.ts`) captures the value
exactly as written, and `validateNormalize` in `src/services/agents.ts` deterministically
parses it into a number afterwards, keeping the original in `field.raw`.

`kvType` is what the **Knowledge Box** stores and filters on. The heuristic mapping would
make a captured string a kv `text` field, and a `text` field supports only `eq` — so
"every invoice over $10,000" would be inexpressible for the most valuable field on the most
common document. `money()` therefore annotates `kv: { type: "float" }`, and `date()`
annotates `kv: { type: "date" }` (DP-48). The annotation is stripped before the schema is
sent to ARAG as `answer_json_schema`, so the model never sees it.
</details>

---

**3. What happens if one pipeline stage (say, `entities`) throws?**

<details><summary>Answer</summary>

Nothing fatal. Every stage in `runPipeline` is wrapped by `ctx.stage(..., { soft: true, …
})`. A `soft` stage's failure is recorded as a stage error and emitted as an event, but the
pipeline continues with the best record it has — the job still reaches `succeeded` with
`status: "ready"`, just missing (or partially missing) that stage's contribution. Only a
genuinely fatal condition — the document record itself going missing from the store —
throws all the way out and fails the job. This is DP-09: "a flaky entity or summary call
should not lose a successful extraction."
</details>

---

**4. There are two ask endpoints. Why do they ground differently?**

<details><summary>Answer</summary>

`POST /api/v1/documents/{id}/ask` answers from **one** document, scoped with
`resource_filters: [rec.resourceId]` and grounded with `full_resource` — the whole document
in the model's context, not just retrieved snippets. That is affordable and correct for one
document, and it is what makes a single-document answer trustworthy.

`POST /api/v1/ask` answers across a **filtered set** of documents, and takes the Documents
list's own filters by their query-parameter names — so "ask the twelve invoices from last
week" is the list already on screen. It grounds by **retrieval over the set**, not
`full_resource`: across dozens of documents the whole-document strategy would be an
enormous prompt and a slow, expensive call. Citations come back mapped to this product's own
document ids, so "show me where" still works across documents.

Both have their own tight rate-limit bucket rather than sharing the public limit, because
every ask is a real generative call against the Knowledge Box and costs money in a way a
read does not (DP-41).
</details>

---

**5. Why does every agent call use `POST /ask` with `resource_filters: [resourceId]`, never
`POST /resource/{id}/ask`, even though the latter reads more naturally?**

<details><summary>Answer</summary>

Verified live against the real Knowledge Box: the per-resource endpoint answers HTTP
500/503 the moment `rag_strategies: [{ name: "full_resource" }]` is present in the request,
while `/ask` + `resource_filters` accepts the identical payload and answers correctly.
Since `full_resource` grounding is essential to reliable extraction, `resource_filters` on
`/ask` is the only usable shape — DP-03, and mechanic 5 in
`docs/architecture/arag-integration.md`.
</details>

---

**6. Why does `buildQuerySeed` use the document's own extracted text rather than a fixed
instruction like `"list all fields"` as the retrieval query?**

<details><summary>Answer</summary>

Even with `full_resource` grounding, ARAG's retrieval step still runs *first* to locate the
resource — an instruction-style query shares no vocabulary with the document and can return
`no_retrieval_data`, meaning the model never gets the document at all. Seeding the query
with the document's own opening text (`buildQuerySeed` in `src/services/agents.ts`)
guarantees a retrieval hit, after which `full_resource` supplies the whole document as
context regardless of which paragraph actually matched. It is a good habit for `ask` callers
too: a question phrased in the document's own vocabulary retrieves; one phrased in
paraphrase may not.
</details>

---

**7. Why does `document.id` equal `document.resourceId`?**

<details><summary>Answer</summary>

A deliberate design decision (DP-01): one opaque id for API callers, no separate mapping
table between "our id" and "ARAG's id", and `DELETE /api/v1/documents/{id}` can delete the
KB resource directly without a lookup. The consequence: if a document is ever re-ingested it
gets a *new* id — you cannot re-upload into the same id, so the old record must be deleted
first. It is also why the key-value filter's matching resource ids can be intersected with
the local list without any translation step.
</details>

---

**8. Extraction retries once if the model returns zero fields. Why is the retry triggered by
"empty result" rather than by an HTTP error from ARAG?**

<details><summary>Answer</summary>

An empty `answer_json` is not a network or server error — the call succeeds, but the model
came back with nothing usable, most often because of residual indexing lag right after
`waitSearchable` passes. `runPipeline`'s extract and entities stages both check
`if (f.length === 0)` and retry once after a short sleep. This guards specifically against a
timing race, not a failure the HTTP client would ever see or retry on its own.
</details>

---

**9. Why are the entity and summary agent calls run sequentially rather than concurrently,
even though they are independent?**

<details><summary>Answer</summary>

Two simultaneous `full_resource` generations against the *same* resource have been observed
to make one of the two calls return empty. `runPipeline` deliberately runs `entities` then
`summary` in sequence, trading roughly two seconds of extra latency for reliability — a
comment directly above that section in `src/services/pipeline.ts` explains the trade-off.
</details>

---

**10. What is the difference between `?config=auto`, `?config=<id>` and `?config=agent` on
`POST /api/v1/documents`?**

<details><summary>Answer</summary>

- `auto` (the default): an agent classifies the document first, then the matching built-in
  schema is used — classification and extraction are both live model calls.
- `<config id>` (a built-in doc type or a custom config id): forces that schema and skips
  classification entirely (`record.meta.forced = true`).
- `agent`: skips *live extraction* altogether and instead reads fields an ARAG **Data
  Augmentation "ask" agent** already persisted on the resource (via
  `Agents.readPersistedFields`, a plain `getResource` call, not an `/ask` call). If the
  resource carries no agent output, the pipeline logs a `classify` `skip` event and falls
  back to live extraction.

See `runPipeline` in `src/services/pipeline.ts` for exactly where these three paths diverge.
</details>

---

**11. An extraction config provisions *two* objects in the Knowledge Box. What are they,
what does each answer, and when is the config considered provisioned?**

<details><summary>Answer</summary>

| Object | Id | Answers |
|---|---|---|
| Stored search configuration (`kind: "ask"`) | `dip_<schema>` | *How is this document read?* It pins the generative model, the `full_resource` RAG strategy, the grounding prompt and the `answer_json_schema` the model must fill. |
| Key-value schema | `dip_<schema>` | *How is the result kept, and what can be asked of it?* Typed, validated fields written onto the resource itself. |

They share an id on purpose (DP-46), so an operator reads the two KB namespaces as one
pair. `ExtractionConfig.provisioning.state` is `provisioned` only when **both** are in
place, and each is reported separately so a half-failure is visible in the Configs list
rather than discovered later when a filter silently returns nothing.

Both are created in the same call as the config itself — which is why the `POST` response
already says `provisioned: true` with no separate step — and both are re-provisioned on
edit (deleting the orphan on a rename) and deleted on delete. The mapping from the config's
JSON Schema to the key-value schema is **derived on every call, not stored**, so it cannot
drift from the config that defines it.
</details>

---

**12. Why do the built-in extraction schemas live as *stored* ARAG search configurations
rather than being sent inline on every extraction request?**

<details><summary>Answer</summary>

So the model, the grounding prompt and the JSON Schema live server-side in the Knowledge
Box, inspectable and tunable directly in the ARAG dashboard, and shared by every client of
that KB — not duplicated in this product's own code and drifting out of sync with what is
actually configured. Extraction then only needs to send the per-request bits (`query`,
`resource_filters`, `max_tokens`, `temperature`) plus the `search_configuration` name.
Provisioning is idempotent by design (`POST`, falling back to `PATCH` on 409), which is why
`POST /api/v1/admin/provision` can be called at any time — boot, after a KB reset, after a
model change — without side effects beyond re-establishing the same configuration.
</details>

---

**13. Nothing in a provisioned key-value schema is marked `required`, even though the
config's own `required` list is honoured everywhere else. Why?**

<details><summary>Answer</summary>

Verified live: ARAG refuses the **entire** key-value write when a required key is absent,
and a key-value write is a **full replace**. Compose those two facts and one un-extracted
required field on one faded scan would cost that resource *every value the pipeline did
extract* — not the missing field, all of them. A required flag that turns a partial success
into a total loss is not a safety property.

So `provisionable()` in `src/services/configs.ts` strips every `required` flag before
provisioning (DP-47). The JSON-Schema → kv mapper still projects `required` faithfully —
the policy lives in one function, and the mapper stays truthful.

The requirement survives everywhere it is useful: the `answer_json_schema` sent to the model
keeps its `required` list, so the extraction still asks for the field; the record still
reports `"required by the extraction config but not extracted"` as a skip
(`src/services/pipeline.ts`); and the grounding score still counts the gap.
</details>

---

**14. You correct a field from `PO-88421` to `PO-88422`. A `kv=` filter on the *old* value
still returns the document. Is that a bug?**

<details><summary>Answer</summary>

No — it is a Knowledge Box behaviour the product cannot fix and therefore reports. Verified
live and undocumented upstream: overwriting a key-value field does **not** remove the
previous value from the KB's filter index. The index accumulates every value ever written
to that field on that resource, and there is no index-purge call.

The product's response (DP-51) is to treat key-value writes as **write-once per resource** —
the pipeline writes once, when the record finishes, and nothing else writes in the normal
path — and, when a second write is unavoidable (a human correction, a reprocess), to make it
visible rather than silent: `meta.kv.writes` counts it, `meta.kv.filterIndexStale` goes
`true`, and `meta.kv.superseded[]` lists the values the resource still matches a filter on
despite having replaced them. The record view states it in words, and the mock reproduces
the trap so it is testable offline.

The design rule that follows: a key-value filter is reliable over immutable data and
unreliable over mutable data. See the architect track's
[`key-value-schema-design.md`](../architect-track/key-value-schema-design.md).
</details>

---

**15. A setting reports `"source": "store"`. What are the other two values it could report,
and why does `GET /api/v1/admin/settings` return an `applied` block as well as the field
list?**

<details><summary>Answer</summary>

The three layers are `default` (the built-in fallback), `env` (the deployment's
environment), and `store` (an in-product edit, which **overrides** the environment and
survives a restart). Environment variables are defaults; the store is the override; the
effective value is live (DP-52). `envVar` and `envSet` are also reported per field, because
a reset only has somewhere to fall back *to* when the environment actually sets the field.

`applied` is separate because the field list is **what the store says** and `applied` is
**what the running objects say** — it is read back from the live ARAG client, the live rate
limiter, the live upload ceiling and the retention scheduler. "I saved it" and "it is in
force" are two different claims, and a settings screen that conflates them cannot tell a
partner whether their rebrand actually landed. `retention.schedulerActive` and `nextRunAt`
are the clearest case: no stored value can tell you whether a timer is actually running.

A `PATCH` is validated in full before anything is written, so one bad value fails the whole
patch rather than applying half of it, and every change is written to the audit log.
</details>

---

**16. What happens to a field's `confidence`, its `verified` state and the record's
`meta.groundingScore` when a human corrects it?**

<details><summary>Answer</summary>

The `confidence` is **dropped entirely** (so is `raw`). A confidence is the model's stated
certainty about a value the model produced, and a corrected value is not that value;
carrying the old number forward would attach the model's certainty to a human's typing.

`verified` is recomputed by re-checking the corrected value against the document's own
extracted text with exactly the same evidence contract the pipeline uses — `exact`,
`normalised` or `unverified`. A value the document does contain earns a new quote; one it
does not gets none, and the stale quote is removed rather than left pointing at the wrong
string.

`meta.groundingScore` can therefore **fall**, and that is the honest outcome. A corrected
field stays in the denominator and counts in the numerator only when its new value verifies
(DP-49). The alternatives were worse: excluding corrected fields quietly moves the
goalposts, since a reviewer could raise a record's score by correcting its worst fields.
`meta.correctedFields` is reported alongside the score so the trust strip can say "11 of 12
fields carry a verified quote · 1 corrected by a reviewer" rather than hiding the human's
hand.

The previous value, the reason and the actor are kept on an append-only history. Undoing a
correction is recorded as a *new* correction, so the revert is exactly as attributable as
the change it undoes.
</details>

---

**17. Why does the upload path validate the MIME type against an explicit allowlist before
anything reaches ARAG, rather than letting ARAG reject unsupported files?**

<details><summary>Answer</summary>

Two reasons: it is a security boundary (arbitrary bytes should never reach the Knowledge Box
unchecked — the prototype this product replaced pushed anything uploaded straight into the
KB), and it is a better failure mode for the caller — a `415` with the full allowlist in the
problem detail, returned instantly, versus an opaque upstream error after a network round
trip. See `ALLOWED_MIME` and `DocumentsService.create` in `src/services/documents.ts`. The
size ceiling next to it is now an editable setting (`limits.maxUploadBytes`) read through a
getter rather than a boot-time constant, so an operator can change it without a restart and
the `413` names the number actually in force.
</details>

---

**18. What does `assert.deepEqual(testing.checkResponse(openapi, path, method, status,
body), [])` actually verify, and why does nearly every integration test call it?**

<details><summary>Answer</summary>

It validates the actual response body against the JSON Schema declared for that exact
operation/status pair in `src/openapi.ts`, and returns a list of schema-mismatch errors — an
empty array means "this response really matches the documented contract", not just "the
test's own hand-written assertions happened to pass". Calling it on every response is what
makes these **contract** tests rather than plain integration tests: STANDARDS §8 requires
spec-lint-clean, every-route-documented and success-responses-validate as three separate,
mandatory checks, and this one line covers the third. It is also what keeps the API explorer
honest, since that screen is generated from the same `/api/v1/openapi.json` rather than
hand-written (DP-53).
</details>
