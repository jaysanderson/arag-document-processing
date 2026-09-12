# Walkthrough: the operator app (`/`)

A click-by-click tour for anyone evaluating the product, no technical background assumed.
Open <http://localhost:8080/> (or your deployment's URL). Nothing here needs a password —
the operator app opens straight into the workspace.

The app is a signed-in workspace with a left sidebar (**Documents**, **Configs**, **Ask**,
**Jobs**, **Settings**) and hash-routed screens — `/#/documents`, `/#/documents/:id/source`,
`/#/configs/new`, and so on. A route is a real, shareable link: send a colleague
`/#/documents?status=ready&sort=grounding:asc` and they land on the same filtered queue.

## First run — the welcome screen

The first time a deployment has no documents, it opens on `/#/welcome` instead of the
queue. Point at the headline — **"Read every document the first time"** — and read the
line under it: this is the same promise the marketing site makes, on the screen.

Two cards, equal weight:

- **Try it with a sample** — click **Start the guided sample**. This posts the bundled
  invoice sample (`POST /api/v1/documents/sample`) and drops you straight into the queue
  with a three-step guided tour running (more on that below). An **Other samples**
  disclosure underneath lists every bundled sample — invoices, a purchase order, a
  contract, a bank statement, a receipt, a résumé, and photographed versions of an
  invoice, a purchase order, and a pre-authorisation form — each processed the same way a
  real upload would be.
- **Use your own document** — click **Upload a document** to open the upload drawer
  directly. Say what it accepts: PDF, PNG, JPEG, TIFF, DOCX, TXT, CSV or Markdown, up to
  25 MB. Worth saying out loud to a customer: bring a difficult document, not a clean one —
  a bad scan tells you more than a sample ever will.

If the deployment is running the mock Knowledge Box, a non-dismissible amber notice sits
under the two cards: *"This deployment is running the mock Knowledge Box. Extraction comes
from deterministic fixtures keyed by filename, not from a model reading the page."* Point
this out before running a sample against the mock — it is the honest caveat, not a bug.

Under that, a quiet line of text says how many document types are ready to use, linking to
**Configs**.

## The guided sample tour

Starting the sample runs a three-step spotlight over the real queue — never a mock of it —
that a solutions engineer can either narrate over or let the customer read themselves:

1. Highlights the stat strip: *"This is the queue. Everything you process lands here, with
   the numbers that decide what to look at first."*
2. Highlights the documents table: *"Each row carries the document's own identity — the
   invoice number and the supplier — not just the filename a scanner gave it. Open the row
   when it says Ready."*
3. Highlights **Configs** in the sidebar: *"Configs are what the model is forced to return.
   Eleven types are built in; a new one is a list of field names."*

**Back** / **Next** / **Skip tour** sit on each step's card, and `Esc` ends the tour
immediately. It never restarts on its own. The step lives in the URL
(`?tour=1&step=2`), so any step can be linked to directly — which is how the showcase
recording stays reproducible.

## 1 · Documents — the queue (`/#/documents`)

This is the default screen and the one Dana (the AP manager persona) never leaves. At the
top of the content column:

- **Stat strip** — four tiles: **Documents** (total), **Need review** (issues or weak
  grounding), **In flight** (queued or processing), **Degraded** (finished but a stage
  failed). Each tile is a link that applies the matching filter — click **Need review** and
  the list re-sorts to the worst records first.
- **Filter bar** — a search box (matches filename, type or extracted value), **Status**,
  **Document type**, a combined **Review state** dropdown (has issues / degraded), and
  **Sort** (Newest first, Oldest first, Grounding: lowest first, Grounding: highest first,
  Name A–Z, Type, Status). A **Clear all filters** link appears once anything is set. Every
  filter lives in the URL query string, so this is a shareable, bookmarkable queue.
- **Table** — a checkbox column, then File (filename plus a second line naming the
  identifying value and counterparty — "INV-2026-1188 · Globex Supply Co · 3 min ago" is
  what makes the queue scannable), Type, Status, Fields, Grounding, and Issues. Column
  headers are clickable to sort. While anything is queued or processing, the list quietly
  refreshes itself every couple of seconds — no manual reload needed to watch a row move
  from **Queued** to **Processing** to **Ready**.
