# Solution 6 — Write and filter a key-value field through the Knowledge Box

A real transcript against a locally running instance (`make dev`, `ARAG_MOCK=1`). Ids
and timestamps will differ; the shapes, the numbers and the status codes will not.

Bootstrap the session cookie the four write calls need (the rest of this exercise is
anonymous-friendly):

```bash
curl -sS -c /tmp/dip-cookies.txt -X POST http://localhost:8080/api/v1/session
```

## 1. What a config declares

```bash
curl -sS http://localhost:8080/api/v1/extraction-configs/invoice \
  | jq '{id, kvSchemaId, provisioning, documentCount}'
```

```json
{
  "id": "invoice",
  "kvSchemaId": "dip_invoice_extraction",
  "provisioning": {
    "state": "provisioned",
    "searchConfiguration": { "name": "dip_invoice_extraction", "state": "provisioned" },
    "keyValueSchema": {
      "state": "provisioned",
      "at": "2026-09-13T08:28:06.412Z",
      "schemaId": "dip_invoice_extraction",
      "fields": 12
    }
  },
  "documentCount": 1
}
```

**An extraction config owns two Knowledge Box objects, not one** (DP-46):

| Object | Id | What it is for |
|---|---|---|
| Stored search configuration (`kind: "ask"`) | `dip_invoice_extraction` | *How a document is read.* It pins the generative model, the `full_resource` RAG strategy, the grounding prompt and the `answer_json_schema` the model must fill. |
| Key-value schema | `dip_invoice_extraction` | *How the result is kept and filtered.* Typed, validated fields on the resource itself, so every client of that Knowledge Box — not just this product — can filter on an invoice total. |

They share the id on purpose: an operator looking at either namespace sees one pair.
`provisioning.state` is `provisioned` **only when both are in place**, and each is
reported separately so a half-failure is visible rather than silent.

## 2. The two fields whose Knowledge Box type is not the type the model was asked for

```bash
curl -sS http://localhost:8080/api/v1/extraction-configs/invoice \
  | jq '.fields[] | select(.key=="total" or .key=="invoice_date")'
```

```json
{
  "key": "total",
  "label": "Total",
  "type": "string",
  "description": "Grand total / amount due (capture exactly as written, including currency/symbols)",
  "required": true,
  "kvType": "float"
}
{
  "key": "invoice_date",
  "label": "Invoice Date",
  "type": "string",
  "description": "Invoice issue date in ISO 8601 (YYYY-MM-DD) if determinable",
  "required": false,
  "kvType": "date"
}
```

These are not contradictions; they are two different questions with two different right
answers.

- `type` is the **JSON-Schema type the model is asked for**. Forcing a model to emit a
  JSON `number` for `"$116,160.00"` is unreliable — it frequently comes back `0`. So
  `money()` declares a string and captures the value exactly as printed. The same logic
  applies to `date()`: models are far more reliable returning `"2026-01-15"` as text than
  a typed value.
- `kvType` is the **Knowledge Box type the value is stored and filtered as**. Mapping a
  money field to kv `text` would mean nobody could ever ask for "every invoice over
  $10,000" — the headline claim would be untrue for the most valuable field on the most
  common document. So `money()` annotates `kv: { type: "float" }` and `date()` annotates
  `kv: { type: "date" }` (DP-48). The annotation is stripped before the schema is sent to
  ARAG as `answer_json_schema`, so the model never sees it.

## 3. Watch a write

```bash
curl -sS -X POST 'http://localhost:8080/api/v1/documents?config=auto' \
     -H 'Content-Type: text/plain' -H 'X-Filename: invoice.txt' \
     --data-binary @public/samples/invoice.txt | tee /tmp/kv.json | jq -r .document.id
ID=$(jq -r .document.id /tmp/kv.json)
# wait for the job (the mock finishes in milliseconds)
curl -sS "http://localhost:8080/api/v1/documents/$ID" | jq '.meta.kv | {written, fields, writes, schemaId}'
```

