# Walkthrough: the demo (`/`)

A click-by-click tour for anyone evaluating the product, no technical background assumed.
Open <http://localhost:8080/> (or your deployment's URL). The page is laid out as four
numbered steps, left to right, top to bottom.

## 1 · Drop a document

The card labelled **"1 · Drop a document"** has a large dashed-border **dropzone** — "Drop a
document here", with "PDF · image · DOCX · TXT · CSV · Markdown — or click to browse"
underneath. You can either drag a file onto it or click it to open a file picker.

If you don't have a document handy, use the sample buttons directly below the dropzone:

- **Text samples** — Invoice, Purchase order, Contract, Résumé, Receipt, Bank statement.
  These load instantly (no upload needed for the sample itself) and immediately start
  processing.
- **Image samples** — Invoice, Purchase order, Pre-auth form, Remittance (each prefixed with
  a small image icon). These demonstrate extraction from an actual scanned-looking image
  rather than plain text, using ARAG's visual-LLM extraction — on a deployment connected to
  a real Knowledge Box. **Running against the mock (the default with no ARAG credentials
  configured), a helper note appears above the sample buttons explaining that extraction
  instead comes from deterministic fixtures keyed by filename**, so the extracted fields
  will not match what's actually drawn in an image sample's pixels — worth knowing before
  demoing an image sample as if it had been genuinely read.

Above the dropzone, a small chip reports what's backing extraction: **"mock ARAG —
deterministic fixtures"** when running against the mock, **"visual extraction on for
images & PDFs"** when connected to a real Knowledge Box with an extract strategy
configured, or **"default ARAG processing"** otherwise.

Below the samples is the **extraction config** row: a dropdown (default "Auto-detect") and a
**"Manage…"** button.

- Leaving it on auto-detect lets the system classify the document itself, then pick the
  matching built-in schema.
- Choosing a specific type from the dropdown (e.g. "invoice") skips classification and
  forces exactly that schema's fields.
- **Manage…** opens the **extraction config manager** — a modal titled "Extraction configs".
  It lists every config (built-in and custom) with its field count, and below that a
  **"Create a custom config"** section: a **Config name** field, one row per field you want
  extracted (with **"+ Add field"** to add more), and a **"Save config"** button. Saving
  provisions the config immediately — it's available in the dropdown as soon as the modal
  closes.

The helper text under the config row explains the default: "Auto-detect classifies the
document first. Choosing a config forces exactly those fields."

## 2 · Live pipeline

As soon as a document is loading, the **"2 · Live pipeline"** card shows a live timeline of
every processing stage as it happens — process, classify, extract, entities, summary,
validate, standardize (also printed as a small caption under the timeline) — each one
appearing, running, and completing in real time. This is driven by the same
server-sent-events stream documented in
[`../developer/examples.md`](../developer/examples.md#watching-a-job-with-sse); nothing
needs to be refreshed. The filename of the current document appears next to the card title.

Below the pipeline card, a **"Source document"** card shows a live preview of what was
uploaded — the image itself for an image upload, an embedded PDF viewer for a PDF, or a note
that no preview is available for a plain-text sample.

## 3 · Canonical record

Once processing finishes, the **"3 · Canonical record"** card on the right fills in:

- A badge naming the detected (or forced) document type, next to a small note of the
  classifier's confidence percentage when auto-detect was used, and the total processing
  time.
- A one-paragraph **summary**, followed by a row of topic **tags**.
- Any **validation issues** — shown as coloured alert banners (e.g. a required field that
  wasn't found, or an invoice whose subtotal and tax don't add up to its total). No issues
  means nothing is shown here at all.
- The **Extracted fields** table: one row per field, its value, and a **confidence bar** —
  a small horizontal bar filled to the field's confidence percentage, so low-confidence
  values are visually obvious at a glance without reading a number.
- An **Entities** section below the table: chips showing each named entity found (people,
  organisations, dates, amounts, and so on) with its type.

At the top of this card, three buttons — **JSON**, **XML**, **CSV** — download the record in
each format the moment they're clicked (see
[`../developer/examples.md`](../developer/examples.md#export-formats) for what each looks
like).

## 4 · Ask this document

Below the record, the **"4 · Ask this document"** card has a text box (placeholder: "e.g.
What is the total due and when?") and an **Ask** button. Type any question about the
document just processed and click Ask (or press Enter); the answer appears underneath,
grounded strictly in that document's content — if the answer isn't in the document, it says
so rather than guessing.

## Recent documents

Underneath, a **"Recent documents"** table lists every document processed so far in this
session (filename, type, status, field count), with a **Refresh** button. Useful for
comparing several runs side by side without re-uploading anything.

## Generate your own test documents

At the very bottom, a **"Generate your own test documents"** panel offers a gallery of
ready-made prompts for popular image-generation tools (the panel names GPT-5.2 image
generation, Google Gemini "Nano Banana", and Grok as examples) — paste one into an image
model, download the result, and drop it straight into the dropzone above to see extraction
work on a realistic, freshly generated document rather than one of the built-in samples.

## Related

- [`walkthrough-admin.md`](walkthrough-admin.md) — the operator's side of the product.
- [`../developer/quickstart.md`](../developer/quickstart.md) — the same flow, as raw API calls.
- [`overview.md`](overview.md) — what all of this is for, in business terms.
