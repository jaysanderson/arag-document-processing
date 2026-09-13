# Architect track — knowledge check

15 questions, about 25 minutes, architect-level: judgement and trade-offs, not syntax.
Each answer points at where the fact lives in the codebase or the companion documents
([`WORKSHOP.md`](WORKSHOP.md), [`key-value-schema-design.md`](key-value-schema-design.md),
[`sizing-deployment.md`](sizing-deployment.md),
[`design-review-checklist.md`](design-review-checklist.md)).

---

**1. A customer asks whether they can run three instances of this product behind a load
balancer for high availability. What's the real answer, and why?**

<details><summary>Answer</summary>

No, not as built, and it's an architectural fact, not a configuration limitation. State
(documents, jobs, extraction configs, and — since this pass — settings overrides, API
keys and the audit log) lives in JSON files loaded fully into each process's memory and
rewritten atomically to one Fly volume
(`vendor/arag-platform/src/store/jsonstore.ts`). Three instances would each hold a
diverging in-memory copy and independently overwrite the same files — a correctness
bug, not a performance one. High availability here means a fast restart of one
instance (`min_machines_running = 1`, Fly's health checks), not horizontal replication.
Making this genuinely HA requires replacing the JSON store with a shared database — see
[`sizing-deployment.md`](sizing-deployment.md), "What to change first for scale," step 5.
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
different models answer to the same schema name ([`WORKSHOP.md`](WORKSHOP.md), Part 2.2
and Scenario B) — a real multi-tenancy constraint worth surfacing before a shared-KB
deployment is approved.
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

**4. Every setting in this product — including which Knowledge Box it talks to — is
live-editable through the API, takes effect with no restart, and overrides the
environment. What does that actually change about how you do a design review, and what
is the only control on it?**

<details><summary>Answer</summary>

It means "what is this deployment configured to do" is no longer answerable from the
repository and the deployment manifest — `fly secrets list` and `fly.toml` tell you the
*defaults*, not the effective configuration. The only place that answers it is
`GET /api/v1/admin/settings`'s `applied` block (every field reports its live value and
`source: "store" | "env" | "default"`) and the audit log (DP-52). Whoever holds the
admin token can repoint `connection.kbId`, change the generative model, raise the upload
ceiling, loosen the rate limiter and disable retention, live, with no review and no
deploy. The only control on that authority is the audit log — and it lives in the same
JSON store as everything else, capped at 5,000 entries with FIFO eviction, so a
deployment with heavy settings churn silently loses its oldest change history.
Exporting it on a schedule is a real operational requirement, not a nice-to-have. Five
variables stay environment-only because they are a restart by definition: `PORT`,
`HOST`, `DATA_DIR`, `NODE_ENV`, `ARAG_MOCK`. See [`WORKSHOP.md`](WORKSHOP.md) Part 2.5
and `design-review-checklist.md`'s "Configuration and change control" section.
</details>

---

**5. Count the LLM calls for a single document processed with `?config=auto`, assuming
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

**6. Why does every agent call in this product use `POST /ask` with
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

**7. A customer's security team asks: "if we delete a document through your API, is it
really gone?" What's the precise answer?**

<details><summary>Answer</summary>

`DELETE /api/v1/documents/{id}` removes the local JSON record **and** calls
`deleteResource` on the ARAG Knowledge Box for the same id (the document id and the KB
resource id are the same string by design — DP-01). That single `deleteResource` call
is also the only thing that removes the document's key-value data and its filter-index
entries from the Knowledge Box — since this pass, every extraction writes a second,
independent copy of the extracted values as key-value fields on the resource, and there
is no separate call to clean that up; deleting the document deletes both together. So
yes, for anything deleted through that endpoint or through `admin/purge`. The caveat:
there is no automatic retention sweep — a document nobody ever calls `DELETE` or
`purge` on stays in the KB, source and key-value data both, indefinitely. "Gone when
deleted" is accurate; "gone by default after some time" is not, unless retention is
actively scheduled (`design-review-checklist.md`, data-protection section).
</details>

---

