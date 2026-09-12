# Document Processing — showcase script

Target length: **2:30–3:00**. Recorded against the mock ARAG (`make showcase`) so it is
deterministic and needs no credentials. Narration is written to be read at a measured,
conversational pace — pause on each on-screen action rather than racing ahead of it.

Screenshot filenames below are produced by `showcase/record.spec.ts` and match
`STORYBOARD.md`. The video is `showcase/out/*/video.webm`.

A note on realism: the mock ARAG resolves the whole seven-stage pipeline in well under a
second (there is no simulated network/model latency), so the *video* shows the pipeline
stages appear in a quick, genuine burst rather than the slower cadence a live multimodal
model would have — that is faster than the real thing, not scripted to look busier than
it is. The document dropped in the first beat is also not one of the pristine built-in
samples: it is `showcase/fixtures/invoice-review.txt`, a deliberately imperfect invoice
(the printed subtotal and tax do not add up to the printed total) so the validation-issues
part of the canonical record has something real to show.

---

### 00:00–00:15 — The problem

**On screen:** the demo home page, freshly loaded. Dropzone empty, "no document" label,
canonical-record panel showing its empty state, no export buttons yet.
**Screenshot:** `01-home.png`

> "Most business documents — invoices, purchase orders, claim forms, receipts — arrive as
> pictures of data: a PDF, a scan, a photo. A person still has to read them and re-key the
> numbers. Document Processing turns any of those into a structured, validated record,
> through one API call, in under a minute."

*Why this matters (demo-giver aside):* frame the whole demo as "picture in, record out" —
everything that follows is one document proving that claim.

---

### 00:15–01:05 — Drop an invoice; the live pipeline; the canonical record

**On screen:** a document is dropped straight into the dropzone (a real file-input
selection, the same code path as drag-and-drop). Within moments the "Live pipeline" card
lists all seven agent stages — process, classify, extract, entities, summary, validate,
standardize — each with a timing in milliseconds and a green "succeeded" chip, and the
canonical record on the right fills in: document-type badge, classifier confidence,
model/timing line, a plain-English summary, topic tags, an extracted-fields table with a
confidence bar per field, and the entities list.
**Screenshot:** `02-pipeline-and-record.png`

> "I'll drop in an invoice — in the real product this is a drag-and-drop PDF or a photo
> from a phone. The moment it lands, Progress Agentic RAG picks it up, and seven agent
> stages run in sequence: the document is processed, classified, its fields extracted,
> named entities pulled out, a summary written, the result validated, and standardised
> into one shape. Every field comes with a confidence score, not just a value.
>
> And look here — the validation stage has flagged something: the subtotal and tax on
> this invoice don't actually add up to the printed total. That's exactly the kind of
> discrepancy a person would otherwise have to notice by hand; the pipeline catches it
> automatically and surfaces it as a warning rather than silently trusting the total."

*Why this matters:* this single screenshot carries most of the value proposition —
nothing here is scripted client-side, it's the real SSE job stream and a real arithmetic
check against the extracted numbers. Point out that a clean document would show no
warning at all; this one was chosen deliberately to prove the check is real.

---

### 01:05–01:20 — Export it

**On screen:** click through the JSON, XML and CSV export buttons; toasts confirm each
download.
**Screenshot:** `03-exports.png`

> "The same record exports as JSON, XML or CSV — whatever the downstream system expects,
> with no re-mapping."

*Why this matters:* one extraction, three integration paths — this is what makes it
drop-in rather than another format to build against.

---

### 01:20–01:40 — Ask the document a question

**On screen:** type a question into "Ask this document" and submit; the answer streams
in with its source-document citation and latency.
**Screenshot:** `04-ask-answer.png`

> "Because the document lives in an ARAG knowledge box, not just a table row, you can also
> ask it questions directly — 'What is the total due?' — and get a grounded answer back,
> traced to the source document."

*Why this matters:* the record isn't a dead export — the original document stays
queryable.

---

### 01:40–02:00 — The visual path

**On screen:** an image (scanned) purchase order is processed with a forced
`purchase_order` config; the preview shows the actual image, and the record panel shows
"auto-classification skipped" alongside the extracted fields.
**Screenshot:** `05-image-sample.png`

> "This isn't limited to text. A scanned or photographed purchase order goes through the
> same pipeline using visual extraction — and here I've forced the purchase-order config
> directly, so classification is skipped and the fields it must return are pinned in
> advance."

*Why this matters:* proves the visual (image/PDF) path is real, and shows the second way
of choosing a schema — forcing it — versus auto-detect.

---

### 02:00–02:25 — Custom extraction configs

**On screen:** open **Manage… → Extraction configs**, see the built-in list, add a new
config with two custom fields, save it, and watch it appear at the top of the list,
provisioned.
**Screenshot:** `06-config-manager.png`, `07-config-fields.png`, `08-config-provisioned.png`

> "Eleven document types ship out of the box, but real catalogues always have one more
> form. Define the fields you need — here, an insurance card's policy number and insurer —
> and saving doesn't just store the config: it provisions a stored ARAG search
> configuration that forces the model to return exactly those fields, grounded in the
> document, every time this config is used."

*Why this matters:* this is the extensibility story — no code change, no redeploy, to
support a new document type.

---

### 02:25–02:45 — The admin panel

**On screen:** sign in to `/admin/` with the deployment's admin token; the overview shows
KB health as connected, the pipeline settings and usage; switch to the extraction-configs
tab (the new custom config is listed, provisioned); switch to jobs and open the job just
run, with its full stage timeline and raw JSON.
**Screenshot:** `09-admin-overview.png`, `10-admin-configs.png`, `11-admin-jobs.png`

> "Operators get their own view: live KB health, every extraction config and its
> provisioning state, and every job with its full stage timeline — the same events the
> demo streamed, available for any run, at any time."

*Why this matters:* this is what makes it operable, not just demoable — health, config
and job visibility in one place, gated by a token.

---

### 02:45–03:00 — The API docs, and the one-command try-it

**On screen:** `/api/v1/docs` — the generated Redoc reference.
**Screenshot:** `12-api-docs.png`

> "Every route shown here is generated from one OpenAPI document and contract-tested
> against it. To try all of this yourself: clone the repo, run `make install && make dev`,
> and open localhost:8080 — no ARAG account required, it runs against a mock knowledge box
> out of the box."

*Why this matters:* close on the one command a viewer can actually run today.

---

## Optional: mp4 conversion

The recording is a `.webm` (Playwright's default), written under
`showcase/out/<test name>/video.webm`. If `ffmpeg` is available locally, it can be
converted for players that prefer mp4:

```bash
ffmpeg -i showcase/out/*/video.webm -c:v libx264 -pix_fmt yuv420p -crf 20 showcase/out/showcase.mp4
```

This is not part of `make showcase` and is not required for the deliverable.
