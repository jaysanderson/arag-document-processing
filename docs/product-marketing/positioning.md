# Positioning

## One-liner

Drop in a document — a PDF, a photo of a form, a scanned invoice — and get back a validated, structured record in under a minute, through one API call.

## Elevator paragraph

Documents still arrive as pictures of data: PDFs, photographed forms, scanned statements. Document Processing turns them into canonical records — typed fields with confidence scores, named entities, a summary, and validation issues — by running a multi-agent pipeline on Progress Agentic RAG. Eleven built-in schemas cover invoices, claims, contracts, statements and more; anything else is a custom config away. Export to JSON, XML or CSV, or just ask the document a question. API-first, open source, zero runtime dependencies.

## Product name

The working name in code and UI is **Document Processing**; the earlier prototype called itself "Document Intelligence Studio". Per workspace decision D-15, naming does not block the MVP, but here are three real candidates.

### Option 1 — DocEngine

- **Rationale.** Plain and functional: it says exactly what the thing is, and "engine" signals infrastructure other systems plug into — consistent with the API-first, no-UI-required positioning.
- **What it signals.** Reliability and composability, not a flashy end-user app. Reads like Progress's more infrastructural product names (OpenEdge, DataDirect).
- **Risks.** High. Apryse (formerly PDFTron) already sells a product literally called "Document Engine" in the adjacent PDF-tooling space — a direct collision risk, not just a nearby one. The term is also generic enough ("document" + "engine") that it would be weak to defend even without that specific clash.
- **Domain/repo note.** `docengine.com`/`.io` are extremely unlikely to be available or clean; the current repo name `arag-doc-processing` would need a full rename, and search results would be dominated by the existing Apryse product.

### Option 2 — Canonical

- **Rationale.** Ties the name directly to the product's actual mechanic: every upload becomes one **canonical record**, the noun already used throughout the API (`DocumentRecord`) and docs. It is the most honest name of the three.
- **What it signals.** Precision and single-source-of-truth — "the canonical version of this document's data."
- **Risks.** Very high. Canonical Ltd (the company behind Ubuntu) is a well-known enterprise-software trademark holder using the identical bare word as its corporate and product name. Shipping a product called "Canonical" invites confusion and likely objection even in a different category. The underlying English word is also weakly distinctive on its own (canonical form, canonical URL are common software terms), so a softened variant like "CanonicalDocs" is the realistic option, and it reads more like a scrappy startup name than a Progress product.
- **Domain/repo note.** `canonical.com` is already Canonical Ltd's own domain; `canonicaldocs.com`/`.io` are more plausible but visibly a workaround, not a clean claim.

### Option 3 — Fieldwork

- **Rationale.** A plain English word that does double duty: it is literally about extracting **fields**, and it reads as "we do the fieldwork so you don't have to." Easy for a salesperson to say and easy to remember.
- **What it signals.** Practical, hands-on, unglamorous work done well — a good fit for a product whose value is turning messy real-world paperwork into clean data, not a research-lab AI story.
- **Risks.** Moderate. There is an existing SaaS product called Fieldwork in field-service management (pest control, lawn care), which owns `fieldwork.com` — a real prior claim, though in a distant category with low likelihood of consumer confusion. The word itself is common enough to be only moderately distinctive as a trademark. It also breaks from Progress's more technical naming cadence (Sitefinity, Telerik, OpenEdge), which is a minor brand-fit risk rather than a legal one — though Progress does own friendlier names too (Kendo UI, NativeChat).
- **Domain/repo note.** `fieldwork.com` is taken by the unrelated field-service company; `fieldwork.io`, `.dev` or `getfieldwork.com` are more realistic claims, and the repo could become `arag-fieldwork` without ambiguity inside this workspace.

### Recommendation

**Fieldwork.** DocEngine collides with a named competitor product in the same broad category, and Canonical collides with a large, litigation-capable enterprise trademark in software generally — both are avoidable fights. Fieldwork's clash is in an unrelated vertical (field service, not documents or AI), it is easy to say in a sales conversation, and it still reads as a real, ownable brand rather than a description. Treat this as a strong direction, not a final legal clearance — run it past trademark counsel before committing.

## Personas

**AP / Finance Operations Manager**
Measured on: cost per invoice processed, days payable outstanding, exception rate.
Current workaround: manual keying, or a template-based OCR tool that breaks every time a vendor changes their invoice layout, forcing another template-tuning cycle.
The sentence that lands: "A new vendor invoice format doesn't mean six weeks of template work — it's read correctly the first time, and you can see exactly why the model is or isn't confident in each field."

**Claims / Health-Scheme Operations Lead**
Measured on: claims turnaround time, first-pass processing yield, audit accuracy.
Current workaround: data-entry staff retyping claim forms, remittance advices and faxed pre-authorisation requests into the core administration system.
The sentence that lands: "Claim number, member number, diagnosis code and amount claimed come out structured and validated before a person ever opens the form."

