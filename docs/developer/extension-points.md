# Extension points

Where to make the six most common changes, with the file and the shape of the change.
None of these require touching the vendored platform.

## Add a document type (extraction schema)

`DOC_TYPE_VALUES` in [`src/types.ts`](../../src/types.ts) is the single source of truth for
document types — `DocType` is derived from it, `SCHEMAS` (`src/services/schemas.ts`) is
typed `Record<DocType, ExtractionSchema>`, and `openapi.ts` builds every `docType`/`doc_type`
enum from the same list, so the spec can never drift from the code.

1. Add the new type to the `DOC_TYPE_VALUES` array in `src/types.ts`. This alone won't
   compile yet — `SCHEMAS` is now missing an entry, which is the point: the compiler
   refuses until you add the schema.
2. Add an `ExtractionSchema` entry to `SCHEMAS` in
   [`src/services/schemas.ts`](../../src/services/schemas.ts) (`name`, `docType`,
   `description`, `properties`, `required`, `labels`). Use the `s()` / `money()` / `n()` /
   `arr()` helpers already in the file — in particular, declare monetary fields with
   `money()` (a string), never `n()` (a number): forcing the model to emit a JSON `number`
   for a currency string like `"$96,000.00"` is unreliable and frequently returns `0`.
   `validateNormalize` parses the string deterministically instead (see
   [`arag-integration.md`](../architecture/arag-integration.md)).
3. That's it for `openapi.ts` — its `docType`/`doc_type` enums are built from
   `DOC_TYPE_VALUES`, not maintained separately. `schemaToFields`, the config catalogue
   (`GET /api/v1/schemas`), the classifier, and provisioning (`provisionBuiltins`) all
   derive from `SCHEMAS` automatically too.

Test it in `test/agents.test.ts` — there is already a test that every schema is internally
consistent (every `required` key has a matching property, every property has a label).

## Add a pipeline stage

File: [`src/services/pipeline.ts`](../../src/services/pipeline.ts), function `runPipeline`.

Stages run inside `ctx.stage(name, message, fn, { soft: true, progress })`:

```ts
const result = await ctx.stage(
  "my-stage",
  "Doing the new thing…",
  async () => deps.agents.myNewAgent(resourceId, seed, ctx.signal),
  { soft: true, progress: 0.8 },
);
```

- `ctx.stage` times the call, emits `start`/`ok`/`error` `JobEvent`s (visible over SSE and
  in the admin job timeline) and records `durationsMs[name]`.
- `soft: true` (used by every stage in this product) means a thrown error is recorded as a
  stage error and the run **continues** with the best record so far — only a missing
  document record fails the whole job ([DP-09](../../DECISIONS.md)). Set `soft: false` only
  if the new stage's output is truly required for every downstream stage.
- `progress` is a 0–1 fraction shown in the UI; keep new stages between the neighbours you
  insert them next to (e.g. `0.6` between `extract` at `0.6` and `entities` at `0.75` means
  putting the new stage after extract, or renumber both).
- Add the stage name to `StageName` / `STAGES` in [`src/types.ts`](../../src/types.ts) — it
  is documentation, not enforced by the job runner, but the admin timeline and OpenAPI
  description of `jobEvents` list them.
- If the stage calls ARAG, put the actual call in
  [`src/services/agents.ts`](../../src/services/agents.ts) as a new method on `Agents`, not
  inline in the pipeline — keeps HTTP-shaped ARAG payloads out of the orchestrator and
  matches every existing stage (`classify`, `extractFields`, `enrichEntities`, `summarize`).
- Sequence, don't parallelise, calls against the *same* resource: two concurrent
  `full_resource` generations against one resource can make one of them return empty (see
  the comment above the `entities`/`summary` stages in `pipeline.ts`).

## Add an export format

File: [`src/services/formats.ts`](../../src/services/formats.ts).

1. Add the format to the `Format` type (`"json" | "xml" | "csv" | "yourformat"`) and to the
   `MIME` map.
2. Write a pure `toYourFormat(rec: DocumentRecord): string` function — no I/O, so it stays
   unit-testable like `toJson`/`toXml`/`toCsv` in `test/formats.test.ts`.
