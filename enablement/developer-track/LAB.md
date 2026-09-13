# Document Processing — Developer Lab

**Time:** a half day — 3 hours 50 minutes including two breaks, in nine timed sections.

| | Section | Time |
|---|---|---|
| 0 | Setup and orientation | 20 min |
| | **Part 1 — drive it** | |
| 1 | Drive the API from the command line | 20 min |
| 2 | Add a new document type | 25 min |
| 3 | Create a custom extraction config | 20 min |
| | *break* | 15 min |
| | **Part 2 — extend it** | |
| 4 | Add an export format | 25 min |
| 5 | Write a test and get `make check` green | 20 min |
| | *break* | 10 min |
| | **Part 3 — operate it** | |
| 6 | Write and filter a key-value field through the Knowledge Box | 30 min |
| 7 | Change a setting without a restart, and prove it | 20 min |
| 8 | Correct a field, and read the audit trail | 25 min |

**You will:** drive the full API from the command line; add a new document type end to
end; create a custom extraction config through the API and the workspace; extend the
product with a new export format and the test that proves it; then operate it — write and
filter typed values in the Knowledge Box, change a live setting and prove it took effect,
and correct a field and follow it through the audit trail. All against the real codebase,
on the mock Knowledge Box, with `make check` green at the end.

## Prerequisites

- Node.js ≥ 22.18 (`node --version`)
- [bun](https://bun.sh) installed (`bun --version`) — dev tooling only; this product never
  uses `npm`
- `git`
- A clone of this repository, on the `mvp` branch
- **No ARAG credentials needed.** Everything in this lab runs against the in-process mock
  Knowledge Box (`ARAG_MOCK=1`). You will never call a real LLM or spend a token.

Optional but handy: `jq` for pretty-printing JSON responses (every command also works
without it — just drop the `| jq .`).

## Learning outcomes

By the end of this lab you will be able to:

1. Drive every stage of the API (upload → job → record → export → ask → correct → delete)
   from `curl`.
2. Add a new document type — an extraction schema, its labels, its required fields and its
   key-value projection — and see it provisioned as both a stored ARAG search configuration
   and a key-value schema, with no further edits.
3. Create and inspect a custom, user-defined extraction config through both the API and the
   workspace, and re-provision it when you change it.
4. Extend the product safely: a new export format that plugs into the existing architecture
   without breaking the contract tests.
5. Write a unit or integration test against the mock and get `make check` green.
6. **Write typed values into the Knowledge Box and filter on them** — and explain why an
   invoice total is a string on the record and a `float` in the Knowledge Box.
7. **Change any setting in the running product** and prove, three ways, that it took effect
   without a restart.
8. **Correct an extracted field** and follow the consequences through the grounding score,
   the key-value filter index and the audit log.

## How this lab is organised

Each section has a time budget, exact commands, what you should see, a **checkpoint** so
you know you are on track, and a **why this matters** note connecting the step to a real
engineering decision in this product. The matching exercise sheet
([`exercises/`](exercises/)`0N-*.md`) restates the task as a standalone problem with
acceptance criteria and hints; the solution ([`solutions/`](solutions/)`0N-*.md`) has the
full worked answer with real output, checked against the actual file paths, exports and
function signatures in this repository. Section N matches exercise N throughout. Use the
exercises if you want to attempt each step yourself first; use the lab text if you want to
follow along directly.

**A note on scope.** Sections 2, 4 and 5 edit files under `src/` and `test/` that are
shared, tested source code — not sandboxed lab files. That is deliberate: this lab teaches
you to extend a real product. Sections 1, 3, 6, 7 and 8 change no source at all; they drive
the API and the workspace. Do the source-editing sections on a scratch branch, or be ready
to `git checkout -- src/` afterwards:

```bash
git checkout -b lab/document-processing   # optional, recommended
# … do the lab …
git checkout -- src/                      # optional, discard lab edits when you're done
```

---

## 0. Setup and orientation (20 min)

```bash
git clone <repo-url> arag-doc-processing   # skip if you already have the clone
cd arag-doc-processing
make install        # bun installs dev tooling only (no npm, ever)
cp .env.example .env
```

`.env.example` ships with `ADMIN_TOKEN` blank, which locks `/admin` and every
`/api/v1/admin/*` route — including routes Sections 3, 7 and 8 use. Set a local dev token
before your first `make dev`:

```bash
printf '\nADMIN_TOKEN=lab-admin-token\n' >> .env
make dev             # http://localhost:8080
```

`make dev` checks whether `ARAG_API_KEY` is set in `.env` and — since it is not — starts
with `ARAG_MOCK=1` automatically. You get the whole pipeline running against an in-process
fake Knowledge Box, with no ARAG account needed.

Leave that terminal running and, in a second terminal, tour the three surfaces.

| Surface | URL | What it is |
|---|---|---|
| Workspace | <http://localhost:8080/> | The product: documents, configs, ask, jobs, API explorer, settings |
| Operator console | <http://localhost:8080/admin/> | Overview, connection, configs, jobs, logs, audit, usage, branding, security |
| API docs | <http://localhost:8080/api/v1/docs> | Redoc (and `/api/v1/swagger` to try it out) |

The workspace is a **hash-routed** signed-in workspace, not a single page (DP-32): a
sidebar rail with six destinations, each a real URL you can link to, bookmark or send a
colleague.

| Rail item | URL | Keyboard |
|---|---|---|
| Documents | `#/documents` | `d` |
| Configs | `#/configs` | `c` |
| Ask | `#/ask` | `a` |
| Jobs | `#/jobs` | `j` |
| API | `#/api` | `i` |
| Settings | `#/settings/connection` | `s` |

`/` focuses the Documents search box. Filter and paging state lives in the hash query
string, so a filtered queue is a link — which is also how the showcase recording deep-links
a step.

Spend five minutes actually walking it:

1. Open the workspace. With an empty store it lands on `#/welcome`; take the "Try it with
   sample data" path or go straight to **Documents → Upload** (`#/documents/upload`) and
   drop in `public/samples/invoice.txt`.
2. Watch the pipeline stages on the record's **Pipeline** tab
   (`#/documents/<id>/pipeline`).
3. Open the record's five tabs: **Record**, **Source & evidence** (every extracted value
   marked inside the real text), **Pipeline**, **Ask**, **JSON**. On the JSON tab, switch
   the segmented control to **Key-value fields** — that is Section 6.
