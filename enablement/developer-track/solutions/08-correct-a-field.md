# Solution 8 — Correct a field, and read the audit trail

A real transcript against a locally running instance (`make dev`, `ARAG_MOCK=1`) with
`ADMIN_TOKEN=lab-admin-token`. Ids, timestamps and audit `seq` numbers will differ; the
values, the arithmetic and the status codes will not.

```bash
B=http://localhost:8080
A='Authorization: Bearer lab-admin-token'
curl -sS -c /tmp/dip-cookies.txt -X POST "$B/api/v1/session" > /dev/null
```

## 1. A record with a grounding score of 1

```bash
curl -sS -X POST "$B/api/v1/documents?config=auto" \
     -H 'Content-Type: text/plain' -H 'X-Filename: invoice.txt' \
     --data-binary @public/samples/invoice.txt | tee /tmp/up8.json | jq -r .document.id
ID=$(jq -r .document.id /tmp/up8.json)
# … wait for the job …
curl -sS "$B/api/v1/documents/$ID" \
  | jq '{grounding: .meta.groundingScore, corrected: .meta.correctedFields,
         kvWrites: .meta.kv.writes, fields: (.fields | length),
         po: (.fields[] | select(.key=="po_number"))}'
```

```json
{
  "grounding": 1,
  "corrected": null,
  "kvWrites": 1,
  "fields": 12,
  "po": { "key": "po_number", "label": "PO #", "value": "PO-88421", "confidence": 0.85 }
}
```

Twelve fields, every one carrying a quote that checks out against the document's own
text, so the score is `1`. `meta.correctedFields` is absent — no human has touched it.

## 2–3. Correct a field

```bash
curl -sS -b /tmp/dip-cookies.txt -X PUT "$B/api/v1/documents/$ID/fields/po_number" \
     -H 'Content-Type: application/json' \
     -d '{"value":"PO-88422","reason":"Transposed digit; the scan reads 88422"}' \
  | jq '.correction'
```

```json
{
  "field": "po_number",
  "label": "PO #",
  "previousValue": "PO-88421",
  "value": "PO-88422",
  "actor": "session",
  "at": "2026-09-13T08:43:03.202Z",
  "verified": "unverified",
  "reason": "Transposed digit; the scan reads 88422",
  "kv": {
    "written": true,
    "schemaId": "dip_invoice_extraction",
    "fieldId": "po_number",
    "filterIndexStale": true
  }
}
```

The three predictions from step 2, and the answers:

**What happens to the field's `confidence`?** It is dropped entirely — not lowered, not
kept:

```bash
curl -sS "$B/api/v1/documents/$ID" | jq '.fields[] | select(.key=="po_number")'
```
```json
{ "key": "po_number", "label": "PO #", "value": "PO-88422" }
```

The `confidence` key is simply gone, and so is `raw`. A confidence is the model's stated
certainty about a value the model produced. This is not that value. Carrying `0.85`
forward would attach the model's certainty to a human's typing, which would be a lie on a
number the record view prints next to the field.

**What does `verified` say?** `"unverified"`. The corrected value is re-checked against
the document's own extracted text with exactly the same evidence contract the pipeline
uses — the three outcomes are `exact`, `normalised` and `unverified`. `PO-88422` is not in
the document, so it earns no quote, and the stale quote the old value had is removed
rather than left pointing at the wrong string. Had you corrected the value to something
the document *does* contain, it would have earned a new quote and read `exact` (you will
see that in step 8).

**Which direction does the grounding score move?** Down.

## 4. The grounding consequence

```bash
curl -sS "$B/api/v1/documents/$ID" | jq '{grounding: .meta.groundingScore, corrected: .meta.correctedFields}'
```
```json
{ "grounding": 0.92, "corrected": 1 }
```

Eleven of twelve fields still carry a verified quote: `11/12 = 0.9166…`, reported as
`0.92`.

**Why a corrected field stays in the denominator.** The score's sentence is "the share of
this record's fields that carry a verified quote". There were three candidate policies:

| Policy | What it does to that sentence |
|---|---|
| Exclude corrected fields from the score | Quietly moves the goalposts. A reviewer could raise a record's score by correcting its worst fields. |
| Keep the model's old confidence for the new value | Attributes the model's certainty to a value it did not produce. |
| Keep the field in the denominator; count it in the numerator only if the *new* value verifies | The sentence stays true. |

The product takes the third, which means **a correction can lower the score** — and that
is the honest outcome, not a defect. `meta.correctedFields` is reported alongside it so
the trust strip can say "11 of 12 fields carry a verified quote · 1 corrected by a
reviewer" rather than hiding the human's hand. Correct a field to something the document
*does* say and the score goes back up, because the new value earns its own quote.

## 5. The trap

