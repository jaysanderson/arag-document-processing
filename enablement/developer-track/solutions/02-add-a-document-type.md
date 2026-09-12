# Solution 2 — Add a new document type (`insurance_card`)

## 1. `src/types.ts` — extend the `DocType` union

```ts
export type DocType =
  | "invoice"
  | "receipt"
  | "contract"
  | "resume"
  | "purchase_order"
  | "medical_claim"
  | "preauthorisation"
  | "bank_statement"
  | "form"
  | "report"
  | "generic"
  | "insurance_card";
```

## 2. `src/services/schemas.ts` — add the schema

Add this entry to the `SCHEMAS` object (placed just before `generic:` in the file, to
match its existing "specific types first, catch-alls last" ordering — order doesn't
matter functionally, `SCHEMAS` is a plain object keyed by `DocType`):

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

## 3. `src/openapi.ts` — extend the local `DOC_TYPES`

```ts
const DOC_TYPES = [
  "invoice", "receipt", "contract", "resume", "purchase_order", "medical_claim",
  "preauthorisation", "bank_statement", "form", "report", "generic",
  "insurance_card",
] as const;
```

This is a **second, independent** list from the one in `src/types.ts` — `openapi.ts`
does not import `DocType`, by design (the OpenAPI document is meant to be
self-describing and buildable without the rest of the product's types). Both lists
must be kept in sync by hand; nothing enforces it automatically except the fact that a
document classified as your new type would otherwise fail `checkResponse()`'s
schema validation against `Document.properties.docType.enum` the next time a test
exercises it.

## 4. Update the three hardcoded counts

Search each test file for a bare `11` used as an exact-equality/count assertion (not
`>= 11`, which is a different, looser check that does not need to change):

**`test/api.test.ts`**, in `"extraction configs: built-ins listed, custom created +
provisioned + deletable"`:

```ts
// before
assert.equal(builtins.filter((c2) => c2.builtin).length, 11);
// after
assert.equal(builtins.filter((c2) => c2.builtin).length, 12);
```

**`test/api.test.ts`**, in `"the schema catalogue lists every document type and its
fields"`:

```ts
// before
assert.equal(items.length, 11);
// after
assert.equal(items.length, 12);
```

**`test/e2e/admin.spec.ts`**, in `"admin: login is required, then health, configs, jobs,
logs and retention are usable"`:

```ts
// before
await expect(page.locator("#cfgTable tbody tr")).toHaveCount(11);
// after
await expect(page.locator("#cfgTable tbody tr")).toHaveCount(12);
```

Leave `assert.ok(out.ok >= 11);` in the `"admin provision re-creates every ARAG search
configuration"` test alone — it is a lower bound, not an exact count, and is still true
at 12.

## 5. Confirm the generic consistency test already covers you

`test/agents.test.ts`'s `"every schema is internally consistent"` test iterates
`DOC_TYPES` (from `schemas.ts`, which is derived from `Object.keys(SCHEMAS)`, so it
already includes `insurance_card` once you've done step 2) and checks, for every
schema, that every `required` key exists in `properties` and every `properties` key has
a `labels` entry. You don't need to write a new test for this — you need to confirm
this one still passes for your addition, which it will if you copied the shape above
correctly. Run it in isolation to be sure:

```bash
node --test --test-reporter=spec test/agents.test.ts
```

## Verifying the whole thing

```bash
node --test --test-reporter=spec 'test/*.test.ts'   # fail 0
make check                                            # lint + typecheck + coverage, green
curl -sS http://localhost:8080/api/v1/schemas | jq '.items | length'   # 12
```

## Why the count assertions exist at all

It would be easy to read "you have to go fix two unrelated-looking test failures" as
lab friction. It isn't: `assert.equal(items.length, 11)` (now `12`) is the thing that
would have caught a *regression* — someone accidentally deleting a built-in schema, or
a refactor that silently dropped one from `DOC_TYPES` — long before it reached
production. Adding a document type is supposed to be a deliberate, visible change to the
public contract; a test suite that let the count drift silently would be a worse test
suite, not a more convenient one.