4. Open **Configs** (`#/configs`): eleven built-in extraction configurations, each backed
   by *two* Knowledge Box objects.
5. Open **Settings** (`#/settings/connection`) and look at the eight tabs. Sign in with
   `lab-admin-token` when it asks — that is Section 7.
6. Open the operator console at `/admin/` and sign in with the same token. Note **Audit**
   — that is Section 8.

Now run the test suite once, before you change anything, so you know what "green" looks
like:

```bash
make test
```

**Checkpoint:** `make test` reports `pass 241` and `fail 0` (the exact count drifts as the
suite grows — confirm your own number and use it as your baseline). If it does not, stop
and fix your environment before continuing; every later section assumes this baseline.

**Why this matters:** the whole product — workspace, operator console, API — is one
process, one store, one job manager. There is no separate "backend" and "frontend" deploy
step, no build, and no compiled artefact: `node --watch src/index.ts` runs the TypeScript
sources directly (erasable-syntax only, per the platform's Node-compatibility rule). That
is also why `make install` never touches `npm` — `bun` is dev tooling only, and the product
itself ships with **zero runtime dependencies**.

---

# Part 1 — drive it

## 1. Drive the API from the command line (20 min)

*Exercise: [`exercises/01-drive-the-api.md`](exercises/01-drive-the-api.md) ·
Solution: [`solutions/01-drive-the-api.md`](solutions/01-drive-the-api.md)*

This section exercises the whole document lifecycle: upload, watch the job, read the
record, export it three ways, ask it a question, and delete it.

### 1.1 Upload

```bash
curl -sS -X POST 'http://localhost:8080/api/v1/documents?config=auto' \
     -H 'Content-Type: text/plain' -H 'X-Filename: invoice.txt' \
     --data-binary @public/samples/invoice.txt | tee /tmp/up.json | jq .
```

You get back `202 Accepted` with both the pending `document` record and the `job` that is
processing it. `document.id` and `document.resourceId` are the **same string** — the
document id *is* the ARAG resource id (DP-01: one opaque id for callers, no mapping table,
and `DELETE /documents/{id}` can delete the KB resource without a lookup).

```bash
ID=$(jq -r .document.id /tmp/up.json)
JOB=$(jq -r .job.id /tmp/up.json)
```

### 1.2 Watch the pipeline over SSE

```bash
curl -sN "http://localhost:8080/api/v1/jobs/$JOB/events"
```

One `event: event` per pipeline stage (`process`, `classify`, `extract`, `entities`,
`summary`, `validate`, `standardize`), then a final `event: job` carrying the whole job
once it reaches a terminal status. Against the mock this completes in milliseconds; against
a live Knowledge Box a short text document typically finishes in well under 20 seconds,
with `process` usually the largest stage (see the architect track's
[`sizing-deployment.md`](../architect-track/sizing-deployment.md) for measured numbers).
On the mock you can also just poll:

```bash
curl -sS "http://localhost:8080/api/v1/jobs/$JOB" | jq '{status, progress}'
```

**Checkpoint:** the job's terminal `status` is `succeeded`, and the SSE stream shows all
seven stage names, each with a `status` of `ok` (or occasionally `skip`, when
classification is bypassed).

**Why this matters:** `GET /api/v1/jobs/{id}/events` is a *view* of the job, not the work
itself. The prototype ran the whole pipeline inside a `GET` handler that streamed its own
progress — a `GET` with side effects, and a client that closed its tab left ARAG calls
running with nowhere to put the result. Here the job keeps running in the `JobManager`
regardless of who is watching; reopening the stream later replays every event that already
happened before resuming live.

### 1.3 Read the canonical record

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID" | jq .
```

`status: "ready"`, `docType: "invoice"` (the classifier worked), extracted `fields`,
`entities`, a `summary`, `tags`, `issues`, and `evidence` — a verbatim quote per field,
checked against the document's own extracted text. Three `meta` keys are worth finding now,
because later sections are about each of them:

- `meta.searchConfiguration` — the stored ARAG search configuration that produced this
  extraction (Section 3).
- `meta.groundingScore` — the share of fields carrying a verified quote (Section 8).
- `meta.kv` — what was written into the Knowledge Box as typed, filterable data
  (Section 6).

### 1.4 Export all three formats

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID/export?format=json" | head -c 300; echo
curl -sS "http://localhost:8080/api/v1/documents/$ID/export?format=xml"  | head -c 400; echo
curl -sS "http://localhost:8080/api/v1/documents/$ID/export?format=csv"  | head -c 400; echo
```

JSON is the canonical record itself. XML is a deterministic element-per-field projection.
CSV is **long format** — one row per extracted field — which is what lets wildly different
document schemas (an invoice's twelve fields, a resume's nine) share one
spreadsheet-friendly shape instead of needing a different column set per doc type.

### 1.5 Ask questions — one document, and many

```bash
curl -sS -X POST "http://localhost:8080/api/v1/documents/$ID/ask" \
     -H 'Content-Type: application/json' -d '{"question":"What is the total due?"}' | jq .
```

This is scoped to the *one* document via `resource_filters: [rec.resourceId]` on `/ask`,
with `full_resource` grounding — the whole document in context. The response carries the
`answer`, its `sources`, and `citations[]` so "show me where" works.

There is also a **cross-document** ask. It takes the Documents list's own filters, so "ask
the twelve invoices from last week" is the list already on screen:

```bash
curl -sS -X POST "http://localhost:8080/api/v1/ask" \
     -H 'Content-Type: application/json' \
     -d '{"question":"What is the total due?","filters":{"doc_type":["invoice"]}}' \
  | jq '{answer, scope, documents}'
```

Note `doc_type` is an **array** here — `filters` uses the same parameter names as
`GET /api/v1/documents`, where `doc_type` is repeatable. The two endpoints ground
differently on purpose: one document gets `full_resource`, a filtered set gets retrieval
over the set, because across dozens of documents `full_resource` would be an enormous
prompt and a slow, expensive call. Citations come back mapped to this product's document
ids either way. Both routes have their own tight rate-limit bucket, because every ask is a
real generative call.

### 1.6 Clean up

Everything so far — upload, read, export, ask — worked with no credential at all. `DELETE`
is different: it also removes the KB resource, a genuine write to shared state, so it
requires a **writer credential**. Any one of four things satisfies it:

| Credential | How to get it |
|---|---|
| A seeded API key | An entry in the `API_KEYS` environment variable |
| A minted API key | `POST /api/v1/admin/api-keys` — Settings → API keys in the workspace |
| The admin token | `Authorization: Bearer $ADMIN_TOKEN` |
| A same-origin session cookie | `POST /api/v1/session` — what the workspace itself uses |

The session cookie is the lowest-friction one for a lab. Bootstrap it once and reuse it:

```bash
curl -sS -c /tmp/dip-cookies.txt -X POST http://localhost:8080/api/v1/session
# { "ok": true, "expiresInSec": 43200 }

curl -sS -b /tmp/dip-cookies.txt -o /dev/null -w '%{http_code}\n' \
     -X DELETE "http://localhost:8080/api/v1/documents/$ID"
# 204
curl -sS -o /dev/null -w '%{http_code}\n' "http://localhost:8080/api/v1/documents/$ID"
# 404 — the record and the underlying KB resource are both gone
```

**Checkpoint:** you have seen `202 → SSE → 200 (record) → 200×3 (exports) → 200×2 (ask) →
204 (delete) → 404 (confirmed gone)` — the full lifecycle, once, end to end.

**Why this matters:** `DELETE` removes the record **and** calls `deleteResource` on the KB —
a product handling other people's documents has to actually delete them, not just hide the
local pointer. Because that is destructive to shared state it goes through a
`requireWriter` guard (`src/routes/guards.ts`) that reads, uploads, exports and `ask` do
not. It is also the only operation that removes the key-value data and filter-index entries
you will create in Section 6. Hence the hard rule for this lab, and for the product's own
`make smoke` live test: **delete anything you create.**

---

## 2. Add a new document type (25 min)

*Exercise: [`exercises/02-add-a-document-type.md`](exercises/02-add-a-document-type.md) ·
Solution: [`solutions/02-add-a-document-type.md`](solutions/02-add-a-document-type.md) ·
Starter: [`starter/insurance-card.schema.ts`](starter/insurance-card.schema.ts)*

You will add a twelfth built-in document type, `insurance_card`. This exercises the "how do
I extend the schema library" path: `src/types.ts` (the single source of truth for every
document-type list in the product) and `src/services/schemas.ts` (the schema itself).