**Platform / Integration Engineer (at an ISV or systems integrator)**
Measured on: time to integrate, API reliability, ongoing maintenance burden.
Current workaround: a hand-rolled script calling a raw LLM API with a prompt that quietly degrades whenever the model provider changes behaviour, with no schema contract and no test suite.
The sentence that lands: "It's a versioned REST API with an OpenAPI spec, RFC 9457 errors and a contract test suite — a real sub-system you can build against, not another prompt to babysit."

**Procurement / Contracts Manager**
Measured on: contract review turnaround, purchase-order match accuracy, vendor onboarding speed.
Current workaround: manually reading each contract or purchase order to copy key terms — parties, value, termination notice, line items — into a tracking spreadsheet.
The sentence that lands: "Ask the contract 'what's the termination notice period?' and get a grounded answer, instead of re-reading twelve pages to find it."

## Use cases

**Invoices / accounts-payable automation.** Before: an AP clerk keys vendor, invoice number, dates and line-item amounts from a PDF into the ERP by hand. After: `POST /api/v1/documents` with `?config=auto` classifies it as an invoice, extracts vendor, invoice number, dates, subtotal/tax/total and line items, and `validateNormalize` checks that subtotal + tax ≈ total before it reaches the ledger. Measurable outcome: manual keying time drops to a review of the flagged exceptions only, not every field of every invoice.

**Purchase orders and three-way matching.** Before: a buyer manually compares the PO, the invoice and the goods receipt. After: PO number, supplier, total and line items come out in the same canonical shape as the invoice record, so a caller can compare the two programmatically. Measurable outcome: fewer manual look-ups per match, faster exception queues.

**Medical claims and pre-authorisations.** Before: claims staff retype claim numbers, member numbers, diagnosis/procedure codes and amounts from claim forms and remittance advices, and separately check admission dates, procedures and approval status on pre-authorisation requests. After: both document types have dedicated schemas (`medical_claim`, `preauthorisation`) that extract these fields directly, with confidence per field and validation issues surfaced instead of silently guessed. Measurable outcome: less transcription time, and issues (missing member number, implausible totals) are visible before adjudication rather than discovered later.

**Bank statement summarisation.** Before: a reconciliation analyst reads a statement PDF to find the opening/closing balance and notable transactions. After: `bank_statement` extraction returns account holder, statement period, opening/closing balance and a transaction list, exportable as CSV straight into a reconciliation spreadsheet. Measurable outcome: statement intake time drops from minutes of reading to seconds of extraction plus a glance at the confidence scores.

**Contract abstraction.** Before: procurement or legal reads a contract end-to-end to find parties, term, governing law, value and termination provisions. After: the `contract` schema extracts exactly those fields, and `POST /documents/{id}/ask` answers follow-up questions ("what's the notice period?") grounded in the actual document text. Measurable outcome: first-pass contract triage happens in the time it takes to read a summary, not the whole document.

**Résumé parsing.** Before: a recruiter skims each résumé to note name, contact details, years of experience, skills and employers into a tracking sheet. After: the `resume` schema returns those fields directly as a structured record, ready to filter or search across candidates. Measurable outcome: shortlisting starts from structured data on arrival instead of a second manual pass.

**Custom and generic forms.** Before: any document that doesn't fit a known template gets routed to a person, and stays that way forever because nobody has time to build a one-off parser for a form used twice a year. After: `POST /api/v1/extraction-configs` lets an operator define the fields once, which persists as a config and provisions a stored ARAG search configuration immediately — every future document of that type is then extracted the same way through `?config=<id>`. Measurable outcome: the long tail of one-off forms stops being permanently manual.

## Competitive framing

