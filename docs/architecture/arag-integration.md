# ARAG integration

Everything this product does with Progress Agentic RAG goes through the shared platform
client (`vendor/arag-platform/src/arag/client.ts`). No product file knows an ARAG URL.

## Endpoints used

| Call | Where | Why |
|---|---|---|
| `POST /kb/{kb}/upload` (`X-FILENAME` base64, optional `?extract_strategy=`) | `services/documents.ts` | Ingest the document. Images and PDFs get the ingestion-time visual-LLM **extract strategy** when `DIP_EXTRACT_STRATEGY` is set. |
| `GET /kb/{kb}/resource/{rid}?show=basic` | `waitProcessed` | Poll `PENDING → PROCESSED`. |
| `POST /kb/{kb}/find` (`resource_filters`) | `waitSearchable`, `isSearchable` | Cheap "is it retrievable yet?" gate. |
| `GET /kb/{kb}/resource/{rid}?show=extracted&extracted=text` | `extractedText`, `readPersistedFields` | Processed text (for the query seed) and Data-Augmentation-agent output. |
| `POST /kb/{kb}/ask` (NDJSON) | every agent, `documents.ask` | Grounded generation, with `answer_json_schema` for structured extraction. |
| `POST /kb/{kb}/search_configurations/{name}` (`kind: "ask"`) | `services/configs.ts` | One stored configuration per extraction schema (`dip_<schema>`). |
| `DELETE /kb/{kb}/resource/{rid}` | delete, purge, `make smoke` | Data retention. |
| `GET /kb/{kb}/catalog`, `GET /kb/{kb}/configuration` | `admin/health` | Connection test and the KB's generative model. |
| `GET/POST/PATCH/DELETE /kb/{kb}/kv-schemas[/{id}]` | `services/kv.ts` | Typed key-value schemas (20 per KB, 50 fields each). |
| `PUT /kb/{kb}/resource/{rid}/key_value/{schemaId}`, `PATCH /kb/{kb}/resource/{rid}` (`key_values`) | `services/kv.ts` | Write structured values onto a resource. |
| `POST /kb/{kb}/find` (`filter_expression.key_value`) | `services/kv.ts` — `kvFilter` | Filter by kv value. Not supported on `/catalog`. |
| `POST /kb/{kb}/task/start`, `POST /kb/{kb}/task/{id}/stop`, `GET /kb/{kb}/task/{id}/inspect` | `services/da-agents.ts` | Data Augmentation generator agents that write kv fields. |

## Key ARAG mechanics

These are hard-won behaviours verified against the live `DocumentProcessing` Knowledge
Box. Each one is the difference between a reliable demo and a flaky one, and each is
repeated verbatim as a comment next to the code that depends on it.

1. **Structured extraction via `answer_json_schema`.** Passing an OpenAI-function-style
   schema forces ARAG to return a validated object in `answer_json`. This is the
   "custom visual-LLM extraction" layer — the multimodal model fills the schema from the
   document. (`src/services/schemas.ts`, `src/services/agents.ts`)

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
   Probe it with the document's *own* opening words, not a generic query: against the live
   KB a generic probe took about twenty polls (≈ 38 s) to register a hit on the same
   resource that a seeded probe found on the first attempt (≈ 7 s end to end for the whole
   process stage). Same reasoning as mechanic 3, applied to the readiness gate.

5. **Scope with `resource_filters` on `/ask`, never `POST /resource/{id}/ask`.** The
   per-resource ask endpoint rejects `rag_strategies: [{ name: "full_resource" }]`
   upstream — it answers HTTP 500 (or 503 "connection termination") for exactly the
   payload that `/ask` + `resource_filters: [rid]` accepts and answers correctly. Since
   full_resource grounding is the whole point of the extraction agents, `resource_filters`
   is the only usable shape. Discovered by `make smoke` and isolated with a live A/B probe.

