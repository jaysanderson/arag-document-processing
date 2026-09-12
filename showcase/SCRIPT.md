# Document Processing — showcase script

Target length: **2:30–3:00**. Recorded against the mock ARAG (`make showcase`) so it is
deterministic and needs no credentials. Narration is written to be read at a measured,
conversational pace — pause on each on-screen action rather than racing ahead of it.

Screenshot filenames below are produced by `showcase/record.spec.ts` and match
`STORYBOARD.md`. The video is `showcase/out/record-showcase-walkthrough/video.webm`.

This follows the click path in `design/PRODUCT-EXPERIENCE.md` §6.3, with one deliberate
change from that document: `Start the guided sample` posts the clean, built-in
`invoice.txt` — there is nothing there for the validation and evidence surfaces to prove.
So the tour still runs, because it is a real product feature worth showing, but the record
the rest of the walkthrough actually opens is `showcase/fixtures/invoice-review.txt`,
dropped in afterwards through the upload drawer. Its subtotal and tax deliberately do not
add up to the printed total, so the trust strip, the field evidence and the source
highlight all have something real to check, not an empty record.

A note on realism: the mock ARAG resolves the whole seven-stage pipeline in well under a
second (there is no simulated network/model latency), so a *still* cannot show a genuine
mid-stage "processing" frame distinct from "ready" — the video captures the real
transition; the screenshots are taken once each screen has settled. The page itself says,
plainly, that this recording is running against the mock Knowledge Box: the alert under the
sample cards on the welcome screen, and again on Settings → Connection, states that
extraction comes from deterministic fixtures rather than a model reading the page, so
nobody watching the video mistakes fixture-driven output for genuine visual extraction.

---

### 00:00–00:10 — Welcome, and the mock-Knowledge-Box honesty rule

**On screen:** the welcome screen on a fresh deployment: the headline, the two action
cards ("Try it with a sample" / "Use your own document"), and — not dismissible — the
alert stating this deployment runs the mock Knowledge Box.
**Screenshot:** `01-welcome.png`

> "Document Processing turns paperwork — invoices, claim forms, statements, delivery notes
> — into a checked, structured record, and shows you exactly where every value came from.
> This deployment is running against a mock Knowledge Box, and it says so right here on
> screen — nothing in this recording is dressed up as a live model reading a page."

---

### 00:10–00:22 — The guided sample, and its tour

**On screen:** clicking `Start the guided sample` posts the built-in invoice and lands in
the Documents queue; an advisory spotlight tour introduces the queue itself.
**Screenshot:** `02-tour.png`

> "Starting the guided sample drops a document straight into the queue and opens a short
> tour of the real screen underneath it — not a mock of the product, the product itself.
> Skipping it, or clicking through, costs nothing: the tour never blocks the page it is
> describing."

---

### 00:22–00:32 — Upload a document worth reviewing

**On screen:** the upload drawer, opened over the Documents list: a dropzone, the accepted
file types and size limit read from the API, and a config picker.
**Screenshot:** `03-upload-drawer.png`

> "To see the product prove something, I'll upload a document with a real problem in it —
> the accepted types and the size limit here come from the API, not from markup that could
> drift out of date."

---

### 00:32–00:44 — The queue: worth reviewing, worth trusting

**On screen:** the new row — `invoice-review.txt`, identified by its own invoice number and
supplier rather than its filename — reaches `Ready`: 12 fields, 100% grounding, one issue
flagged.
**Screenshot:** `04-fixture-ready.png`

> "This is `invoice-review.txt` — a supplier invoice whose subtotal and tax don't actually
> add up to the printed total. The row already tells the story before I open it: twelve
> fields read, full grounding, and one issue flagged — that's the arithmetic check, not a
> guess."

---

### 00:44–00:59 — The record: a claim with a denominator

**On screen:** the document detail's Record tab. The trust strip states "12 of 12 fields
carry a quote found in this document," the exact/near/none breakdown, and — right below
it — the reconciliation warning.
**Screenshot:** `05-record.png`

> "Every record opens with this strip, and it never shows a bare percentage. '12 of 12
> fields carry a quote found in this document' is a claim you can check, not just a score.
> And here's the validation catch: the subtotal and tax on this invoice don't reconcile
> with the printed total — flagged automatically, against the field it actually concerns."

---

### 00:59–01:14 — The evidence beat: a field's own quote

**On screen:** the `Total` field's evidence disclosure, opened — the quote "TOTAL DUE:
$25,750.00" in the model's own words, with the reconciliation issue carried inline beneath
it rather than left for a banner at the top to explain.
**Screenshot:** `06-evidence-quote.png`

