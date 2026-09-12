# Document Processing — storyboard

Shot list for `showcase/record.spec.ts`. Each screenshot lands in `showcase/out/` at the
listed filename; the `.webm` video covers the whole session continuously. Durations are
approximate on-screen time in the recording, not narration length (see `SCRIPT.md` for
the read-aloud script and timestamps).

| # | Duration | On screen | UI element in focus | Camera / zoom note | Screenshot | Narration line (SCRIPT.md) |
|---|---|---|---|---|---|---|
| 1 | ~3 s | Home page, freshly loaded, nothing processed yet | Dropzone + empty canonical-record panel | Full page, no zoom — establish the whole layout | `01-home.png` | 00:00 "Most business documents… arrive as pictures of data" |
| 2 | ~2 s | Invoice sample clicked; file label set, source preview showing raw text, pipeline card mid-stage | `#timeline` (live pipeline card) | Full page — the pipeline card sits centre-left, no crop needed | `02-pipeline-running.png` | 00:15 "I'll drop in a sample invoice…" |
| 3 | ~2 s | Pipeline finished; all seven stages listed, "succeeded" chip green | `#timeline .arag-steps` and the status chip | Full page | `03-pipeline-complete.png` | 00:35 "Seven agent stages run in sequence…" |
| 4 | ~3 s | Canonical record populated: type badge, confidence, summary, tags, issues, fields table with confidence bars, entities | `#resultBody` (right column) | Full page — record panel is the dominant visual | `04-canonical-record.png` | 01:00 "And here's the payoff: a canonical record…" |
| 5 | ~2 s | Export toast visible after JSON/XML/CSV downloads | `#exports` buttons + `.arag-toast` | Full page | `05-exports.png` | 01:25 "The same record exports as JSON, XML or CSV…" |
| 6 | ~3 s | Question asked, grounded answer rendered with source chip and latency | `#answer .arag-bubble.assistant` | Full page | `06-ask-answer.png` | 01:40 "You can also ask it questions directly…" |
| 7 | ~3 s | Image purchase-order sample processed with a forced config; image preview + "auto-classification skipped" record | `#preview img` and `#docConf` | Full page — the image preview on the left is the key contrast with shot 1's text preview | `07-image-sample.png` | 02:00 "This isn't limited to text…" |
| 8 | ~2 s | Extraction-config modal open, built-in configs listed | `#configModal` / `#cfgList` | Modal is centred — full page capture still reads fine | `08-config-manager.png` | 02:20 "Eleven document types ship out of the box…" |
| 9 | ~2 s | Custom config form filled in (name + two field rows) before saving | `#cfgName`, `#cfgFields` | Modal | `09-config-fields.png` | 02:20 (continued) "Define the fields you need…" |
| 10 | ~2 s | New custom config saved and shown as provisioned in the list | `#cfgList` (new card, "provisioned" chip) | Modal | `10-config-provisioned.png` | 02:20 (continued) "…provisions a stored ARAG search configuration…" |
| 11 | ~2 s | Admin signed in, overview tab: KB health "connected", model + extract strategy | `arag-health` component | Full page | `11-admin-overview.png` | 02:40 "Operators get their own view…" |
| 12 | ~2 s | Admin extraction-configs tab: table including the new custom config | `#cfgTable` | Full page | `12-admin-configs.png` | 02:40 (continued) "…every extraction config and its provisioning state…" |
| 13 | ~2 s | Admin jobs tab: job list plus the opened job's stage timeline | `#jobs` table + `#jobDetail` | Full page | `13-admin-jobs.png` | 02:40 (continued) "…every job with its full stage timeline…" |
| 14 | ~3 s | Redoc API reference page | Page title / operation list | Full page | `14-api-docs.png` | 02:55 "Every route shown here is generated from one OpenAPI document…" |

Total: 14 screenshots, one continuous video covering all shots plus the transitions
between them (page navigations, typing, clicking).
