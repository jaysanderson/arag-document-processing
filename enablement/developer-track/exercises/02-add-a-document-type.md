# Exercise 2 — Add a new document type

**Time budget:** 25 minutes.
**Matches:** LAB.md Section 2. Starter: `starter/insurance-card.schema.ts`.

## Task

Add `insurance_card` as a twelfth built-in document type: a health/medical insurance
membership card. Wire it all the way through so it is indistinguishable, from the API's
point of view, from any of the other eleven built-ins.

Concretely:

1. Add `"insurance_card"` to `DOC_TYPE_VALUES` in `src/types.ts` — this is the single
   source of truth for every document-type list in the product (`DocType` is derived
   from it, and `src/openapi.ts` builds its `docType` enums from the same array, so
   there is no separate spec-side list to edit).
2. Design and add an `ExtractionSchema` for it in `src/services/schemas.ts`'s `SCHEMAS`
   object (start from `starter/insurance-card.schema.ts`). Decide your own field list —
   at minimum capture the scheme/insurer name and a member/policy number, and mark at
   least one field `required`. Every extraction config now also provisions a
   **key-value schema** in the Knowledge Box (DP-46), so give the date fields the file's
   `date()` helper (not plain `s()`) and, if you add an amount field, `money()` — both
   attach a `kv:` type hint that decides how the field is filterable later, not just
   how it's described to the model.
3. Confirm `GET /api/v1/schemas` and `GET /api/v1/openapi.json` both show
   `insurance_card` with no further edits — the schema/spec should already be in sync.
   Confirm `GET /api/v1/extraction-configs/insurance_card` reports both halves of the
   provisioning.
4. Add a case to `test/agents.test.ts`'s (or your own new) unit test confirming your
   schema's required keys all exist in its properties and every property has a label —
   or confirm the existing "every schema is internally consistent" test already covers
   this generically (it does — check that it does, and that it passes, for your
   addition).

## Acceptance criteria

- [ ] After step 1 alone (before step 2), `tsc --noEmit -p tsconfig.json` **fails** with
      a missing-key error on `SCHEMAS` — this is expected and is the point, not a bug to
      work around. Confirm you see it before moving on to step 2.
- [ ] After step 2, `tsc --noEmit -p tsconfig.json` passes.
- [ ] `GET /api/v1/schemas` includes an item with `docType: "insurance_card"`.
- [ ] `GET /api/v1/openapi.json`'s `Document.properties.docType.enum` includes
      `"insurance_card"` — with no edit to `openapi.ts` at all.
- [ ] `GET /api/v1/extraction-configs/insurance_card` reports a `kvSchemaId` and
      `kvFields`, and `provisioning.state` is `provisioned` with **both**
      `searchConfiguration` and `keyValueSchema` reported inside it.
- [ ] Uploading a document with `?config=insurance_card` produces a record with
      `docType: "insurance_card"` and `meta.schema` ending in `insurance_card_extraction`.
- [ ] `make test` passes with **zero** failures, with **no test file edited** — the
      built-in-count assertions are derived from `DOC_TYPE_VALUES.length`, not a literal
      number, so they move with you automatically. Baseline before your change: 241
      tests, pass 241, fail 0.
- [ ] `make check` is green.

## Hints

- `SCHEMAS: Record<DocType, ExtractionSchema>` means the TypeScript compiler itself
  will tell you if you forget to add the twelfth key — that's a feature of the type,
  not a coincidence. Try step 1 in isolation first and actually read the compiler error;
  it's worth seeing once.
- Look at `medical_claim` and `preauthorisation` in `schemas.ts` for the closest
  existing analogues — an insurance card is much simpler than a claim, but shares the
  "scheme / member number" vocabulary.
- `schemaToFields()` in `schemas.ts` is what turns your schema into what the API and the
  workspace UI actually render (the record's JSON view at `#/documents/:id/json` and the
  config detail page at `#/configs/:id`) — you don't need to touch it, but it's worth
  reading to see how `labels`, `required`, `properties` and each field's `kv` hint
  combine.
- `s()`, `date()` and `money()` are all thin wrappers around the same `JsonProp` shape —
  read their docstrings at the top of `schemas.ts` (roughly lines 35–100) before picking
  which one to use per field. `date()` differs from `s()` only by attaching
  `kv: { type: "date" }`; `money()` differs by attaching `kv: { type: "float" }` while
  still declaring the property itself as a `string` (so "$96,000.00" survives on the
  record, not just its float projection).
- If you're wondering how the test suite avoids the "hardcoded count" trap this product
  used to have: search `test/api.test.ts` and `test/e2e/admin.spec.ts` for
  `DOC_TYPE_VALUES` — both import it from `src/types.ts` and assert against
  `DOC_TYPE_VALUES.length` rather than a literal `11` (or, now, `12`).

If you get stuck, [`solutions/02-add-a-document-type.md`](../solutions/02-add-a-document-type.md) has the full schema and
the exact two-file diff.
