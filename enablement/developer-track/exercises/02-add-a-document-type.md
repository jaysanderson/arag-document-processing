# Exercise 2 — Add a new document type

**Time budget:** 20 minutes.
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
   least one field `required`.
3. Confirm `GET /api/v1/schemas` and `GET /api/v1/openapi.json` both show
   `insurance_card` with no further edits — the schema/spec should already be in sync.
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
- [ ] Uploading a document with `?config=insurance_card` produces a record with
      `docType: "insurance_card"` and `meta.schema` ending in `insurance_card_extraction`.
- [ ] `make test` passes with **zero** failures, with **no test file edited** — the
      built-in-count assertions are derived from `DOC_TYPE_VALUES.length`, not a literal
      number, so they move with you automatically.
- [ ] `make check` is green.

## Hints

- `SCHEMAS: Record<DocType, ExtractionSchema>` means the TypeScript compiler itself
  will tell you if you forget to add the twelfth key — that's a feature of the type,
  not a coincidence. Try step 1 in isolation first and actually read the compiler error;
  it's worth seeing once.
- Look at `medical_claim` and `preauthorisation` in `schemas.ts` for the closest
  existing analogues — an insurance card is much simpler than a claim, but shares the
  "scheme / member number" vocabulary.
- `schemaToFields()` in `schemas.ts` is what turns your schema into what the API and
  the demo UI actually render — you don't need to touch it, but it's worth reading to
  see how `labels`, `required` and `properties` combine.
- If you're wondering how the test suite avoids the "hardcoded count" trap this product
  used to have: search `test/api.test.ts` and `test/e2e/admin.spec.ts` for
  `DOC_TYPE_VALUES` — both import it from `src/types.ts` and assert against
  `DOC_TYPE_VALUES.length` rather than a literal `11` (or, now, `12`).

If you get stuck, [`solutions/02-add-a-document-type.md`](../solutions/02-add-a-document-type.md) has the full schema and
the exact two-file diff.