### 2.1 Add it to `DOC_TYPE_VALUES` — then watch the compiler stop you

Open `src/types.ts`. `DocType` is *derived* from one array, not hand-written:

```ts
export const DOC_TYPE_VALUES = [
  "invoice", "receipt", "contract", "resume", "purchase_order", "medical_claim",
  "preauthorisation", "bank_statement", "form", "report", "generic",
] as const;

export type DocType = (typeof DOC_TYPE_VALUES)[number];
```

Add `"insurance_card"` to the array, then immediately run:

```bash
bunx tsc --noEmit -p tsconfig.json
```

**Checkpoint:** this fails, with a missing-key error on `SCHEMAS`
(`Record<DocType, ExtractionSchema>` in `src/services/schemas.ts`) refusing to compile
until every `DocType` has a matching schema. You cannot half-add a document type here.

### 2.2 Add the schema

Use the starter stub at [`starter/insurance-card.schema.ts`](starter/insurance-card.schema.ts)
as your starting point, then paste the finished object into `SCHEMAS`.

Each schema is an OpenAI-function-style JSON Schema, terse by design via the file's
helpers: `s()` (string), `date()` (a date captured as text), `money()` (an amount captured
as text), `n()` (number) and `arr()` (string array).

Read `date()` and `money()` before you use them. Both declare a JSON `string` to the model
and annotate a *different* type for the Knowledge Box — `kv: { type: "date" }` and
`kv: { type: "float" }`. That annotation is what makes "every card expiring this quarter"
or "every claim over $5,000" expressible at all. Pick the right helper per field now and
Section 6 will work; pick `s()` for everything and it will not.