```bash
curl -sS "$B/api/v1/documents/$ID" | jq '{writes: .meta.kv.writes, stale: .meta.kv.filterIndexStale, superseded: .meta.kv.superseded}'
```
```json
{
  "writes": 2,
  "stale": true,
  "superseded": [ { "field": "po_number", "value": "PO-88421" } ]
}
```

Now prove it. Filter on the value you **replaced**:

```bash
curl -sS "$B/api/v1/documents?kv=dip_invoice_extraction:po_number:eq:PO-88421" | jq '.total'
# 1     ← the document you just corrected, still matching its old value
curl -sS "$B/api/v1/documents?kv=dip_invoice_extraction:po_number:eq:PO-88422" | jq '.total'
# 1     ← and its new one
```

One document, two mutually exclusive values, both matching.

**Why this is reported rather than fixed.** Two verified-live facts compose into it
(DP-51). First, a key-value write is a **full replace** of that schema's data on that
resource — which is why a one-field correction sends the entire current record, not just
the field. Second, and undocumented upstream: overwriting a value does **not** remove the
previous value from the Knowledge Box's filter index, which accumulates every value ever
written to that field on that resource, and there is no index-purge call. So the product
does the only two things left available to it — it writes **once** per resource in the
normal path (the pipeline writes when the record finishes, and nothing else does), and
when a second write is unavoidable it sets `filterIndexStale` and accumulates
`superseded[]` so the record view can state it plainly.

> `filters.knowledgeBox.matchedResources` in the response may be **larger** than `total`.
> It is the Knowledge Box's own count of matching resources *before* intersection with
> this workspace's list, so it also counts resources this workspace no longer knows
> about. It is reported for exactly that reason: it is the number that tells an operator
> the Knowledge Box and the local store disagree.

## 6. The record's own review history

```bash
curl -sS "$B/api/v1/documents/$ID/corrections" | jq '{items: (.items | length), first: .items[0].field}'
# { "items": 1, "first": "po_number" }
```

The endpoint returns **newest first** — the reading order a review panel wants, because
the most recent change is the one a second reviewer needs to see. The same list is on the
record itself as `corrections`, **oldest first**, because that is the order it happened in
and the order the Pipeline tab's timeline renders. Same data, two reading orders, neither
of them a default anyone has to guess at.

## 7. The operator's audit trail

```bash
curl -sS "$B/api/v1/admin/audit?action=document.field.correct" -H "$A" | jq '.items[0]'
```

```json
{
  "id": "a000000000025",
  "seq": 25,
  "ts": "2026-09-13T08:43:03.202Z",
  "actor": { "type": "session", "name": "session" },
  "action": "document.field.correct",
  "target": "1ae8305f46774821a869e97fe1b865e1#po_number",
  "before": "PO-88421",
  "after": "PO-88422",
  "requestId": "adff1462-9a5d-439f-81f7-2917d6dadcf8"
}
```

```bash
curl -sS "$B/api/v1/admin/audit?target=$ID%23po_number" -H "$A" | jq '.total'
# 1
```

The two records are deliberately not the same thing:

| | The correction record | The audit entry |
|---|---|---|
| Lives on | the document | the operator's log |
| Audience | a reviewer reading *this* record | an operator asking "who changed what, across everything" |
| Carries uniquely | the reviewer's `reason`, the `verified` outcome, the key-value write's fate | `requestId` (correlates with the request log), a monotonic `seq`, and one uniform shape shared with settings edits, key creation, config changes, purges and deletes |

`target` is `<documentId>#<fieldKey>`, which is what makes the second query above
possible: one field's entire change history across every reviewer, without reading the
document. Paging is by sequence number rather than offset, so an entry written while an
operator is reading cannot duplicate or hide a row.

### What the log redacts, and what it must not

Your correction's `before` and `after` are the real values — `"PO-88421"` and
`"PO-88422"` — not `***`. That is the point of the log: an entry that hides its own
subject is worse than no entry, because it looks complete. Redaction is anchored to
property names that *end* in a credential word (`apiKey`, `api_key`, `adminToken`,
`clientSecret`, `password`, `authorization`, `cookie`), so compare the correction above
with a secret rotation:

```bash
curl -sS "$B/api/v1/admin/audit?action=settings.update" -H "$A" | jq '.items[0]'
```
```json
{
  "seq": 2,
  "actor": { "type": "admin", "name": "admin token" },
  "action": "settings.update",
  "target": "connection.apiKey",
  "before": "***",
  "after": "***",
  "detail": "secret rotated"
}
```