6. **Verified evidence, because citations are unavailable to structured extraction.** ARAG
   rejects `citations` alongside `answer_json_schema` — the live KB answers HTTP 500 — so
   the usual citation machinery cannot annotate an extraction. A schema-only `/ask` *does*
   still return the retrieval item with paragraph ids and character offsets, and a model
   asked for verbatim quotes *inside* the schema fills them accurately. So every extraction
   schema carries an `evidence` array of `{field, quote}`, and the service then checks each
   quote against the document's own extracted text: an exact substring is `exact` (offsets
   recorded), a match after normalising case, whitespace and punctuation is `normalised`,
   anything else is `unverified` and raises a validation warning. Verified quotes are
   pinned to the retrieval paragraph that contains them. The share of extracted fields with
   a verified quote is `meta.groundingScore`. A model that paraphrases instead of quoting
   is therefore visible rather than silently trusted. (`src/services/agents.ts`
   — `verifyEvidence`, `groundingScore`; `src/services/schemas.ts` — `EVIDENCE_PROPERTY`)

   Measured on the live Knowledge Box (`make smoke`, sample invoice, `chatgpt-azure-4o`):
   12 fields extracted, 11 quotes returned — 10 `exact`, 1 `normalised`, 0 `unverified` —
   for a grounding score of **0.92**, with every quote pinned to a retrieval paragraph.
   The one field with no quote is visible in the record rather than quietly presented as
   grounded, which is the whole point of the contract.

Plus two robustness choices:

- **Amounts are extracted as strings, then normalized to numbers.** Forcing the model to
  emit a JSON `number` for `"$96,000.00"` frequently returns `0`. Schemas declare amounts
  as strings (`money()` in `schemas.ts`); `validateNormalize` parses them to numbers and
  keeps the raw value in `field.raw`. It also checks `subtotal + tax ≈ total` and
  required-field presence.
- **Token budgets are generous.** A truncated structured response is *invalid* JSON and
  yields no `answer_json` at all (not a partial), so under-budgeting drops every field.
  The classifier, entity and summary agents all budget well above their expected output.

A further constraint the client handles for you: ARAG rejects `citations` together with
`answer_json_schema`. `AragClient.askStream` drops `citations` automatically when a schema
is present, so extraction and Q&A can share one code path — and the evidence contract
(mechanic 6) gives structured extraction the grounding that citations would otherwise
provide. Plain text `/ask` (`POST /api/v1/documents/{id}/ask`) still uses real citations.

## Stored search configurations

Every extraction config — the 11 built-ins and every custom one — is provisioned as a
stored ARAG search configuration named `dip_<schema name>`:

```jsonc
{
  "kind": "ask",
  "config": {
    "generative_model": "chatgpt-azure-4o",   // the multimodal/visual LLM
    "reranker": "predict",
    "rag_strategies": [{ "name": "full_resource" }],
    "prompt": { "system": "You are a precise document-data extraction engine. …" },
    "answer_json_schema": {
      "name": "invoice_extraction",
      "parameters": {
        "properties": { "…": "…", "evidence": { "type": "array", "items": { "…": "…" } } }
      }
    }
  }
}
```

Extraction then calls `/ask` with `search_configuration: "dip_invoice_extraction"` and only
the per-request bits (`query`, `resource_filters`, `max_tokens`, `temperature`). The model,
the grounding rules and the schema live **server-side in the Knowledge Box**, not in this
service — so they can be inspected and tuned in the ARAG dashboard, and every client of the
KB gets the same extraction contract.

Provisioning is idempotent (`POST`, falling back to `PATCH` on 409) and runs at boot, on
custom-config creation, and on demand via `POST /api/v1/admin/provision`. **Changing an
extraction schema — including adding the `evidence` property — only takes effect after a
re-provision**, because the schema lives in the stored configuration, not in the request.
Those 409s are expected and are counted separately from real errors in
`GET /api/v1/admin/usage` (`aragConflicts`), so a re-provision does not read as an outage.

## Data Augmentation agents

