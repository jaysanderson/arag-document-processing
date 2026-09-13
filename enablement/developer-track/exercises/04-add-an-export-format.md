# Exercise 4 — Add an export format

**Time budget:** 25 minutes.
**Matches:** LAB.md Section 4. Starter: `starter/markdown-export.snippet.ts`.

## Task

Add a fourth export format, `markdown`, to `src/services/formats.ts`, and wire it all
the way through the product: the type, the dispatcher, the route's format allowlist, and
the OpenAPI document.

1. Write `toMarkdown(rec: DocumentRecord): string` in `src/services/formats.ts` (start
   from `starter/markdown-export.snippet.ts`). It must produce:
   - a level-1 heading with the filename
   - the doc type and status
   - the summary, if present
   - a Markdown table of extracted fields (label, value, and — recommended —
     confidence)
   - an `## Entities` section, only if there are any entities
   - an `## Issues` section, only if there are any issues
2. Add `"markdown"` to the `Format` type and the `MIME` map, and a case to
   `serialize()`.
3. Add `"markdown"` to the `FORMATS` `Set` in `src/routes/documents.ts`.
4. Add `"markdown"` to the `format` enum and the `200` response content map for
   `/api/v1/documents/{id}/export` in `src/openapi.ts`.
5. Confirm `GET /api/v1/documents/{id}/export?format=markdown` returns `200` with
   `Content-Type: text/markdown; charset=utf-8`.

**Stretch goal:** instead of (or in addition to) a new export format, add a pipeline
stage. A safe, testable option: a `redact` stage in `src/services/pipeline.ts`, run
after `validate` and before `standardize`, that masks anything in `record.fields`
matching a simple PII pattern (e.g. a 13–19 digit run that looks like a card number).
Use `ctx.stage(name, message, fn, { soft: true, progress })`, exactly like every
existing stage — and add `"redact"` to the `StageName` union and the `STAGES` array in
`src/types.ts` first, the same single-source-of-truth pattern `DOC_TYPE_VALUES` follows
in Exercise 2; `stage()`'s first parameter is typed `StageName`, so this won't
type-check until you do.

## Acceptance criteria

- [ ] `toMarkdown` contains no `await`, no `fetch`, and no reference to `AragClient` —
      it is a pure function, like `toJson`/`toXml`/`toCsv`.
- [ ] A Markdown table cell containing a literal `|` does not break the table (it is
      escaped, not left raw).
- [ ] `serialize(rec, "markdown")` returns the same string as calling `toMarkdown(rec)`
      directly.
- [ ] `curl .../export?format=markdown` returns `200` with the correct content type.
- [ ] `curl .../export?format=bogus` still returns `400` (the `FORMATS` Set correctly
      rejects unknown values — you haven't accidentally made it permissive).
- [ ] `testing.lintSpec(openapi)` and `testing.missingFromSpec(...)` (the contract
      tests in `test/api.test.ts`) still pass after your `openapi.ts` edit.

## Hints

- `flatValue()` in `formats.ts` already turns an `ExtractedField["value"]` (which can be
  a string, number, boolean, null, or an array of those) into a display string — reuse
  it, don't reimplement it.
- Compare your escaping approach to `escapeXml` (for XML) and `csvCell` (for CSV) in the
  same file — every format needs its own escaping rule because each format has
  different "dangerous" characters.
- The `FORMATS` Set in `routes/documents.ts` is what turns an unrecognised
  `?format=` into a `400 badRequest`, before `deps.documents.export()` is ever called —
  read that guard clause before you touch it.

If you get stuck, [`solutions/04-add-an-export-format.md`](../solutions/04-add-an-export-format.md) has the complete,
working `toMarkdown` function and every wiring diff.
