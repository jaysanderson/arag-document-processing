# Exercise 5 — Write a test against the mock ARAG and get `make check` green

**Time budget:** 15 minutes.
**Matches:** LAB.md Section 5. Depends on Exercise 4 (or the stretch pipeline-stage
option) being done first.

## Task

1. Add a unit test to `test/formats.test.ts` for `toMarkdown` (from Exercise 4),
   following the exact style of the existing `toXml`/`toCsv` tests: reuse the file's
   `sample()` fixture, assert on specific substrings/structure with `assert.match`, not
   just "it doesn't throw".
2. Run just that file (`node --test --test-reporter=spec test/formats.test.ts`) and
   confirm it passes on its own.
3. Run the full suite (`make test`) and confirm nothing else regressed.
4. Run `make check` (lint + typecheck + coverage) and get it fully green.

If you did the stretch goal in Exercise 4 (a `redact` pipeline stage) instead of, or as
well as, the export format, write an **integration** test instead: extend
`test/pipeline.test.ts`'s pattern (boot the product against the mock ARAG with
`createProduct`, upload a document containing a fake card number, wait for the job, and
assert the field's value in the finished record is masked).

## Acceptance criteria

- [ ] The new test asserts on at least three distinct, specific things about the
      output (not just that a function returns a truthy string).
- [ ] `node --test --test-reporter=spec test/formats.test.ts` (or `test/pipeline.test.ts`
      for the stretch option) shows your test passing by name.
- [ ] `make test` reports `fail 0`.
- [ ] `make check` exits `0` — Biome, `tsc --noEmit`, and the 80%-line-coverage test run
      all pass.
- [ ] You did **not** add a live-ARAG dependency anywhere — the mock
      (`ARAG_MOCK=1`, the default under `make test`) is the only backend your new test
      talks to.

## Hints

- `test/formats.test.ts` has no `before`/`after` hooks and no server — it calls the pure
  functions directly. That's the simplest test in the whole suite to model yours on.
- If you're doing the pipeline-stage stretch goal instead, `test/pipeline.test.ts`
  already shows the pattern for injecting extra mock behaviour via `answerHook` without
  touching any vendored platform file — copy that shape, don't reinvent it.
- `make coverage` (which `make check` calls) excludes `src/index.ts` from the line-count
  gate but includes everything else in `src/**` — a completely untested new function
  will show up as a coverage drop even if every other test still passes.
- If Biome complains about formatting after you paste code in, `make format` fixes it
  automatically — don't hand-format to match Biome's rules.

If you get stuck, [`solutions/05-write-a-test.md`](../solutions/05-write-a-test.md) has the finished test and the full
`make check` output.