3. Add a `case` to `serialize()`.
4. Update `openapi.ts`: the `format` enum on `GET /api/v1/documents/{id}/export` and the
   `200` response's `content` map (add the MIME type). **Do this before wiring the route** —
   the contract test `missingFromSpec()` and the export route's `FORMATS` set
   (`src/routes/documents.ts`) both need the new value, and `FORMATS` is what actually gates
   the request (`400` if not in the set).

## Add a route

Follow the API-first rule (STANDARDS §4, non-negotiable):

1. **`src/openapi.ts` first.** Add the path/method, `operationId`, `tags`, `summary`,
   request/response schemas, and `security` (`apiSecurity` or `adminSecurity`, defined at
   the top of the file). Reuse `jsonBody()`, `jsonResponse()`, `pageSchema()`,
   `standardResponses` from the platform (`vendor/arag-platform/src/index.ts`).
2. **Then `src/routes/*.ts`.** Add a thin handler in the relevant module (`documents.ts`,
   `jobs.ts`, `configs.ts`, or `admin.ts`) that calls into a `services/` method. Pass
   `validate: operationSchemas(openapi, "<path>", "<method>")` so the platform validates
   params/query/body against what you just wrote in step 1, and `operationId` matching the
   spec so contract tests can map the route back to it.
3. Put the actual logic in `src/services/*.ts`, not the route handler — routes stay HTTP
   plumbing (auth mode, status codes, headers), services stay HTTP-type-free and unit
   testable.
4. Run `make check`: `missingFromSpec()` fails the build if the route isn't in the spec,
   `lintSpec()` checks the spec itself (operationIds, tags, resolvable `$ref`s), and
   `checkResponse()` (used in `test/api.test.ts`) validates a real response against the
   declared schema.

## Swap the store

[`Store`](../../vendor/arag-platform/src/store/jsonstore.ts) is a small interface: one JSON
file per named `Collection` under `DATA_DIR`, in-memory index, debounced atomic writes. It
is intentionally minimal (MVP-scale, single-instance — see
[`architecture/limits.md`](../architecture/limits.md)). To move to Postgres/Redis at GA:

- Everything that touches storage goes through `store.collection<T>("name")`, used in
  exactly three places: `DocumentsService` (`"documents"`), `ConfigsService`
  (`"extraction-configs"`), and `JobManager` (`"jobs"`, inside the platform).
- Replace the `Collection<T>` implementation (same `get`/`list`/`put`/`update`/`delete`
  signature) behind `Store.collection()` — nothing in `src/services/*.ts` or
  `src/routes/*.ts` references `jsonstore.ts` directly, so a drop-in replacement needs no
  product-code changes. This lives in the platform, so the change happens in
  `arag-platform`, then `make sync-platform`.
- `Collection.list()`'s `filter`/`sort`/`offset`/`limit` shape is what `DocumentsService.list`
  and `ConfigsService.customs()` rely on for pagination — preserve that contract (or move
  filtering into the new backend's query layer and keep the same TypeScript signature).

## The `answerHook` seam (mock ARAG behaviour in tests)

[`startMockArag()`](../../vendor/arag-platform/src/arag/mock/server.ts) accepts an
`answerHook(effective, { text, resources })` option that intercepts `/ask` calls before the
mock's default heuristic answer generator runs. Use it in tests to control exactly what a
given extraction call returns, without needing a real ARAG account:

```ts
const product = await createProduct(env, {
  mock: {
    answerHook: (req, { resources }) => {
      // req is the raw /ask body; return { answer } or { answerJson }, or null to fall
      // through to the mock's default per-field synthesis.
      if (req.search_configuration && resources[0]?.title === "retry-me.txt") {
        return { answerJson: {} }; // force an empty extraction once, to test the retry
      }
      return null;
    },
  },
});
```

See `test/pipeline.test.ts`: `"extraction retries once when the model returns nothing"`
uses `answerHook` to force one empty `answer_json` for a specific document title so the
pipeline's retry-once-on-empty guard is exercised deterministically. `"config=agent reads
fields a Data Augmentation agent persisted on the resource"` reaches straight into the mock
instead — `product.mock!.mock.resources.get(documentId)!.fields.da_fields = { kind: "text",
body: JSON.stringify(persisted), ... }` — to simulate a DA "ask" agent writing a JSON text
field onto the resource, then re-submits the job with `config: "agent"`. Both are the seam
to reach for whenever a test needs a specific classification, a specific set of extracted
fields, or an empty-then-retry scenario, rather than editing vendored mock files.
