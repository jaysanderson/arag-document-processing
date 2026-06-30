# Architecture

Dependency-free Node + native TypeScript. The bridge serves both the web console and a
small JSON/SSE API, and is the only thing that talks to Progress Agentic RAG (ARAG).

## Module map (`bridge/src`)

| Module | Responsibility |
|---|---|
| `config.ts` | Env config + `.env` loader; derives the KB id from `ARAG_KB_URL`. |
| `logger.ts` | JSON-line structured logging. |
| `types.ts` | The canonical `DocRecord`, `ExtractedField`, `Entity`, `StageEvent`. |
| `arag.ts` | **The only ARAG client.** `upload`, `waitProcessed`, `waitSearchable`, `extractedText`, `ask` (NDJSON + `answer_json_schema` + `full_resource`), `deleteResource`. |
| `schemas.ts` | Per-document-type extraction JSON Schemas → `answer_json_schema`. |
| `agents.ts` | Data-augmentation agents: `classify`, `extractFields`, `enrichEntities`, `summarize`, plus deterministic `validateNormalize` and `buildQuerySeed`. |
| `normalize.ts` | Pure value normalizers: `parseAmount`, `parseDateISO`, `normalizeCurrency`. |
| `formats.ts` | Canonical record → JSON / XML / CSV (pure, fully tested). |
| `pipeline.ts` | Orchestrates the stages and emits `StageEvent`s for the live UI. |
| `server.ts` | Node stdlib HTTP: static UI + ingest + SSE + record/export + ask. |
| `index.ts` | Entry: validate config, listen. |

## The pipeline

```
ingest → process (PROCESSED → searchable) → classify → extract → entities → summary → validate → standardize → done
```

Each stage is timed and reported as an SSE `StageEvent` (`start` / `ok` / `error`), which
the browser renders as a live, lighting-up stepper.

## Key ARAG mechanics (learned by probing the live KB)

These four details are what make the demo reliable rather than flaky. Each was verified
against the live `DocumentProcessing` KB.

1. **Structured extraction via `answer_json_schema`.** Passing an OpenAI-function-style
   schema forces ARAG to return a validated object in `answer_json`. This is the
   "custom visual-LLM extraction" layer — the multimodal model fills the schema from the
   document. (`bridge/src/arag.ts`, `bridge/src/schemas.ts`)

2. **`full_resource` grounding.** Plain `/ask` only puts the *retrieved paragraphs* in
   the model's context, so a value in a non-matching paragraph (e.g. an invoice total)
   is missed. The `rag_strategies: [{ name: "full_resource" }]` strategy puts the **whole
   document** in context. Essential for extraction and summarization.

3. **Seed the retrieval query with real document text.** Even with `full_resource`,
   retrieval runs *first* to locate the resource; an instruction-style query
   ("list the entities") can share no vocabulary with the document and return
   `no_retrieval_data`. We fetch the processed text (`extractedText`) and use its opening
   as the query seed (`buildQuerySeed`) so retrieval always hits.

4. **`PROCESSED` ≠ searchable.** A resource's status flips to `PROCESSED` a few seconds
   before it becomes retrievable. Extracting too early yields empty results, so the
   pipeline gates on `waitSearchable` (a cheap `/find` poll) after `waitProcessed`.

Plus two robustness choices:

- **Amounts are extracted as strings, then normalized to numbers.** Forcing the model to
  emit a JSON `number` for `"$96,000.00"` frequently returns `0`. Schemas declare amounts
  as strings; `validateNormalize` parses them to numbers and keeps the raw value. It also
  checks `subtotal + tax ≈ total` and required-field presence.
- **Token budgets are generous.** A truncated structured response is *invalid* JSON and
  yields no `answer_json` at all (not a partial), so under-budgeting drops every field.

## Canonical record

One `DocRecord` per document (see `types.ts`): id, filename, contentType, docType (+
confidence), `fields[]` (label · value · raw · confidence), `entities[]`, summary, tags,
`issues[]`, and `meta` (timings, schema, model, source length). JSON is the record
verbatim; XML and CSV are deterministic projections.