`config=agent` skips live extraction and reads fields an ARAG **Data Augmentation "ask"
agent** already persisted on the resource — either a JSON text field or a key-value field
written by the agent configured in the ARAG dashboard (`readPersistedFields`). Keys are
user-defined, so labels are derived from the key and values are normalised by heuristics
(`fieldsFromObject`: amounts → numbers, dates → ISO, sentinels like "N/A" dropped). When the
resource carries no agent output the pipeline says so in a `classify` `skip` event and falls
back to live extraction.

## Key-value fields and the generator agent

Key-value (kv) fields are ARAG's typed, schema-validated structured metadata on a resource.
Where the evidence contract (mechanic 6) proves *this run* read the document correctly, kv
fields make the result **durable and queryable**: the values the visual LLM extracted are
written back onto the resource and can then be filtered on directly, so "every invoice over
$10k from Acme" is a search, not a re-read of every document.

Everything below was verified live against the `DocumentProcessing` Knowledge Box on
**2026-09-13** (region `aws-us-east-2-1`, base `https://{region}.dp.progress.cloud/api/v1`,
header `X-NUCLIA-SERVICEACCOUNT: Bearer <key>`). Requests and responses are reproduced
verbatim, trimmed only for length. The vendored platform client has no kv support, so the
product layer (`src/services/kv.ts`, `src/services/da-agents.ts`) drives these routes
through the client's generic `request()` — see **Platform gap** at the end of this section.

### Limits and naming (verified)

| Constraint | Value | How it fails |
|---|---|---|
| Schemas per Knowledge Box | 20 | documented; not probed (would require filling the KB) |
| Fields per schema | 50 | `422` `"List should have at most 50 items after validation, not 51"` |
| Field types | `text`, `integer`, `float`, `boolean`, `date` | `422` enum error |
| Schema id **and** field key pattern | `^[^/.]{1,64}$` | `422` `string_pattern_mismatch` |
| `repeated: true` | **`text` only** | `422` `"KVFieldType.INTEGER is not an allowed repeated type"` |
| `range: true` | **`integer`, `float`, `date` only** | `422` `"KVFieldType.TEXT is not an allowed range type"` |
| Duplicate field keys | rejected | `422` `"Schema field keys must be unique"` |
| Range bounds | `lower < upper`, strictly | `422` `"lower endpoint (50) must be < than its upper endpoint (5)"` |

The naming rule is the surprise: **a field id is the `key` you declare, verbatim — there is
no slugging and no generated id.** Only `/` and `.` are banned, so spaces, capitals, hyphens
and non-ASCII all survive (`"Vendor Name"` is a legal key). `toKvFieldKey()` therefore
replaces only those two characters and truncates at 64, keeping the map as close to identity
as the platform allows; `KvSchemaMapping.fieldIds` / `.names` round-trip the rest.

### Schemas — CRUD

`GET /kb/{kb}/kv-schemas` on an empty KB:

```jsonc
// 200
{ "schemas": {} }
```

`POST /kb/{kb}/kv-schemas` — one field of every type plus each modifier:

```jsonc
// request
{
  "id": "dip_verify_all",
  "description": "Throwaway schema created to verify kv field behaviour.",
  "fields": [
    { "key": "v_text",     "type": "text",    "required": true,  "description": "A required plain text value." },
    { "key": "v_int",      "type": "integer", "required": false, "description": "An integer value." },
    { "key": "v_float",    "type": "float",   "required": false, "description": "A float value." },
    { "key": "v_bool",     "type": "boolean", "required": false, "description": "A boolean value." },
    { "key": "v_date",     "type": "date",    "required": false, "description": "An RFC3339 date-time." },
    { "key": "v_range",    "type": "integer", "required": false, "range": true,    "description": "An integer range." },
    { "key": "v_repeated", "type": "text",    "required": false, "repeated": true, "description": "A repeated text value." }
  ]
}
```

