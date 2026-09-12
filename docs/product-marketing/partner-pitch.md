# Partner pitch — Document Processing

For a Progress partner or systems integrator deciding whether to build a practice around
this product.

## The opportunity

Every customer with an ERP, a claims system, a loan-origination system or a contracts
register has the same unglamorous problem: documents arrive as PDFs, photographs and
scans, and someone has to turn them into rows in a database. That work is currently done
by hand, by brittle template-based OCR that breaks on every new vendor layout, or by a
one-off script calling an LLM with no schema contract, no validation and no audit trail.

Document Processing is the open-source, API-first layer that does that structuring
reliably on top of Progress Agentic RAG: eleven built-in extraction schemas, a canonical
record with confidence and validation, export to JSON/XML/CSV, and grounded Q&A per
document. It is deliberately not a finished vertical application — there is no
human-review queue, no industry-specific workflow, no fine-tuning. That gap is the
partner opportunity: the product is the reliable extraction core, and the partner builds
the last mile a specific customer actually needs.

## Where the partner adds value

- **Vertical schemas.** The eleven built-in types cover the common cases; a partner
  serving, say, freight forwarders or a specific insurance line defines the exact fields
  that line of business needs with `POST /api/v1/extraction-configs` — no code change,
  just a persisted config that immediately provisions a stored ARAG search
  configuration.
- **Integration into the systems of record.** Pushing a canonical record into an ERP's
  AP module, a claims administration system, or a CRM is customer-specific integration
  work this product deliberately does not do. The JSON export and the stable field
  schema (`key`, `label`, `value`, `confidence`, `raw`) are the contract a partner
  integrates against.
- **The human-in-the-loop layer.** The product surfaces `issues` and per-field
  `confidence` but ships no review-and-correct UI. Building that screen — a queue of
  low-confidence or flagged records, a place to fix a field and push the correction back
  — is exactly the kind of sticky, billable workflow layer a partner is best placed to
  own.
- **Managed deployment and operations.** The Dockerfile and `fly.toml` are ready to
  deploy, but running it reliably for a customer (secrets, retention policy via
  `POST /admin/purge`, log monitoring via `/admin/logs`, upgrade cadence as the platform
  version moves) is an ongoing managed-service relationship, not a one-time install.
- **Volume engineering.** The MVP job runner is a single in-process worker — correct for
  a pilot, not for a customer processing tens of thousands of documents a day. Standing
  up a queue-backed worker pool against the same job API is real, scoped implementation
  work a partner can price and deliver.

## Commercial shape

The product itself is Apache-2.0 and free to use, self-host, and modify — there is no
licence fee to Progress for the software. The commercial opportunity for a partner sits
entirely in services and recurring value on top of it:

- **Implementation engagements**: a scoped project to stand up the product against a
  customer's ARAG Knowledge Box, define their document schemas, and integrate the
  canonical record into their line-of-business system.
- **Managed hosting / operations**: an ongoing retainer to run, monitor and patch the
  deployment, tune extraction configs as document formats drift, and own the retention
  and data-governance policy.
- **Vertical accelerators**: a partner that builds a reusable schema pack and review
  workflow for a specific industry (say, health-fund claims, or freight documentation)
  can resell that accelerator across multiple customers in the same vertical — the
  product's own extension point (`extraction-configs`) is the mechanism, the vertical
  packaging is the partner's IP.

Progress's role is the platform (Agentic RAG itself) and this reference product; the
partner's role is everything a specific customer needs to go live and stay live.

## 90-day landing plan

**Days 1–10 — prove it.** Run `make dev` against the mock ARAG (no customer credentials
needed) and walk the customer through the demo end to end: upload a sample invoice,
watch the pipeline, read the canonical record, export it, ask it a question. This takes
under ten minutes and requires nothing from the customer's environment.

**Days 10–30 — point it at their knowledge.** Stand up (or reuse) the customer's ARAG
Knowledge Box, configure `ARAG_KB_ID` / `ARAG_API_KEY` / `ARAG_REGION`, and run the same
demo against three to five of the customer's own real documents of their single
highest-value type (almost always invoices or claims). Use the admin panel's **Test KB
connection** and **Re-provision all** to confirm the extraction configs are live in
their Knowledge Box, not just the mock.

