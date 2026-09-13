# Solution 5 — Test `toMarkdown` and get `make check` green

## 1. The test

Add to `test/formats.test.ts`, importing `toMarkdown` alongside the existing imports:

```ts
import { serialize, toCsv, toJson, toMarkdown, toXml } from "../src/services/formats.ts";
```

```ts
test("toMarkdown renders a heading, a field table, entities and issues", () => {
  const md = toMarkdown(sample());
  assert.match(md, /^# invoice\.pdf/);
  assert.match(md, /\*\*Type:\*\* invoice/);
  assert.match(md, /\| Vendor \| Acme Robotics <Pty> & Co \| 0\.95 \|/);
  assert.match(md, /## Entities\n- \*\*ORG\*\*: Acme Robotics/);
  assert.match(md, /## Issues\n- \[warning\] tax: subtotal \+ tax ≠ total/);
});

test("toMarkdown escapes a literal pipe in a field value", () => {
  const rec = sample();
  rec.fields = [{ key: "note", label: "Note", value: "A | B", confidence: 0.9 }];
  const md = toMarkdown(rec);
  assert.match(md, /\| Note \| A \\\| B \| 0\.90 \|/);
});

test("serialize dispatches markdown too", () => {
  assert.equal(serialize(sample(), "markdown"), toMarkdown(sample()));
});
```

Also extend the existing `"serialize dispatches by format"` test (don't leave two tests
with the same near-duplicate assertion) — or fold the `markdown` case into it directly:

```ts
test("serialize dispatches by format", () => {
  const rec = sample();
  assert.equal(serialize(rec, "json"), toJson(rec));
  assert.equal(serialize(rec, "xml"), toXml(rec));
  assert.equal(serialize(rec, "csv"), toCsv(rec));
  assert.equal(serialize(rec, "markdown"), toMarkdown(rec));
});
```

(If you fold it in, drop the separate `"serialize dispatches markdown too"` test above —
don't keep both.)

## 2. Run it in isolation

```bash
node --test --test-reporter=spec test/formats.test.ts
```

Before your change, this file has 9 passing tests (verified against the mock, commit
`2c9cc30` on `mvp`) — `toJson`, `toXml`, `toCsv`, `serialize dispatches by format`,
`csvCell neutralises …`, `toCsv escapes a malicious …`, `toXml includes verified
evidence …`, `toCsv carries each field's quote …`, `serializeMany bundles …`. Adding the
two `toMarkdown` tests above (and folding the dispatch check into the existing
`"serialize dispatches by format"` test rather than adding a third) takes it to 11:

```
✔ toJson round-trips to the same object
✔ toXml escapes special characters and is well-formed-ish
✔ toCsv emits one row per field with a header and quotes risky cells
✔ serialize dispatches by format
✔ csvCell neutralises spreadsheet formula injection but leaves numbers alone
✔ toCsv escapes a malicious extracted value and a malicious quote
✔ toXml includes verified evidence and the grounding score
✔ toCsv carries each field's quote and verification alongside its value
✔ serializeMany bundles records, and stays well formed with nothing selected
✔ toMarkdown renders a heading, a field table, entities and issues
✔ toMarkdown escapes a literal pipe in a field value
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

## 3. Run the full suite, then `make check`

```bash
node --test --test-reporter=spec 'test/*.test.ts'   # fail 0
make check
```

The verified baseline for this codebase (commit `2c9cc30` on `mvp`, before this
exercise) is **241 tests, pass 241, fail 0**. Your two new tests take the full suite to
**243** — confirm your own run reports that count and `fail 0`, rather than trusting a
number pasted here: the exact figure moves if you've also kept earlier exercises' code
in your working tree, or wrote a different number of tests than this solution did.
`make check` (Biome, `tsc --noEmit`, and the 80%-line-coverage run) should exit `0`.

## Why this test, and not something looser

- **`assert.match` on specific substrings, not `assert.ok(md.length > 0)`**: a test that
  only checks "something came back" would pass even if `toMarkdown` returned garbage —
  every other test in this file (`toXml`, `toCsv`) asserts on the *shape* of the output
  for exactly this reason, and the new test should match that bar, not lower it.
- **A dedicated escaping test**: the pipe-escaping branch (`mdCell`) is the one piece of
  non-obvious logic in the whole function — everything else is string concatenation. If
  a test suite only covers the "happy path" fixture (whose only field value containing a
  `|` is the vendor name, and only coincidentally), a regression in `mdCell` could ship
  unnoticed. This mirrors why `toCsv`'s existing test specifically constructs a
  comma-and-quote-containing value rather than relying on the fixture to happen to
  contain one.
- **No ARAG mock needed**: `formats.ts` has no I/O, so this whole exercise never touches
  `ARAG_MOCK`, `createProduct`, or a `JobManager` — proof that the "does it need the
  mock KB" question depends entirely on which layer you're testing, not on which file
  you're editing.
