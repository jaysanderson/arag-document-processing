# Document Processing — storyboard

Shot list for `showcase/record.spec.ts`. Each screenshot lands in `showcase/out/` at the
listed filename; the `.webm` video
(`showcase/out/record-showcase-walkthrough/video.webm`) covers the whole session
continuously. **Duration is the beat's scripted hold**, not an approximation:
`record.spec.ts` keeps each shot on screen until its end time in `SCRIPT.md`, so the video
runs to the script's length and the narration lays over it without re-cutting.

The walkthrough follows `design/PRODUCT-EXPERIENCE.md` §6.3, with one change: the guided
sample (`#startSample`) posts the clean, built-in `invoice.txt`, which has no validation
issue and nothing unverified for the trust surfaces to prove. So the tour still runs — it
is a real, on-screen feature — but the record the rest of the walkthrough opens is
`showcase/fixtures/invoice-review.txt`, dropped in afterwards through the upload drawer.
That fixture's subtotal and tax deliberately do not reconcile with the printed total, so
shots 5–8 (the trust strip, the field evidence, the source highlight and the values as the
Knowledge Box holds them — the centre of the recording) all have a real issue and a real quote to show, not an empty state.

| # | Duration | On screen | UI element in focus | Camera / zoom note | Screenshot | Narration line (SCRIPT.md) |
|---|---|---|---|---|---|---|
| 1 | 10 s | Welcome, first run: headline, two action cards, the non-dismissible mock-Knowledge-Box alert | `.arag-alert.warn` + the two `.arag-card`s | Full page, no zoom — establish the layout | `01-welcome.png` | 00:00 "Document Processing turns paperwork…" |
| 2 | 11 s | The guided sample posted; the advisory spotlight tour's first step, over the real Documents queue | `.arag-tour-card` over `#strip` | Full page — the scrim and card sit over the live screen, not a separate mock | `02-tour.png` | 00:10 "Starting the guided sample…" |
| 3 | 10 s | The upload drawer open over the Documents list: dropzone, accepted types and size limit, config picker | `.arag-drawer` | Full page | `03-upload-drawer.png` | 00:21 "To see the product prove something…" |
| 4 | 11 s | `invoice-review.txt` row, Ready: identified by its own invoice number and supplier, 12 fields, 100% grounding, 1 issue | `#docsTable` row for `invoice-review.txt` | Full page | `04-fixture-ready.png` | 00:31 "This is invoice-review.txt…" |
| 5 | 14 s | Document detail, Record tab: the trust strip ("12 of 12 fields carry a quote found in this document", exact/near/none breakdown) and the reconciliation warning | `.dip-grounding` + the issue `.arag-alert.warn` | Full page — strip is the first element, issue directly beneath it | `05-record.png` | 00:42 "Every record opens with this strip…" |
| 6 | 13 s | The `Total` field's evidence disclosure open: the quote "TOTAL DUE: $25,750.00", with the reconciliation issue carried inline on the field | `#field-total .dip-field__evidence` (open) + `.dip-field__issue` | Full page — the centre of the recording | `06-evidence-quote.png` | 00:56 "Every field carries its own quote…" |
| 7 | 13 s | Source & evidence tab: the evidence rail on the left, the document's own extracted text on the right with the `Total` quote highlighted and active | `.dip-source__rail` + `mark.dip-hit.is-active` | Full page — two panes, bidirectionally linked | `07-source-highlight.png` | 01:09 "This is the loop closing…" |
| 8 | 14 s | The record's JSON tab switched to `Key-value fields`: the provisioned schema `dip_invoice_extraction`, a `Written` chip, and each product property paired with the Knowledge Box key and the value it was written under | `#jsonPane` table + `.arag-chip.ok` | Full page — the pass's headline capability, and the one claim checkable nowhere else | `08-keyvalues.png` | 01:22 "Here is the part that outlives this product…" |
| 9 | 10 s | Pipeline tab: all seven stages with real durations and status | `#tabPanel` table | Full page | `09-pipeline.png` | 01:36 "Every stage that produced this record…" |
| 10 | 7 s | Record tab again; CSV exported, toast confirms the download | `#exportCsv` + `.arag-toast` | Full page | `10-export.png` | 01:46 "The record exports as CSV, JSON or XML…" |
| 11 | 12 s | Ask tab: question asked, grounded answer with `Open in source` links | `.arag-bubble.assistant` (last) | Full page | `11-ask.png` | 01:53 "Because the document lives in a Knowledge Box…" |
| 12 | 12 s | New extraction config form: name and two field rows filled in, key preview updating live | `#cfgName`, `.dip-fieldrow`, `#keyPreview` | Full page | `12-config-builder.png` | 02:05 "Eleven document types ship built in…" |
| 13 | 9 s | The saved config's detail page: `Ready`, its own stored ARAG search configuration named | `.arag-chip.ok` + provisioning `dl` | Full page | `13-config-saved.png` | 02:17 "Saving doesn't just store a list of names…" |
| 14 | 8 s | Settings → Connection: Knowledge Box, model, extract strategy, mean grounding, the mock alert — no admin token | `#panel` (Connection tab) | Full page | `14-settings.png` | 02:26 "Anyone using the product can answer…" |
| 15 | 10 s | Admin, signed in: Overview — health, grounding, "Needs attention" | `.arag-statstrip` + "Needs attention" card | Full page | `15-admin-overview.png` | 02:34 "Operators get a separate product…" |
| 16 | 10 s | Admin → Connection: every stored ARAG search configuration, `dip_invoice_extraction`'s drawer open showing its prompt and schema | `table` + open `.arag-drawer` | Full page | `16-admin-connection.png` | 02:44 "Every extraction config is backed by…" |
| 17 | 10 s | The workspace's own API section: every operation grouped by tag, generated from `/api/v1/openapi.json`; `listDocuments` sent against this deployment, answering 200, with the copyable curl beneath | `#apiList` + `#responseOut` + `#curlOut` | Full page — the contract running, not a rendering of it | `17-api-explorer.png` | 02:54 "…the product ships the API as a screen." |

Total: 17 screenshots, one continuous video covering all shots plus the transitions between
them (page navigations, typing, clicking, opening disclosures). Shots 4 onward all concern
the same document, `invoice-review.txt`, uploaded once in shot 3 and never replaced; the
built-in sample from the guided sample tour (shot 2) exists in the queue throughout but is
never reopened — its only purpose is to let the tour run against a real, populated screen.