```json
{
  "written": true,
  "fields": 12,
  "writes": 1,
  "schemaId": "dip_invoice_extraction"
}
```

Now the three renderings of the same two values:

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID" | jq '
  { record: (.fields[] | select(.key=="total") | {raw, value}),
    knowledgeBox: .meta.kv.values.total }'
curl -sS "http://localhost:8080/api/v1/documents/$ID" | jq '
  { record: (.fields[] | select(.key=="invoice_date") | {raw, value}),
    knowledgeBox: .meta.kv.values.invoice_date }'
```

```json
{ "record": { "raw": "$116,160.00", "value": 116160 }, "knowledgeBox": 116160 }
{ "record": { "raw": "15/06/2026", "value": "2026-06-15" }, "knowledgeBox": "2026-06-15T00:00:00Z" }
```

Three layers, each honest about a different thing:

1. **`raw`** — exactly what was printed on the document. Nothing is lost.
2. **`value`** — `validateNormalize` in `src/services/agents.ts` deterministically parses
   the money string into a number and the date into ISO 8601. This is what the record,
   the exports and the arithmetic checks use.
3. **`meta.kv.values`** — what `toKvData` coerced to the field's *declared* key-value
   type before writing. A `date` field becomes a full RFC 3339 instant, because that is
   what the Knowledge Box stores and therefore what a `gte` filter has to be phrased
   against. Where a value cannot be coerced, it is **skipped with a named reason** rather
   than written wrong (you will see that in step 7).

## 4. The Key-value view in the workspace

Open `http://localhost:8080/#/documents/<id>/json?view=kv`. The **JSON** tab has two
views — **Record** (the canonical JSON this API returns) and **Key-value fields** (what
reached the Knowledge Box). The second one shows written, skipped and rejected fields
with equal prominence, and states the filter-index caveat rather than burying it.

## 5. Filter on it

```bash
B=http://localhost:8080
curl -sS "$B/api/v1/documents?kv=dip_invoice_extraction:total:gte:10000"  | jq '.total'
curl -sS "$B/api/v1/documents?kv=dip_invoice_extraction:total:gte:200000" | jq '.total'
curl -sS --get "$B/api/v1/documents" \
     --data-urlencode 'kv=dip_invoice_extraction:invoice_date:gte:2026-01-01T00:00:00Z' | jq '.total'
curl -sS --get "$B/api/v1/documents" \
     --data-urlencode 'kv=dip_invoice_extraction:invoice_date:lte:2026-01-01T00:00:00Z' | jq '.total'
curl -sS --get "$B/api/v1/documents" \
     --data-urlencode 'kv=dip_invoice_extraction:line_items:contains:12-month Premium Support              1     $6,400.00   $6,400.00' | jq '.total'
curl -sS --get "$B/api/v1/documents" \
     --data-urlencode 'kv=dip_invoice_extraction:currency:eq:AUD' \
     --data-urlencode 'kv=dip_invoice_extraction:total:gte:200000' | jq '.total'
```

```
1
0
1
0
1
0
```

The last one is the AND: `currency=AUD` matches and `total >= 200000` does not, so the
pair matches nothing. Up to ten `kv` parameters may be combined.

Note what you did **not** have to do on the date filters: escape anything. The value
`2026-01-01T00:00:00Z` contains two colons of its own, and it still parses, because only
the **first three** colons separate `schemaId`, `field` and `op` from the value.

### Which system answered which half

```bash
curl -sS --get "$B/api/v1/documents" \
     --data-urlencode 'kv=dip_invoice_extraction:total:gte:10000' \
     --data-urlencode 'status=ready' \
     --data-urlencode 'doc_type=invoice' | jq '{total, filters}'
```

```json
{
  "total": 1,
  "filters": {
    "knowledgeBox": {
      "applied":   [ { "schemaId": "dip_invoice_extraction", "key": "total", "op": "gte", "value": "10000" } ],
      "requested": [ { "schemaId": "dip_invoice_extraction", "key": "total", "op": "gte", "value": "10000" } ],
      "matchedResources": 1
    },
    "local": ["status", "doc_type"]
  }
}
```