```bash
bunx tsc --noEmit -p tsconfig.json   # now passes
```

### 2.3 See it appear — everywhere, with no further edits

```bash
curl -sS http://localhost:8080/api/v1/schemas | jq '.items[] | select(.docType=="insurance_card")'
curl -sS http://localhost:8080/api/v1/openapi.json \
  | jq '.components.schemas.Document.properties.docType.enum'
curl -sS http://localhost:8080/api/v1/extraction-configs/insurance_card \
  | jq '{kvSchemaId, kvFields, provisioning}'
```

(`make dev` runs under `node --watch`, so it usually reloads on save.) The first call shows
your schema's fields; the second already contains `"insurance_card"` — `openapi.ts` imports
`DOC_TYPE_VALUES` from `types.ts` and builds every `docType` enum from it, so step 2.1
alone updated the public contract. The third shows the two Knowledge Box objects your new
type provisioned, with `provisioning.state: "provisioned"` only once **both** are in place.
Your type also appears in the workspace's Configs list and the upload drawer's config
selector automatically.

### 2.4 Run the tests — and notice what *doesn't* break

```bash
make test
```

**Checkpoint:** `fail 0` — with **no test file edited**. The extraction-config and
schema-catalogue tests in `test/api.test.ts`, and `test/e2e/admin.spec.ts`'s config-table
assertion, all import `DOC_TYPE_VALUES` and assert against `DOC_TYPE_VALUES.length`, not a
literal number.

Also run the `"every schema is internally consistent"` test in isolation once — it iterates
every schema, yours included, and checks that every `required` key exists in `properties`
and every property has a label:

```bash
node --test --test-reporter=spec test/agents.test.ts
```

**Why this matters:** this product used to keep the document-type list in three unsynced
places, so adding a type meant four coordinated hand-edits, and forgetting one either broke
the build, silently drifted the public spec from the code, or left a test looking green
while it had quietly stopped checking anything. Collapsing it to one source of truth did
not remove the compiler's guard rail from 2.1 — it removed the *manual, easy-to-forget
synchronisation* that used to sit next to it. A hardcoded count in a test is usually a
symptom of a missing single source of truth in the code under test.

If you want your working tree back exactly as it started, `git checkout -- src/` here.
Sections 3–8 do not depend on this change.

---

## 3. Create a custom extraction config (20 min)

*Exercise: [`exercises/03-custom-extraction-config.md`](exercises/03-custom-extraction-config.md) ·
Solution: [`solutions/03-custom-extraction-config.md`](solutions/03-custom-extraction-config.md)*

Not every document type deserves a built-in schema. `POST /api/v1/extraction-configs` lets
a caller define one on the fly.

### 3.1 Through the API

Creating a config writes into the Knowledge Box, so it needs the writer credential from
1.6:

```bash
curl -sS -b /tmp/dip-cookies.txt -X POST 'http://localhost:8080/api/v1/extraction-configs' \
     -H 'Content-Type: application/json' \
     -d '{
           "name": "Insurance Card",
           "fields": [
             { "label": "Policy Number", "required": true },
             { "label": "Insurer" },
             { "label": "Valid To", "kvType": "date" },
             { "label": "Benefits", "type": "array" }
           ]
         }' | jq .
```

Field `key`s are derived from the label (`toKey`) unless you supply one. The response
carries `aragConfig` (the stored search configuration), `kvSchemaId` (the key-value schema),
and a `provisioning` block reporting each separately — creation and provisioning happen in
the same call, which is why `provisioned` is already `true` with no separate step.

Note `kvType: "date"` on one field. On a custom config the overrides are
`kvType`/`kvRepeated`/`kvRange`, the same capability `date()` and `money()` give a built-in
schema. Section 6 is where that pays off.

### 3.2 Through the workspace

Open **Configs → New configuration** (`http://localhost:8080/#/configs/new`), add the same
fields in the builder, and save. It calls the exact same endpoint — the workspace has no
separate config logic; it is a thin client over `/api/v1`, same as `curl` (it obtains its
own session automatically on load, which is why you did not have to sign in). Your config
appears in the Configs list immediately, and its detail page (`#/configs/:id`) shows both
Knowledge Box objects and the documents processed with it.

### 3.3 Re-provision one config

Change something and put it back:

```bash
CFG=cfg_...   # your id
curl -sS -b /tmp/dip-cookies.txt -X POST \
     "http://localhost:8080/api/v1/extraction-configs/$CFG/provision" | jq .
```

This re-provisions **both** objects and reports each. It is idempotent, writer-gated, and
the granularity an operator needs to fix the one config that did not take.
`POST /api/v1/admin/provision` does all of them and needs the admin token.

### 3.4 Inspect the stored ARAG search configuration

`GET /api/v1/admin/search-configurations` reads the `dip_*` search configurations straight
from the Knowledge Box — exactly what the extraction agents run against — so you can see
the raw ARAG payload without opening the ARAG dashboard. It is gated by the **admin**
credential, a different and stronger gate than the session cookie:

```bash
curl -sS http://localhost:8080/api/v1/admin/search-configurations \
     -H "Authorization: Bearer lab-admin-token" \
  | jq '.items[] | select(.name=="dip_custom_insurance_card")'
```

**Checkpoint:** you can point at the three things this config pins server-side — the
reranker, the `full_resource` RAG strategy, and the `answer_json_schema` — and explain why
none of them live in this product's own code once provisioned.