```jsonc
// 201 — the stored schema, with every modifier defaulted explicitly
{
  "id": "dip_verify_all",
  "description": "Throwaway schema created to verify kv field behaviour.",
  "fields": [
    { "key": "v_text",  "type": "text",    "description": "A required plain text value.",
      "required": true, "range": false, "repeated": false },
    { "key": "v_range", "type": "integer", "description": "An integer range.",
      "required": false, "range": true,  "repeated": false }
    // … one entry per declared field, in declaration order
  ]
}
```

The rest of the surface: `GET /kb/{kb}/kv-schemas/{id}` returns that same object (note the
path is **plural** — `GET /kb/{kb}/kv-schema/{id}` is a 404), `PATCH /kb/{kb}/kv-schemas/{id}`
takes `{description?, fields?}` and cannot change the id, and `DELETE /kb/{kb}/kv-schemas/{id}`
removes it. `description` — on the schema **and** on each field — is not decoration: it is
what a generator agent reads to decide what to extract, which is why `schemaToKvSchema()`
carries the product's field descriptions across verbatim.

### Writing values — two shapes

**Inline**, at resource create (`POST /kb/{kb}/resources`) or update (`PATCH /kb/{kb}/resource/{rid}`).
The key in `key_values` is the **schema id**:

```jsonc
// request — 201 { "uuid": "3abbc29b…", "elapsed": 0.25, "seqid": null }
{
  "title": "dip_verify_kv_probe",
  "texts": { "body": { "body": "Acme Widgets invoice INV-9001 total 1234.56 AUD.", "format": "PLAIN" } },
  "key_values": {
    "dip_verify_all": {
      "data": {
        "v_text": "acme widgets",
        "v_int": 42,
        "v_float": 1234.56,
        "v_bool": true,
        "v_date": "2026-01-15T00:00:00Z",
        "v_range": { "lower": 1, "upper": 5 },
        "v_repeated": ["alpha", "beta"]
      }
    }
  }
}
```

A `PATCH` with the same `key_values` block updates only the schemas it names; other schemas
on the resource are untouched, and several schemas coexist on one resource happily.

**Direct**, `PUT /kb/{kb}/resource/{rid}/key_value/{field_id}` — where `field_id` **is the
schema id** — with the `data` map alone:

```jsonc
// request → 201 { "seqid": null }
{ "data": { "v_text": "put-path value", "v_int": 7, "v_range": { "lower": 10, "upper": 20 } } }
```

This **replaces the whole field**: keys absent from `data` are dropped, and every `required`
key must be present or the write is rejected. Use the inline `PATCH` form to set one schema
without disturbing the others.

Date values need a full RFC 3339 date-**time**: `"2026-01-15"` alone is rejected as a type
mismatch, so `toRfc3339()` widens a bare date to midnight UTC.

### Reading values back

Only `show=values` returns them (`show=key_values` is not a valid enum member — the accepted
values are `basic`, `origin`, `extra`, `relations`, `values`, `extracted`, `errors`,
`security`). `GET /kb/{kb}/resource/{rid}?show=values`:

```jsonc
// 200 — note the extra ".value" wrapper the write shape does not have
{
  "id": "3abbc29b…",
  "data": {
    "texts":    { "body": { "value": { "body": "Acme Widgets invoice …", "format": "PLAIN" } } },
    "generics": { "title": { "value": "dip_verify_kv_probe" } },
    "key_values": {
      "dip_verify_all": {
        "value": {
          "data": {
            "v_text": "acme widgets", "v_int": 42, "v_float": 1234.56, "v_bool": true,
            "v_date": "2026-01-15T00:00:00Z",
            "v_range": { "lower": 1, "upper": 5 },
            "v_repeated": ["alpha", "beta"]
          }
        }
      }
    }
  }
}
```

So values are written at `key_values.<schemaId>.data` and read at
`data.key_values.<schemaId>.value.data`. `readResourceKeyValues()` unwraps the asymmetry.

### 422 behaviour — two different dialects

