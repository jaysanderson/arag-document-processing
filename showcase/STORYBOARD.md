# Document Processing — storyboard

Shot list for `showcase/record.spec.ts`. Each screenshot lands in `showcase/out/` at the
listed filename; the `.webm` video
(`showcase/out/record-showcase-walkthrough/video.webm`) covers the whole session
continuously. Durations are approximate on-screen time in the recording, not narration
length (see `SCRIPT.md` for the read-aloud script and timestamps).

The walkthrough follows `design/PRODUCT-EXPERIENCE.md` §6.3, with one change: the guided
sample (`#startSample`) posts the clean, built-in `invoice.txt`, which has no validation
issue and nothing unverified for the trust surfaces to prove. So the tour still runs — it
is a real, on-screen feature — but the record the rest of the walkthrough opens is
`showcase/fixtures/invoice-review.txt`, dropped in afterwards through the upload drawer.
That fixture's subtotal and tax deliberately do not reconcile with the printed total, so
shots 5–7 (the trust strip, the field evidence and the source highlight — the centre of the
recording) all have a real issue and a real quote to show, not an empty state.

| # | Duration | On screen | UI element in focus | Camera / zoom note | Screenshot | Narration line (SCRIPT.md) |
|---|---|---|---|---|---|---|
| 1 | ~2 s | Welcome, first run: headline, two action cards, the non-dismissible mock-Knowledge-Box alert | `.arag-alert.warn` + the two `.arag-card`s | Full page, no zoom — establish the layout | `01-welcome.png` | 00:00 "Document Processing turns paperwork…" |
| 2 | ~2 s | The guided sample posted; the advisory spotlight tour's first step, over the real Documents queue | `.dip-tour__card` over `#strip` | Full page — the scrim and card sit over the live screen, not a separate mock | `02-tour.png` | 00:10 "Starting the guided sample…" |
| 3 | ~2 s | The upload drawer open over the Documents list: dropzone, accepted types and size limit, config picker | `.dip-drawer` | Full page | `03-upload-drawer.png` | 00:22 "To see the product prove something…" |
| 4 | ~2 s | `invoice-review.txt` row, Ready: identified by its own invoice number and supplier, 12 fields, 100% grounding, 1 issue | `#docsTable` row for `invoice-review.txt` | Full page | `04-fixture-ready.png` | 00:32 "This is invoice-review.txt…" |
| 5 | ~3 s | Document detail, Record tab: the trust strip ("12 of 12 fields carry a quote found in this document", exact/near/none breakdown) and the reconciliation warning | `.dip-grounding` + the issue `.arag-alert.warn` | Full page — strip is the first element, issue directly beneath it | `05-record.png` | 00:44 "Every record opens with this strip…" |
| 6 | ~3 s | The `Total` field's evidence disclosure open: the quote "TOTAL DUE: $25,750.00", with the reconciliation issue carried inline on the field | `#field-total .dip-field__evidence` (open) + `.dip-field__issue` | Full page — the centre of the recording | `06-evidence-quote.png` | 00:59 "Every field carries its own quote…" |
| 7 | ~3 s | Source & evidence tab: the evidence rail on the left, the document's own extracted text on the right with the `Total` quote highlighted and active | `.dip-source__rail` + `mark.dip-hit.is-active` | Full page — two panes, bidirectionally linked | `07-source-highlight.png` | 01:14 "This is the loop closing…" |
| 8 | ~2 s | Pipeline tab: all seven stages with real durations and status | `#tabPanel` table | Full page | `08-pipeline.png` | 01:29 "Every stage that produced this record…" |
| 9 | ~2 s | Record tab again; CSV exported, toast confirms the download | `#exportCsv` + `.arag-toast` | Full page | `09-export.png` | 01:39 "The record exports as CSV, JSON or XML…" |
| 10 | ~2 s | Ask tab: question asked, grounded answer with `Open in source` links | `.arag-bubble.assistant` (last) | Full page | `10-ask.png` | 01:47 "Because the document lives in a Knowledge Box…" |
| 11 | ~2 s | New extraction config form: name and two field rows filled in, key preview updating live | `#cfgName`, `.dip-fieldrow`, `#keyPreview` | Full page | `11-config-builder.png` | 01:59 "Eleven document types ship built in…" |
| 12 | ~2 s | The saved config's detail page: `Ready`, its own stored ARAG search configuration named | `.arag-chip.ok` + provisioning `dl` | Full page | `12-config-saved.png` | 02:11 "Saving doesn't just store a list of names…" |
| 13 | ~2 s | Settings → Connection: Knowledge Box, model, extract strategy, mean grounding, the mock alert — no admin token | `#panel` (Connection tab) | Full page | `13-settings.png` | 02:19 "Anyone using the product can answer…" |
| 14 | ~2 s | Admin, signed in: Overview — health, grounding, "Needs attention" | `.dip-statstrip` + "Needs attention" card | Full page | `14-admin-overview.png` | 02:27 "Operators get a separate product…" |
| 15 | ~2 s | Admin → Connection: every stored ARAG search configuration, `dip_invoice_extraction`'s drawer open showing its prompt and schema | `table` + open `.dip-drawer` | Full page | `15-admin-connection.png` | 02:37 "Every extraction config is backed by…" |
| 16 | ~2 s | Redoc API reference page | Page title / operation list | Full page | `16-api-docs.png` | 02:47 "Every screen in this recording is…" |

Total: 16 screenshots, one continuous video covering all shots plus the transitions between
them (page navigations, typing, clicking, opening disclosures). Shots 4 onward all concern
the same document, `invoice-review.txt`, uploaded once in shot 3 and never replaced; the
built-in sample from the guided sample tour (shot 2) exists in the queue throughout but is
never reopened — its only purpose is to let the tour run against a real, populated screen.