**Why this matters:** the model, the grounding rules and the schema live **server-side in
the Knowledge Box**, so they can be inspected and tuned in the ARAG dashboard, and every
client of that KB gets the same extraction contract. Provisioning is idempotent (`POST`,
falling back to `PATCH` on 409), so re-running it is always safe, including after a KB
reset.

Clean up your test config when you are done:

```bash
curl -sS -b /tmp/dip-cookies.txt -o /dev/null -w '%{http_code}\n' \
     -X DELETE "http://localhost:8080/api/v1/extraction-configs/$CFG"
# 204 — and the key-value schema goes with it, freeing one of the KB's twenty
```

Built-ins answer `409 Conflict` — they are not deletable.

---

*Break — 15 minutes.*

---

# Part 2 — extend it

## 4. Add an export format (25 min)

*Exercise: [`exercises/04-add-an-export-format.md`](exercises/04-add-an-export-format.md) ·
Solution: [`solutions/04-add-an-export-format.md`](solutions/04-add-an-export-format.md) ·
Starter: [`starter/markdown-export.snippet.ts`](starter/markdown-export.snippet.ts)*

`src/services/formats.ts` turns a `DocumentRecord` into `json`, `xml` or `csv` — three
pure, dependency-free functions plus a `serialize()` dispatcher. You will add a fourth:
`markdown`, a single Markdown document with a summary, a field table and an entity/issue
list — the kind of thing you would paste into a ticket.

### 4.1 Write `toMarkdown`

Add it to `src/services/formats.ts` (see the starter snippet for a TODO-annotated start and
[`solutions/04-add-an-export-format.md`](solutions/04-add-an-export-format.md) for the
finished function). Reuse the file's existing private `flatValue()` helper for
array/`null` handling — do not duplicate it.

### 4.2 Wire it into the type and the dispatcher

```ts
export type Format = "json" | "xml" | "csv" | "markdown";

export const MIME: Record<Format, string> = {
  json: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
};
```

and add `case "markdown": return toMarkdown(rec);` to `serialize()`.

### 4.3 Wire it into the route and the spec

`src/routes/documents.ts` guards `?format=` with a `Set`:

```ts
const FORMATS = new Set(["json", "xml", "csv", "markdown"]);
```

`src/openapi.ts`'s `/api/v1/documents/{id}/export` operation enumerates the same values in
its `format` query parameter and lists a content type per format in its `200` response —
add `"markdown"` to the `enum` and `"text/markdown": { schema: { type: "string" } }` to the
content map. Skipping this does not break `curl`, but it does mean `missingFromSpec()` and
`checkResponse()` — the contract tests — will not know the format exists, and STANDARDS §2
requires every route and every documented shape it can return to live in `openapi.ts`
first.

### 4.4 Try it

```bash
curl -sS -D - "http://localhost:8080/api/v1/documents/$ID/export?format=markdown" | head -20
```

**Checkpoint:** `200`, `Content-Type: text/markdown; charset=utf-8`, and a readable
Markdown document — a `#` heading with the filename, a field table, an `## Entities` list
and (if any) an `## Issues` list. Confirm `?format=bogus` still answers `400`.

**Stretch goal — a pipeline stage instead:** look at `src/services/pipeline.ts`'s stage
list and `ctx.stage(name, message, fn, { soft: true, progress })`. A safe stage to add is a
deterministic `redact` step after `validate` that masks obvious PII in `record.fields`
before `standardize` — no model call, so trivial to unit test. Note that stage names are
typed, so you will also register it in `src/types.ts`, the same single-source-of-truth
pattern as Section 2. Every stage is `soft: true`: a thrown error inside `ctx.stage()` is
caught, recorded, and the run continues with the best record so far.

**Why this matters:** formats and pipeline stages are the two safest extension points in
this product precisely because both are additive to a stable contract — `formats.ts`
functions are pure (no I/O, so trivially testable) and pipeline stages are soft-failing by
design, so a bug in your new stage degrades a run rather than crashing it. Both are exactly
the shape of change a real customer integration asks for, without touching the ARAG
integration layer at all.

---

## 5. Write a test and get `make check` green (20 min)

*Exercise: [`exercises/05-write-a-test.md`](exercises/05-write-a-test.md) ·
Solution: [`solutions/05-write-a-test.md`](solutions/05-write-a-test.md)*

### 5.1 Unit test for the new format

Add to `test/formats.test.ts` (it already has a `sample()` fixture and tests for
`toJson`/`toXml`/`toCsv` in exactly this style):

```ts
test("toMarkdown renders a heading, a field table and an entities section", () => {
  const md = toMarkdown(sample());
  assert.match(md, /^# invoice\.pdf/);
  assert.match(md, /\| Vendor \| Acme Robotics <Pty> & Co \| 0\.95 \|/);
  assert.match(md, /## Entities/);
  assert.match(md, /- \*\*ORG\*\*: Acme Robotics/);
});
```

### 5.2 Run it

```bash
node --test --test-reporter=spec test/formats.test.ts
```

**Checkpoint:** your new test passes alongside the existing ones in that file.

### 5.3 Get the whole thing green

```bash
make check      # Biome + tsc --noEmit + tests with the 80% coverage gate
```

`make check` runs, in order: `biome check .`, `tsc --noEmit`, and the full test run with
`--experimental-test-coverage --test-coverage-lines=80` on `src/**`. All three must be
clean.

**Checkpoint:** `make check` exits `0`. If Biome complains about formatting, run
`make format` and re-run — do not hand-format to match its rules.