ARAG rejects bad kv writes in **two shapes**, and a client that only handles one will show
users a raw blob. `kvErrorFrom()` normalises both into a `KvValidationError` carrying
`kind`, `field`, `schemaId`, `expected` and `got`.

**Sentence form** — semantic violations against the schema, `detail` is a plain string:

```jsonc
// PUT …/key_value/dip_verify_all  {"data":{"v_text":"x","v_int":"not-an-integer"}}  → 422
{ "detail": "Key 'v_int' in schema 'dip_verify_all' expects type 'integer', got str" }

// {"data":{"v_int":1}}  → 422   (v_text is required)
{ "detail": "Missing required keys for schema 'dip_verify_all': ['v_text']" }

// {"data":{"v_text":"x","nope_unknown":"y"}}  → 422
{ "detail": "Unknown keys for schema 'dip_verify_all': ['nope_unknown']" }

// a Range object into a non-range field → 422
{ "detail": "Key 'v_int' in schema 'dip_verify_all' expects type 'integer', got Range" }
```

**List form** — FastAPI/Pydantic body validation, `detail` is an array. Because `KVValue` is
a union (`str | list[str] | int | float | bool | datetime | Range`), **one** bad value
produces **seven** entries, one per union member; the last is the real constraint:

```jsonc
// {"data":{"v_range":{"lower":50,"upper":5}}}  → 422
{ "detail": [
  { "type": "string_type", "loc": ["body","data","v_range","str"],  "msg": "Input should be a valid string" },
  { "type": "int_type",    "loc": ["body","data","v_range","int"],  "msg": "Input should be a valid integer" },
  // … float_type, bool_type, datetime_type, list_type …
  { "type": "value_error",
    "loc": ["body","data","v_range","function-after[check_bounds(), Range]"],
    "msg": "Value error, lower endpoint (50) must be < than its upper endpoint (5)" }
] }
```

Schema-level failures use the same list form with `loc: ["body","fields", …]`. `kvErrorFrom`
therefore prefers a *recognised* entry over the generic union noise rather than taking the
first.

**One thing is not validated:** a bare scalar written into a `repeated: true` field is
**accepted** (`201`) and stored as a scalar — `{"v_repeated": "not-a-list"}` round-trips as
the string. `repeated` constrains the schema, not the write.

### Filtering by kv value

The working syntax is a `filter_expression` with a `key_value` branch, on **`POST /find` and
`POST /ask`**:

```jsonc
{
  "query": "acme",
  "features": ["keyword"],
  "top_k": 5,
  "filter_expression": {
    "key_value": { "schema_id": "dip_verify_all", "key": "v_text", "eq": "acme widgets" }
  }
}
```

`and` / `or` / `not` nest inside the `key_value` branch
(`{"key_value": {"and": [ {…}, {…} ]}}`), and an optional sibling `"operator": "and" | "or"`
combines the `key_value` branch with `field` / `paragraph` branches. `kvFilter()`, `kvAnd()`,
`kvOr()` and `kvNot()` build exactly this.

**`/catalog` does not support kv filters.** Its `filter_expression` accepts only a `resource`
branch, whose tags are `and, or, not, resource, created, modified, label, resource_mimetype,
language, origin_tag, origin_metadata, origin_path, origin_source, origin_collaborator,
status`. Passing `key_value` returns `422 "Extra inputs are not permitted"`. **kv fields are
also not facetable** — `faceted: ["/kv/<schema>/<key>"]` returns `{}`. So a kv-filtered
listing must go through `/find`, not the catalog, and a kv-driven filter UI has to source its
options from the schema, not from facet counts.

The replacement for a kv-filtered catalog listing is `/find` with an **empty query**: it
returns every resource matching the filter and nothing else, and adding
`"show": ["basic", "values"]` puts each hit's kv values inline on the result, so one call
both lists and renders them:

