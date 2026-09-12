# When to use it

## Good fits

- **High-volume, semi-structured business documents you receive from outside your
  organisation** — supplier invoices, receipts for expense processing, purchase orders,
  incoming résumés, bank statements, medical claims and pre-authorisation forms. These
  arrive in inconsistent formats from parties you don't control, which is exactly the
  problem structured extraction solves.
- **You need a human-checkable audit trail, not just a black-box answer.** Every extracted
  value carries a confidence score and, where normalisation happened (a date, an amount), the
  original text it came from. Validation issues (missing required fields, arithmetic that
  doesn't reconcile) are surfaced explicitly rather than silently swallowed — useful
  anywhere a wrong number has real consequences (finance, claims, compliance).
- **Your document types are known but not fixed.** Eleven common types ship built in;
  anything else — an insurance card, a customs declaration, an internal request form — is a
  single API call away as a custom extraction config, with no model training and no code
  change.
- **You want the output to feed a downstream system**, not just be read by a person. JSON,
  XML and CSV exports, plus a stable canonical schema (`fields`, `entities`, `issues`,
  `meta`) designed to be consumed programmatically.
- **You want to self-host and control the whole stack.** This is an open, API-first product
  you deploy yourself (Fly, or any container host), with your own Knowledge Box and your
  own retention policy — not a SaaS black box.
- **Occasional ad-hoc questions about a specific document** — "what's the total due", "who
  are the parties to this contract" — where a grounded, cited answer beats re-reading the
  PDF.

## Poor fits

- **Real-time, sub-second extraction.** Processing a document against a real ARAG Knowledge
  Box takes on the order of several to tens of seconds end to end depending on document
  size (see [`architecture/scaling.md`](../architecture/scaling.md)) — dominated by ARAG's
  own ingestion pipeline, not this product. If you need extraction in the time it takes to
  render a page, this isn't it.
- **Very high-volume, latency-insensitive batch pipelines at scale (thousands per hour).**
  The MVP runs two documents at a time per instance and isn't built to run multiple
  instances safely yet (see [`limits.md`](../architecture/limits.md)). It handles a real
  team's steady inbound volume comfortably; it is not (yet) an enterprise batch-processing
  platform.
- **Documents that need byte-perfect, template-exact extraction with zero tolerance for
  model variance** — e.g. a regulator-mandated form where every field must match a fixed
  position on the page regardless of content. This product reads *meaning*, which is more
  robust to format drift than a template, but also means it's a probabilistic extractor
  (with confidence scores and validation, not a guarantee) rather than a deterministic
  parser.
- **Free-text documents with no fields to extract at all** — a novel, a long-form article
  with no structured facts to pull out. The value here is turning a document into fields
  and entities; if there's nothing structured in it, a summariser or a general chat
  assistant is a better fit.
- **Highly sensitive documents where no data may ever leave your network**, if you're not
  prepared to self-host the Knowledge Box in your own infrastructure too — the document
  content is sent to ARAG for processing (see
  [`architecture/data-flow.md`](../architecture/data-flow.md) for exactly what goes where).

## Use something else

| If you need... | Consider instead |
|---|---|
| A fixed-layout form parser with byte-exact field positions | A template-based OCR/forms tool (e.g. a scanner-vendor forms product) rather than a model-based reader |
| Sub-second synchronous extraction at the point of scan | A dedicated low-latency OCR/ICR engine; use this product for the structured, validated record after the fact, not inline with a scanner |
| General-purpose chat over a large, mixed document corpus (not one document at a time) | A general RAG/knowledge-base search product — this product is deliberately scoped to *one document at a time*, extracted into a fixed schema |
| Enterprise-scale batch processing (tens of thousands of documents/day, multi-instance, guaranteed throughput SLAs) | A dedicated document-processing platform built for that scale, or plan to invest in replacing this product's store/job queue first (see [`architecture/scaling.md`](../architecture/scaling.md)) |
| Long-form summarisation or open-ended writing assistance | A general-purpose LLM assistant — this product's summary is one factual paragraph grounded in a single document, not a writing tool |

## Related

- [`overview.md`](overview.md) — what the product does, in business terms.
- [`faq.md`](faq.md) — cost, accuracy, data handling, and scale questions in more detail.
- [`../architecture/scaling.md`](../architecture/scaling.md) — the numbers behind the throughput claims above.