**Why this matters:** `make check` is exactly what CI runs and exactly what STANDARDS §8
calls the testing bar for this product. A pure function like `toMarkdown` needs no ARAG call
and no mock to unit-test — a deliberate architectural choice, and it is why an 80% coverage
gate on `src/**` is achievable without a slow, flaky suite: the parts of this product that
talk to ARAG are the minority, and everything else is small, deterministic and cheap to
test.

---

*Break — 10 minutes.*

---

# Part 3 — operate it

The last three sections change no source code. They are about the product as a running
thing: what it writes into the Knowledge Box, how an operator changes it, and what happens
when a human disagrees with the model.

## 6. Write and filter a key-value field through the Knowledge Box (30 min)

*Exercise: [`exercises/06-key-value-fields.md`](exercises/06-key-value-fields.md) ·
Solution: [`solutions/06-key-value-fields.md`](solutions/06-key-value-fields.md)*

Extracted values do not only land in this workspace's JSON store. When a record finishes,
the verified values are written into the **Knowledge Box itself** as typed, validated,
filterable fields — so an invoice total is a `float` that anything with access to that KB
can filter on, not a string only this product can read.

### 6.1 An extraction config owns two Knowledge Box objects

```bash
curl -sS http://localhost:8080/api/v1/extraction-configs/invoice \
  | jq '{kvSchemaId, provisioning}'
```

| Object | Id | Answers |
|---|---|---|
| Stored search configuration (`kind: "ask"`) | `dip_invoice_extraction` | *How is this document read?* |
| Key-value schema | `dip_invoice_extraction` | *How is the result kept, and what can be asked of it?* |

They share an id on purpose, so an operator reads the two KB namespaces as one pair.
`provisioning.state` is `provisioned` only when both are in place, and each is reported
separately so a half-failure is visible rather than discovered when a filter silently
returns nothing.

### 6.2 The declared type and the extracted type disagree on purpose

```bash
curl -sS http://localhost:8080/api/v1/extraction-configs/invoice \
  | jq '.fields[] | select(.key=="total" or .key=="invoice_date") | {key, type, kvType}'
```

```json
{ "key": "invoice_date", "type": "string", "kvType": "date"  }
{ "key": "total",        "type": "string", "kvType": "float" }
```

`type` is the JSON-Schema type the **model** is asked for: forcing a model to emit a JSON
`number` for `"$116,160.00"` is unreliable and frequently returns `0`, so `money()` captures
a string. `kvType` is the type the **Knowledge Box** stores and filters on: mapping a money
field to `text` would make "every invoice over $10,000" inexpressible. The annotation is
stripped before the schema is sent to ARAG, so the model never sees it (DP-48).

### 6.3 Watch a write

Upload `public/samples/invoice.txt` with `?config=auto`, then:

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID" | jq '.meta.kv | {written, fields, writes}'
# { "written": true, "fields": 12, "writes": 1 }
```

Three layers of the same value, each honest about a different thing:

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID" | jq '
  { record: (.fields[] | select(.key=="invoice_date") | {raw, value}),
    knowledgeBox: .meta.kv.values.invoice_date }'
# { "record": { "raw": "15/06/2026", "value": "2026-06-15" }, "knowledgeBox": "2026-06-15T00:00:00Z" }
```

`raw` is what was printed. `value` is `validateNormalize`'s deterministic parse. The
Knowledge Box value is `toKvData`'s coercion to the *declared* kv type — a full RFC 3339
instant, which is therefore what a `gte` filter has to be phrased against. A value that
cannot be coerced is **skipped with a named reason**, not written wrong.

Open `#/documents/<id>/json?view=kv` to see all of this on screen, including anything
skipped.

### 6.4 Filter on it

```bash
B=http://localhost:8080
curl -sS "$B/api/v1/documents?kv=dip_invoice_extraction:total:gte:10000"  | jq .total   # 1
curl -sS "$B/api/v1/documents?kv=dip_invoice_extraction:total:gte:200000" | jq .total   # 0
curl -sS --get "$B/api/v1/documents" \
     --data-urlencode 'kv=dip_invoice_extraction:invoice_date:gte:2026-01-01T00:00:00Z' | jq .total   # 1
```

The shape is `kv=<schemaId>:<field>:<op>:<value>`, repeatable up to ten and ANDed. Only the
**first three** colons separate, which is why an RFC 3339 value needs no escaping.
Operators are per field kind: `eq` on any scalar; `gte`/`lte` on integer, float and date
scalars only; `contains` on `repeated` and `range` fields. Ask for the wrong one and you get
a `400` naming what that field does accept — checked before the call, because ARAG enforces
the same rule with a `412` that says nothing useful.

Now combine a Knowledge Box filter with a local one:

```bash
curl -sS --get "$B/api/v1/documents" \
     --data-urlencode 'kv=dip_invoice_extraction:total:gte:10000' \
     --data-urlencode 'status=ready' | jq .filters
```

```json
{ "knowledgeBox": { "applied": [ … ], "requested": [ … ], "matchedResources": 1 },
  "local": ["status"] }
```

**Checkpoint:** you can say why these are reported separately rather than as one list.

**Why this matters:** they are not interchangeable. `status` is a predicate over this
workspace's own store — exhaustive, instant, true the moment the record is written. The
`kv` filter is a `/find` against a *different system*, answering at a *different time*, and
it can fail or lag independently. `requested` versus `applied` is how a Knowledge Box that
cannot answer degrades to the local list **with the reason**, rather than to an empty page
that reads as "nothing matched". And `matchedResources` is reported instead of a facet
count because key-value fields are not facetable at all — a count would be promising
something the platform cannot answer (DP-50).