**8. A customer wants fifteen bespoke document types, plus generator agents on a few of
them. What actually stops them, and what are the real remedies?**

<details><summary>Answer</summary>

Not throughput, not memory, not compute — a Knowledge Box allows **20 key-value schemas**,
and the 11 built-in document types already consume 11 of them, leaving **9** for custom
configs. Starting a Data Augmentation generator agent for one of those configs costs a
**second** schema for its own config (`dip_<schema>_gen`), because a key-value write is a
full replace and the agent must never write into the pipeline's own schema (DP-54). Fifteen
bespoke types alone already exceeds the 9 remaining slots, before a single generator agent
is turned on. The real remedies: delete the built-in extraction configs the deployment
doesn't use, consolidate similar document types into fewer configs, or give the customer a
second Knowledge Box — never a bigger machine, because this is a schema-count problem, not
a capacity problem, and none of concurrency, RAM or VM class move this ceiling. It bites
long before any throughput ceiling does, which is why it belongs in the *first* sizing
conversation, not the deployment review. See
[`key-value-schema-design.md`](key-value-schema-design.md) §5 and
[`sizing-deployment.md`](sizing-deployment.md), "Knowledge Box ceilings."
</details>

---

**9. Nothing is marked `required` in a provisioned key-value schema — even fields the
extraction config itself marks required. Why, and what's the general lesson for any
schema-validated write path?**

<details><summary>Answer</summary>

Two facts compose into a trap: ARAG refuses the **entire** key-value write when a
required key is absent, and a key-value write is a **full replace** of that schema's
data on the resource. Put together, one un-extracted required field on one faded scan
would cost that resource **every value the pipeline did extract**, not just the missing
one. `provisionable()` in `src/services/configs.ts` strips every `required` flag before
a config's fields become a key-value schema (DP-47) — deliberately, not as an oversight.
The requirement survives where it's still useful: the `answer_json_schema` sent to the
model keeps its `required` list (the model is still told the field matters), the record
still reports "required by the extraction config but not extracted" as a validation
issue, and the grounding score still counts the gap. The general lesson: a constraint
that converts partial success into total loss is an *availability* property with the
sign flipped, not a safety property — before treating any `required`/reject-on-missing
rule as a safeguard, ask what it does on the bad day. See
[`key-value-schema-design.md`](key-value-schema-design.md) §2.
</details>

---

**10. A customer proposes a `kv=`-filtered exception queue — for example
`kv=…:status:eq:unpaid` — over a status field they update as invoices get paid. Why
does this fail, and what do you offer instead?**

<details><summary>Answer</summary>

A key-value write is a full replace, but overwriting a field does **not** remove the
old value from the Knowledge Box's filter index — the index accumulates every value
ever written to that field on that resource, and there is no purge call (DP-51). So
every invoice ever marked `unpaid` still matches that filter after it's corrected to
`paid`: the queue only ever grows, it never empties. The product doesn't hide this —
`meta.kv.writes` counts the extra write, `meta.kv.filterIndexStale` goes `true`, and
`meta.kv.superseded[]` lists every value the resource still matches despite having
replaced it, both in the API response and on the record's Key-value view. The design
rule this produces: a key-value filter is reliable over immutable data and unreliable
over mutable data. What to offer instead: the thing key-value filtering is actually
good at — an analyst's ad-hoc question over a settled corpus, "every invoice over
$10,000 from this supplier last quarter," which is one filter instead of a full
re-read — and keep the exception queue itself in the customer's own system of record
(their ERP), where it always belonged even before this capability existed. See
[`key-value-schema-design.md`](key-value-schema-design.md) §3 and
[`WORKSHOP.md`](WORKSHOP.md), Scenario D.
</details>

---

**11. Key-value filtering is "eventually consistent." What three things should an
architect specifically never promise a customer because of it?**

<details><summary>Answer</summary>