> "Every field carries its own quote, not just a value. Opening the evidence on Total shows
> exactly what was read — 'TOTAL DUE: $25,750.00' — and the issue that quote raised sits
> right here on the field, not only in a banner you'd have to correlate back to it."

---

### 01:14–01:29 — Source & evidence: the quote, in the document's own text

**On screen:** the Source & evidence tab: the left rail lists every field's evidence, the
right pane is the document's own extracted text with each quote highlighted; selecting
`Invoice #` and then `Total` moves the highlight to the matching sentence.
**Screenshot:** `07-source-highlight.png`

> "This is the loop closing: the quote isn't just printed back at you, it's highlighted
> inside the actual text Progress Agentic RAG read from the document. Selecting a field
> jumps straight to its sentence — this is the difference between a system that asserts and
> one that shows."

---

### 01:29–01:39 — Pipeline: seven stages, real timings

**On screen:** the Pipeline tab — process, classify, extract, entities, summary, validate,
standardize — each with a real duration and a status.
**Screenshot:** `08-pipeline.png`

> "Every stage that produced this record is on the Pipeline tab, with its own timing — this
> is the same job the queue streamed live, available afterwards for any run."

---

### 01:39–01:47 — Export the record

**On screen:** back on Record, `Export CSV` downloads the file; a toast confirms it.
**Screenshot:** `09-export.png`

> "The record exports as CSV, JSON or XML — whatever the downstream ledger expects, with no
> re-mapping."

---

### 01:47–01:59 — Ask this document

**On screen:** the Ask tab: "What is the total due and when?" answered from the document's
own text, with an `Open in source` link back to the passage it came from.
**Screenshot:** `10-ask.png`

> "Because the document lives in a Knowledge Box, not just a table row, you can ask it a
> question directly and get an answer traced back to the same source text — not the
> model's general knowledge."

---

### 01:59–02:11 — A custom extraction config

**On screen:** Configs → `+ New config`: naming two fields — Policy Number, Insurer — the
key preview updating live as they're typed.
**Screenshot:** `11-config-builder.png`

> "Eleven document types ship built in, but real catalogues always have one more form.
> Naming the fields here is the whole job — saving is what does the work."

---

### 02:11–02:19 — Saved, and provisioned

**On screen:** the new config's detail page: `Ready`, and its own stored ARAG search
configuration, `dip_custom_insurance_card`.
**Screenshot:** `12-config-saved.png`

> "Saving doesn't just store a list of names — it provisions a stored search configuration
> that forces the model to return exactly these fields, grounded in the document, every
> time this config is used. No redeploy."

---

### 02:19–02:27 — Settings: what this deployment is connected to

**On screen:** Settings → Connection — Knowledge Box, model, extract strategy, mean
grounding — and the same mock-Knowledge-Box statement, without needing an admin token.
**Screenshot:** `13-settings.png`

> "Anyone using the product can answer 'what am I actually connected to?' for themselves,
> here — no admin token required."

---

### 02:27–02:37 — Admin: sign in, and the operator's own view

**On screen:** signing in to `/admin/` with the deployment's admin token; the Overview
shows Knowledge Box health, the grounding mean and anything that needs attention.
**Screenshot:** `14-admin-overview.png`

> "Operators get a separate product behind its own sign-in: live health, grounding, and a
> worklist of what needs attention — not a tab bolted onto the app Dana uses."

---

### 02:37–02:47 — Admin → Connection: the stored search configurations

**On screen:** the Connection tab lists every stored ARAG search configuration, including
the one just created; opening `dip_invoice_extraction` shows its model, grounding strategy
and JSON schema.
**Screenshot:** `15-admin-connection.png`

> "Every extraction config is backed by a real, inspectable search configuration — the
> model, the `full_resource` grounding strategy, the prompt and the schema — readable here
> without opening the Knowledge Box dashboard."

---

### 02:47–02:55 — The API docs

**On screen:** `/api/v1/docs`, the generated Redoc reference.
**Screenshot:** `16-api-docs.png`

> "Every screen in this recording is a documented, contract-tested `/api/v1` endpoint —
> there is no UI-only capability. Clone the repo, run `make install && make dev`, and it's
> the same product, running against the same mock, with no account required to start."

---

## Optional: mp4 conversion

The recording is a `.webm` (Playwright's default), written under
`showcase/out/record-showcase-walkthrough/video.webm`. If `ffmpeg` is available locally, it
can be converted for players that prefer mp4:

```bash
ffmpeg -i showcase/out/record-showcase-walkthrough/video.webm -c:v libx264 -pix_fmt yuv420p -crf 20 showcase/out/showcase.mp4
```

This is not part of `make showcase` and is not required for the deliverable.