**The one thing the mock does not teach you.** Against the mock, a key-value write is
filterable immediately. Against a live Knowledge Box it is not: measured on 2026-09-13, a
value was readable through `show=values` the instant it was written and **still not
returned by a `/find` key-value filter ~66 seconds later**, with no status to poll (DP-55).
Everything you proved here about *correctness* transfers; nothing you observed about
*timing* does. The architect track's
[`key-value-schema-design.md`](../architect-track/key-value-schema-design.md) is where that
becomes a design rule.

---

## 7. Change a setting without a restart, and prove it (20 min)

*Exercise: [`exercises/07-change-a-setting-live.md`](exercises/07-change-a-setting-live.md) ·
Solution: [`solutions/07-change-a-setting-live.md`](solutions/07-change-a-setting-live.md)*

Every value this deployment reads from configuration is editable in the product, takes
effect immediately, survives a restart, overrides the environment and is audited (DP-52).

### 7.1 Read the settings document

```bash
A='Authorization: Bearer lab-admin-token'
curl -sS "$B/api/v1/admin/settings" -H "$A" | jq '{version, groups: [.groups[].id]}'
# { "version": 1, "groups": ["branding","connection","limits","security","retention","operations"] }
```

Every field reports which of three layers its value came from: `default` (the built-in
fallback), `env` (the deployment's environment), or `store` (an in-product edit, which
overrides the environment). Secrets report `set` and a four-character `hint`, and **never a
value** — `connection.apiKey` and `security.adminToken` return `"value": null` everywhere.

The `applied` block is read back from the **live objects** — the ARAG client, the rate
limiter, the upload ceiling, the retention scheduler — not from the stored document. "I
saved it" and "it is in force" are two different claims, and this is how a UI makes both
honestly.

### 7.2 Change something with an observable consequence

```bash
curl -sS -X PATCH "$B/api/v1/admin/settings" -H "$A" \
     -H 'Content-Type: application/json' \
     -d '{"limits":{"maxUploadBytes":2048}}' | jq '{changed, version: .settings.version}'
```

Three independent proofs, no restart:

```bash
curl -sS "$B/api/v1/admin/settings" -H "$A" \
  | jq '.groups[].fields[] | select(.key=="limits.maxUploadBytes") | {source, value}'
# { "source": "store", "value": 2048 }     ← was "env", 26214400
curl -sS "$B/api/v1/admin/settings" -H "$A" | jq '.applied.limits.maxUploadBytes'   # 2048
curl -sS "$B/api/v1/settings" | jq '.uploads.maxBytes'                              # 2048
```

The third is the credential-free endpoint the upload drawer reads, which is why lowering
the ceiling changes what the screen tells the next person who opens it (DP-40).

### 7.3 Prove it against real behaviour

```bash
head -c 3000 /dev/urandom | base64 | head -c 3000 > /tmp/big.txt
curl -sS -o /tmp/413.json -w '%{http_code}\n' -X POST "$B/api/v1/documents" \
     -H 'Content-Type: text/plain' -H 'X-Filename: big.txt' --data-binary @/tmp/big.txt
jq -r .detail /tmp/413.json
```

```
413
Body exceeds 2048 bytes
```

### 7.4 The patch is atomic

```bash
curl -sS -X PATCH "$B/api/v1/admin/settings" -H "$A" -H 'Content-Type: application/json' \
     -d '{"branding":{"primaryColor":"not-a-colour","tagline":"Should not be applied"}}' | jq '{status, errors}'
curl -sS "$B/api/v1/branding" | jq -r .tagline
# Documents in, validated records out      ← the valid half was NOT applied
```

### 7.5 Put it back, and read the audit trail

```bash
curl -sS -X POST "$B/api/v1/admin/settings/reset" -H "$A" -H 'Content-Type: application/json' \
     -d '{"keys":["limits.maxUploadBytes"]}' | jq '.changed'
curl -sS "$B/api/v1/admin/audit?action=settings" -H "$A" \
  | jq '[.items[] | {actor: .actor.type, action, target, before, after}]'
```

Reset does not "set it back to 26214400" — it **removes the store override**, so the field
falls back to whatever the environment says now. `action=settings` is a prefix match, so it
catches `settings.update` and `settings.reset` together.

**Checkpoint:** you changed a live deployment's behaviour, proved it four ways (the field's
layer, the applied block, the public endpoint, a real 413), proved a bad patch changes
nothing, and found both changes in the audit log — without restarting anything.

**Why this matters:** a settings screen that needs a redeploy to take effect is a
configuration viewer, not a settings screen. The consequence for anyone reviewing this
product is in the architect track: "what is this deployment configured to do" is no longer
answerable from the repository and the deployment manifest, only from `applied` and the
audit log. Five variables stay environment-only because they are a restart by definition:
`PORT`, `HOST`, `DATA_DIR`, `NODE_ENV`, `ARAG_MOCK`.

---

## 8. Correct a field, and read the audit trail (25 min)

*Exercise: [`exercises/08-correct-a-field.md`](exercises/08-correct-a-field.md) ·
Solution: [`solutions/08-correct-a-field.md`](solutions/08-correct-a-field.md)*

A human typing a value does not make it grounded. This section is what the product does
instead.

### 8.1 Correct a field

Upload `public/samples/invoice.txt` again, confirm `meta.groundingScore` is `1`, then:

