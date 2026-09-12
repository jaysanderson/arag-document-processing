# Document Processing — showcase script

Target length: **2:30–3:00**. Recorded against the mock ARAG (`make showcase`) so it is
deterministic and needs no credentials. Narration is written to be read at a measured,
conversational pace — pause on each on-screen action rather than racing ahead of it.

Screenshot filenames below are produced by `showcase/record.spec.ts` and match
`STORYBOARD.md`. The video is `showcase/out/*.webm`.

---

### 00:00–00:15 — The problem

**On screen:** the demo home page, freshly loaded. Dropzone empty, "no document" label,
canonical-record panel showing its empty state.
**Screenshot:** `01-home.png`

> "Most business documents — invoices, purchase orders, claim forms, receipts — arrive as
> pictures of data: a PDF, a scan, a photo. A person still has to read them and re-key the
> numbers. Document Processing turns any of those into a structured, validated record,
> through one API call, in under a minute."

*Why this matters (demo-giver aside):* frame the whole demo as "picture in, record out" —
everything that follows is one document proving that claim.

---

### 00:15–00:35 — Drop an invoice

**On screen:** click the **Invoice** text sample button. The file label updates, the
source preview fills with the raw invoice text, and the live pipeline card starts
reporting the first stage.
**Screenshot:** `02-pipeline-running.png` (captured while a stage is still in flight)

> "I'll drop in a sample invoice — in the real product this would be a drag-and-drop PDF
> or a photo from a phone. The moment it lands, Progress Agentic RAG picks it up: OCR,
> layout, embeddings, and the extraction pipeline all fire immediately."

*Why this matters:* stress that nothing here is scripted client-side — the timeline is a
live server-sent-events stream off a real job.

---

### 00:35–01:00 — The live pipeline, stage by stage

**On screen:** the pipeline card lights up each stage in turn — process, classify,
extract, entities, summary, validate, standardize — finishing with a green "succeeded"
chip.
**Screenshot:** `03-pipeline-complete.png`

> "Seven agent stages run in sequence: the document is processed by ARAG, classified by
> type, its fields extracted, named entities pulled out, a summary written, the result
> validated, and finally standardised into one shape. You're watching the actual job
> stream, not a progress bar."

*Why this matters:* this is the "multi-agent pipeline" claim made visible — a sceptical
viewer can see each named stage complete, not just a spinner.

---

### 01:00–01:25 — The canonical record

**On screen:** the record panel populates: document-type badge, classifier confidence,
summary paragraph, topic tags, any validation issues, the extracted-fields table with a
confidence bar per field, and the entities list.
**Screenshot:** `04-canonical-record.png`

> "And here's the payoff: a canonical record. Every field comes with a confidence score,
> not just a value — so a low-confidence total or ABN gets flagged for review instead of
> silently trusted. Named entities, a plain-English summary, and any validation issues sit
> alongside it."

*Why this matters:* confidence-per-field and validation issues are the difference between
"OCR text" and something a finance system can trust.

---

### 01:25–01:40 — Export it

**On screen:** click through the JSON, XML and CSV export buttons; a toast confirms each
download.
**Screenshot:** `05-exports.png`

> "The same record exports as JSON, XML or CSV — whatever the downstream system expects,
> with no re-mapping."

*Why this matters:* one extraction, three integration paths — this is what makes it
drop-in rather than another format to build against.

---

### 01:40–02:00 — Ask the document a question

**On screen:** type a question into "Ask this document" and submit; the answer streams
in with its source citation and latency.
**Screenshot:** `06-ask-answer.png`

> "Because the document lives in an ARAG knowledge box, not just a table row, you can also
> ask it questions directly — 'What is the total due?' — and get a grounded answer back,
> with the answer traced to the source."

*Why this matters:* the record isn't a dead export — the original document stays
queryable.

---

### 02:00–02:20 — The visual path

**On screen:** an image (scanned) purchase order is processed with a forced
`purchase_order` config; the preview shows the actual image, and the record panel shows
"auto-classification skipped" alongside the extracted fields.
**Screenshot:** `07-image-sample.png`

> "This isn't limited to text. A scanned or photographed purchase order goes through the
> same pipeline using visual extraction — and here I've forced the purchase-order config
> directly, so classification is skipped and the fields it must return are pinned in
> advance."

*Why this matters:* proves the visual (image/PDF) path is real, and shows the second way
of choosing a schema — forcing it — versus auto-detect.

---

### 02:20–02:40 — Custom extraction configs

**On screen:** open **Manage… → Extraction configs**, see the built-in list, add a new
config with two custom fields, save it, and watch it appear as provisioned.
**Screenshot:** `08-config-manager.png`, `09-config-fields.png`, `10-config-provisioned.png`

> "Eleven document types ship out of the box, but real catalogues always have one more
> form. Define the fields you need — here, an insurance card's policy number and insurer —
> and saving doesn't just store the config: it provisions a stored ARAG search
> configuration that forces the model to return exactly those fields, grounded in the
> document, every time this config is used."

*Why this matters:* this is the extensibility story — no code change, no redeploy, to
support a new document type.

---

### 02:40–02:55 — The admin panel

**On screen:** sign in to `/admin/` with the deployment's admin token; the overview shows
KB health as connected; switch to the extraction-configs tab (the new custom config is
listed, provisioned); switch to jobs and open the job just run.
**Screenshot:** `11-admin-overview.png`, `12-admin-configs.png`, `13-admin-jobs.png`

> "Operators get their own view: live KB health, every extraction config and its
> provisioning state, and every job with its full stage timeline — the same events the
> demo streamed, available for any run, at any time."

*Why this matters:* this is what makes it operable, not just demoable — health, config
and job visibility in one place, gated by a token.

---

### 02:55–03:00 — The API docs, and the one-command try-it

**On screen:** `/api/v1/docs` — the generated Redoc reference.
**Screenshot:** `14-api-docs.png`

> "Every route shown here is generated from one OpenAPI document and contract-tested
> against it. To try all of this yourself: clone the repo, run `make install && make dev`,
> and open localhost:8080 — no ARAG account required, it runs against a mock knowledge box
> out of the box."

*Why this matters:* close on the one command a viewer can actually run today.

---

## Optional: mp4 conversion

The recording is a `.webm` (Playwright's default). If `ffmpeg` is available locally, it
can be converted for players that prefer mp4:

```bash
ffmpeg -i showcase/out/*.webm -c:v libx264 -pix_fmt yuv420p -crf 20 showcase/out/showcase.mp4
```

This is not part of `make showcase` and is not required for the deliverable.
