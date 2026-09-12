# Exercise 2 — Add a new document type

**Time budget:** 20 minutes.
**Matches:** LAB.md Section 2. Starter: `starter/insurance-card.schema.ts`.

## Task

Add `insurance_card` as a twelfth built-in document type: a health/medical insurance
membership card. Wire it all the way through so it is indistinguishable, from the API's
point of view, from any of the other eleven built-ins.

Concretely:

1. Add `"insurance_card"` to the `DocType` union in `src/types.ts`.
2. Design and add an `ExtractionSchema` for it in `src/services/schemas.ts`'s `SCHEMAS`
   object (start from `starter/insurance-card.schema.ts`). Decide your own field list —
   at minimum capture the scheme/insurer name and a member/policy number, and mark at
   least one field `required`.
3. Add `"insurance_card"` to the local `DOC_TYPES` array in `src/openapi.ts`.
4. Update every test that hardcodes "there are 11 built-in document types" so the suite
   is green again (there is more than one — find them with a search rather than
   trusting a single memorised location).
5. Add a case to `test/agents.test.ts`'s (or your own new) unit test confirming your
   schema's required keys all exist in its properties and every property has a label —
   or confirm the existing "every schema is internally consistent" test already covers
   this generically (it does — check that it does, and that it passes, for your
   addition).

## Acceptance criteria

- [ ] `tsc --noEmit -p tsconfig.json` passes (the `SCHEMAS` object is
      `Record<DocType, ExtractionSchema>` — TypeScript enforces every `DocType` has an
      entry).
- [ ] `GET /api/v1/schemas` includes an item with `docType: "insurance_card"`.
- [ ] Uploading a document with `?config=insurance_card` produces a record with
      `docType: "insurance_card"` and `meta.schema` ending in `insurance_card_extraction`.
- [ ] `make test` passes with **zero** failures (not just zero *new* failures — the
      pre-existing hardcoded-count assertions must be updated, not skipped).
- [ ] `make check` is green.

## Hints

- `SCHEMAS: Record<DocType, ExtractionSchema>` means the TypeScript compiler itself
  will tell you if you forget to add the twelfth key — that's a feature of the type,
  not a coincidence.
- Search for the literal `11` across `test/` (not just `test/api.test.ts`) — one of the
  three places it's hardcoded lives in a Playwright e2e spec, not a unit test.
- Look at `medical_claim` and `preauthorisation` in `schemas.ts` for the closest
  existing analogues — an insurance card is much simpler than a claim, but shares the
  "scheme / member number" vocabulary.
- `schemaToFields()` in `schemas.ts` is what turns your schema into what the API and
  the demo UI actually render — you don't need to touch it, but it's worth reading to
  see how `labels`, `required` and `properties` combine.

If you get stuck, [`solutions/02-add-a-document-type.md`](../solutions/02-add-a-document-type.md) has the full schema, the exact
three-file diff, and the exact three test locations that need their count updated.