```jsonc
{
  "query": "",
  "features": ["keyword"],
  "top_k": 20,
  "show": ["basic", "values"],
  "filter_expression": { "key_value": { "schema_id": "dip_invoice", "key": "currency", "eq": "AUD" } }
}
// 200 → resources.<rid>.data.key_values.<schemaId>.value.data
```

(`features` accepts only `keyword`, `semantic`, `relations`, `graph` — there is no
`fulltext` member.)

Operator support is per field kind and is enforced with a **412**, not a 422:

| Field kind | `eq` | `gte` / `lte` | `contains` |
|---|---|---|---|
| `text`, `integer`, `float`, `boolean`, `date` (scalar) | yes | numeric/date only | **no** — 412 |
| `range: true` | no — 412 | **no** — 412 | yes (is the value inside the interval) |
| `repeated: true` | **no** — 412 | no | yes (membership) |

```jsonc
// 412 — the error names the field and the reason
{ "detail": "Invalid query. Error in key_value: Key 'v_text' in schema 'dip_verify_all' is not a range type. Therefore 'contains' can't be used" }
{ "detail": "Invalid query. Error in key_value: Unknown key-value schema: 'no_such_schema'" }
{ "detail": "Invalid query. Error in key_value: Key 'no_such_key' not found in schema 'dip_verify_all'" }
```

On a resource written **once**, every operator is exactly correct, bounds inclusive — an
`integer` of 42 matches `lte: 42` and `gte: 42` but neither `lte: 41` nor `gte: 43`; a range
of `{lower:1,upper:5}` matches `contains: 1` through `contains: 5` and nothing outside.

### The overwrite trap (live behaviour, not documented)

**Overwriting a kv value does not remove the previous value from the search index.** The
stored value read back through `show=values` is always correct and single, but the filter
index accumulates *every value ever successfully written to that field*, so stale values keep
matching filters forever.

Demonstrated on one resource whose `v_text` was written `"acme widgets"`, then
`"put-path value"`, then `"x"`, then back to `"acme widgets"`:

```
show=values → v_text = "acme widgets"          (correct, single)

find eq "acme widgets"  → HIT     find eq "put-path value" → HIT
find eq "x"             → HIT     find eq "never-written"  → none
```

The same held for every type: `v_int` (42 now, 7 earlier) matched `eq: 42` **and** `eq: 7`;
`v_bool` (true now, false earlier) matched both `true` and `false`; `v_repeated`
(`["alpha","beta"]` now) still matched `contains: "gamma"` and `contains: "not-a-list"` from
earlier writes. A value from a write that was *rejected* with a 422 never appeared, so only
successful writes pollute. A control resource written exactly once filtered perfectly on
every operator, which isolates the cause to the overwrite rather than the operators.

Consequences for this product:

- treat a kv write as **write-once per resource**. Re-extracting a document and re-writing
  its kv values leaves the old values filterable, which silently corrupts result sets.
- to genuinely revise values, delete and re-create the resource (or accept the stale
  matches). There is no index-purge call.
- this also explains any "impossible" filter result during development — check the write
  history of the field before suspecting the operator. It is what first looked like `lte`
  being broken on integers (an earlier write of `7` was still indexed) and `gte` being loose
  on dates (an earlier write of `2026-02-02`).

### The required-key trap, and why this product provisions nothing as required

The second place the platform's behaviour forces a design choice. Two verified facts combine
badly:

1. a kv write is a **full replace** of that schema's data — keys absent from `data` are
   dropped, not merged; and
2. a write missing any `required` key is rejected **whole**, with
   `422 {"detail": "Missing required keys for schema 'dip_verify_all': ['v_text']"}`. There
   is no partial success: the other keys in the same write do not land.

Taken together, one un-extracted required field costs the resource *every* value the
extraction did produce. That is not a hypothetical — a faded scan with an unreadable total is
an ordinary Tuesday, and marking `total` required in the kv schema would mean such an invoice
gets **no** filterable vendor, number or date either. A generator agent hits the same wall:
its own write is rejected in full when the model cannot find a required field, so the agent
silently produces nothing rather than producing most of it.