For a secret, *that it changed* is the record — the target names which one, the actor
names who, and `detail` says what happened, with no value anywhere. Everything else stays
readable: a `config.create` entry carries the whole configuration, every field's `key`
included, which is what lets an operator answer "what exactly did this config look like
when it was created" months later. (Until 13 September the redaction pattern was an
unanchored `key`, so a `config.create` entry came back with every field `key` and
`provisioning.keyValueSchema` blanked to `***` — if your copy of this lab predates that
fix, this is why your output looked shredded.)

## 8. Undo

```bash
curl -sS -b /tmp/dip-cookies.txt -X DELETE "$B/api/v1/documents/$ID/fields/po_number" \
  | jq '{correction, grounding: .document.meta.groundingScore,
         corrected: .document.meta.correctedFields,
         history: (.document.corrections | length),
         kv: {writes: .document.meta.kv.writes, superseded: .document.meta.kv.superseded}}'
```

```json
{
  "correction": {
    "field": "po_number",
    "previousValue": "PO-88422",
    "value": "PO-88421",
    "actor": "session",
    "at": "2026-09-13T08:43:28.998Z",
    "verified": "exact",
    "reason": "Reverted the correction made at 2026-09-13T08:43:03.202Z",
    "kv": { "written": true, "schemaId": "dip_invoice_extraction",
            "fieldId": "po_number", "filterIndexStale": true }
  },
  "grounding": 1,
  "corrected": 1,
  "history": 2,
  "kv": {
    "writes": 3,
    "superseded": [
      { "field": "po_number", "value": "PO-88421" },
      { "field": "po_number", "value": "PO-88422" }
    ]
  }
}
```

What came back: the **value**, and with it `verified: "exact"` (the restored value *is* in
the document, so it earns a real quote again) and `meta.groundingScore: 1`.

What did **not** come back, and why each is right:

1. **`meta.correctedFields` is still `1`.** A human has been in this record. Undoing the
   edit does not undo that fact, and a reviewer arriving later is entitled to know.
2. **The field's `confidence` is still gone.** The value is the model's again by
   coincidence of content, not by provenance — it was last set by a person.
3. **`corrections` grew to 2, it did not shrink.** The revert is recorded as a *new*
   correction, so the history stays append-only and the undo is exactly as attributable
   as the change it undoes. `reason` is filled in automatically, naming the timestamp of
   the correction being reverted.
4. **`kv.writes` is `3` and `superseded` now lists both values.** A revert is another
   full replace, so it is another write, and the filter index now also matches the value
   that only ever existed for twenty-five seconds.

### Why a second undo does not answer 400

```bash
curl -sS -b /tmp/dip-cookies.txt -X DELETE "$B/api/v1/documents/$ID/fields/po_number" \
  | jq '{value: .correction.value, verified: .correction.verified,
         grounding: .document.meta.groundingScore, history: (.document.corrections | length)}'
```
```json
{ "value": "PO-88422", "verified": "unverified", "grounding": 0.92, "history": 3 }
```

It undoes the **most recent** correction — and the most recent correction is now the
revert. So it oscillates, and each swing is another row in the history and another
key-value write. This is consistent rather than surprising once you accept the
append-only rule: there is no "undo stack" being popped, only a history being extended.

The documented 400 is for a field with **no** correction history at all:

```bash
curl -sS -b /tmp/dip-cookies.txt -o /tmp/u.json -w '%{http_code}\n' \
     -X DELETE "$B/api/v1/documents/$ID/fields/currency"
cat /tmp/u.json | jq -r .detail
```
```
400
no correction to revert for field: currency
```

## 9. Clean up

```bash
curl -sS -b /tmp/dip-cookies.txt -o /dev/null -w '%{http_code}\n' -X DELETE "$B/api/v1/documents/$ID"
# 204
```

Deleting the document deletes the Knowledge Box resource, and with it the key-value data
and the filter-index entries this exercise accumulated. It is the only operation that
does.

## Notes on the choices

- **Why a correction is recorded rather than applied.** An extraction product's whole
  claim is that you can check its output against the source. The moment a human can
  silently overwrite a value, nothing in the record can be trusted to have come from
  where it says it came from. Keeping `previousValue`, `reason`, `actor` and `at` costs a
  few bytes per correction and preserves the claim.
- **Why the corrected value is re-checked at all,** rather than simply marked "human".
  Because a reviewer typing a value that *is* printed on the document is the common case,
  and it is worth knowing. Re-checking is what lets `verified` say `exact` for a good
  correction and `unverified` for a guess — a distinction "human-entered" would erase.
- **Why the whole record is written back to the Knowledge Box for a one-field change.**
  There is no partial key-value update: a write replaces the schema's data on that
  resource. Sending only the corrected field would delete the other eleven.
- **What this means for a customer's query layer.** A key-value filter over data that
  gets corrected is not a reliable query, and the architect track's
  [`key-value-schema-design.md`](../../architect-track/key-value-schema-design.md) turns
  that into a design rule rather than a footnote.
