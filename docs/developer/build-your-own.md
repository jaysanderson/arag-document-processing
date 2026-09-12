# Build your own on this product

[White-labelling](white-label.md) covers what you can change with environment variables.
This page is the next step: forking Document Processing and making it yours — a vertical
document product, an embedded feature in a larger platform, or a starting point for
something different.

It is ordered by how much you have to take on, cheapest first. Most partner work stops at
step 2.

## 0. Before you fork: can configuration do it?

| You want | You need |
|---|---|
| Your name, logo, colours, no Progress credit | Configuration — [white-label.md](white-label.md) |
| Different fields extracted from a document | **No fork** — `POST /api/v1/extraction-configs` at runtime |
| A new document *type* in the built-in catalogue | A fork, step 1 |
| A different pipeline, extra stages, your own storage | A fork, steps 2–4 |
| Your own UI on top of the API | No fork — the API is the product; see [examples.md](examples.md) |

The last row matters: every surface here is a client of `/api/v1`. If you are building your
own front end, you do not need this repository's code at all, only its API.

## 1. Add a document type

The eleven built-in types live in one place. `DOC_TYPE_VALUES` in
[`../../src/types.ts`](../../src/types.ts) is the single source of truth — `DocType` is
derived from it, `SCHEMAS` is `Record<DocType, ExtractionSchema>`, and the OpenAPI enums are
built from the same array.

1. Add your type to `DOC_TYPE_VALUES`. `tsc --noEmit` will now fail: `SCHEMAS` is missing a
   key. That failure is the guard rail — it is telling you step 2 is compulsory.
2. Add the schema to `SCHEMAS` in [`../../src/services/schemas.ts`](../../src/services/schemas.ts):
   `properties`, `labels` for every property, and the `required` keys. Declare money as
   `money()` (a string, normalised to a number afterwards — see
   [`../architecture/arag-integration.md`](../architecture/arag-integration.md)).
3. Re-provision so the stored ARAG search configuration picks it up:
   `POST /api/v1/admin/provision`.

Nothing else changes: `GET /api/v1/schemas`, the operator app's upload config selector, the
admin configs table and the OpenAPI document all derive from those two edits. The
[developer lab](../../enablement/developer-track/LAB.md) walks through exactly this.

## 2. Change what the agents do

[`../../src/services/agents.ts`](../../src/services/agents.ts) holds the grounded ARAG calls
— classify, extract, entities, summarise — plus the deterministic `validateNormalize` and
the evidence verifier. Common changes:

- **A different grounding prompt** — `GROUNDING` is one constant, baked into every stored
  search configuration.
- **More or fewer agents** — the pipeline in
  [`../../src/services/pipeline.ts`](../../src/services/pipeline.ts) is a linear list of
  `stage(...)` calls. Add one, delete one, reorder. Add its name to `StageName` in
  `src/types.ts` so the API keeps describing itself accurately.
- **Different normalisation** — `AMOUNT_KEYS`, `parseAmount`, `parseDateISO` and
  `normalizeCurrency` are pure functions with their own unit tests.
- **Your own verification rules** — `verifyEvidence` decides what counts as grounded. If
  your domain needs stricter matching (exact only, say), that is a one-line change.

See [extension-points.md](extension-points.md) for the exact seams.

## 3. Add or change API surface

The rule is **spec first**: add the operation to
[`../../src/openapi.ts`](../../src/openapi.ts), then implement it in `src/routes/`. The
contract tests (`missingFromSpec`, `lintSpec`, `checkResponse`) fail the build if a route is
undocumented or a response drifts from its schema, which is the point.

Validation comes from the spec — `validate: operationSchemas(openapi, "<path>", "<method>")`
— so you do not hand-write request checks. Writes to shared state should go through
`requireWriter` in [`../../src/routes/guards.ts`](../../src/routes/guards.ts).

## 4. Replace the storage

`Store`/`Collection` (JSON files under `DATA_DIR`) is deliberately a small interface:
`get`, `put`, `list`, `delete`, `size`. Swapping it for Postgres, DynamoDB or Redis means
implementing that interface and passing it to `createProduct` — the services never touch the
filesystem directly. This is the first thing to change for multi-instance deployments; see
[`../architecture/scaling.md`](../architecture/scaling.md).

## 5. Staying on the platform

The shared platform is vendored at `vendor/arag-platform/` and **must never be edited in
place** — a sync overwrites it. To take platform fixes:

```bash
cd ../arag-platform && make sync-platform TARGET=../your-fork
```

If you need platform behaviour that does not exist, do what this product does: work around
it locally, leave a comment naming the gap, and raise it upstream. Two examples you can read
in this repository are the multipart parsing in
[`../../src/routes/documents.ts`](../../src/routes/documents.ts) and the mock evidence hook
in [`../../src/services/mock-evidence.ts`](../../src/services/mock-evidence.ts) — extra mock
behaviour belongs in an `answerHook`, never in a vendored file.

## 6. Keeping the quality bar

Inherit these; they are what makes the fork maintainable:

```bash
make check      # Biome, tsc --noEmit, tests with the 80 % coverage gate, dependency audit
make e2e        # Playwright over the operator app and the admin app against the mock ARAG
make links      # every relative documentation link resolves
make smoke      # opt-in live run against a real Knowledge Box; cleans up after itself
```

`ARAG_MOCK=1` means contributors need no credentials and no LLM spend. Keep it working: it
is the difference between a fork people can contribute to and one only you can build.

## 7. Licence

Apache-2.0 ([`../../LICENSE`](../../LICENSE)). You may fork, modify, rebrand and sell — keep
the licence and notices, mark files you changed, and read the trademark note in
[white-label.md](white-label.md#licence-and-trademark-obligations) before you name anything.

## Related

- [quickstart.md](quickstart.md) · [local-dev.md](local-dev.md) · [examples.md](examples.md)
- [`../architecture/architecture.md`](../architecture/architecture.md) — how the pieces fit
- [`../../enablement/developer-track/LAB.md`](../../enablement/developer-track/LAB.md) — a
  guided version of steps 1–3
