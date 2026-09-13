# Key-value schema design — and three findings that constrain it

**Time:** 45 minutes as a workshop module (Part 3 of [`WORKSHOP.md`](WORKSHOP.md)), or
25 minutes to read on its own.

**Who this is for:** the architect deciding whether a customer's "we'll query the
Knowledge Box for it" plan is sound, and what their extraction configurations should look
like before anyone provisions twenty of them.

Companion documents: [`WORKSHOP.md`](WORKSHOP.md) (reference architecture and decision
points), [`sizing-deployment.md`](sizing-deployment.md) (the schema-ceiling arithmetic in
its capacity-planning context) and [`design-review-checklist.md`](design-review-checklist.md)
(these findings turned into sign-off items).

---

## 1. What a key-value schema is, and why there are two namespaces (15 min)

Extraction produces a record. That record has always lived in this product's own JSON
store. What this product pass added is that the *verified* record is also written into the
**Knowledge Box itself**, as typed, validated fields on the resource, under a key-value
schema — so an invoice's total is a `float` that anything with access to that KB can
filter on, not a string that only this product can read.

That means **every extraction configuration owns two Knowledge Box objects**, not one
(DP-46):

| Object | Id | Answers |
|---|---|---|
| Stored search configuration (`kind: "ask"`) | `dip_<schema>` | *How is this document read?* Model, `full_resource` RAG strategy, grounding prompt, `answer_json_schema`. |
| Key-value schema | `dip_<schema>` | *How is the result kept, and what can be asked of it?* Typed fields on the resource. |

They share an id deliberately, so the two namespaces read as one pair to an operator.
`ExtractionConfig.provisioning.state` is `provisioned` only when **both** are in place, and
each is reported separately — a half-failure is visible in the Configs list rather than
discovered when a filter silently returns nothing.

The mapping from a config's JSON Schema to a key-value schema is **derived on every call,
not stored**. That is the design choice that makes the schema unable to drift from the
config that defines it: editing a config re-provisions the schema (and deletes the orphan
on a rename), and deleting a config deletes the schema.

### The type system you are actually designing against