- **Selection and bulk actions** — tick rows (or the header checkbox for the whole page) and
  a bulk bar appears in the table footer: **Export CSV**, **Export JSON**, **Export XML**,
  **Delete**, **Clear selection**. Selection survives paging within a visit. Deleting a
  selection asks for confirmation and names the first few filenames plus the total count.
- **Row menu** (`⋯`) — Open, Ask this document, Export JSON/XML/CSV, Reprocess (failed or
  degraded rows only), Delete.

Click **+ Upload document** (top right) to open the upload drawer over the list — the list
stays visible behind it, and closing the drawer (or pressing Back) returns to the queue
without losing an in-flight upload.

### Upload drawer (`/#/documents/upload`)

- A dashed dropzone — drag files onto it, or click to browse. The accepted extensions and
  the size ceiling shown underneath come from the API (`GET /api/v1/settings`), not from
  hard-coded markup, so they always match what the server will actually accept.
- **Extraction config** — a select defaulting to **Auto-detect (classify first)**, with an
  **ARAG data-augmentation agent (persisted fields)** option, then the eleven built-in types
  and any custom configs grouped underneath. The helper line explains the default in one
  sentence: "Auto-detect picks one of the 11 built-in types. Choosing a config forces
  exactly its fields."
- Files queue and upload one at a time (the job runner only processes two at once, so
  queuing client-side keeps the progress honest), each row showing **uploading** →
  **queued**, or **too large** / **failed** with the reason.
- If the Knowledge Box is unreachable, the drawer opens with a plain error banner and
  uploads are paused rather than accepted and left to fail a minute later.

## 2 · Document detail — five tabs

Click any **Ready** or **Degraded** row to open its record. The breadcrumb reads
**Documents › <filename>**; the page title is the document's own identity — counterparty
and identifier, e.g. "Globex Supply Co Pty Ltd — INV-2026-1188" — not the filename, because
that is what a person actually looks for. Five tabs sit under the title: **Record**,
**Source & evidence**, **Pipeline**, **Ask**, **JSON**.

### Record (the default tab)

This is the screen the product is judged on. Point at things top to bottom:

