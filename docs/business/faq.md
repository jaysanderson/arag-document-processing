# FAQ

## What does it cost to run?

The software itself is Apache-2.0 and free to self-host. Running cost has two components:
hosting (one small Fly machine is enough for the MVP — see
[`../architecture/deployment-topologies.md`](../architecture/deployment-topologies.md)) and
LLM usage against your Progress Agentic RAG Knowledge Box — every document upload makes
several grounded model calls (classify, extract, entities, summary), and every `ask`
question makes one more. There's no LLM spend at all while developing against the built-in
mock ARAG (`ARAG_MOCK=1`).

## How accurate is the extraction?

It depends on the document and the model, but every result comes with signal you can act
on rather than a bare value: a **confidence score** per field, the **raw text** the model
actually read before normalisation, and explicit **validation issues** — a required field
that wasn't found, or (for money documents) a subtotal/tax/total that doesn't reconcile.
This is designed to be checked, not blindly trusted, especially for high-stakes fields.
Extraction quality also depends on using a genuinely multimodal generative model
(`ARAG_GENERATIVE_MODEL`) for visual documents — a text-only model won't read a scanned
image well.

## Does it handle scanned images and PDFs, or only text?

Both. Text files are read directly; images (PNG/JPEG/WebP/TIFF) and PDFs go through ARAG's
visual-LLM extraction path — optionally with a configured ingestion-time "extract strategy"
(`DIP_EXTRACT_STRATEGY`) for higher-fidelity visual/layout processing. The demo's "Image
samples" buttons and prompt gallery exist specifically to show this off.

## What file types are accepted?

PDF, PNG, JPEG, WebP, TIFF, plain text, Markdown, CSV, and Word (`.docx`) — nine content
types in total, enforced before anything reaches the Knowledge Box. Anything else is
rejected immediately with a clear error. See
[`../architecture/limits.md`](../architecture/limits.md) for the exact list and the 25 MB
size cap.

## What happens if extraction fails partway through?

Each pipeline stage is independent: if entity enrichment or summarisation fails, the
document still ends up `ready` with whatever fields were successfully extracted, and the
failure is visible in the job's timeline rather than losing the whole run. Only a genuinely
missing document record fails the job outright. Extraction and entity enrichment also get
one automatic retry if the first pass comes back empty (a rare artefact of the model
returning nothing on the very first grounded call).

## Does it handle non-English documents?

The extraction, classification and summarisation prompts don't restrict input language, and
a capable multimodal model will generally read and respond in the document's language or
in English depending on how it's prompted — but this hasn't been systematically evaluated
across languages, and the built-in schemas and labels are written in English. Treat
non-English support as "likely works, not formally verified" rather than a guaranteed
capability.

## Is my data retained? For how long?

Yes, until you delete it. Uploaded documents live in the ARAG Knowledge Box and the
extracted record lives in the local store indefinitely — there is no automatic expiry.
Deletion is explicit: `DELETE` a single document (removes it from both places), or an
operator runs a retention purge (age-based, bulk) from the admin panel's **Retention** tab
or the API. See [`../architecture/security-model.md`](../architecture/security-model.md#data-retention-and-purge).

## Is PII handled safely?

Documents commonly contain PII (names, addresses, member numbers), and this product treats
that as the operator's responsibility to manage, not something it strips or masks
automatically: it doesn't redact PII from extracted fields, entities, logs of document
*content*, or exports. What it does do: secrets (tokens, keys) are never logged or exposed;
documents are only ever sent to the Knowledge Box you configure; and deletion/purge
genuinely removes data from both the local store and the Knowledge Box. If your documents
carry regulated PII, plan your retention policy and access controls (`ADMIN_TOKEN`,
`API_KEYS`) accordingly before going live — see
[`../architecture/security-model.md`](../architecture/security-model.md).

## Can it run without a live ARAG account?

Yes, for development and evaluation: set `ARAG_MOCK=1` and the entire product runs against
an in-process mock Knowledge Box — no credentials, no LLM spend, deterministic behaviour
good enough to see the whole pipeline shape end to end. It is not a substitute for testing
against a real Knowledge Box before trusting extraction quality on real documents (the mock
synthesises placeholder field values rather than genuinely reading documents) — see
[`../architecture/limits.md`](../architecture/limits.md#mock-vs-live-differences).

## How do I add support for a new kind of document?

Two ways, neither requiring a code change for most cases: (1) as an end user, create a
**custom extraction config** — name it, list the fields you want, done, via the admin-free
"Manage…" button in the demo or a single `POST /api/v1/extraction-configs` call; or (2) as a
developer, add a new built-in schema to the codebase if you want it available by default
and addressable by document-type name. See
[`../developer/extension-points.md`](../developer/extension-points.md#add-a-document-type-extraction-schema).

## How fast is it?

Export, listing and asking a question are effectively instant (no new ARAG ingestion
involved). A fresh upload's full pipeline — against a real Knowledge Box — takes roughly a
minute end to end, dominated by ARAG's own document ingestion (OCR, visual layout,
embeddings), not this product's code. Against the built-in mock it completes in well under
a second, which is useful for development but not representative of real timing. See
[`../architecture/scaling.md`](../architecture/scaling.md) for the real stage-by-stage
numbers.

## Can it scale to high volume?

The MVP processes two documents at a time per instance and is explicitly a single-instance
design for now — the local JSON store and in-process job queue aren't safe to share across
multiple instances as shipped. That's enough for a real team's steady inbound volume; it
isn't yet an enterprise batch-processing platform. See
[`../business/when-to-use.md`](when-to-use.md#poor-fits) and
[`../architecture/scaling.md`](../architecture/scaling.md) for what would need to change
first.

## Can I ask questions about a document instead of just extracting fields?

Yes — every document has an "Ask this document" box in the demo (and a
`POST /api/v1/documents/{id}/ask` endpoint). Answers are grounded strictly in that one
document; if the answer isn't in it, the system says so rather than guessing from general
knowledge.

## Is it open source?

Yes — Apache-2.0, self-hostable, with zero runtime dependencies (the Node standard library
only). The full source, including the OpenAPI specification every route is validated
against, ships in this repository.

## What happens to a document if I close my browser tab mid-processing?

Nothing bad — processing is a background job, not something tied to a live connection. The
live pipeline view in the demo is just a window onto that job; closing it doesn't stop or
restart the work, and reopening the document later shows the finished record exactly as if
you'd stayed on the page the whole time.

## Do I need to write any code to try it?

No — `make dev` starts the whole product against the mock ARAG with one command, and the
demo UI at `/` walks through upload → extraction → export → ask with sample documents
already provided. See [`../developer/quickstart.md`](../developer/quickstart.md).

## Related

- [`overview.md`](overview.md) — what the product does and why it matters.
- [`when-to-use.md`](when-to-use.md) — good fits, poor fits, and alternatives.
- [`../architecture/security-model.md`](../architecture/security-model.md) — the full security and data-handling picture.