**Why the product reports them separately instead of as one list.** They are not
interchangeable. `status` and `doc_type` are predicates over this workspace's own store:
exhaustive, instant, and true the moment the record is written. The `kv` filter is a
`/find` against the Knowledge Box whose matching resource ids are then intersected with
the local list — it is a *different system*, answering at a *different time*, and it can
fail or lag independently. `requested` and `applied` differ when the Knowledge Box could
not answer: the product then degrades to the local list **and says so**, rather than
returning an empty page that reads as "nothing matched". And `matchedResources` is
reported instead of a facet count because a key-value filter expression is a 422 on
`/catalog` and key-value fields are not facetable at all (DP-50) — a count would be
promising something the platform cannot answer.

## 6. Break it on purpose

```bash
curl -sS "$B/api/v1/documents?kv=dip_invoice_extraction:vendor_name:gte:5" | jq -r .detail
curl -sS "$B/api/v1/documents?kv=dip_invoice_extraction:nope:eq:x"         | jq -r .detail
```

```
kv field "vendor_name" is a text field, which supports eq, not "gte"
kv schema "dip_invoice_extraction" has no field "nope" (it has: vendor_name, vendor_address, bill_to, invoice_number, invoice_date, due_date, currency, subtotal, tax, total, line_items, po_number)
```

Both are `400`. The product validates the operator against the field's declared kind
*before* calling the Knowledge Box, because ARAG enforces the same rule with a `412` that
says nothing useful. The operator table it is checking against:

| Operator | Valid on |
|---|---|
| `eq` | any scalar field — text, integer, float, boolean, date |
| `gte` / `lte` | integer, float and date **scalars** only |
| `contains` | `repeated` fields (is this a member?) and `range` fields (is this point inside the interval?) |

## 7. Make an unfilterable value filterable

Create a config with an amount field and no override:

```bash
curl -sS -b /tmp/dip-cookies.txt -X POST "$B/api/v1/extraction-configs" \
  -H 'Content-Type: application/json' \
  -d '{ "name": "Utility Bill",
        "fields": [ { "label": "Provider", "required": true },
                    { "label": "Account Number" },
                    { "label": "Amount Due" } ] }' | jq '{id, kvSchemaId, fields}'
```

```json
{
  "id": "cfg_98dcddfa",
  "kvSchemaId": "dip_custom_utility_bill",
  "fields": [
    { "key": "provider",       "label": "Provider",       "type": "string", "required": true  },
    { "key": "account_number", "label": "Account Number", "type": "string", "required": false },
    { "key": "amount_due",     "label": "Amount Due",     "type": "string", "required": false }
  ]
}
```

No `kvType`, so the heuristic makes it kv `text`, and the Knowledge Box will not order it:

```bash
curl -sS "$B/api/v1/documents?kv=dip_custom_utility_bill:amount_due:gte:100" | jq -r .detail
```

```
kv field "amount_due" is a text field, which supports eq, not "gte"
```

`PUT` the config with the override. A `PUT` keeps the id — so `meta.config` (which is the
config **id**, with the human wording in `meta.configLabel`) on every document already
processed with it still resolves, and `?config=` filtering and `documentCount` keep
working. Delete-and-recreate would break all three. It also re-provisions both Knowledge
Box objects:

```bash
CFG=cfg_98dcddfa
curl -sS -b /tmp/dip-cookies.txt -X PUT "$B/api/v1/extraction-configs/$CFG" \
  -H 'Content-Type: application/json' \
  -d '{ "name": "Utility Bill",
        "fields": [ { "label": "Provider", "required": true },
                    { "label": "Account Number" },
                    { "label": "Amount Due", "kvType": "float" } ] }' \
  | jq '{provisioning, amount_due: (.fields[] | select(.key=="amount_due"))}'
```