1. **The trust strip.** The first element on the page, full width: a grounding percentage
   with a progress bar, and next to it the sentence that makes the number checkable —
   *"11 of 12 fields carry a quote found in this document"* — followed by the exact
   breakdown: exact / near match / no quote. Below that, a facts row: the status chip, the
   document type (with the classifier's confidence, or a note that a config was forced), an
   issue-count chip, the total processing time, and a **What is this?** button that opens a
   short explanation of exact vs. near match vs. no quote. If the record has no evidence at
   all, the strip says so in words rather than showing a bare `0%`.
2. **Issues.** Any validation problem — say, an invoice whose subtotal and tax don't
   reconcile with its printed total — appears as an alert directly under the trust strip,
   worst severity first, each with a **Go to field ›** link that scrolls to and briefly
   highlights the row.
3. **Check these first.** If any field's quote is missing or unverified, those fields are
   pinned into their own group directly under the issues, ahead of the full field list —
   trust beats reading order.
4. **Extracted fields.** One row per field, in the schema's own order: label, the
   normalised value (with the original raw text shown alongside whenever normalisation
   changed it — `$25,750.00` → `25750`), a confidence meter (grey, never colour-coded — that
   is deliberate: colouring confidence would make it look like verification), and the
   verification chip — **Verified**, **Near match**, or **No quote returned**. Expand a
   field's **Evidence** disclosure to read the exact quote, and click **Open in source** to
   jump to it highlighted in the document's own text.
5. **The right-hand cards** — Summary (with topic tags), Entities, "How this was produced"
   (config, schema, model, the stored ARAG search-configuration name, source character
   count, run time, document id), and a Danger zone with **Delete document**.
6. **Page actions** — **Export CSV** is the primary button; the overflow menu (`⋯`) adds
   Export JSON, Export XML, Reprocess, Copy document id, Copy job id, and Delete.

### Source & evidence

This is the screen that closes the loop the marketing copy opens — evidence you can open,
not just a citation you have to trust. Two panes:

- **Left rail** — every evidence entry, worst first (no quote, then near match, then
  exact), each showing the verification chip, the field label, the quote, and its character
  offsets in the source text.
- **Right pane** — a toggle between **Extracted text** (the text Progress Agentic RAG read
  from the document, with every evidence quote highlighted as a `<mark>` inside it) and
  **Original file** (the uploaded image or PDF itself, fetched only when you ask for it).

Click any evidence entry on the left and the source pane scrolls to and highlights that
quote; click a highlighted quote in the text and the matching entry is selected on the
left. Both directions update the URL (`?ev=<field>`), so a specific disputed value can be
linked to directly. If the source text is no longer available, the quotes still render —
only the jump-to-source behaviour is disabled, with a note explaining why.

### Pipeline

A table of the seven stages — process, classify, extract, entities, summary, validate,
standardize — each with a duration bar (relative to the slowest stage) and a **Done** /
**Failed** / **Not run** chip. If a stage failed, a warning banner sits above the table
naming it, with a **Reprocess** button, and the failed row's bar renders in the danger
colour. Below the table: total time, the job id (with **Copy id** and a link to open it in
**Jobs**), and start time. A collapsed **What each stage does** disclosure explains each
stage in one line — useful the first time someone asks "what does 'standardize' actually
do?"

### Ask

A per-document chat: suggested questions tailored to the document type (an invoice gets
"What is the total due and when?"; a contract gets "What is the termination notice
period?"), a text box, and an **Ask** button. Answers come back with the source document
named and, when the API returns a citation, an **Open in source** link; otherwise the
answer card says plainly **No source returned** rather than implying one exists. The
conversation is not saved — leaving the tab and coming back starts fresh.

### JSON

The canonical record exactly as `GET /api/v1/documents/{id}` returns it, rendered with the
shared JSON viewer. This is Priya's (the integration engineer persona) screen — it proves
the UI shows nothing the API does not also expose.

## 3 · Ask (`/#/ask`)

A first-class home for grounded Q&A that does not start with finding a row in a list —
Alex's (the contracts-manager persona) screen. Pick a document from the combobox (only
**Ready** and **Degraded** documents are selectable), then ask exactly as on the document's
own Ask tab. The page states plainly that there is no cross-document search — each question
is scoped to one file.

## 4 · Configs (`/#/configs`)

Two sections — **Custom** and **Built in** — each a table of Name, Fields, ARAG
configuration (the stored search-configuration name, e.g. `dip_invoice`), Documents (how
many records were produced with it), and State (**Ready** or **Not provisioned**). Say this
line to a customer: every config, built-in or custom, is backed by a stored ARAG search
configuration that pins the model, the grounding strategy and the JSON schema — which is
why "a new document type" is a five-minute task, not a project.

Row actions: Open, Use for an upload, View documents using it, Edit (custom only),
Re-provision, Delete (custom only, confirmation names the document count).

### New config (`/#/configs/new`)

Click **+ New config**. Give it a name and an optional description, then add fields with
**+ Add field** — a label, a type (text / number-amount / list), and a required toggle.
Fields can be reordered with the up/down buttons. A live preview shows the machine keys
each label will become. **Save config** provisions a stored ARAG search configuration
immediately and lands on the new config's detail page. Editing an existing custom config
(`/#/configs/:id/edit`) is the same screen, pre-filled — built-in configs cannot be edited,
only read.

## 5 · Jobs (`/#/jobs`)

Every upload starts a job, and its seven stages are recorded here regardless of whether
anyone watched it live. A search box (job or document id), a status filter, and an
**Auto-refresh** switch (a pause control for demos and screenshots, not a poll-interval
setting) sit above a table of Job / Status / Stage / Elapsed / Started. Click a row to open
a drawer with the full stage timeline, the raw job JSON, and — while the job is still
queued or running — a **Cancel job** button.

## 6 · Settings (`/#/settings/*`)

Answers, without an admin token, the questions a user of the product has to be able to
answer for themselves:

| Tab | What it shows |
| --- | --- |
| **Connection** (default) | Knowledge Box id, region, endpoint, live vs. mock, the generative model, the extract strategy, and mean grounding across every record |
| **Extraction** | Accepted file types, the maximum upload size, the question-length limit, the extraction-config count, and a one-line description of each of the seven pipeline stages |
| **Branding** | The effective branding values next to the `BRAND_*` variable that sets each one, plus a live preview tile — read-only, because branding is environment configuration and a form that appeared to save but couldn't would be a lie |
| **API** | Usage counters for this workspace, links to Redoc, Swagger and the raw OpenAPI document, a plain explanation of API keys/the session cookie/the admin token, keyboard shortcuts, and **Run the guided sample again** |

## Keyboard shortcuts

Worth mentioning at the end of a demo, not the start: `/` focuses the search box, `u` opens
the upload drawer, `Esc` closes any open overlay, and `g` then one of `d` / `c` / `a` / `j` /
`s` jumps to Documents / Configs / Ask / Jobs / Settings. None of them are required — they
are documented in Settings → API for anyone who wants them.

## Generating your own test documents

The product no longer ships an in-app prompt gallery, but the seven prompts below still
work exactly as before: paste one into an image model — a GPT-5.2 (image) request, Google
Gemini "Nano Banana", or Grok all produce usable results — and it returns a realistic,
single-page document you can download and drop straight into the upload dropzone, rather
than relying only on the built-in samples.

**Invoice**

> A photorealistic scan of a one-page commercial TAX INVOICE on white A4 paper, portrait.
> Company 'Northwind Logistics Pty Ltd' at top-left with a small geometric logo; invoice number INV-2027-1185,
> date 12/02/2027, due date 14/03/2027. A clean line-item table (description, qty, unit price, amount) with 4 rows,
> then Subtotal, VAT 15%, and a bold TOTAL DUE in ZAR. Crisp, legible printed text, subtle paper texture, no watermark.

**Purchase order**

> A photorealistic one-page PURCHASE ORDER, white A4 portrait. Buyer 'Cobalt Manufacturing Inc.',
> supplier 'Apex Industrial Supplies', PO number PO-55218, order date 03/05/2027, currency USD.
> Include a 5-row item table with quantities and unit prices, a totals block (subtotal, tax, total),
> ship-to address, and an authorised-by signature line. Sharp, clearly readable text suitable for OCR.

**Medical claim form**

> A photorealistic scanned HEALTH INSURANCE CLAIM FORM, white A4 portrait, with labelled field/value rows.
> Insurer 'Meridian Health'; member name Sarah Donovan; membership number MER-4471902; claim number CLM-90233;
> date of service 18/06/2027; diagnosis code ICD-10 J45.9; procedure code 99213; amount claimed $420.00.
> Include a green 'RECEIVED' stamp angled in the corner. Legible printed text, light scan shadows.

**Pre-authorisation request**

> A photorealistic scanned HOSPITAL PRE-AUTHORISATION REQUEST form, white A4 portrait. Scheme 'Meridian Health',
> benefit option 'Comprehensive Plus', membership number MER-4471902, patient Sarah Donovan (DOB 04/11/1984),
> treating provider Dr Anil Mehta, facility 'St Jude Private Hospital', proposed admission 22/06/2027,
> length of stay 3 nights, procedure 'Arthroscopic knee reconstruction (CPT 29888)', authorisation number AUTH-90233,
> status APPROVED, co-payment $250.00. Boxed form fields, crisp legible text.

**Contract page**

> A photorealistic first page of a SERVICES AGREEMENT, white A4 portrait, professional legal typography.
> Title 'Master Services Agreement', effective date 1 March 2027, between 'Helios Software LLC' (Provider) and
> 'Vanguard Retail Group' (Customer). Number sections 1–5 (Term, Fees of USD $480,000, Termination, Governing Law: Delaware,
> Confidentiality) with short paragraphs. Clean serif body text, justified, clearly readable.

**Receipt**

> A photorealistic photograph of a retail RECEIPT on thermal paper, slightly curled, on a dark surface.
> Merchant 'Brew & Bean Cafe', date 09/09/2027 14:32, 4 line items with prices, subtotal, tax, and total $27.85,
> card payment VISA ending 4417. Monospaced receipt font, realistic but fully legible text.

**Bank statement**

> A photorealistic one-page BANK STATEMENT, white A4 portrait. Bank 'Sterling National Bank', account holder
> 'Priya Nair', account number ending 8842, statement period 01–31 July 2027. A transaction table with date,
> description, debit, credit, and balance columns (about 8 rows), plus opening and closing balances in USD.
> Clean corporate layout, crisp legible figures.

## Related

- [`walkthrough-admin.md`](walkthrough-admin.md) — the operator's side of the product.
- [`../developer/quickstart.md`](../developer/quickstart.md) — the same flow, as raw API calls.
- [`overview.md`](overview.md) — what all of this is for, in business terms.
