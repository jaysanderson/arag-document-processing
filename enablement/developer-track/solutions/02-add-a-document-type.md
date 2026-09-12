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
src/services/schemas.ts(58,14): error TS2741: Property 'insurance_card' is missing in
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
    valid_from: s("Card valid-from date in ISO 8601 if determinable"),
    valid_to: s("Card valid-to / expiry date in ISO 8601 if determinable"),
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
  },
},
```

**Choices explained:**

- All fields use the `s()` (string) helper — a card carries no monetary amount, so
  `money()` never comes up, and nothing here needs `n()` (number) or `arr()` (array).
- `required: ["scheme", "member_number"]` mirrors `medical_claim`'s single required
  field (`provider`) and `preauthorisation`'s (`member_number`) — a card with neither an
  insurer name nor a membership number isn't usefully an insurance card record, but
  everything else (member name, plan, dates) is commonly present but not load-bearing.
- `valid_from`/`valid_to` follow the same "ISO 8601 if determinable" phrasing as every
  other date field in the file (`invoice_date`, `due_date`, `service_date`, …) — this
  wording is what `validateNormalize`'s `*_date` heuristic keys off downstream
  (any key ending `_date` gets run through `parseDateISO`), and it's also the
  instruction the model itself receives, since `description` is sent verbatim as part
  of the `answer_json_schema`.

Now `tsc --noEmit -p tsconfig.json` passes.

## 3. Confirm the spec and schema catalogue updated themselves

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
(imported from `types.ts`), so step 1 alone already fixed the spec. This is the entire
point of the single-source-of-truth refactor: before it existed, `openapi.ts` kept its
own independent copy of this list, and it was easy to update `schemas.ts` and forget the
spec (or vice versa) — see the note at the end of this document for what that used to
look like.

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

Every one of these passes **without editing a single test file.** `test/api.test.ts`'s
extraction-config and schema-catalogue tests, and `test/e2e/admin.spec.ts`'s admin
config-table assertion, all import `DOC_TYPE_VALUES` from `src/types.ts` and assert
against `DOC_TYPE_VALUES.length` — the count moves with the source of truth.

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