```bash
curl -sS -b /tmp/dip-cookies.txt -X PUT "$B/api/v1/documents/$ID/fields/po_number" \
     -H 'Content-Type: application/json' \
     -d '{"value":"PO-88422","reason":"Transposed digit; the scan reads 88422"}' | jq .correction
```

Before you read the response, predict three things: what happens to the field's
`confidence`, what `verified` will say, and which direction `meta.groundingScore` will
move.

The answers: the `confidence` is **dropped entirely** (so is `raw`) — a confidence is the
model's certainty about a value the model produced, and this is not that value. `verified`
is `"unverified"`, because the corrected value is re-checked against the document's own
text with the same evidence contract the pipeline uses, and `PO-88422` is not in the
document; the stale quote is removed rather than left pointing at the wrong string. And the
grounding score **falls**, to `0.92` — eleven of twelve fields still carry a verified quote.

### 8.2 Why the score falls

```bash
curl -sS "$B/api/v1/documents/$ID" | jq '{grounding: .meta.groundingScore, corrected: .meta.correctedFields}'
# { "grounding": 0.92, "corrected": 1 }
```

A corrected field stays in the denominator and counts in the numerator only when its new
value verifies (DP-49). Excluding corrected fields would quietly move the goalposts — a
reviewer could raise a record's score by correcting its worst fields. Keeping the model's
old confidence would attribute the model's certainty to a human's typing.
`meta.correctedFields` is reported alongside the score so the trust strip can say "11 of 12
fields carry a verified quote · 1 corrected by a reviewer" rather than hiding the human's
hand.

### 8.3 Find the trap

```bash
curl -sS "$B/api/v1/documents/$ID" | jq '{writes: .meta.kv.writes, stale: .meta.kv.filterIndexStale, superseded: .meta.kv.superseded}'
# { "writes": 2, "stale": true, "superseded": [ { "field": "po_number", "value": "PO-88421" } ] }

curl -sS "$B/api/v1/documents?kv=dip_invoice_extraction:po_number:eq:PO-88421" | jq .total   # 1
curl -sS "$B/api/v1/documents?kv=dip_invoice_extraction:po_number:eq:PO-88422" | jq .total   # 1
```

One document, two mutually exclusive values, both matching.

**Why this matters:** two verified-live facts compose into it (DP-51). A key-value write is
a **full replace** of that schema's data on that resource — which is why a one-field
correction sends the whole current record. And overwriting a value does **not** remove the
previous one from the Knowledge Box's filter index, which accumulates every value ever
written, with no purge call. So the product writes **once** per resource in the normal path,
and when a second write is unavoidable it reports it rather than hiding it. The design rule
that follows — a key-value filter is reliable over immutable data and unreliable over
mutable data — is the architect track's
[`key-value-schema-design.md`](../architect-track/key-value-schema-design.md).

### 8.4 Two histories, for two audiences

```bash
curl -sS "$B/api/v1/documents/$ID/corrections" | jq '.items[0]'
curl -sS "$B/api/v1/admin/audit?action=document.field.correct" -H "$A" | jq '.items[0]'
```

The correction record lives on the document, is what a reviewer reads, and carries the
`reason`, the `verified` outcome and the key-value write's fate. The audit entry lives in
the operator's log, carries a `requestId` and a monotonic `seq`, and shares one uniform
shape with settings edits, key creation, config changes, purges and deletes. `target` is
`<documentId>#<fieldKey>`, so one field's entire history across every reviewer is one query.

The endpoint returns corrections **newest first** — the order a review panel wants — while
the record's own `corrections` array is **oldest first**, the order it happened in and the
order the Pipeline tab's timeline renders.

### 8.5 Undo

```bash
curl -sS -b /tmp/dip-cookies.txt -X DELETE "$B/api/v1/documents/$ID/fields/po_number" \
  | jq '{verified: .correction.verified, grounding: .document.meta.groundingScore,
         corrected: .document.meta.correctedFields,
         history: (.document.corrections | length), writes: .document.meta.kv.writes}'
# { "verified": "exact", "grounding": 1, "corrected": 1, "history": 2, "writes": 3 }
```

The value comes back, and with it `verified: "exact"` and a grounding score of `1`. Four
things do not: `correctedFields` stays `1` (a human has been in this record), the field's
`confidence` stays gone, the history **grew** rather than shrank (the revert is recorded as
a new correction, so it is exactly as attributable as the change it undoes), and
`kv.writes` is `3` with both values now superseded.

Run the undo a second time and it oscillates rather than answering 400 — it undoes the
*most recent* correction, which is now the revert. The documented 400 is for a field with no
correction history at all.

**Checkpoint:** clean up.

```bash
curl -sS -b /tmp/dip-cookies.txt -o /dev/null -w '%{http_code}\n' -X DELETE "$B/api/v1/documents/$ID"
# 204 — the record, the KB resource, its key-value data and its filter-index entries
```

---

## What you've done

You have touched every layer this product is built from: the HTTP surface (`routes/`), the
domain logic (`services/`), the contract (`openapi.ts`), the shared types (`types.ts`), the
test suite that keeps all four honest — and the three things that make it a product rather
than a pipeline: typed, filterable data in the Knowledge Box, live configuration, and an
append-only record of every human judgement applied to a machine's output.

If you want to keep practising, the exercises in [`exercises/`](exercises/) restate each
section as a standalone problem with acceptance criteria, and
[`knowledge-check.md`](knowledge-check.md) probes the *why*, not just the *how*, of the
choices you just made. The architect track's
[`WORKSHOP.md`](../architect-track/WORKSHOP.md) is the half-day companion to this one.