A required flag that turns a partial success into a total loss is not a safety property.
So the rule this product follows:

- `schemaToKvSchema()` keeps projecting `required` **faithfully** — the mapper stays truthful
  and is the shape the extraction schema really describes;
- `provisionable()` (`src/services/configs.ts`) strips it, and is the single place the policy
  lives: **the kv schema in the Knowledge Box marks nothing required**;
- the requirement is kept where it is useful. The extraction config still lists the field as
  required, so the visual LLM is still asked for it and the record's confidence still
  reflects it, and `writeRecordKv()` reports the gap itself as a skip on the record —
  `meta.kv.skipped[] = { field, reason: "required by the extraction config but not
  extracted" }` — so the honest signal survives without the blast radius.

The same `provisionable()` mapping is what the pipeline writes against and what a generator
agent is bound to, so nothing downstream can quietly re-tighten the schema underneath the
others.

### The Data Augmentation generator agent

A generator agent writes kv fields **asynchronously, platform-side**: ARAG schedules a task
that reads each matching resource and persists a schema-conforming object onto it. The schema
descriptions are the extraction instructions.

The generator is the task named **`ask`**. `GET /kb/{kb}/tasks` lists the available task
definitions (`labeler`, `llama-guard`, `prompt-guard`, `llm-graph`, `synthetic-questions`,
`ask`, `llm-align`, `memory`) with their JSON-Schema validation, plus the KB's own
`configs` / `running` / `done` buckets. What makes `ask` a *key-value* generator rather than
one that writes a JSON text field is two fields on `AskOperation`:

- `store_as_key_value: true` — store the generated JSON as a kv field. Requires `json: true`
  and `ApplyTo.FIELD`.
- `kv_schema_id` — the kv schema the output must conform to. Falls back to `destination`.

`POST /kb/{kb}/task/start?apply=EXISTING`:

```jsonc
// request — `question` must BE the JSON schema, serialised as a string (see below)
{
  "name": "ask",
  "parameters": {
    "name": "dip_verify_generator",
    "on": 1,                                    // ApplyTo.FIELD — `ask` supports only this
    "filter": { "rids": ["88f38bf2…"], "field_types": ["text"] },
    "operations": [ { "ask": {
        "question": "{\"name\": \"dip_verify_gen\", \"description\": \"Purchase order header fields.\", \"parameters\": {\"type\": \"object\", \"properties\": {\"supplier\": {\"type\": \"string\", \"description\": \"The name of the supplier or vendor company named on the purchase order.\"}, \"po_number\": {\"type\": \"string\", \"description\": \"The purchase order number or identifier, e.g. PO-1234.\"}}, \"required\": [\"supplier\", \"po_number\"]}}",
        "destination": "dip_verify_gen",
        "json": true,
        "store_as_key_value": true,
        "kv_schema_id": "dip_verify_gen"
    } } ],
    "llm": { "model": "chatgpt-azure-4o" }
  }
}
```

```jsonc
// 200
{ "name": "ask", "status": "started", "id": "bfd00f6c-dfee-499f-ae93-8bd70e0417f9" }
```

`apply` is a **query parameter** (`EXISTING`, `NEW`, `ALL`), not a body field.

Four lifecycle facts that cost real time to discover:

1. **`question` must be the JSON schema itself**, serialised. A plain-English question with
   `json: true` returns `422 {"detail": "Invalid JSON schema. Reason: Expecting value: line 1
   column 1 (char 0)"}`. The kv schema does not replace it — both are supplied, and their
   field descriptions should agree. `mappingToJsonSchema()` derives one from the other so
   they cannot drift.
2. **One running `ask` task per `destination`.** A second start returns
   `422 {"detail": "Already running an operation of ask with destination dip_verify_gen"}`.
   Provisioning per-config generators therefore needs distinct destinations, and a re-run
   means stopping the existing task first.