**Days 30–60 — first production document type.** Take the customer's highest-value
document type — usually the one already listed as a built-in schema — and get it into
their pipeline: real uploads, real validation issues reviewed by a person, a real export
landing in their target system (even if that landing is a manual CSV import in this
phase). This is the point at which "processing our documents" becomes "processing our
documents to go live," typically the moment a customer starts believing the number is
real.

**Days 60–90 — the second document type and the operating model.** Add a second document
type (built-in or custom), agree the retention policy (`admin/purge` cadence), decide
who owns config changes when a vendor's invoice layout changes, and put monitoring
(`admin/logs`, `admin/usage`) in front of whoever operates it day to day. By day 90 the
customer should have two live document types, an agreed support model, and a clear next
document type on the backlog — the shape of an ongoing managed relationship rather than
a one-off project.

## What Progress provides vs what the partner brings

| Progress provides | Partner brings |
|---|---|
| Progress Agentic RAG (the Knowledge Box, retrieval, grounding, generative models) | The customer relationship, discovery and requirements |
| Document Processing: the open-source API, pipeline, eleven schemas, admin panel, demo, OpenAPI spec, Docker/Fly deployment shape | Vertical schema design and tuning for the customer's actual documents |
| The documented ARAG mechanics that make extraction reliable (grounding, retrieval seeding, the searchable-gate timing) | Integration into the customer's ERP/claims/CRM system of record |
| Reference deployment topology and security baseline | The human-review workflow, managed hosting, monitoring and support |
| Ongoing platform and product updates (`make sync-platform`) | Volume/scale engineering beyond the single-instance MVP job runner |

## Technical proof path

1. **Run the demo with the mock — ten minutes, no credentials.** `make install && make
   dev`, open `http://localhost:8080`, click a sample document, watch it process. This
   is the qualification demo: it proves the product works before anyone touches a
   customer's environment.
2. **Point it at their Knowledge Base.** Swap `ARAG_MOCK=1` for real `ARAG_KB_ID` /
   `ARAG_API_KEY` / `ARAG_REGION`, restart, and re-run the same demo against a document
   pulled from the customer's own archive. The admin panel's health check
   (`/api/v1/admin/health`) confirms the KB connection and the configured generative
   model before you upload anything.
3. **First production document type in a week.** Pick the customer's highest-volume
   built-in-compatible type (invoices are almost always the fastest path), confirm the
   schema matches their fields (adjust with a custom config if not), provision it, and
   process a real batch. A week is realistic because the schema and the pipeline already
   exist — the work is validating fit and wiring the export into whatever the customer
   uses downstream.

## What to demo, in what order

Matches the actual demo UI at `http://localhost:8080/` and admin panel at
`http://localhost:8080/admin/` — don't improvise a different order, this one is designed
to land value before mechanism:

1. **Drop a document.** Click one of the built-in text samples (Invoice is the safest
   opener — everyone immediately understands what "vendor, total, due date" means).
   Point out the extraction-config selector: auto-detect is the default, but a config
   can be forced.
2. **Watch the live pipeline.** The timeline shows each stage — process, classify,
   extract, entities, summary, validate, standardize — running in real time over
   server-sent events. This is the moment to say the sentence: "this isn't a canned
   response, it's actually calling the model right now."
3. **Read the canonical record.** Walk the extracted fields table left to right: field,
   value, confidence. Point at a field with a `raw` value different from its normalised
   value (an amount is the clearest example) to show the string-then-normalise
   behaviour, then point at the entities and the summary.
4. **Export it.** Click JSON, then CSV. This is the "here's what your integration
   receives" moment — keep it brief, it's a button click, not a feature to over-explain.
5. **Ask the document a question.** Type a question that isn't one of the extracted
   field labels ("what are the payment terms?") to show the grounded Q&A is reading the
   actual document, not just echoing structured fields.
6. **Switch to the admin panel.** Show **Overview** (health, KB connection, extraction
   strategy), then **Extraction configs** (the eleven built-ins plus how a custom one
   gets provisioned), then **Jobs** (the same pipeline you just watched, now listable and
   inspectable after the fact). Close on **Retention**, since data governance is usually
   the first question a customer's security team asks.

Keep the whole walkthrough under ten minutes — the point is that steps 1–5 are the
customer's entire integration surface, and step 6 is what an operator sees once it's
running for real.