```json
{
  "provisioning": {
    "state": "provisioned",
    "searchConfiguration": { "name": "dip_custom_utility_bill", "state": "provisioned" },
    "keyValueSchema": {
      "state": "provisioned",
      "at": "2026-09-13T08:38:03.100Z",
      "schemaId": "dip_custom_utility_bill",
      "fields": 3
    }
  },
  "amount_due": {
    "key": "amount_due", "label": "Amount Due", "type": "string",
    "required": false, "kvType": "float"
  }
}
```

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
     "$B/api/v1/documents?kv=dip_custom_utility_bill:amount_due:gte:100"
# 200  (zero matches — nothing has been processed with this config — but the filter is now legal)
```

The override is validated, not merely accepted: `kvRepeated` is legal on `text` only and
`kvRange` on `integer`/`float`/`date` only, and an illegal combination throws at
provisioning time rather than silently coercing.

If you want to see the skip path, force a document through this config. The mock's
extraction for fields a document does not contain returns placeholder text, which cannot
become a float:

```bash
curl -sS -X POST "$B/api/v1/documents?config=$CFG" \
     -H 'Content-Type: text/plain' -H 'X-Filename: bill.txt' \
     --data-binary @public/samples/invoice.txt | jq -r .document.id
# … then, on the finished record:
curl -sS "$B/api/v1/documents/<id>" | jq '.meta.kv.skipped'
```

```json
[ { "field": "amount_due", "reason": "\"Amount Due (bill.txt)\" is not a float" } ]
```

That is the contract: `toKvData` coerces to the declared type, and **names the value when
it cannot** rather than writing something wrong or dropping it silently.

## 8. Clean up

```bash
curl -sS -b /tmp/dip-cookies.txt -o /dev/null -w '%{http_code}\n' -X DELETE "$B/api/v1/documents/$ID"
# 204
curl -sS -b /tmp/dip-cookies.txt -o /dev/null -w '%{http_code}\n' -X DELETE "$B/api/v1/extraction-configs/$CFG"
# 204
```

Deleting a custom config also deletes its key-value schema, which is what frees one of the
Knowledge Box's twenty back up.

## Notes on the choices

- **Why a key-value schema per config rather than one schema for the product.** ARAG
  allows 50 fields per schema and 20 schemas per Knowledge Box. One shared schema would
  collide the moment two document types used the same field name for different things (an
  invoice's `total` and a claim's `total`), and a key-value write is a *full replace* of
  one schema's data on one resource — so a shared schema would also mean whichever config
  wrote last erased the other's values. Per-config schemas keep both readable.
- **Why the mapping is derived on every call rather than stored.** It cannot then drift
  from the config that defines it. Editing a config re-provisions the schema and, on a
  rename, deletes the orphan; deleting a config deletes the schema.
- **Why nothing in the provisioned schema is marked `required`** — even though the
  config's own `required` list is honoured everywhere else, and the mapper still projects
  `required` faithfully. Verified live: ARAG refuses the **entire** key-value write when a
  required key is absent, and the write is a full replace. One un-extracted required field
  on one faded scan would therefore cost that resource every value the pipeline *did*
  extract. A required flag that turns a partial success into a total loss is not a safety
  property, so `provisionable()` in `src/services/configs.ts` strips it (DP-47). The
  requirement survives where it is useful: the extraction still asks for the field, and
  the record still reports "required by the extraction config but not extracted" as a
  skip.
- **Against the mock, a filter sees a write immediately. Against a live Knowledge Box it
  does not.** Measured on 2026-09-13: a value was readable through `show=values` the
  instant it was written, and still not returned by a `/find` key-value filter ~66 seconds
  later — and waiting for the resource to become *searchable* first did not help, because
  key-value indexing is a second asynchronous step with no status to wait on (DP-55). The
  mock is built for fast, deterministic tests, not to model production timing. Everything
  you proved about *correctness* here transfers; nothing you observed about *timing* does.
  The architect track's
  [`key-value-schema-design.md`](../../architect-track/key-value-schema-design.md) is
  where that finding gets its consequences.