Measured live on 2026-09-13 through the product's own `KvService`: a value is readable
via `show=values` the instant it's written, but the same value was still **not**
returned by a `/find` key-value filter roughly 66 seconds later; waiting for the
resource to become *searchable* first did not help; and during that window the matched
count moved independently (7 → 17) without ever including the newly written resource.
Three promises that follow from this, and must not be made: (1) don't promise "you can
filter it right away after upload" — there's no interval you can wait that's
guaranteed, and nothing to poll for completion; (2) don't promise the returned count is
the answer — key-value fields aren't facetable at all (a filter expression is a `422`
on `/catalog`), so a filtered list is a retrieval, not a `COUNT(*)`; (3) don't promise
zero results means there are none — it may just mean "not indexed yet." One more thing
to flag explicitly: the **mock** Knowledge Box (`ARAG_MOCK=1`, every automated test and
the developer lab) filters immediately, so a team whose confidence comes from the
developer lab is borrowing timing behaviour that does not hold live — say so before
that confidence reaches a customer conversation. See
[`key-value-schema-design.md`](key-value-schema-design.md) §4 (DP-55).
</details>

---

**12. Why is `provisioning` (writing ARAG search configurations) designed to be
idempotent, and what operational scenario specifically depends on that?**

<details><summary>Answer</summary>

Provisioning `POST`s a configuration and falls back to `PATCH` on `409` — safe to call
any number of times with the same result. It runs automatically (non-blocking) at
boot, on every custom-config creation, and on demand via
`POST /api/v1/admin/provision`. The scenario that specifically depends on this: a KB
reset or migration to a new Knowledge Box leaves it with zero search configurations
*and* zero key-value schemas (DP-46 — both are re-derived from each config, not carried
over) — without idempotent, on-demand re-provisioning, recovering from that would
require redeploying the whole product (to re-trigger boot-time provisioning) rather
than one admin API call. `design-review-checklist.md`'s reliability section calls this
out as a runbook that should be exercised once, in a non-production KB, before it's
needed for real.
</details>

---

**13. This product has zero runtime dependencies. What does that buy an architect
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
and version-pinned via `PLATFORM_VERSION` (`0.1.8` as of this check — see
`vendor/arag-platform/src/index.ts`; the separate UI kit consumed by the workspace is
independently versioned at `0.2.0`, per DP-44, so the two don't move together and a
review should check both, not assume one number covers the whole vendored surface).
</details>

---

**14. Why do the medical-claims-oriented schemas (`medical_claim`, `preauthorisation`)
raise a different bar in a design review than, say, `receipt` or `resume`?**

<details><summary>Answer</summary>

They're specifically designed to extract health-adjacent PII/PHI (member numbers,
diagnosis codes, patient names, claim amounts) — and that data now exists in the ARAG
Knowledge Box (a third party's infrastructure) as **two** copies, not one: the source
document itself, which persists until explicitly deleted, and — since this pass —
the same extracted values again as a filterable key-value index on the resource
(DP-46), reachable by anything with access to that KB, not only by this product. A
deployment intending to process real claims data needs an explicit answer, before
go-live, to "does the KB's data-handling and region satisfy our compliance obligations
for this data class," covering both copies, not just the document store. This is the
first item under data protection in `design-review-checklist.md` for exactly this
reason.
</details>

---

**15. A customer wants documents pushed to their ERP the moment processing finishes,
without polling. What should an architect actually recommend, given what this product
supports today?**

<details><summary>Answer</summary>

There is no outbound webhook in this product — recommending "just build a webhook
receiver on their end" presumes a feature that doesn't exist. The two real options are
(a) polling `GET /api/v1/jobs?status=succeeded` or `GET /api/v1/documents?status=ready`
on a short interval, which needs zero product changes and is adequate at the volumes
this product currently targets — and, notably, is *not* the same recommendation as
filtering on `kv=`, which is eventually consistent and will not reliably contain a
document that just finished (question 11) — or (b) a small bridge process, owned by the
integrator, that holds the SSE connection (`GET /api/v1/jobs/{id}/events`) and
translates events into whatever the ERP's own ingestion mechanism expects. Building
outbound webhooks *into this product* is a legitimate feature request to route to the
product owner as a roadmap item — not something to improvise into a single customer's
deployment. ([`WORKSHOP.md`](WORKSHOP.md), Scenario A.)
</details>