| Alternative | What it does well | Where it hurts | Where Document Processing wins |
|---|---|---|---|
| Cloud OCR/IDP services (AWS Textract, Azure Document Intelligence, Google Document AI) | Mature, high-volume OCR and layout extraction; deep integration into each cloud's own ecosystem; strong per-field bounding-box and table support | You still build the business logic on top: classification, validation, export formats, a Q&A layer and an API surface are all your own code; pricing and vendor lock-in are per-cloud | Ships that layer already — canonical record, confidence, validation, JSON/XML/CSV export and grounded Q&A behind one small API, open source so you can see and change how it works |
| Specialist IDP vendors (Rossum, Instabase, Hyperscience) | Purpose-built human-in-the-loop review queues, learning/feedback loops, deep enterprise workflow integration, mature accuracy tuning for high-volume production use | Commercial licensing, longer sales and implementation cycles, often per-document pricing that adds up at volume | Open source, self-hostable, and usable in minutes against a mock with no account — but honestly, it does **not** yet have their review-queue or fine-tuning maturity (see below) |
| DIY: call an LLM API directly with your own prompt | Fast to start, full control over the prompt, no new vendor | No grounding discipline (easy to hallucinate a field that isn't in the document), no schema contract, no confidence/validation model, every team reinvents export formats and error handling | Encodes the hard-won grounding mechanics (`full_resource`, query seeding, string-then-normalise amounts) and a stable schema/API contract once, instead of every integrator rediscovering them independently |

**What this MVP honestly does not do**, so nobody buys the wrong expectation:

- No human-in-the-loop review queue or approval workflow — validation issues are visible via the API and admin panel, but there is no built-in UI for a person to correct a field and have that correction fed back.
- No fine-tuning or model-training tooling — extraction quality is inherited entirely from the configured ARAG generative model.
- The job runner is a single in-process instance, not a distributed queue — fine for departmental volumes and demos, not yet built for high-throughput production scale.
- No table-cell-level bounding boxes or layout coordinates — fields come back as values with confidence, not as a positional map onto the page image.

## Proof points

- **Eleven built-in extraction schemas** (invoice, receipt, purchase order, contract, résumé, medical claim, pre-authorisation, bank statement, form, report, generic) plus unlimited **custom configs**, each provisioned as a stored ARAG search configuration (`dip_<schema>`) so the model, the grounding strategy and the JSON schema live in the Knowledge Box, not scattered across client code.
- A **canonical record** for every document: typed fields with per-field confidence and the original raw value, named entities, a topic-tagged summary, and explicit validation issues (e.g. subtotal + tax not matching the total) rather than a silent best guess.
- **Export to JSON, XML or CSV** from the same record, verified against the running server.
- **Grounded Q&A** per document (`POST /documents/{id}/ask`), answering from the document's own text rather than the model's general knowledge.
- A **full versioned API** under `/api/v1`, documented by an OpenAPI 3.1 spec served as both Redoc and Swagger UI, with RFC 9457 problem responses.
- **Open source, Apache-2.0.**
- **Zero runtime dependencies** — the entire service runs on the Node standard library.
- Runs end-to-end against an **in-process mock Knowledge Box** with `ARAG_MOCK=1` — no ARAG account, no credentials, no LLM spend required to see it work.

## Objection handling

**"We already pay for Textract / Document AI / Azure Document Intelligence."**
This isn't a replacement for cloud OCR — if you already have documents in an ARAG Knowledge Box, this is the structuring layer on top: classification, a canonical record with confidence and validation, export formats and a Q&A endpoint, all open source so you can inspect and change the extraction logic instead of treating it as a black box.

**"How do we trust an LLM not to hallucinate a number that isn't in the document?"**
Every extraction agent uses `full_resource` grounding (the whole document goes into context, not just a retrieved snippet) and every field carries a confidence score and the raw text it came from. `validateNormalize` also runs a deterministic arithmetic check (subtotal + tax ≈ total) and flags missing required fields as issues rather than hiding them.

**"What about handwriting or poor-quality scans?"**
Accuracy on visually difficult documents is inherited from the configured ARAG generative model and, for images/PDFs, its extract strategy — this product does not do its own OCR model training or handwriting-specific tuning. If your documents are consistently low quality, budget time to evaluate the underlying model against samples before committing.

**"Is there a screen for a human to review and correct extracted fields?"**
Not in this MVP. Validation issues are visible through the API (`issues` on the record) and the admin panel, but there's no built-in review-and-correct workflow — a partner or customer would build that screen against the existing API, filtering on confidence or on the `issues` list.

**"Will this handle our production volume?"**
The MVP job runner processes documents in a single in-process worker, which is appropriate for departmental volumes, pilots and demos. Scaling to high-throughput production means moving to a queue-backed worker pool — a known, scoped piece of work, not a redesign, since jobs are already a first-class resource in the API.

**"Are we locking ourselves into Progress Agentic RAG?"**
Yes, deliberately. The reliable parts of this product — full_resource grounding, stored search configurations, the searchable-gate timing — are ARAG-specific behaviours learned the hard way, not a generic LLM wrapper. If you're already investing in ARAG as a knowledge platform, that's a feature; if you need a backend-agnostic tool, this isn't it.

## Partner-ready by construction

The audience for this product is Progress and its ISV partner network, so the things a
partner needs are features, not afterthoughts:

- **White-label by configuration.** `BRAND_*` environment variables change the product
  name, tagline, logo, colours, footer and docs link, and can hide the "Built on Progress
  Agentic RAG" credit entirely. No fork, no rebuild, no code change — and the licence
  obligations are spelled out rather than left to guesswork.
  See [`../developer/white-label.md`](../developer/white-label.md).
- **Extend without forking.** New extraction fields are a runtime API call
  (`POST /api/v1/extraction-configs`); a partner's own front end only needs `/api/v1`.
- **Fork cleanly when you must.** [`../developer/build-your-own.md`](../developer/build-your-own.md)
  is an ordered guide from "add a document type" to "replace the storage layer", with the
  quality bar (`make check`, `make e2e`, mock-ARAG development) intact.
- **Apache-2.0, zero runtime dependencies.** Nothing to license onward, nothing to audit.
