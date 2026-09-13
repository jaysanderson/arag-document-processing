# Solution 2 — Add a new document type (`insurance_card`)

## 1. `src/types.ts` — extend the single source of truth

```ts
export const DOC_TYPE_VALUES = [
  "invoice",
  "receipt",
  "contract",
  "resume",
  "purchase_order",
  "medical_claim",
  "preauthorisation",
  "bank_statement",
  "form",
  "report",
  "generic",
  "insurance_card",
] as const;

export type DocType = (typeof DOC_TYPE_VALUES)[number];
```

`DocType` is a derived type, not a hand-written union — `DOC_TYPE_VALUES` is the one
place this list is spelled out. `src/openapi.ts` imports `DOC_TYPE_VALUES` directly and
builds every `docType` enum in the spec from it, and `SCHEMAS` in `schemas.ts` is typed
`Record<DocType, ExtractionSchema>`. **Stop here and run `tsc --noEmit -p tsconfig.json`
before doing anything else** — it fails with something like:

```
src/services/schemas.ts(99,14): error TS2741: Property 'insurance_card' is missing in
type '{ invoice: {...}; ... }' but required in type 'Record<... | "insurance_card",
ExtractionSchema>'.
```

This is the guard rail working exactly as designed: the compiler itself refuses to
build until `SCHEMAS` has an entry for the type you just added — there is no way to
half-add a document type and have it silently compile.

## 2. `src/services/schemas.ts` — add the schema

Add this entry to the `SCHEMAS` object (placed just before `generic:`, matching the
file's existing "specific types first, catch-alls last" order — functionally the
position doesn't matter, `SCHEMAS` is a plain object):

```ts
insurance_card: {
  name: "insurance_card_extraction",
  docType: "insurance_card",
  description: "Structured fields from a health/medical insurance membership card.",
  properties: {
    scheme: s("Medical scheme / insurer name"),
    member_name: s("Name of the principal member printed on the card"),
    member_number: s("Membership / policy number"),
    plan_name: s("Plan / benefit option name"),
    dependant_code: s("Dependant code, if this card is for a dependant"),
    valid_from: date("Card valid-from date in ISO 8601 if determinable"),
    valid_to: date("Card valid-to / expiry date in ISO 8601 if determinable"),
    co_payment: money("Standard co-payment amount printed on the card, if any"),
  },
  required: ["scheme", "member_number"],
  labels: {
    scheme: "Scheme / Insurer",
    member_name: "Member Name",
    member_number: "Member #",
    plan_name: "Plan",
    dependant_code: "Dependant Code",
    valid_from: "Valid From",
    valid_to: "Valid To",
    co_payment: "Co-payment",
  },
},
```

**Choices explained:**

- Most fields use the `s()` (string) helper, same as any other schema in the file —
  nothing here needs `n()` (number) or `arr()` (array).
- `valid_from`/`valid_to` use `date()`, not `s()`. Every field in this file is a JSON
  Schema property *and* a key-value field declaration at once (DP-46 — see the
  `KvHint`/`JsonProp` docstrings at the top of `schemas.ts`, roughly lines 35–100):
  `date()` is identical to `s()` except it also attaches `kv: { type: "date" }`, so the
  field lands in the Knowledge Box's key-value schema as a `date`, which is what makes
  `gte`/`lte` filtering (`GET /api/v1/documents?kv=...:valid_to:lte:...`) work on it
  later. Using plain `s()` on a date field wouldn't break extraction — the model still
  returns the right string — it would just make that field kv `text`, where only `eq`
  is a legal operator, silently closing off range filtering.
- `co_payment` uses `money()`, not `s()`, for the same reason: `money()` keeps the
  property itself a `string` (so a value like "$25.00 copay" is captured and displayed
  exactly as printed) but attaches `kv: { type: "float" }`, so "cards with a co-payment
  over $50" becomes a filter instead of a full re-read of every card. This is the one
  field on this schema an insurance card actually carries that is a monetary amount —
  everything else here is identifiers and dates.
- `required: ["scheme", "member_number"]` mirrors `medical_claim`'s single required
  field (`provider`) and `preauthorisation`'s (`member_number`) — a card with neither an
  insurer name nor a membership number isn't usefully an insurance card record, but
  everything else (member name, plan, dates, co-payment) is commonly present but not
  load-bearing. Note DP-47: nothing you mark `required` here is enforced as required in
  the *provisioned* kv schema — ARAG refuses the whole kv write if a required key is
  missing, so the product strips `required` before provisioning. `required` still means
  something on the record's own `issues[]` (a missing `scheme` raises a validation
  issue) — it just isn't enforced a second time by the Knowledge Box.

Now `tsc --noEmit -p tsconfig.json` passes.

## 3. Confirm the spec, schema catalogue and provisioning updated themselves

```bash
curl -sS http://localhost:8080/api/v1/schemas | jq '.items | length'          # 12
curl -sS http://localhost:8080/api/v1/openapi.json \
  | jq '.components.schemas.Document.properties.docType.enum'
```

