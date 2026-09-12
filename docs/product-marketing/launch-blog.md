# Document Processing: turning pictures of data back into data

Most of the data your systems need doesn't arrive as data. It arrives as a PDF invoice,
a photographed claim form, a scanned bank statement — a picture, effectively, of numbers
and names that a person has to read and retype before anything downstream can use them.
Optical character recognition solved half of this problem decades ago: it can tell you
what characters are on the page. It cannot tell you which of those characters is the
invoice total, which is the due date, or whether the tax and subtotal actually add up to
the number printed as the grand total. That gap — from "here is some text" to "here is a
validated business record" — is what Document Processing exists to close, and we're
releasing it as an open-source, API-first product built on Progress Agentic RAG (ARAG).

## What it looks like from the outside

The whole product is one small REST API. Here's the actual sixty-second path, run
against a live local instance:

```bash
# 1. Upload a document; you get the record and the job that is processing it.
curl -sS -X POST 'http://localhost:8080/api/v1/documents?config=auto' \
     -H 'Content-Type: text/plain' -H 'X-Filename: invoice.txt' \
     --data-binary @public/samples/invoice.txt

# 2. Once the job finishes, read the canonical record.
curl -sS "http://localhost:8080/api/v1/documents/$ID"
```

The response is a record with typed, labelled fields — vendor name, invoice number,
dates, a subtotal/tax/total triad, line items — each carrying a confidence score and,
where relevant, the raw text the value was normalised from:

```json
{
  "key": "total",
  "label": "Total",
  "value": 116160,
  "confidence": 0.95,
  "raw": "$116,160.00"
}
```

alongside named entities, a summary, and any validation issues. The same record exports
as JSON, XML or CSV, and you can ask it a direct question — "what's the total due?" —
and get an answer grounded in the document's own text, not the model's general
knowledge. Eleven document types ship built in (invoices, receipts, purchase orders,
contracts, résumés, medical claims, pre-authorisations, bank statements, forms, reports,
generic); anything else is a `POST /api/v1/extraction-configs` away, with no code
change.

## The pipeline, and why the hard parts are hard

Under that one API call is a small multi-agent pipeline — process, classify, extract,
entities, summary, validate, standardise — running as a platform job you can watch over
server-sent events or inspect after the fact. Each stage is deliberately simple in
isolation. What made the product reliable rather than merely demoable was a handful of
behaviours specific to how ARAG actually works, learned by running real documents
through a real Knowledge Box rather than assuming the obvious approach would work.

The most important one is **grounding scope**. A plain retrieval-augmented query only
puts the *retrieved paragraphs* into the model's context — which is exactly wrong for
extraction, because the invoice total is often in a paragraph that a generic query never
retrieves. Telling ARAG to ground on the **full resource** instead — the whole document,
not a snippet of it — is what makes extraction actually see the field it's being asked
for. It sounds like a small configuration flag; in practice it's the difference between
an extraction agent that reliably finds the total and one that finds it only when the
total happens to share vocabulary with the question.

The second is a subtlety of retrieval itself: full-resource grounding still needs
retrieval to *locate* the resource first, and an instruction-shaped query like "list the
entities in this document" can share no vocabulary at all with the document's actual
text, returning nothing to ground on. The fix is almost embarrassingly simple once you've
hit the failure mode — seed the query with a slice of the document's own extracted text
rather than an instruction — but it isn't something you'd think to do until a real
production document teaches you it's necessary.

The third is a timing trap: a resource reports status `PROCESSED` a few seconds before
it is actually retrievable. Extract immediately on seeing `PROCESSED` and you get an
empty, confusing result — not an error, just nothing — because the document technically
exists but isn't searchable yet. The pipeline gates on an explicit "is it findable"
check before it ever asks a real question of the document.

The fourth is a modelling choice that looks wrong until you've watched it fail: currency
amounts are extracted as **strings**, not JSON numbers. Ask a model to emit a JSON number
for `"$116,160.00"` and it will frequently, silently, return `0` — a formatted currency
string doesn't coerce cleanly to a number in the model's head, and a `0` looks like a
successful extraction, not a failure. Capturing the raw string and normalising it
deterministically afterwards, in code, is both more robust and preserves exactly what
was printed on the document, which turns out to matter when someone wants to check the
extraction against the source.

None of these are exotic. They're the kind of thing that only shows up when full
resource grounding is turned on against a live Knowledge Box with a real invoice, not a
toy example — which is exactly why they're worth publishing rather than rediscovering
per integrator. The complete list, with the ARAG endpoints and payloads involved, is in
[`docs/architecture/arag-integration.md`](../architecture/arag-integration.md).

## What's open, and what isn't finished

The whole product — pipeline, API, admin panel, demo UI, OpenAPI spec, tests — is
Apache-2.0 and has zero runtime dependencies; it runs on the Node standard library
alone. That's a deliberate constraint, not an accident: fewer dependencies means less
supply-chain surface and an easier audit for anyone deciding whether to run this against
their own documents.

It's also honestly an MVP, not a finished platform. There's no human-in-the-loop review
queue — validation issues surface through the API, but correcting a low-confidence field
and feeding that correction back is a workflow this product doesn't yet provide. There's
no fine-tuning: extraction quality is whatever the configured ARAG generative model
delivers. The job runner is a single in-process worker, fine for a pilot and not yet
built for high-volume production throughput. And extraction returns values with
confidence, not page coordinates — there's no table-cell-level bounding box if you need
to highlight exactly where a value came from on the source image.

## Try it

```bash
make install   # bun installs dev tooling only
make dev       # http://localhost:8080 — runs against a mock Knowledge Box, no ARAG account needed
```

That's the entire setup. No credentials, no cloud account, no LLM spend — the mock
Knowledge Box behaves like the real one closely enough to see the whole pipeline run
end to end. When you're ready to point it at a real ARAG Knowledge Box, the same
`.env.example` documents every variable, and the admin panel's health check confirms the
connection before you upload anything real.

What's next is mostly the gap between "MVP" and "production platform" above: a
queue-backed job runner for volume, and a review workflow for the fields a model isn't
confident about. Both are scoped extensions of the existing job and record APIs, not a
redesign — which is the point of getting the API contract right first.
