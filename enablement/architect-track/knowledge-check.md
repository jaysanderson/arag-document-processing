# Architect track — knowledge check

12 questions, architect-level: judgement and trade-offs, not syntax. Each answer points
at where the fact lives in the codebase or the companion documents.

---

**1. A customer asks whether they can run three instances of this product behind a load
balancer for high availability. What's the real answer, and why?**

<details><summary>Answer</summary>

No, not as built, and it's an architectural fact, not a configuration limitation. State
(documents, jobs, extraction configs) lives in JSON files loaded fully into each
process's memory and rewritten atomically to one Fly volume
(`vendor/arag-platform/src/store/jsonstore.ts`). Three instances would each hold a
diverging in-memory copy and independently overwrite the same files — a correctness
bug, not a performance one. High availability here means a fast restart of one
instance (`min_machines_running = 1`, Fly's health checks), not horizontal replication.
Making this genuinely HA requires replacing the JSON store with a shared database — see
`sizing-deployment.md`, "What to change first for scale," step 4.
</details>

---

**2. Why does extraction call a *stored* ARAG search configuration
(`search_configuration: "dip_invoice_extraction"`) instead of sending the model,
prompt and JSON Schema inline on every request?**

<details><summary>Answer</summary>

So the extraction contract — which model, which grounding strategy, which prompt,
which schema — lives server-side in the Knowledge Box, inspectable and tunable in the
ARAG dashboard, and shared identically by every client of that KB. The trade-off: the
configuration name is global to the KB, so two tenants sharing one KB cannot have
different models answer to the same schema name (WORKSHOP.md, Part 2.2 and Scenario
B) — a real multi-tenancy constraint worth surfacing before a shared-KB deployment is
approved.
</details>

---

**3. Why is `GET /api/v1/jobs/{id}/events` (SSE) described as "a view of the job, not
the work itself" — what would break if it weren't?**

<details><summary>Answer</summary>

If the SSE handler *were* the work (as in the prototype this product replaced — a
`GET` handler that ran the pipeline as a side effect), a client disconnecting mid-run
would either kill the extraction or leave it running with no client left to receive the
finished result. Here, the `JobManager` runs the pipeline independent of any SSE
subscriber; the endpoint replays history and then streams live events to whoever is
currently listening, and a document is fully processed and queryable via
`GET /api/v1/documents/{id}` whether or not anyone ever opened the event stream.
</details>

---

**4. Count the LLM calls for a single document processed with `?config=auto`, assuming
no retries fire. Now do the same for `?config=agent`. What's the practical implication
of the difference?**

<details><summary>Answer</summary>

`auto`: 4 calls (`classify`, `extract`, `entities`, `summary`). `agent`: 2 calls
(`entities`, `summary` only — reading DA-agent-persisted fields is a `getResource` call,
not an `/ask` call). The practical implication: `agent` mode is roughly half the
per-document LLM cost of `auto`, provided the customer has already configured a
persistent Data Augmentation agent in the KB dashboard to do the extraction work
up front. This is a genuine cost/architecture trade-off to raise in any deployment
conversation with a customer already using — or willing to configure — DA agents; see
`design-review-checklist.md`'s cost section for the full table including forced-config
mode.
</details>

---

**5. Why does every agent call in this product use `POST /ask` with
`resource_filters: [resourceId]`, and never `POST /resource/{id}/ask`, even though the
per-resource endpoint looks like the more natural fit?**

<details><summary>Answer</summary>

A live-verified ARAG quirk: the per-resource ask endpoint answers HTTP 500/503 the
moment `rag_strategies: [{ name: "full_resource" }]` is present, while `/ask` with
`resource_filters` accepts the identical payload and works. Since `full_resource`
grounding (the whole document in context) is essential for reliable extraction, this
isn't a stylistic choice — it's the only shape that functions. This is exactly the kind
of hard-won, non-obvious operational fact a design review should expect to find
documented (it is: `docs/architecture/arag-integration.md`, mechanic 5, and DP-03 in
`DECISIONS.md`) rather than rediscovered the hard way in a customer's production
environment.
</details>

---

**6. A customer's security team asks: "if we delete a document through your API, is it
really gone?" What's the precise answer?**

<details><summary>Answer</summary>

`DELETE /api/v1/documents/{id}` removes the local JSON record **and** calls
`deleteResource` on the ARAG Knowledge Box for the same id (the document id and the KB
resource id are the same string by design — DP-01). So yes, for anything deleted
through that endpoint or through `admin/purge`. The caveat: there is no automatic
retention sweep — a document nobody ever calls `DELETE` or `purge` on stays in the KB
indefinitely. "Gone when deleted" is accurate; "gone by default after some time" is not,
unless retention is actively scheduled (`design-review-checklist.md`, data-protection
section).
</details>

---

**7. Why does the classifier's `max_tokens` budget (300) look generous for what sounds
like a small structured response (`doc_type` + `confidence`)? What would happen if it
were set too low?**

<details><summary>Answer</summary>

A truncated structured (`answer_json_schema`) response is **invalid JSON**, and an
invalid response yields **no** `answer_json` at all — not a partial one. An
under-budgeted `max_tokens` doesn't degrade gracefully to "confidence is missing"; it
silently demotes every document to the `generic` doc type (the classifier's fallback
when it can't parse a valid `doc_type`). This is why every structured-output agent call
in this product budgets well above its expected output size — a design-review-worthy
pattern to recognise anywhere `answer_json_schema` is used, not just here.
</details>

---

**8. What is `TRUST_PROXY` for, and what's the concrete failure mode of setting it
wrong in a given deployment?**

<details><summary>Answer</summary>

It tells the app which header identifies the real client IP for per-IP rate limiting:
`fly` (trust `Fly-Client-IP`, the default), `xff` (trust the first
`X-Forwarded-For` entry), or `none` (trust nothing — use the raw socket peer). Set it
to `fly` behind a different reverse proxy (one that doesn't set `Fly-Client-IP`), and
every request looks like it comes from the same address as far as this header is
concerned — rate limiting then either keys everyone into one shared bucket (if it falls
back to the connecting peer, which on a proxied deployment is the proxy itself) or
fails to identify abusive clients individually. This is an easy thing to get wrong when
a product built for Fly gets deployed behind a different edge/proxy layer — check it
explicitly in any non-Fly deployment.
</details>

---

**9. Why is `provisioning` (writing ARAG search configurations) designed to be
idempotent, and what operational scenario specifically depends on that?**

<details><summary>Answer</summary>

Provisioning `POST`s a configuration and falls back to `PATCH` on `409` — safe to call
any number of times with the same result. It runs automatically (non-blocking) at
boot, on every custom-config creation, and on demand via
`POST /api/v1/admin/provision`. The scenario that specifically depends on this: a KB
reset or migration to a new `ARAG_KB_ID` leaves a KB with zero search configurations —
without idempotent, on-demand re-provisioning, recovering from that would require
redeploying the whole product (to re-trigger boot-time provisioning) rather than one
admin API call. `design-review-checklist.md`'s reliability section calls this out as a
runbook that should be exercised once before it's needed for real.
</details>

---

**10. This product has zero runtime dependencies. What does that buy an architect
evaluating it, concretely — beyond "fewer things to patch"?**

<details><summary>Answer</summary>

A meaningfully smaller and more auditable supply-chain surface (`bun audit` in CI has
almost nothing to report), a Docker image that needs no build step (TypeScript runs
directly on Node's erasable-syntax support), and — practically — a `git clone` +
`make install` + `make dev` that has no version-resolution surprises across
environments, because there's very little to resolve. For an architect, the concrete
evaluation question this answers is "how much of this product's behaviour could change
underneath us via a transitive dependency update we didn't review?" — here, the answer
is close to none, since the only third-party code that ships to production is the
vendored platform (`vendor/arag-platform/`), which is explicitly never edited in place
and version-pinned via `PLATFORM_VERSION`.
</details>

---

**11. Why do the medical-claims-oriented schemas (`medical_claim`, `preauthorisation`)
raise a different bar in a design review than, say, `receipt` or `resume`?**

<details><summary>Answer</summary>

They're specifically designed to extract health-adjacent PII/PHI (member numbers,
diagnosis codes, patient names, claim amounts) — and the underlying source *document*
persists in the ARAG Knowledge Box (a third party's infrastructure) until explicitly
deleted, on top of the extracted fields in this product's own JSON store. A deployment
intending to process real claims data needs an explicit answer, before go-live, to
"does the KB's data-handling and region satisfy our compliance obligations for this
data class" — a question that simply doesn't arise the same way for a resume or a
retail receipt. This is the first item under data protection in
`design-review-checklist.md` for exactly this reason.
</details>

---

**12. A customer wants documents pushed to their ERP the moment processing finishes,
without polling. What should an architect actually recommend, given what this product
supports today?**

<details><summary>Answer</summary>

There is no outbound webhook in this product — recommending "just build a webhook
receiver on their end" presumes a feature that doesn't exist. The two real options are
(a) polling `GET /api/v1/jobs?status=succeeded` or `GET /api/v1/documents?status=ready`
on a short interval, which needs zero product changes and is adequate at the volumes
this product currently targets, or (b) a small bridge process, owned by the integrator,
that holds the SSE connection (`GET /api/v1/jobs/{id}/events`) and translates events
into whatever the ERP's own ingestion mechanism expects. Building outbound webhooks
*into this product* is a legitimate feature request to route to the product owner as a
roadmap item — not something to improvise into a single customer's deployment.
(WORKSHOP.md, Scenario A.)
</details>