3. **A running task cannot be deleted.** `DELETE /kb/{kb}/task/{id}` returns
   `422 "Cannot delete a running job, please stop it first."` The order is
   `POST /kb/{kb}/task/{id}/stop` → `200 {"name":"ask","status":"not_running","id":…}`, then
   `DELETE /kb/{kb}/task/{id}` → `200`, after which the KB's `configs`/`running` buckets are
   empty again.
4. **There is no per-task GET.** `GET /kb/{kb}/task/{id}` is `405`; inspection is
   `GET /kb/{kb}/task/{id}/inspect` (`200`, returns `{request: {…full run record…}}`) or by
   finding the id in the buckets of `GET /kb/{kb}/tasks`. A run record carries `scheduled`,
   `completed`, `failed`, `stopped`, `retries`, `scheduled_at`, `completed_at` and `log`.

Scheduling is **batch and slow**. Both verification runs — one with the default `apply`, one
with `apply=EXISTING`, each filtered to a single resource — were accepted immediately and then
sat at `scheduled: true, completed: false, failed: false, retries: 0, log: ""` for well over
twenty minutes without writing the target field. **The agent's own write was therefore never
observed within the verification window**; what is verified above is the full task lifecycle
(start, list, inspect, stop, delete) and the exact request body the platform accepts, not the
end-to-end extraction latency. Treat the queue delay as unbounded from the product's point of
view and confirm throughput separately before depending on it.

The practical consequence is the same either way: a generator agent is a background
enrichment path, never something a synchronous request can wait on — which is exactly why the
product's own extraction stays on the `/ask` path of `services/agents.ts` and treats kv
generation as an additional, eventually-consistent layer. `DaAgents.awaitRun()` polls with a
generous deadline and returns `timedOut` rather than throwing, so a caller can degrade
instead of hanging. **Always** set `filter.rids` (or another narrowing filter): an empty
filter sweeps the entire Knowledge Box.

### Mock mode

The vendored mock ARAG server knows none of these routes and is never edited. `KvService` and
`DaAgents` instead keep an in-memory registry when `ARAG_MOCK=1`, mirroring the live request
and response shapes *and* the live validation — the mock path raises the same
`KvValidationError` kinds (`type_mismatch`, `missing_required`, `unknown_key`,
`too_many_fields`, `too_many_schemas`, `invalid_modifier`, `duplicate_key`) that
`kvErrorFrom()` produces from a real 422. `make test` and `make e2e` therefore exercise the
real code paths offline, following the same pattern as the rest of the mock-mode handling.

### Platform gap

`vendor/arag-platform/src/arag/client.ts` has **no kv support at all**: no `kv-schemas` CRUD,
no `key_value` write or read, no `filter_expression` typing, and its `TaskStartRequest` does
not model `AskOperation`'s `store_as_key_value` / `kv_schema_id`. Its task helpers are also
incomplete against the live API — there is no `stopTask`, so `deleteTask` cannot succeed on a
running task, and there is no `/task/{id}/inspect`. The product carries `src/services/kv.ts`
and `src/services/da-agents.ts` over the client's generic `request()` as a deliberate
product-local layer rather than forking the vendored client; both are candidates to be
promoted into the platform, at which point this product's modules become thin re-exports.

## Failure handling

`AragError` carries `kind` (`timeout | http | network | aborted | protocol`) and is mapped
to RFC 9457 problems by the platform: timeouts → 504, upstream failures → 502, 401 → a 502
that names `ARAG_API_KEY` without leaking it. Pipeline stages are `soft`: a failing stage is
recorded as a stage error and the run continues with the best record it has, so one flaky
agent never loses the whole extraction.

## Further reading

For the system-level view (module map, request lifecycle, job/SSE model), a document's
end-to-end journey, and real-world throughput built on the timings above, see
[`architecture.md`](architecture.md), [`data-flow.md`](data-flow.md) and
[`scaling.md`](scaling.md).
