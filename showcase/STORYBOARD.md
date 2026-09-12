# Document Processing — storyboard

Shot list for `showcase/record.spec.ts`. Each screenshot lands in `showcase/out/` at the
listed filename; the `.webm` video (`showcase/out/<test name>/video.webm`) covers the
whole session continuously. Durations are approximate on-screen time in the recording,
not narration length (see `SCRIPT.md` for the read-aloud script and timestamps).

| # | Duration | On screen | UI element in focus | Camera / zoom note | Screenshot | Narration line (SCRIPT.md) |
|---|---|---|---|---|---|---|
| 1 | ~3 s | Home page, freshly loaded, nothing processed yet, no export buttons | Dropzone + empty canonical-record panel | Full page, no zoom — establish the whole layout | `01-home.png` | 00:00 "Most business documents… arrive as pictures of data" |
| 2 | ~4 s | An invoice dropped via the file input; pipeline card shows all seven stages complete with timings and a "succeeded" chip; canonical record shows fields with confidence bars, entities, a summary, and a validation warning banner (subtotal + tax ≠ total) | `#timeline` (pipeline card, left) and `#resultBody` (record panel, right) — both visible in one shot | Full page — the split layout puts the process and the result side by side | `02-pipeline-and-record.png` | 00:15 "I'll drop in an invoice…" through "…surfaces it as a warning" |
| 3 | ~2 s | Export toasts visible after JSON/XML/CSV downloads | `#exports` buttons + `.arag-toast` | Full page | `03-exports.png` | 01:05 "The same record exports as JSON, XML or CSV…" |
| 4 | ~3 s | Question asked, grounded answer rendered with source-document chip and latency | `#answer .arag-bubble.assistant` | Full page | `04-ask-answer.png` | 01:20 "You can also ask it questions directly…" |
| 5 | ~3 s | Image purchase-order sample processed with a forced config; image preview + "auto-classification skipped" record | `#preview img` and `#docConf` | Full page — the image preview on the left is the key contrast with shot 2's text preview | `05-image-sample.png` | 01:40 "This isn't limited to text…" |
| 6 | ~2 s | Extraction-config modal open, built-in configs listed | `#configModal` / `#cfgList` | Modal is centred — full page capture still reads fine | `06-config-manager.png` | 02:00 "Eleven document types ship out of the box…" |
| 7 | ~2 s | Custom config form filled in (name + two field rows) before saving | `#cfgName`, `#cfgFields` | Modal | `07-config-fields.png` | 02:00 (continued) "Define the fields you need…" |
| 8 | ~2 s | New custom config saved, scrolled into view at the top of the list under "Custom", showing "provisioned" | `#cfgList` (new card, "provisioned" chip) | Modal, scrolled to the new card | `08-config-provisioned.png` | 02:00 (continued) "…provisions a stored ARAG search configuration…" |
| 9 | ~2 s | Admin signed in, overview tab: health "connected", version/uptime, pipeline settings (extract strategy, model, document counts), usage JSON | `Health` and `Pipeline settings` cards | Full page | `09-admin-overview.png` | 02:25 "Operators get their own view…" |
| 10 | ~2 s | Admin extraction-configs tab: table including the new custom config, all provisioned | `#cfgTable` | Full page | `10-admin-configs.png` | 02:25 (continued) "…every extraction config and its provisioning state…" |
| 11 | ~2 s | Admin jobs tab: job list plus the opened job's stage timeline and raw JSON | `#jobs` table + `#jobDetail` | Full page | `11-admin-jobs.png` | 02:25 (continued) "…every job with its full stage timeline…" |
| 12 | ~3 s | Redoc API reference page | Page title / operation list | Full page | `12-api-docs.png` | 02:45 "Every route shown here is generated from one OpenAPI document…" |

Total: 12 screenshots, one continuous video covering all shots plus the transitions
between them (page navigations, typing, clicking). Shots 2 and 3 onward share the same
document (`invoice-review.txt`) until shot 5 switches to the image sample; shots 6–8 use
whichever document is currently loaded (the image sample) as the extraction target for
the custom-config demonstration — only the config manager itself is on screen there, so
the document underneath is incidental.
