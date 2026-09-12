# Contributing

Full workflow, ground rules and PR checklist: [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).
This page adds the rules specific to working on this product's API and its vendored
platform dependency.

## API-first

`src/openapi.ts` is the single source of truth for `/api/v1`. Every change to a route —
new endpoint, new parameter, new response field — is made there **first**, then in
`src/routes/*.ts`. The contract tests enforce the order in CI, not just in review:

- `missingFromSpec(app, openapi)` fails if a registered route isn't described in the spec.
- `lintSpec(openapi)` fails on a missing `operationId`, missing `tags`, no responses, or an
  unresolvable `$ref`.
- `checkResponse(openapi, path, method, status, body)` validates real response bodies
  (`test/api.test.ts`) against the schema you declared.

See [`extension-points.md`](extension-points.md#adding-a-route) for the exact steps when
adding a route.

## The vendored platform

`vendor/arag-platform/` is a synced copy of the shared `arag-platform` repo — **never edit
it in place**. If you find a platform bug (as documented in
[`DECISIONS.md`](../../DECISIONS.md), DP-10, for the multipart Content-Type case), work
around it in product code and note the workaround with a comment pointing at the platform
issue, the way `src/routes/documents.ts` does. To pick up a real platform fix:

```bash
cd ../arag-platform && make sync-platform TARGET=../arag-doc-processing
```

This overwrites `vendor/arag-platform/` and bumps `PLATFORM_VERSION`; commit the result as
its own change, separate from product code changes.

## Conventional commits

`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:` — one logical change per commit,
`CHANGELOG.md` updated in the same PR (root `CONTRIBUTING.md` §Workflow).

## The bar before you're done

```bash
make check   # Biome + tsc --noEmit + unit/integration/contract tests, coverage ≥ 80% on src/
make e2e     # Playwright: demo + admin happy paths against a mock-backed server
```

Both must be green before opening a PR. If you touched the API surface, also run
`make docs` and commit the regenerated `docs/developer/api-reference.md` — it's generated,
but the generated output is still checked in and reviewed like any other file.
