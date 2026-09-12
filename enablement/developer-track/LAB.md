# Document Processing — Developer Lab

**Time:** 60–90 minutes, in six timed sections.
**You will:** drive the full API from the command line, add a new document type end to
end, create a custom extraction config through the API and the UI, extend the product
(a new export format), and write a test that proves it — against the real codebase, on
the mock ARAG, with `make check` green at the end.

## Prerequisites

- Node.js ≥ 22.18 (`node --version`)
- [bun](https://bun.sh) installed (`bun --version`) — used for dev tooling only; this
  product never uses `npm`
- `git`
- A clone of this repository, on the `mvp` branch
- **No ARAG credentials needed.** Everything in this lab runs against the in-process
  mock Knowledge Box (`ARAG_MOCK=1`). You will never call a real LLM or spend a token.

Optional but handy: `jq` for pretty-printing JSON responses (every command also works
without it — just drop the `| jq .`).

## Learning outcomes

By the end of this lab you will be able to:

1. Drive every stage of the Document Processing API (upload → job → record → export →
   ask → delete) from `curl`.
2. Add a new document type: an extraction schema, its labels and required fields, and
   see it provisioned as a stored ARAG search configuration and surfaced through
   `GET /api/v1/schemas` and the demo's config selector.
3. Create and inspect a custom, user-defined extraction config — through both the API
   and the demo UI — and see the ARAG search configuration it provisions.
4. Extend the product safely: add a new export format (or, as a stretch goal, a new
   pipeline stage) that plugs into the existing architecture without breaking the
   contract tests.
5. Write a unit or integration test against the mock ARAG and get `make check` green.

## How this lab is organised

Each section below has a time budget, exact commands, what you should see, a
**checkpoint** so you know you're on track, and a **why this matters** note connecting
the step to a real engineering decision in this product. The matching exercise sheet
([`exercises/`](exercises/)`0N-*.md`) restates the task as a standalone problem with acceptance
criteria and hints; the solution ([`solutions/`](solutions/)`0N-*.md`) has the full worked answer with
an explanation of the choices, checked against the real file paths, exports and
function signatures in this repository. Use the exercises if you want to attempt each
step yourself first; use the lab text if you want to follow along directly.

**A note on scope for sections 2 and 4:** you will edit files under `src/` (and add to
`test/` in Section 5) that are shared, tested source code — not sandboxed lab files.
That is deliberate: this lab teaches you to extend a real product. Section 2 in
particular is worth reading closely even though it turns out to need only two file
edits — the *reason* it needs only two, not four, is itself the lesson (a single source
of truth the test suite derives its counts from, rather than a hardcoded number). Do
the exercises on a scratch branch or be ready to `git checkout -- src/` afterwards if
you want your working tree back exactly as it started:

```bash
git checkout -b lab/document-processing   # optional, recommended
# … do the lab …
git checkout -- src/                      # optional, discard lab edits when you're done
```

---

## 0. Setup and orientation (10 min)

```bash
git clone <repo-url> arag-doc-processing   # skip if you already have the clone
cd arag-doc-processing
make install        # bun installs dev tooling only (no npm, ever)
cp .env.example .env
```

`.env.example` ships with `ADMIN_TOKEN` blank, which locks `/admin` and every
`/api/v1/admin/*` route (including one this lab uses in Section 3). Set a local dev
token before your first `make dev`:

```bash
printf '\nADMIN_TOKEN=lab-admin-token\n' >> .env
make dev             # http://localhost:8080
```

`make dev` checks whether `ARAG_API_KEY` is set in `.env`, and — since it isn't —
starts with `ARAG_MOCK=1` automatically. You get the whole pipeline running against an
in-process fake Knowledge Box, with no ARAG account needed.

Leave that terminal running and, in a second terminal, tour the three surfaces:

| Surface | URL | What it is |
|---|---|---|
| Demo | <http://localhost:8080/> | Drop a document, watch the pipeline live, read the record |
| Admin | <http://localhost:8080/admin/> | Health, KB test, extraction configs, jobs, logs, retention |
| API docs | <http://localhost:8080/api/v1/docs> | Redoc (and `/api/v1/swagger` to try it out) |

Open the demo, drop in `public/samples/invoice.txt` (drag it into the browser window),
and watch the pipeline stages light up in real time. Then open the admin panel, sign in
with `lab-admin-token` (or whatever you set above), and look at the **Configs** tab:
eleven built-in extraction configs, each backed by a stored ARAG search configuration
named `dip_<schema name>`.

Now run the test suite once, before you change anything, so you know what "green" looks
like:

```bash
make test
```

**Checkpoint:** `make test` reports `pass 39` (approximately — exact counts drift as the
suite grows) and `fail 0`. If it doesn't, stop and fix your environment before
continuing — every later section assumes this baseline is green.

**Why this matters:** the whole product — demo, admin, API — is one process, one store,
one job manager. There is no separate "backend" and "frontend" deploy step, no build,
and no compiled artefact: `node --watch src/index.ts` runs the TypeScript sources
directly (erasable-syntax only, per the platform's Node-compatibility rule). That is
also why `make install` never touches `npm` — `bun` is dev tooling only, and the
product itself ships with **zero runtime dependencies**.

---

## 1. Drive the API from the command line (15 min)

This section exercises the whole document lifecycle: upload, watch the job, read the
record, export it three ways, ask it a question, and delete it. Every command below was
run against the mock ARAG to produce the exact output shown; your ids and timestamps
will differ.

### 1.1 Upload

```bash
curl -sS -X POST 'http://localhost:8080/api/v1/documents?config=auto' \
     -H 'Content-Type: text/plain' -H 'X-Filename: invoice.txt' \
     --data-binary @public/samples/invoice.txt | tee /tmp/up.json | jq .
```

You get back `202 Accepted` with both the pending `document` record and the `job` that
is processing it:

```json
{
  "document": {
    "id": "4de05b0da01e410ebe075f61f2cb6b11",
    "resourceId": "4de05b0da01e410ebe075f61f2cb6b11",
    "jobId": "e791576a-4c8d-4cf1-b24a-3b4d6a6632f7",
    "status": "pending",
    "docType": "generic",
    "fields": [], "entities": [], "tags": [], "issues": []
  },
  "job": { "id": "e791576a-4c8d-4cf1-b24a-3b4d6a6632f7", "kind": "process-document", "status": "queued" }
}
```

Note that `document.id` and `document.resourceId` are the **same string** — the
document id *is* the ARAG resource id (a deliberate product decision: one opaque id for
callers, no mapping table, and `DELETE /documents/{id}` can delete the KB resource
without a lookup).

```bash
ID=$(jq -r .document.id /tmp/up.json)
JOB=$(jq -r .job.id /tmp/up.json)
```

### 1.2 Watch the pipeline over SSE

```bash
curl -sN "http://localhost:8080/api/v1/jobs/$JOB/events"
```

You will see one `event: event` per pipeline stage (`process`, `classify`, `extract`,
`entities`, `summary`, `validate`, `standardize`), and a final `event: job` carrying the
whole job once it reaches a terminal status. Against the mock this completes in
milliseconds; against a live Knowledge Box the whole pipeline for a short text document
typically finishes in well under 20 seconds, with `process` (OCR/visual layout/
embeddings, then a wait for the resource to become *searchable*) usually the single
largest stage — though it scales with document size and page count, so a multi-page
scanned PDF takes meaningfully longer than a short text file (see the architect track's
`sizing-deployment.md` for measured numbers). On the mock you can also just poll
instead:

```bash
curl -sS "http://localhost:8080/api/v1/jobs/$JOB" | jq '{status, progress}'
```

**Checkpoint:** the job's terminal `status` is `succeeded`, and the SSE stream shows all
seven stage names above, each with a `status` of `ok` (or occasionally `skip`, when
classification is bypassed).

**Why this matters:** `GET /api/v1/jobs/{id}/events` is a *view* of the job, not the
work itself. The prototype ran the whole pipeline inside a `GET` handler that streamed
its own progress — a GET with side effects, and a client that closed its tab left ARAG
calls running with nowhere to put the result. Here the job keeps running in the
`JobManager` regardless of who is watching; closing your `curl` and reopening
`GET /api/v1/jobs/$JOB/events` later replays every event that already happened before
resuming the live stream.

### 1.3 Read the canonical record

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID" | jq .
```

The record now has `status: "ready"`, `docType: "invoice"` (the classifier worked),
extracted `fields` (typed values with a `confidence`), `entities`, a `summary`, `tags`,
and `issues` (empty here — the invoice's numbers add up). Look at `meta.schema`
(`invoice_extraction`) and `meta.searchConfiguration` (`dip_invoice_extraction`) — the
name of the stored ARAG search configuration that produced this extraction.

### 1.4 Export all three formats

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID/export?format=json" | head -c 300; echo
curl -sS "http://localhost:8080/api/v1/documents/$ID/export?format=xml"  | head -c 400; echo
curl -sS "http://localhost:8080/api/v1/documents/$ID/export?format=csv"  | head -c 400; echo
```

JSON is the canonical record itself, pretty-printed. XML is a deterministic
element-per-field projection. CSV is **long format** — one row per extracted field
(`document_id, filename, doc_type, field_key, field_label, value, confidence`) — which
is what lets wildly different document schemas (an invoice's twelve fields, a resume's
nine) share one spreadsheet-friendly shape instead of needing a different column set
per doc type.

### 1.5 Ask the document a question

```bash
curl -sS -X POST "http://localhost:8080/api/v1/documents/$ID/ask" \
     -H 'Content-Type: application/json' -d '{"question":"What is the total due?"}' | jq .
```

```json
{ "answer": "… TOTAL DUE: $116,160.00 AUD …", "sources": ["invoice.txt"], "ms": 2 }
```

This is scoped to the *one* document via `resource_filters: [rec.resourceId]` on
`/ask` — not a knowledge-base-wide question. `POST /api/v1/documents/{id}/ask` answers
only from the one document you name in the URL; there is no "ask the whole KB" endpoint
in this product, because every document here is a self-contained record, not a shared
corpus (see the knowledge check for the fuller reasoning).

### 1.6 Clean up

Everything so far — upload, read, export, ask — worked with no credential at all. `DELETE`
is different: it also removes the KB resource, a genuine write to shared state, so it
requires one even though `API_KEYS` is unset. Bootstrap a same-origin session once (the
same call the demo UI makes) and reuse the cookie for the rest of this lab:

```bash
curl -sS -c /tmp/dip-cookies.txt -X POST http://localhost:8080/api/v1/session
```

```json
{ "ok": true, "expiresInSec": 43200 }
```

```bash
curl -sS -b /tmp/dip-cookies.txt -o /dev/null -w '%{http_code}\n' \
     -X DELETE "http://localhost:8080/api/v1/documents/$ID"
# 204
curl -sS -o /dev/null -w '%{http_code}\n' "http://localhost:8080/api/v1/documents/$ID"
# 404 — the record and the underlying KB resource are both gone
```

**Checkpoint:** you have seen `202 → SSE → 200 (record) → 200×3 (exports) → 200 (ask)
→ 204 (delete) → 404 (confirmed gone)` — the full lifecycle, once, end to end.

**Why this matters:** `DELETE` removes the record **and** calls `deleteResource` on the
KB — a product handling other people's documents has to actually delete them, not just
hide the local pointer. Because that's destructive to shared state, it goes through a
`requireWriter` guard (`src/routes/guards.ts`) that reads, uploads, exports and `ask`
don't — any of an admin token, an API key, or this session cookie satisfies it. This is
also why the hard rule for this lab (and for the whole product's `make smoke` live test)
is: **delete anything you create.**

---

## 2. Add a new document type (20 min)

You will add an eleventh — no, a **twelfth** — built-in document type: `insurance_card`
(a health/medical scheme membership card). This exercises the "how do I extend the
schema library" path: `src/types.ts` (the single source of truth for every
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
tsc --noEmit -p tsconfig.json   # or: bunx tsc --noEmit -p tsconfig.json
```

**Checkpoint:** this fails, with something like:

```
src/services/schemas.ts(58,14): error TS2741: Property 'insurance_card' is missing in
type '{ invoice: {...}; ... }' but required in type 'Record<... | "insurance_card",
ExtractionSchema>'.
```

Good — that's `SCHEMAS`'s type (`Record<DocType, ExtractionSchema>` in
`src/services/schemas.ts`) refusing to compile until every `DocType` has a matching
schema. You cannot half-add a document type here.

### 2.2 Add the schema

Still in `src/services/schemas.ts`, use the starter stub at
[`starter/insurance-card.schema.ts`](starter/insurance-card.schema.ts) as your starting
point (it sketches the shape with `TODO`s); paste the finished object into `SCHEMAS`
(alphabetical position doesn't matter — placing it just before `generic:` is consistent
with the file's existing order).

Each schema is an OpenAI-function-style JSON Schema, terse by design via the file's
`s()` (string), `money()` (string, but documented as an amount — see the comment above
`money()` for *why* amounts are never declared as JSON `number`), `n()` (number) and
`arr()` (string array) helpers.

```bash
tsc --noEmit -p tsconfig.json   # now passes
```

### 2.3 See it appear — everywhere, with no further edits

```bash
curl -sS http://localhost:8080/api/v1/schemas | jq '.items[] | select(.docType=="insurance_card")'
curl -sS http://localhost:8080/api/v1/openapi.json \
  | jq '.components.schemas.Document.properties.docType.enum'
```

(Restart `make dev` first if it isn't already picking up the change — it runs under
`node --watch`, so it usually reloads on save.) You should see your new schema's fields
from the first call, and `"insurance_card"` already present in the second — `openapi.ts`
imports `DOC_TYPE_VALUES` from `types.ts` and builds every `docType` enum in the spec
from it, so step 2.1 alone already updated the public contract. It will also appear,
automatically, in the demo's config selector — `configs.list()` builds the built-in list
from `DOC_TYPES` (itself `[...DOC_TYPE_VALUES]`) dynamically.

### 2.4 Run the tests — and notice what *doesn't* break

```bash
make test
```

**Checkpoint:** `fail 0` — with **no test file edited**. `test/api.test.ts`'s
extraction-config and schema-catalogue tests, and `test/e2e/admin.spec.ts`'s admin
config-table assertion, all import `DOC_TYPE_VALUES` from `src/types.ts` and assert
against `DOC_TYPE_VALUES.length`, not a literal number — the count moved with you.

**Why this matters:** this product used to keep the document-type list in three unsynced
places (a hand-written union, a duplicate array in `openapi.ts`, and a literal `11`
baked into three tests) — adding a type meant four coordinated hand-edits, and
forgetting one either broke the build, silently drifted the public spec from the code,
or left a test looking green while it had quietly stopped checking anything. Collapsing
it to one source of truth (`DOC_TYPE_VALUES`) didn't remove the compiler's guard rail
from Section 2.1 — it removed the *manual, easy-to-forget synchronisation* that used to
sit next to it. A hardcoded count in a test is often a symptom of a missing single
source of truth in the code under test, not a permanent fact of life.

Also run `test/agents.test.ts`'s `"every schema is internally consistent"` test in
isolation once — it iterates every schema (yours included) and checks that every
`required` key exists in `properties` and every property has a label, which is the
closest thing to a dedicated unit test your new schema needs:

```bash
node --test --test-reporter=spec test/agents.test.ts
```

If you want your working tree back exactly as it started, this is a good point to run
`git checkout -- src/` before moving on — Sections 3–5 do not depend on this change.

---

## 3. Create a custom extraction config through the API and the UI (10 min)

Not every document type deserves a built-in schema. `POST /api/v1/extraction-configs`
lets a caller define one on the fly.

### 3.1 Through the API

Creating a config is a write to shared state (it provisions a real ARAG search
configuration), so — unlike the upload in Section 1 — it needs the session credential
from Section 1.6. Reuse the cookie jar you already made:

```bash
curl -sS -b /tmp/dip-cookies.txt -X POST 'http://localhost:8080/api/v1/extraction-configs' \
     -H 'Content-Type: application/json' \
     -d '{
           "name": "Insurance Card",
           "fields": [
             { "label": "Policy Number", "required": true },
             { "label": "Insurer" },
             { "label": "Benefits", "type": "array" }
           ]
         }' | jq .
```

```json
{
  "id": "cfg_611b7155",
  "name": "Insurance Card",
  "docType": "generic",
  "builtin": false,
  "aragConfig": "dip_custom_insurance_card",
  "provisioned": true,
  "fields": [
    { "key": "policy_number", "label": "Policy Number", "type": "string", "required": true },
    { "key": "insurer", "label": "Insurer", "type": "string", "required": false },
    { "key": "benefits", "label": "Benefits", "type": "array", "required": false }
  ]
}
```

Field `key`s are derived from the label (`toKey`) unless you supply one explicitly.
`provisioned: true` means the ARAG search configuration (`dip_custom_insurance_card`,
`kind: "ask"`) has already been written to the Knowledge Box — creation and
provisioning happen in the same call (`ConfigsService.create`).

### 3.2 Through the UI

Open <http://localhost:8080/> (the demo), find the config manager section, add the same
three fields by hand, and click save. It calls the exact same
`POST /api/v1/extraction-configs` endpoint — the demo UI has no separate config logic;
it is a thin client over `/api/v1`, same as `curl` (it obtains its own session
automatically on page load, which is why you didn't need to log in to use it). Your new
config appears immediately in the "Custom" group of the upload selector.

### 3.3 Inspect the stored ARAG search configuration

`GET /api/v1/admin/search-configurations` reads the `dip_*` search configurations
straight from the Knowledge Box — exactly what the extraction agents run against — so
you can see the raw ARAG payload without opening the ARAG dashboard or writing any code.
It's gated by the **admin** credential (the `ADMIN_TOKEN` you set in Section 0), a
different, stronger gate than the session cookie above:

```bash
curl -sS http://localhost:8080/api/v1/admin/search-configurations \
     -H "Authorization: Bearer lab-admin-token" \
  | jq '.items[] | select(.name=="dip_custom_insurance_card")'
```

```json
{
  "name": "dip_custom_insurance_card",
  "kind": "ask",
  "config": {
    "generative_model": "chatgpt-azure-4o",
    "reranker": "predict",
    "rag_strategies": [{ "name": "full_resource" }],
    "prompt": { "system": "You are a precise document-data extraction engine. …" },
    "answer_json_schema": {
      "name": "custom_insurance_card",
      "parameters": { "type": "object", "properties": { "policy_number": {...}, "insurer": {...} }, "required": ["policy_number"] }
    }
  }
}
```

**Checkpoint:** you can point at the exact three things this config pins server-side —
the reranker, the `full_resource` RAG strategy, and the `answer_json_schema` — and
explain why none of them live in this product's own code once provisioned.

**Why this matters:** the model, the grounding rules and the schema live **server-side
in the Knowledge Box**, not in this service. That means they can be inspected and tuned
directly in the ARAG dashboard, and every client of the KB — not just this product —
gets the same extraction contract. Provisioning is idempotent (`POST`, falling back to
`PATCH` on 409), so re-running it (`POST /api/v1/admin/provision` in the admin panel) is
always safe, including after a KB reset. Before `GET /api/v1/admin/search-configurations`
existed, seeing this payload meant a throwaway script calling `AragClient` directly, or
the ARAG dashboard — this endpoint makes it a first-class, discoverable operation.

Clean up your test config when you're done (reusing the session cookie again):
`curl -b /tmp/dip-cookies.txt -X DELETE http://localhost:8080/api/v1/extraction-configs/cfg_...`
(built-ins answer `409 Conflict` if you try — they aren't deletable).

---

## 4. Add an export format (20 min)

`src/services/formats.ts` turns a `DocumentRecord` into `json`, `xml` or `csv` — three
pure, dependency-free functions plus a `serialize()` dispatcher. You will add a fourth:
`markdown`, a single Markdown document with a summary, a field table and an entity/issue
list — the kind of thing you'd paste straight into a ticket or a chat message.

### 4.1 Write `toMarkdown`

Add to `src/services/formats.ts` (see
[`starter/markdown-export.snippet.ts`](starter/markdown-export.snippet.ts) for a TODO-annotated
starting point and [`solutions/04-add-an-export-format.md`](solutions/04-add-an-export-format.md) for the finished function).
Reuse the file's existing private `flatValue()` helper for array/`null` handling —
don't duplicate it.

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

and add a `case "markdown": return toMarkdown(rec);` to `serialize()`.

### 4.3 Wire it into the route and the spec

`src/routes/documents.ts` guards the `?format=` query parameter with a `Set`:

```ts
const FORMATS = new Set(["json", "xml", "csv", "markdown"]);
```

`src/openapi.ts`'s `/api/v1/documents/{id}/export` operation enumerates the same values
in its `format` query parameter schema, and its `200` response lists a content type per
format — add `"markdown"` to the `enum` and `"text/markdown": { schema: { type: "string" } }`
to the response content map. Skipping this step doesn't break `curl`, but it does mean
`missingFromSpec()`/`checkResponse()` — the contract tests — won't know the new format
exists, and STANDARDS §2 requires every route (and every documented shape it can
return) to live in `openapi.ts` first.

### 4.4 Try it

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID/export?format=markdown"
```

**Checkpoint:** you get back `200`, `Content-Type: text/markdown; charset=utf-8`, and a
readable Markdown document — a `#` heading with the filename, a two-column field table,
an `## Entities` list and (if any) an `## Issues` list.

**Stretch goal — a pipeline stage instead:** if you'd rather extend the *pipeline* than
the export layer, look at `src/services/pipeline.ts`'s stage list (`process → classify
→ extract → entities → summary → validate → standardize`) and `ctx.stage(name,
message, fn, { soft: true, progress })`. A safe stage to add is a deterministic
`redact` step after `validate` that masks obvious PII (e.g. anything matching a card- or
SSN-like pattern) in `record.fields` before `standardize` — no model call needed, so it
is trivial to unit test. Every stage in this pipeline is `soft: true`: a thrown error
inside `ctx.stage()` is caught, recorded as a stage error, and the run continues with
the best record produced so far (see the knowledge check for why).

**Why this matters:** formats and pipeline stages are the two safest extension points in
this product precisely because both are additive to a stable contract — `formats.ts`
functions are pure (no I/O, so trivially testable) and pipeline stages are soft-failing
by design, so a bug in your new stage degrades a run rather than crashing it. Both are
exactly the shape of change an actual customer integration would ask for ("can you give
me a Markdown export", "can you add a PII-redaction pass") without touching the ARAG
integration layer at all.

---

## 5. Write a test and get `make check` green (15 min)

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

(Import `toMarkdown` alongside the other format functions at the top of the file.)

### 5.2 Run it

```bash
node --test --test-reporter=spec test/formats.test.ts
```

**Checkpoint:** your new test passes alongside the existing four.

### 5.3 Get the whole thing green

```bash
make check      # Biome + tsc --noEmit + tests with the 80% coverage gate
```

`make check` runs, in order: `biome check .` (formatting + lint), `tsc --noEmit`
(type-checking against `tsconfig.json`), and the full test run with
`--experimental-test-coverage --test-coverage-lines=80` on `src/**`. All three must be
clean.

**Checkpoint:** `make check` exits `0`. If Biome complains about formatting, run
`make format` (`biome check --write .`) and re-run.

**Why this matters:** `make check` is exactly what CI runs (Node 22 and 24) and exactly
what STANDARDS §8 calls the testing bar for this product. A pure function like
`toMarkdown` needs no ARAG call and no mock to unit-test — that's a deliberate
architectural choice (`formats.ts`'s docstring: "Pure functions, no I/O — fully
unit-tested"), and it is why the 80% coverage gate on `src/**` is achievable without a
slow, flaky test suite: the parts of this product that talk to ARAG are the minority,
and everything else is small, deterministic, and cheap to test.

---

## What you've done

You have now touched every layer this product is built from: the HTTP surface
(`routes/`), the domain logic (`services/`), the contract (`openapi.ts`), the shared
types (`types.ts`), and the test suite that keeps all four honest. If you want to keep
practising, the exercises in [`exercises/`](exercises/) restate each section as a standalone problem
with acceptance criteria, and [`knowledge-check.md`](knowledge-check.md) has 15 questions (with answers) that
probe the *why*, not just the *how*, of the choices you just made.