```json
["invoice","receipt","contract","resume","purchase_order","medical_claim",
 "preauthorisation","bank_statement","form","report","generic","insurance_card"]
```

No edit to `src/openapi.ts` was needed — it builds this enum from `DOC_TYPE_VALUES`
(imported from `types.ts`), so step 1 alone already fixed the spec.

```bash
curl -sS http://localhost:8080/api/v1/extraction-configs/insurance_card | jq '{kvSchemaId, kvFields, provisioning}'
```

`GET /api/v1/extraction-configs/{id}` reports the same shape for every built-in config —
this is the actual, live response for `invoice` (confirmed against the running mock;
`insurance_card` differs only in the field keys, which are your own):

```json
{
  "kvSchemaId": "dip_invoice_extraction",
  "kvFields": {
    "vendor_name": "vendor_name", "vendor_address": "vendor_address", "bill_to": "bill_to",
    "invoice_number": "invoice_number", "invoice_date": "invoice_date", "due_date": "due_date",
    "currency": "currency", "subtotal": "subtotal", "tax": "tax", "total": "total",
    "line_items": "line_items", "po_number": "po_number"
  },
  "provisioning": {
    "state": "provisioned",
    "searchConfiguration": { "name": "dip_invoice_extraction", "state": "provisioned" },
    "keyValueSchema": { "state": "provisioned", "at": "…", "schemaId": "dip_invoice_extraction", "fields": 12 }
  }
}
```

For `insurance_card`, expect `kvSchemaId: "dip_insurance_card_extraction"`,
`kvFields` with your eight property keys, and `provisioning.keyValueSchema.fields: 8`.
`provisioning.state` is `"provisioned"` only when **both** `searchConfiguration` and
`keyValueSchema` individually report `state: "provisioned"` — this is DP-46: adding a
schema now provisions two Knowledge Box objects, not one, and the product surfaces both
so a partial failure (search configuration provisioned, kv schema failed, or vice versa)
is visible instead of silently reported as one success.

No edit to `src/routes/configs.ts` or `src/services/configs.ts` was needed either — the
provisioning pipeline reads every entry out of `SCHEMAS`/`DOC_TYPES`, so a twelfth schema
is provisioned the same way the other eleven already are, at the same startup path.

## 4. Confirm the generic consistency test already covers you

`test/agents.test.ts`'s `"every schema is internally consistent"` test iterates
`DOC_TYPES` (from `schemas.ts`, itself `[...DOC_TYPE_VALUES]`, so it already includes
`insurance_card` once you've done step 2) and checks, for every schema, that every
`required` key exists in `properties` and every `properties` key has a `labels` entry.
You don't need to write a new test for this — you need to confirm this one still passes
for your addition, which it will if you copied the shape above correctly:

```bash
node --test --test-reporter=spec test/agents.test.ts
```

## Verifying the whole thing

```bash
node --test --test-reporter=spec 'test/*.test.ts'   # fail 0 — no test file touched
make check                                            # lint + typecheck + coverage, green
curl -sS http://localhost:8080/api/v1/schemas | jq '.items | length'   # 12
```

The verified baseline for this codebase (commit `2c9cc30` on `mvp`, before your change)
is **241 tests, pass 241, fail 0** — not the `39` an older version of this lab claimed.
Every one of the checks above passes **without editing a single test file.**
`test/api.test.ts`'s extraction-config and schema-catalogue tests, and
`test/e2e/admin.spec.ts`'s admin config-table assertion, all import `DOC_TYPE_VALUES`
from `src/types.ts` and assert against `DOC_TYPE_VALUES.length` — the count moves with
the source of truth.

## Why this is worth noticing

Earlier versions of this product kept the document-type list in three unsynced places:
a hand-written `DocType` union in `types.ts`, a duplicate array in `openapi.ts`, and a
literal `11` baked into three test assertions. Adding a type meant four coordinated
edits, and forgetting any one of them either broke the build (a missing `SCHEMAS` key),
silently drifted the public spec from the code (a stale `openapi.ts` enum), or left a
regression-catching test looking green when it had actually stopped checking anything
meaningful. Collapsing the list to one array (`DOC_TYPE_VALUES`) that everything else
derives from doesn't remove the compiler's guard rail (`SCHEMAS` is still
`Record<DocType, ExtractionSchema>`, so a missing schema still fails to compile) — it
just removes the *manual, easy-to-forget* synchronisation that used to be needed
alongside it. This is a good general lesson: a hardcoded count in a test is often a
symptom of a missing single source of truth in the code it's testing, not a permanent
fact of life to work around by hand every time.

The same lesson now applies one level deeper: `kv` annotations on a schema's properties
are the single source of truth for how that schema's fields behave as Knowledge Box
filters. Get the `date()`/`money()` choice right in `schemas.ts` and every consumer —
the config detail page, `GET /api/v1/documents?kv=...` filtering, the field-correction
audit trail — inherits it automatically, the same way `DOC_TYPE_VALUES` propagates.