Five field types — `text`, `integer`, `float`, `boolean`, `date` — plus two modifiers with
hard rules (all verified live, and enforced in `src/services/kv.ts` before the call rather
than by catching ARAG's 412/422):

| | Rule |
|---|---|
| `repeated` (a list) | **`text` only** |
| `range` (an interval `{lower, upper}`) | **`integer`, `float`, `date` only** |
| Ids and field keys | `^[^/.]{1,64}$` — only `/` and `.` are forbidden, so spaces and capitals survive |

And the operator table, which is the whole reason the type matters:

| Operator | Valid on |
|---|---|
| `eq` | any scalar — text, integer, float, boolean, date |
| `gte` / `lte` | **integer, float and date scalars only** |
| `contains` | `repeated` fields (membership) and `range` fields (point inside interval) |

**The design consequence, stated plainly:** the field type is not a formatting detail, it
is the set of questions the customer will ever be able to ask. A `text` field can only be
matched exactly. If a customer's requirement is "show me every invoice over $10,000" or
"everything issued in Q2", and the field is `text`, the requirement is not implementable —
not slow, not awkward, *not implementable* — until the schema changes.

### Why the declared type and the extracted type disagree on purpose

The most valuable field on the most common document is a worked example. An invoice total
is declared to the *model* as a JSON `string`, because forcing a model to emit a JSON
`number` for `"$116,160.00"` is unreliable and frequently returns `0`. But it is declared
to the *Knowledge Box* as a `float`, because the heuristic mapping (`text`) would have
made the headline filtering claim untrue for exactly the field customers care about.

So the product carries a per-field override (DP-48): `kv: { type, repeated, range }` on a
built-in schema's property, and `kvType` / `kvRepeated` / `kvRange` on a custom config's
field. Every `money()` field is a `float`; every ISO-8601 `date()` field is a `date`.

Three layers, each true about a different thing, and worth walking through with the group
because it is the shape every well-designed extraction schema ends up with:

| Layer | Invoice total | Invoice date |
|---|---|---|
| `field.raw` — what the model returned | `"$116,160.00"` | `"15/06/2026"` |
| `field.value` — normalised on the record | `116160` | `"2026-06-15"` |
| `meta.kv.values` — coerced to the declared kv type | `116160` | `"2026-06-15T00:00:00Z"` |

Coercion is checked, not assumed: a value that cannot be represented in the declared type
is **skipped with a named reason** (`"Total Amount (bill.txt)" is not a float`) rather
than written wrong or dropped silently, and an illegal modifier (`repeated` on a `float`)
throws at provisioning rather than coercing quietly.

### Discussion prompt (5 min)

Take a document type your customer actually processes. List its fields, and for each one
decide the key-value type **from the queries the customer will run**, not from what the
value looks like. Then count how many of them needed an override. In this product's own
built-ins the answer is "every amount and every date" — if your count is zero, you have
probably designed a schema nobody can filter.

---

## 2. Finding one — a required key would be ruinous, so nothing is required (10 min)

**The finding, verified live:** ARAG refuses the **entire** key-value write when a
`required` key is absent. And a key-value write is a **full replace** of that schema's data
on that resource.

Compose those two facts. One un-extracted required field on one faded scan would cost that
resource **every value the pipeline did extract** — not the missing field, all of them.
The same mechanism would break a Data Augmentation generator agent's own writes.

**What the product does (DP-47):** `provisionable()` in `src/services/configs.ts` strips
every `required` flag before the schema is provisioned. Nothing in a provisioned key-value
schema is required, ever. The JSON-Schema → kv mapper still projects `required`
faithfully — the policy lives in one function, and the mapper stays truthful.

**Where the requirement survives, because there it is useful:**
- the extraction still *asks* for the field (the `answer_json_schema` sent to the model
  keeps its `required` list, so the model is still told the field matters);
- the record still reports "required by the extraction config but not extracted" as a
  validation issue;
- the grounding score still counts the gap.

### The general lesson, which is the point of this module

`required` looks like a safety property. Here it is a *availability* property with the
sign flipped: it converts a partial success into a total loss. An architect reviewing any
schema-validated write path against a store that replaces rather than merges should ask
the same question — **what does this constraint do on the bad day?** — before deciding it
is a safeguard.

### Discussion prompt (4 min)

A customer's compliance lead asks for `member_number` to be `required` on the
`medical_claim` key-value schema, "so we can't have claims without one". What do you tell
them, and what do you offer instead? (Model answer: the flag would mean a scan where the
member number is illegible loses the diagnosis codes, the amounts and the dates too — the
exact opposite of the compliance outcome they want. Offer the record-side validation issue
and the grounding score, which flag the gap without destroying the rest, plus a
`has_issues=true` list filter as the work queue.)

---

## 3. Finding two — the overwrite trap (10 min)

**The finding, verified live and undocumented upstream:** overwriting a key-value field
does **not** remove the previous value from the Knowledge Box's filter index. The index
accumulates every value ever written to that field on that resource, and **there is no
index-purge call**.

The consequence is not subtle. A resource whose `po_number` was corrected from `PO-88421`
to `PO-88422` matches a filter on **both**. One document, two mutually exclusive values,
both returning it.

**What the product does (DP-51):**
- Key-value writes are treated as **write-once per resource**. The pipeline writes once,
  when the record finishes. Nothing else writes in the normal path.
- When a second write is unavoidable — a human correction, a reprocess — it is **reported,
  not hidden**: `meta.kv.writes` counts it, `meta.kv.filterIndexStale` goes `true`, and
  `meta.kv.superseded[]` lists the values this resource still matches a filter on despite
  having replaced them. The record view states it in words.
- The mock Knowledge Box reproduces the trap, so it is testable and demonstrable offline.

### The design rule this produces

> **A key-value filter is reliable over immutable data and unreliable over mutable data.**

Which makes it excellent for the thing it was built for — "find me the invoices over
$10,000 from this supplier in Q2" over a settled corpus — and unsuitable as the query layer
for anything that gets corrected: a reconciliation report, a compliance attestation, an
exception queue that must not contain items that have been fixed.

If a customer wants a reliable query over corrected data, the honest architecture is the
one this product was designed for anyway: **this product is an enrichment step, not a
system of record.** The corrected record goes into their system of record, and they query
*that*.

### Discussion prompt (4 min)

A customer proposes using `kv=…:status:eq:unpaid` as their AP exception queue, updating
the field as invoices are paid. Walk the group to the failure: every invoice ever marked
unpaid stays in the queue forever. Then ask what they should do instead, and notice that
the answer — keep the queue in the ERP — was the right answer before the key-value
capability existed too.

---

## 4. Finding three — filtering is eventually consistent, with no status to wait on (10 min)

**The finding, measured live on 2026-09-13 through the product's own `KvService`:**

- A value is readable through `show=values` **the instant it is written**.
- The same value was **still not returned** by a `/find` key-value filter **~66 seconds
  later**.
- Waiting for the resource to become *searchable* before writing did **not** help — so
  key-value indexing is a **second asynchronous step**, with no status to poll and no
  completion event.
- During that window the matched count grew from 7 to 17 **without ever including the
  resource just written**, which rules out reading the count as progress.

**What the product does (DP-55):** it never implies otherwise. The Documents list reports
what the Knowledge Box *actually matched* rather than presenting a key-value filter as an
exhaustive query, and **no count, total or "0 results" conclusion is built on one**. The
response separates `filters.knowledgeBox.requested` from `.applied` and surfaces
`matchedResources`, so a Knowledge Box that cannot answer degrades to the local list
**with the reason** rather than to an empty page that reads as "nothing matched".

A document that has just finished processing therefore shows every written value on its
Key-value view — and will not yet come back from a key-value filter.

### Three things an architect must not promise

1. **"Filter it immediately after upload."** There is no interval you can wait that is
   guaranteed, and nothing to poll. An integration that uploads and then filters for what
   it just uploaded is a race with no upper bound.
2. **"The count is the answer."** A key-value filter is a retrieval, not a `COUNT(*)`. It
   is not exhaustive and it is not stable during indexing.
3. **"Zero results means there are none."** It may mean "not indexed yet", "the Knowledge
   Box could not answer", or "there are none", and only the third is a business
   conclusion. This is why the product returns the `filters` block instead of just a
   number.

### Note on the mock

Against the mock Knowledge Box (`ARAG_MOCK=1`, every automated test and the whole developer
lab) a key-value write is filterable **immediately**. The mock exists to make tests fast
and deterministic, not to model production timing — the same relationship it has to the
~14 s live pipeline it completes in milliseconds. Everything the developer track proves
about *correctness* transfers to live; nothing it shows about *timing* does. Say this out
loud to any team whose confidence comes from the lab.

---

## 5. Capacity: the ceiling most customers hit first (5 min)

Two hard limits, checked before the call, with an error that names its own remedy:

- **20 key-value schemas per Knowledge Box**
- **50 fields per schema**

The arithmetic:

| | Schemas |
|---|---|
| Built-in document types shipped | 11 |
| Remaining for custom extraction configurations | **9** |
| Cost of starting a Data Augmentation generator agent for one config | **+1** (`dip_<schema>_gen` — its own schema, provisioned on demand, never shared with the pipeline's) |

A customer who wants a dozen bespoke document types does not have room, and neither does
one who wants generator agents on more than a handful of configs. **This ceiling bites long
before any throughput ceiling does** — it is a schema-count problem, not a capacity problem,
so it is not solved by a bigger machine. The real remedies are: delete the built-in
configurations the deployment does not use, consolidate similar document types into one
configuration, or give the customer a second Knowledge Box.

Raise this in the *first* design conversation, not the deployment review. It changes the
information architecture a customer designs, and it is much cheaper to hear before they
have written twelve schemas.

See [`sizing-deployment.md`](sizing-deployment.md) for this in its capacity-planning
context, including the per-document key-value write's cost against the KB's rate limits.

---

## 6. Design review: what to carry away

Turned into sign-off items in [`design-review-checklist.md`](design-review-checklist.md)'s
"Key-value fields and filtering" section. In summary, before you approve a design that
relies on key-value fields:

- [ ] Count the schemas the customer needs against the 20 the Knowledge Box allows, with
      generator agents counted at one each.
- [ ] For every field the customer intends to **filter numerically or by date**, confirm
      it carries a type override. A `text` field cannot be ordered.
- [ ] Confirm nobody is relying on a `required` key-value field as a data-quality gate —
      and that they understand a required key would cost them the whole write.
- [ ] Confirm no reconciliation, compliance or exception-queue query is built on a filter
      over data that gets corrected.
- [ ] Confirm no count, total or "zero results" conclusion is built on a key-value filter,
      and that any integration which uploads and then filters has been redesigned.
- [ ] Confirm the team's confidence is not borrowed from the mock's timing.
