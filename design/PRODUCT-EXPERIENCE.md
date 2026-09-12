# Document Processing — product experience specification

**Status:** design, D-28 pass. **Audience:** the engineering lead implementing `public/`,
`admin/` and the `/api/v1` additions they require. **Scope:** the whole signed-in product —
operator app and admin app — as a static SPA served from `public/` and `admin/`, consuming
only `/api/v1`, styled with `vendor/arag-platform/ui/arag-ui.css` plus a local
`public/ui-ext.css`.

This document is the contract between design and engineering. Where it says *NEW API*, the
endpoint or parameter does not exist today and must be authored in `src/openapi.ts` before
the route. Every other statement can be built against the API as it stands on 2026-09-12
(20 paths, `src/openapi.ts`).

Conventions used here: British English; `hash routes` written as `/#/documents`; API paths
written in full; component classes prefixed `.arag-` (shared kit, do not edit) or `.dip-`
(this product's `public/ui-ext.css`).

**Read alongside:** `marketing/site/document-processing.json` (the customer promise this UI
must live up to), `src/types.ts` (`DocumentRecord`, `Evidence`, `ExtractedField`,
`ValidationIssue`, `StageName`), `src/services/schemas.ts` (the eleven built-in schemas),
`docs/developer/white-label.md`.

---

## 1. Personas and jobs to be done

The four personas are taken verbatim from `marketing/site/document-processing.json`. Each
one is given the screens they live in; a screen nobody lives in should not be built.

### 1.1 Dana — AP / Finance Operations Manager

> *"Measured on cost per invoice, days payable outstanding and exception rate; wants a new
> vendor invoice layout read correctly the first time, not another six-week template-tuning
> cycle."*

| Job to be done | What she does in the product | Screens |
| --- | --- | --- |
| Clear today's invoice queue without re-keying | Sorts Documents by grounding score, worst first; opens only the records with issues or unverified fields | Documents, Document detail → Record |
| Prove a number to an auditor or a supplier | Opens the field, reads the quote, jumps to the sentence in the source | Document detail → Record, → Source |
| Get the record into the ledger | Exports CSV for one document, or a bulk CSV for the day's batch | Documents (bulk export), Document detail (export menu) |
| Judge whether a new vendor layout reads correctly | Uploads three of the new supplier's invoices, compares the extracted fields with the evidence quotes | Upload, Document detail |
| Know when to stop trusting it | Watches the grounding score and the issue counts on the Documents header strip | Documents |

Dana never opens the admin app. Her whole product is: list → detail → export.

### 1.2 Marcus — Claims / Health-Scheme Operations Lead

> *"Measured on claims turnaround, first-pass yield and audit accuracy; wants claim number,
> member number, diagnosis code and amount claimed structured and validated before a person
> opens the form."*

| Job to be done | What he does | Screens |
| --- | --- | --- |
| Triage a batch of claim forms | Filters Documents to `Medical claim` + `Needs review`, works the filtered list top to bottom | Documents |
| Confirm a member number before adjudication | Reads the field's verification chip; an `unverified` member number is a stop | Document detail → Record |
| Handle a form the built-in schema does not cover | Creates a config with the six fields the scheme actually uses, then forces it on upload | Configs, Config detail, Upload |
| Answer a one-off question about a pre-authorisation | Asks the document "what length of stay was approved?" | Ask, Document detail → Ask |
| Chase a stuck batch | Checks Jobs for anything queued or failed, cancels or reprocesses | Jobs |

### 1.3 Priya — Platform / Integration Engineer at an ISV or SI

> *"Measured on integration time and ongoing maintenance burden; wants a versioned REST API
> with an OpenAPI spec and a contract test suite, not a prompt to babysit."*

| Job to be done | What she does | Screens |
| --- | --- | --- |
| Decide in twenty minutes whether to integrate | Runs the guided sample, then reads the same record as JSON | Welcome, guided sample path, Document detail (JSON view) |
| Find the endpoint behind a screen | Every screen names its endpoints; Settings → API links to Redoc and Swagger | Settings → API, `/api/v1/docs` |
| Reproduce a support case | Opens the document's Pipeline tab, reads stage timings and stage errors, copies the job id | Document detail → Pipeline, Jobs |
| Check quotas and limits before wiring an uploader | Reads accepted types, max upload size and the ask limit | Settings → Extraction |
| Confirm the deployment is pointed where she thinks | Settings → Connection: live or mock, which Knowledge Box, which model | Settings → Connection |

### 1.4 Alex — Procurement / Contracts Manager

> *"Measured on contract review turnaround and vendor onboarding speed; wants to ask a
> contract 'what's the termination notice period?' and get a grounded answer instead of
> re-reading twelve pages."*

| Job to be done | What he does | Screens |
| --- | --- | --- |
| Abstract a contract into a summary he can circulate | Uploads the PDF, reads parties / term / governing law / value | Upload, Document detail → Record |
| Ask the awkward question | Ask, with the contract selected and a suggested question offered | Ask |
| Check the answer is really in the document | Opens the citation, lands on the clause | Ask, Document detail → Source |
| Keep a file of what was agreed | Exports JSON into the contract file | Document detail |

### 1.5 The fifth persona: Sam, the operator

Not in the marketing JSON, but the admin app has no meaning without them. Sam runs the
deployment (partner engineer, or the customer's own platform team). Jobs: confirm the
Knowledge Box connection, see that extraction configs are provisioned, read logs when a
batch fails, watch usage and grounding, apply retention, prove the branding in force.
Screens: the whole admin app, and nothing in the operator app except as a visitor.

---

## 2. Information architecture

### 2.1 Routing recommendation — hash routing

**Use hash routing (`/#/documents/abc123`) in both apps.** Reasons, in order of weight:

1. The platform's static file server (`App.static`, `vendor/arag-platform/src/http/app.ts`
   line 416) has **no SPA fallback**: an unmatched path falls through `serveStatic` and
   throws `notFound`. A path-routed deep link such as `/documents/abc123` would return a
   404 problem document, not the app. Path routing therefore requires a new server
   behaviour (a catch-all route rewriting unknown non-API GETs to `public/index.html`),
   which is a real change to a security-sensitive dispatcher for no user-visible gain.
2. The admin app is served from a *sub-path* (`app.static("/admin", …)`). Hash routes under
   `/admin/#/jobs` need no base-path configuration; path routes would need one.
3. Deep links still work everywhere that matters: the showcase recording, e2e tests, the
   docs and a shared link all navigate to `/#/documents/<id>` and land correctly.
4. The cost — hash fragments in the URL bar — is invisible in a recorded walkthrough and
   irrelevant to SEO for a signed-in workspace.

Implementation rules: one `hashchange` listener per app, a route table mapping a pattern to
a render function, `history.replaceState` for filter changes (so filters do not fill the
back stack) and `location.hash = …` for navigations (so Back works). Filter and paging
state lives in the hash query string — `/#/documents?status=ready&sort=-grounding&page=2` —
so a filtered queue is a shareable link, which is exactly how Marcus hands work to a
colleague.

### 2.2 Sitemap

```
Operator app  (public/index.html)
│
├─ /#/welcome ....................... first run only; redirects to /#/documents once a document exists
│
├─ /#/documents ..................... Documents list (default route; "/" and "" redirect here)
│   ?q= &status= &doc_type= &config= &date_from= &date_to= &sort= &page= &page_size=
│  ├─ /#/documents/upload ........... Upload drawer over the list (focus-trapped)
│  └─ /#/documents/:id .............. Document detail (full page, its own header)
│      ├─ …/:id            ......... tab: Record        (default)
│      ├─ …/:id/source     ......... tab: Source & evidence
│      ├─ …/:id/pipeline   ......... tab: Pipeline
│      ├─ …/:id/ask        ......... tab: Ask
│      └─ …/:id/json       ......... tab: JSON
│
├─ /#/configs ...................... Extraction configs (11 built-in + custom)
│   ?q= &kind=builtin|custom &sort=
│  ├─ /#/configs/new ............... Field builder (full page, not a modal)
│  └─ /#/configs/:id ............... Config detail; /#/configs/:id/edit for custom configs
│
├─ /#/ask .......................... Grounded per-document Q&A with a document picker
│   ?doc=<id>
│
├─ /#/jobs ......................... Jobs list
│   ?status= &page=
│  └─ /#/jobs/:id .................. Job detail drawer over the list
│
└─ /#/settings ..................... Settings
   ├─ /#/settings/connection ....... Knowledge Box, mock vs live, model, health   (default)
   ├─ /#/settings/extraction ....... Extract strategy, accepted types, limits, defaults
   ├─ /#/settings/branding ......... Effective branding + live preview (read-only)
   └─ /#/settings/api .............. Usage, API docs links, credentials explainer

Admin app  (admin/index.html)  — same shell, different nav, admin cookie required
│
├─ (sign-in) ....................... shown in place of the app when /api/v1/admin/health 401s
├─ /admin/#/overview ............... health, stat strip, recent failures            (default)
├─ /admin/#/connection ............. KB test, endpoint, region, model, extract strategy, search configurations
├─ /admin/#/configs ................ configs table + provisioning; drawer shows the stored ARAG search configuration
│   └─ /admin/#/configs/:id ........ drawer
├─ /admin/#/jobs ................... all jobs, filterable; drawer shows timeline + raw JSON + cancel
│   └─ /admin/#/jobs/:id ........... drawer
├─ /admin/#/logs ................... log table with level and text filters, live tail toggle
├─ /admin/#/usage .................. counters, ARAG call health, grounding average, documents over time
├─ /admin/#/branding ............... effective BRAND_* values, asset paths, live preview, how to change
└─ /admin/#/security ............... credentials in force, rate limits, CORS, retention/purge (destructive, confirmed)
```

### 2.3 Navigation model

Both apps use the same shell: a **Progress brand band** (44 px, ink-950), a **left sidebar**
(232 px) holding the product wordmark, the primary nav and a footer status pill, and a
**content column** (fluid, max 1208 px) whose first element is always a page header
(breadcrumb → title → primary action).

Operator nav order and rationale — the order is the workflow, not the alphabet:

| # | Label | Route | Badge |
| --- | --- | --- | --- |
| 1 | Documents | `/#/documents` | count of documents needing review (issues or grounding < 0.5) |
| 2 | Configs | `/#/configs` | none |
| 3 | Ask | `/#/ask` | none |
| 4 | Jobs | `/#/jobs` | count of queued + running jobs, live |
| 5 | Settings | `/#/settings/connection` | a warning dot when the Knowledge Box is unreachable |

Admin nav order: Overview, Connection, Configs, Jobs, Logs, Usage, Branding, Security.

Cross-links: the operator app's brand band carries `API docs` and `Admin`; the admin app's
band carries `API docs` and `Open app`. Admin is never a tab inside the operator app — it is
a different product for a different person, and the sign-in boundary must look like one.


---

## 3. Screen-by-screen specification

Every wireframe is drawn at **1440 px**: a 44 px Progress brand band, a 232 px sidebar, and a
fluid content column capped at 1208 px with 24 px gutters. The ASCII is proportional, not
pixel-exact; it fixes regions, order and real labels, not measurements.

The data in the wireframes is real: `public/samples/invoice.txt` (Acme Robotics,
INV-2026-0042) and `showcase/fixtures/invoice-review.txt` (Globex Supply Co, INV-2026-1188 —
the invoice whose subtotal and tax deliberately do not reconcile with the printed total).

### 3.0 The shell (every screen)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                          API docs   Admin   service · online                   │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Documents                                        [ + Upload document ]          │
│     Document Processing  │  ─────────────────────────────────────────────────────────────────────────       │
│                          │  content column, max 1208 px, 24 px gutters                                      │
│▎ ▤ Documents          24 │                                                                                  │
│  ⚙ Configs            13 │                                                                                  │
│  ? Ask                   │                                                                                  │
│  ◷ Jobs               1  │                                                                                  │
│  ⚒ Settings              │                                                                                  │
│                          │                                                                                  │
│  ────────────────────    │                                                                                  │
│  ● Knowledge Box online  │                                                                                  │
│  Built on Progress ARAG  │                                                                                  │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Contents | Notes |
| --- | --- | --- |
| Brand band (44 px) | Progress Agentic RAG wordmark (`arag-logo-alt.svg`, white/green, on ink-950), `API docs`, `Admin`, `<arag-status endpoint="/readyz">` | Hidden entirely when `branding.poweredBy === false` |
| Sidebar (232 px) | Product wordmark (`arag-logo.svg` or `branding.logoUrl`), product name, primary nav with live badges, connection pill, footer credit | Sticky, full height, own scroll |
| Page header | Breadcrumb (detail screens only) → `<h1>` → primary action | Always the first element of the content column |
| Content | Screen body | Max 1208 px |

---

### 3.1 Welcome (first run) — `/#/welcome`

**Purpose.** Turn an empty deployment into a processed document in one click, and be honest
about which Knowledge Box it is talking to.

**Shown when** `GET /api/v1/documents?page_size=1` returns `total === 0`. Redirects to
`/#/documents` the moment a document exists. Reachable afterwards from Settings → "Run the
guided sample again".

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                          API docs   Admin   service · online                   │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │                                                                                  │
│     Document Processing  │   Read every document the first time                                             │
│                          │   Drop in a document and get back a checked, structured record — with the        │
│▎ ▤ Documents           0 │   sentence from the page behind every value.                                     │
│  ⚙ Configs            13 │                                                                                  │
│  ? Ask                   │   ┌───────────────────────────────────┬───────────────────────────────┐          │
│  ◷ Jobs                0 │   │ Try it with a sample              │ Use your own document         │          │
│  ⚒ Settings              │   │                                   │                               │          │
│                          │   │ A supplier invoice whose totals   │ PDF, PNG, JPEG, TIFF, DOCX,   │          │
│  ────────────────────    │   │ do not reconcile — so you can see │ TXT, CSV or Markdown, up to   │          │
│  ● Mock Knowledge Box    │   │ the validation catch something.   │ 25 MB.                        │          │
│  Built on Progress ARAG  │   │                                   │                               │          │
│                          │   │ [ Start the guided sample ]       │ [ Upload a document ]         │          │
│                          │   └───────────────────────────────────┴───────────────────────────────┘          │
│                          │                                                                                  │
│                          │   ⚠ This deployment is running the mock Knowledge Box. Extraction comes          │
│                          │     from deterministic fixtures keyed by filename, not from a model              │
│                          │     reading the page. Set ARAG_KB_ID and ARAG_API_KEY for live extraction.       │
│                          │     Settings → Connection                                                        │
│                          │                                                                                  │
│                          │   Eleven document types are ready to use · Configs                               │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Regions.** (1) Headline + subheadline, taken from `customer.headline` /
`customer.subheadline` in the marketing JSON — the product must say on screen what the site
promises. (2) Two action cards, equal weight, sample first. (3) Deployment-honesty alert.
(4) A single quiet link to Configs.

**Data shown.** `branding.productName`, mock vs live from `GET /readyz` (`arag.mock`),
config count from `GET /api/v1/extraction-configs`.

**Actions.** `Start the guided sample` → posts the sample and enters the tour (§6).
`Upload a document` → `/#/documents/upload`. `Settings → Connection` link.

**Endpoints.** `GET /readyz`; `GET /api/v1/documents?page_size=1`;
`GET /api/v1/extraction-configs`; **NEW API** `GET /api/v1/samples`, **NEW API**
`POST /api/v1/documents/sample`.

**Empty-state honesty rule.** The alert is not dismissible while the deployment is on the
mock. It is the same commitment `showcase/SCRIPT.md` already makes; it must survive the
redesign.

---

### 3.2 Documents — `/#/documents`

**Purpose.** The working queue. Find a document, judge at a glance whether it can be trusted
unreviewed, act on many at once.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                          API docs   Admin   service · online                   │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Documents                                        [ + Upload document ]          │
│     Document Processing  │ ──────────────────────────────────────────────────────────────────────────       │
│                          │  ┌ 24 documents ─┬ 2 need review ─┬ 1 processing ─┬ Mean grounding ──┐           │
│▎ ▤ Documents          24 │  │      24       │       2        │      1        │      0.91        │           │
│  ⚙ Configs            13 │  └───────────────┴────────────────┴───────────────┴──────────────────┘           │
│  ? Ask                   │                                                                                  │
│  ◷ Jobs                1 │  [ 🔍 Search filename, type or value ] [Status ▾] [Type ▾] [Config ▾]             │
│  ⚒ Settings              │  [Uploaded: any ▾]   Sort: Newest first ▾            Clear all filters           │
│                          │                                                                                  │
│  ────────────────────    │  ☐  File                    Type       Status    Fields  Ground.  Issues         │
│  ● Knowledge Box online  │ ─────────────────────────────────────────────────────────────────────────        │
│  Built on Progress ARAG  │  ☑  invoice-review.txt      Invoice    ● Ready      12     92%    ▲ 1  ⋯         │
│                          │     INV-2026-1188 · Globex Supply Co · 3 min ago                                 │
│                          │  ☑  invoice.txt             Invoice    ● Ready      12     100%     —   ⋯        │
│                          │     INV-2026-0042 · Acme Robotics Pty Ltd · 12 min ago                           │
│                          │  ☐  preauth-form.png        Pre-auth   ● Ready      14      79%    ▲ 2  ⋯        │
│                          │     AUTH-90233 · Meridian Health · 41 min ago                                    │
│                          │  ☐  remittance.png          Med. claim ◐ Processing  —       —      —   ⋯        │
│                          │     extract · 00:34 elapsed · Cancel                                             │
│                          │  ☐  scan-0041.pdf           Invoice    ⊘ Failed      —       —      —   ⋯        │
│                          │     Knowledge Box unreachable · 1 h ago · Reprocess                              │
│                          │  ☐  contract.txt            Contract   ◑ Degraded    8      88%    ▲ 1  ⋯        │
│                          │     Summary stage failed · 2 h ago                                               │
│                          │ ─────────────────────────────────────────────────────────────────────────        │
│                          │  2 selected   [ Export CSV ▾ ]  [ Delete ]        1–20 of 24  ‹ 1 2 ›            │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Regions.**
1. **Page header** — title, `+ Upload document` (primary).
2. **Stat strip** (`.dip-statstrip`) — four tiles: total, need review, processing, mean
   grounding. Each tile is a filter link: "2 need review" sets
   `?has_issues=true&sort=grounding`.
3. **Filter bar** (`.dip-filterbar`) — search box, four dropdown filters, sort select, and a
   `Clear all filters` link that appears only when something is set.
4. **Data table** (`.dip-datatable`) — a checkbox column, seven data columns, a row-actions
   menu. Each row is two lines: filename on line one; the identifying value, the counterparty
   and the relative time on line two. The second line is what makes the queue scannable —
   `scan-0041.pdf` tells Dana nothing; `INV-2026-1188 · Globex Supply Co` tells her everything.
5. **Bulk bar** (`.dip-bulkbar`) — appears inside the table footer when a selection exists;
   it replaces the count text rather than floating over the content.
6. **Pagination** (`.dip-pagination`).

**Data shown per row.** `filename`, `docType` (labelled, not snake_case), `status` +
derived `degraded`, `fields.length`, `meta.groundingScore`, issue count by max severity,
`createdAt` (relative, absolute in `title`), and the identifying value — the first present of
`invoice_number`, `po_number`, `claim_number`, `authorisation_number`, `reference`, `title`,
`full_name` — plus the counterparty (`vendor_name`, `supplier`, `merchant`, `scheme`,
`bank_name`, `parties[0]`).

**Sort options.** Newest first (default), Oldest first, Grounding: lowest first, Grounding:
highest first, Name A–Z, Type, Status.

**Row actions menu (`⋯`).** Open, Export JSON / XML / CSV, Ask this document, Reprocess
(failed or degraded only), Delete (confirmation).

**Bulk actions.** Export CSV / JSON / XML for the selection; Delete the selection
(typed confirmation — see §4.6). Selection persists across pagination within a session and is
reported as "2 selected" in an `aria-live="polite"` region.

**Endpoints and the gap.** Today `GET /api/v1/documents` accepts only `page`, `page_size`,
`status`, `doc_type`. This screen needs, all **NEW API** on the same operation:

| Param | Type | Behaviour |
| --- | --- | --- |
| `q` | string, ≤200 | Case-insensitive substring over `filename`, `docType`, `summary`, `tags[]`, and the stringified `fields[].value` and `fields[].raw` |
| `sort` | enum | `-created_at` (default), `created_at`, `filename`, `-filename`, `doc_type`, `status`, `grounding`, `-grounding`, `fields`, `-fields`. Implemented as a comparator map passed to `Collection.list({ sort })` — the JSON store already supports it (`vendor/arag-platform/src/store/jsonstore.ts` line 74) |
| `doc_type` | repeated or comma-separated | Multi-select filter; keep the single value working |
| `config` | string | Extraction config id, matched against `meta.config` |
| `date_from`, `date_to` | date or date-time | Inclusive range over `createdAt` |
| `degraded` | boolean | `true` selects `status === "ready" && meta.stageErrors?.length` |
| `has_issues` | boolean | `true` selects records with at least one issue of severity `warning` or `error` |
| `min_grounding` | number 0–1 | `meta.groundingScore >= value`; records without a score are excluded |
| `view` | `compact` \| `full` | `compact` (default for this screen) returns a `DocumentSummary`: `id, filename, contentType, bytes, status, docType, createdAt, updatedAt, jobId, fieldCount, issueCounts {info,warning,error}, groundingScore, degraded, headline {identifier, counterparty}`. A page of 50 full records carries every evidence quote and every field — hundreds of kilobytes for a list that shows none of it |

Also **NEW API** on the response: `facets: { status: {...}, docType: {...}, degraded: n,
needsReview: n }` so the stat strip and the filter dropdown counts cost no extra round trip.

Bulk actions, both **NEW API**:

- `POST /api/v1/documents/export` — body `{ ids: string[] (1–200), format: "json"|"xml"|"csv" }`.
  Returns the combined file with `Content-Disposition: attachment`. JSON → an array of records;
  XML → a `<documents>` root; CSV → the existing per-document CSV with a leading `document_id`
  column and one header row. `auth: "api"` (a read).
- `POST /api/v1/documents/bulk-delete` — body `{ ids: string[] (1–200) }` → `200 { deleted: string[],
  failed: [{ id, error }] }`. Guarded by `requireWriter` (it deletes Knowledge Box resources)
  and partial failure is reported, never swallowed.

Recovery action, **NEW API**: `POST /api/v1/documents/{id}/reprocess` → `202 { document, job }`.
Re-runs the pipeline against the existing ARAG resource (no re-upload), resets `status` to
`pending`, clears `fields`/`evidence`/`issues`/`meta.stageErrors`, keeps `id`, `resourceId`,
`filename` and `createdAt`. Optional `?config=` to force a different extraction config on the
retry — which is also how Dana tests a config change against a document she has already
uploaded. Guarded by `requireWriter`.

---

### 3.3 Upload — `/#/documents/upload` (drawer over the list)

**Purpose.** Get bytes in with the fewest possible decisions, and make the one decision that
matters — auto-classify or force a config — legible.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                          API docs   Admin   service · online                   │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Documents                     ┌──────────────────────────────────────┐          │
│     Document Processing  │ ───────────────────────────────│  Upload document                  ✕  │          │
│                          │  ┌ 24 documents ─┬ 2 need re│ ──────────────────────────────────── │             │
│▎ ▤ Documents          24 │  │      24       │       2  │                                      │             │
│  ⚙ Configs            13 │  └───────────────┴──────────│   ┌──────────────────────────────┐   │             │
│  ? Ask                   │                              │   │      Drop files here         │   │            │
│  ◷ Jobs                1 │  [ 🔍 Search filename, type │   │      or browse               │   │              │
│  ⚒ Settings              │  [Uploaded: any ▾]   Sort: N│   └──────────────────────────────┘   │             │
│                          │                              │   PDF, PNG, JPEG, TIFF, DOCX, TXT,   │            │
│  ────────────────────    │  ☐  File                    │   CSV, MD · up to 25 MB each         │             │
│  ● Knowledge Box online  │ ─────────────────────────────│                                      │            │
│  Built on Progress ARAG  │  ☐  invoice-review.txt      │   Extraction config                  │             │
│                          │     INV-2026-1188 · Globex S│   [ Auto-detect (classify first) ▾ ] │             │
│                          │  ☐  invoice.txt             │   Auto-detect picks one of the 11    │             │
│                          │     INV-2026-0042 · Acme Rob│   built-in types. Choosing a config  │             │
│                          │  ☐  preauth-form.png        │   forces exactly its fields.         │             │
│                          │     AUTH-90233 · Meridian He│                                      │             │
│                          │  ☐  remittance.png          │   Queued (2)                         │             │
│                          │     extract · 00:34 elapsed │   ▸ invoice-2.pdf   ● uploading 40%  │             │
│                          │  ☐  scan-0041.pdf           │   ▸ claim-77.png    ◷ queued         │             │
│                          │     Knowledge Box unreachabl│                                      │             │
│                          │  ☐  contract.txt            │ ──────────────────────────────────── │             │
│                          │     Summary stage failed · 2│         [ Cancel ]  [ Upload 2 ]     │             │
│                          │ ─────────────────────────────└──────────────────────────────────────┘            │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Regions.** Dropzone (`.arag-dropzone`, already in the kit); accepted-types line; config
select with a one-line explanation; per-file queue with progress; footer actions.

**Behaviour.** Multiple files are accepted and posted sequentially (the job runner has
`concurrency: 2`; queueing client-side keeps the order predictable and the progress honest).
Each successful `POST` inserts the new row at the top of the list behind the drawer, in
`pending` state, so the drawer can be closed and the work watched in the list. Closing the
drawer never cancels an in-flight upload.

**Accepted types and size must come from the API, not the markup.** Today
`public/index.html` hard-codes `accept=".pdf,.png,…"` and the 25 MB limit is invisible until
a 413 comes back. Both live in `ALLOWED_MIME` and `DIP_MAX_UPLOAD_BYTES`
(`src/services/documents.ts`) and must be published — see the **NEW API**
`GET /api/v1/settings` in §3.12.

**Endpoints.** `POST /api/v1/documents?config=<id|auto|agent>` (multipart);
`GET /api/v1/extraction-configs`; `GET /api/v1/jobs/{id}/events` for each accepted upload;
**NEW API** `GET /api/v1/settings` for accepted types and the size limit.

---

### 3.4 Document detail — Record tab — `/#/documents/:id`

**Purpose.** The verified-evidence record, front and centre. This is the screen the product
is judged on.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                          API docs   Admin   service · online                   │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Documents › invoice-review.txt                                                  │
│     Document Processing  │  Globex Supply Co Pty Ltd — INV-2026-1188   [ Export ▾ ] [ Ask ] [ ⋯ ]           │
│                          │ ──────────────────────────────────────────────────────────────────────────       │
│▎ ▤ Documents          24 │  Record | Source & evidence | Pipeline | Ask | JSON                              │
│  ⚙ Configs            13 │ ──────────────────────────────────────────────────────────────────────────       │
│  ? Ask                   │  ┌──────────────────────────────────────────────────────────────────────┐        │
│  ◷ Jobs                1 │  │ Grounding  92%  ████████████████████░  11 of 12 fields carry a quote │        │
│  ⚒ Settings              │  │                found in this document.  10 exact · 1 near · 1 none   │        │
│                          │  │ ● Ready   Invoice · 97% classifier   ▲ 1 warning   6.1 s   What is   │        │
│  ────────────────────    │  │                                                            this? ⓘ   │        │
│  ● Knowledge Box online  │  └──────────────────────────────────────────────────────────────────────┘        │
│  Built on Progress ARAG  │                                                                                  │
│                          │  ▲ Total does not reconcile                                                      │
│                          │    subtotal (22500) + tax (2250) ≠ total (25750). Check the printed total        │
│                          │    against the line items before posting.            Go to field ›               │
│                          │                                                                                  │
│                          │  Extracted fields (12)              ┌ Summary ──────────────────────────┐        │
│                          │ ──────────────────────────────────  │ A tax invoice from Globex Supply  │        │
│                          │  Vendor                             │ Co to Meridian Health Networks    │        │
│                          │  Globex Supply Co Pty Ltd           │ for an annual platform licence    │        │
│                          │  conf ████████░ 96%   ✓ Verified    │ and onboarding services, due      │        │
│                          │  “GLOBEX SUPPLY CO PTY LTD”  ↗      │ 2 September 2026.                 │        │
│                          │ ──────────────────────────────────  │ invoice  accounts-payable  AUD    │        │
│                          │  Invoice #                          └───────────────────────────────────┘        │
│                          │  INV-2026-1188                      ┌ Entities (9) ─────────────────────┐        │
│                          │  conf █████████ 99%   ✓ Verified    │ ORG  Globex Supply Co Pty Ltd     │        │
│                          │  “Invoice Number: INV-2026-1188” ↗  │ ORG  Meridian Health Networks Ltd │        │
│                          │ ──────────────────────────────────  │ MONEY $25,750.00                  │        │
│                          │  Invoice date                       │ DATE 2026-08-03   DATE 2026-09-02 │        │
│                          │  2026-08-03   raw “03/08/2026”      │ ID   PO-77341        + 3 more     │        │
│                          │  conf ████████░ 95%   ✓ Verified    └───────────────────────────────────┘        │
│                          │  “Invoice Date: 03/08/2026”      ↗  ┌ How this was produced ────────────┐        │
│                          │ ──────────────────────────────────  │ Config    invoice (auto-detected) │        │
│                          │  Currency                           │ Schema    invoice_extraction      │        │
│                          │  AUD                                │ Model     chatgpt-azure-4o-mini   │        │
│                          │  conf ██████░░░ 72%   ≈ Near match  │ ARAG cfg  dip_invoice             │        │
│                          │  “Currency: AUD”                 ↗  │ Source    1 284 characters        │        │
│                          │ ──────────────────────────────────  │ Run       6.1 s · 12 Sep, 09:41   │        │
│                          │  Total                              └───────────────────────────────────┘        │
│                          │  25750.00   raw “$25,750.00”        ┌ Danger zone ──────────────────────┐        │
│                          │  conf ████████░ 94%   ✓ Verified    │ Deleting removes the record and   │        │
│                          │  “TOTAL DUE: $25,750.00”  ▲      ↗  │ the Knowledge Box resource.       │        │
│                          │ ──────────────────────────────────  │ [ Delete document ]               │        │
│                          │  Vendor address                     └───────────────────────────────────┘        │
│                          │  Level 3, 88 Collins Street, Mel…                                                │
│                          │  conf ███████░░ 88%   ○ No quote returned                                        │
│                          │  This value is not backed by a quote from the document. Check it                 │
│                          │  against the source before using it.                   Open source ›             │
│                          │ ──────────────────────────────────                                               │
│                          │  … 7 more fields                                    Show all fields ▾            │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Regions.**
1. **Breadcrumb** — `Documents › <filename>`; the filename is the last crumb and is not a link.
2. **Title block** — `<h1>` is the *document's own identity* (`counterparty — identifier`),
   not the filename; the filename is the breadcrumb. Actions: Export menu (JSON / XML / CSV),
   Ask, overflow (Reprocess, Copy document id, Copy job id, Delete).
3. **Tabs** — Record, Source & evidence, Pipeline, Ask, JSON. Anchor-based, each a real route.
4. **Trust strip** (`.dip-grounding`) — full width, the first thing on the page. §5.1.
5. **Issues** — one `.arag-alert` per issue, ordered error → warning → info, each with a
   `Go to field ›` link that focuses the field row.
6. **Fields column** (7fr) — `.dip-field` rows. §5.2.
7. **Inspector column** (5fr) — Summary, Entities, How this was produced, Danger zone.

**Data shown.** The whole `DocumentRecord`. `fields[]` joined to `evidence[]` by
`field`/`key`. `meta.groundingScore`, `meta.schema`, `meta.model`, `meta.config`,
`meta.forced`, `meta.searchConfiguration`, `meta.sourceChars`, `meta.durationsMs`,
`meta.processedAt`, `meta.stageErrors`, `docTypeConfidence`, `summary`, `tags[]`,
`entities[]`, `issues[]`.

**Field ordering.** Schema order (the order in `SCHEMAS[docType].properties`), not
confidence order — Dana reads an invoice in the shape of an invoice. The first ten fields are
shown; `Show all fields` expands the rest. **Exception:** any field whose evidence is
`unverified` or missing is *also* pinned into a "Check these first" group directly under the
issues block, with a link back to its position in the schema order. Trust beats familiarity
when they conflict.

**Actions.** Export (three formats); Ask (jumps to the Ask tab with focus in the input);
Reprocess; Delete (confirmation naming the file and stating the Knowledge Box consequence);
per-field: expand quote, jump to source, copy value.

**Endpoints.** `GET /api/v1/documents/{id}`; `GET /api/v1/documents/{id}/export?format=`;
`DELETE /api/v1/documents/{id}`; **NEW API** `POST /api/v1/documents/{id}/reprocess`;
**NEW API** `GET /api/v1/documents/{id}/text` (for the jump-to-source highlight, §3.5).

---

### 3.5 Document detail — Source & evidence tab — `/#/documents/:id/source`

**Purpose.** Close the loop the marketing copy opens: *"Evidence you can open… the difference
between a system that asserts and a system that shows."* Two panes, bidirectionally linked.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                          API docs   Admin   service · online                   │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Documents › invoice-review.txt                                                  │
│     Document Processing  │  Globex Supply Co Pty Ltd — INV-2026-1188   [ Export ▾ ] [ Ask ] [ ⋯ ]           │
│                          │ ──────────────────────────────────────────────────────────────────────────       │
│▎ ▤ Documents          24 │  Record | Source & evidence | Pipeline | Ask | JSON                              │
│  ⚙ Configs            13 │ ──────────────────────────────────────────────────────────────────────────       │
│  ? Ask                   │  Evidence (12)            │  Source text        [ Original file ▾ ]              │
│  ◷ Jobs                1 │  ───────────────────────  │ ────────────────────────────────────────────         │
│  ⚒ Settings              │  ✓ Vendor                 │  GLOBEX SUPPLY CO PTY LTD                            │
│                          │    “GLOBEX SUPPLY CO       │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ← Vendor                  │
│  ────────────────────    │     PTY LTD”              │  Level 3, 88 Collins Street, Melbourne VIC           │
│  ● Knowledge Box online  │    chars 0–25             │  3000, Australia                                     │
│  Built on Progress ARAG  │  ───────────────────────  │                                                      │
│                          │  ✓ Invoice #              │  TAX INVOICE                                         │
│                          │    “Invoice Number:       │                                                      │
│                          │     INV-2026-1188”        │  Invoice Number: INV-2026-1188                       │
│                          │    chars 41–71            │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ← selected           │
│                          │  ───────────────────────  │  Invoice Date: 03/08/2026                            │
│                          │  ≈ Currency               │  Due Date: 02/09/2026                                │
│                          │    “Currency: AUD”        │  Currency: AUD                                       │
│                          │    matched after          │                                                      │
│                          │    normalising case and   │  Bill To:                                            │
│                          │    whitespace             │  Meridian Health Networks Ltd                        │
│                          │  ───────────────────────  │  Level 9, 200 George Street, Sydney NSW 2000         │
│                          │  ○ Vendor address         │                                                      │
│                          │    No quote returned for  │  Description        Qty  Unit Price   Amount         │
│                          │    this field.            │  Annual platform…     1  $18,000.00  $18,000.00      │
│                          │    Nothing to verify.     │  Onboarding services  1   $4,500.00   $4,500.00      │
│                          │  ───────────────────────  │                                                      │
│                          │  ✓ Total                  │  Subtotal: $22,500.00                                │
│                          │    “TOTAL DUE:            │  GST (10%): $2,250.00                                │
│                          │     $25,750.00”           │  TOTAL DUE: $25,750.00                               │
│                          │    chars 604–629          │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ← Total ▲                   │
│                          │  ───────────────────────  │                                                      │
│                          │  Legend: ✓ found verbatim │  1 284 characters extracted by Progress Agentic      │
│                          │  ≈ found after normalising│  RAG at ingestion. This is the text every            │
│                          │  ○ no quote / not found   │  extraction stage read.                              │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Regions.** Left rail (360 px): every evidence entry, grouped by verification state, worst
first — `unverified` and missing quotes at the top, `normalised` next, `exact` last. Right
pane: the extracted text with `<mark>` at each evidence `start`/`end`, the selected one
emphasised. Header of the right pane offers `Original file ▾` to switch between the extracted
text and the uploaded file (image or PDF preview).

**Interaction.** Selecting an evidence entry scrolls the source pane to its offsets, sets
`.is-active` on the mark and moves focus to it (`tabindex="-1"`). Clicking a mark selects the
matching evidence entry. Both directions update `?ev=<field>` in the hash so a colleague can
be sent straight to the disputed value.

**The blocking API gap.** `Evidence.start` / `Evidence.end` are offsets into *the document's
own extracted text*, which the browser has no way to obtain today. `sourceText` is read in
the pipeline (`src/services/pipeline.ts`, `arag.extractedText(resourceId)`) and only its
length is kept (`meta.sourceChars`). Without the text, "jump to source" cannot be built at
all, and the product's central claim stays a promise. Two **NEW API** endpoints:

- `GET /api/v1/documents/{id}/text` → `200 { text: string, chars: integer, truncated: boolean }`.
  Query: `max_chars` (default 200000, max 2000000). Implementation: fetch from ARAG on demand
  via `arag.extractedText(resourceId)` and cache on the record, or persist `meta.sourceText`
  at pipeline time — persisting is preferred, because it makes evidence offsets stable even if
  the Knowledge Box resource is later reprocessed. `auth: "api"`.
- `GET /api/v1/documents/{id}/source` → `200` original bytes, `Content-Type` from
  `contentType`, `Content-Disposition: inline; filename="<sanitised>"`. Streams the file back
  from the ARAG resource. If the bytes cannot be retrieved, answer `404` with a problem
  document whose `detail` says the original file is no longer available — the UI then hides
  the `Original file` option and shows extracted text only (see §4.4). `auth: "api"`.

**Endpoints.** `GET /api/v1/documents/{id}`; **NEW API** `GET /api/v1/documents/{id}/text`;
**NEW API** `GET /api/v1/documents/{id}/source`.

---

### 3.6 Document detail — Pipeline tab — `/#/documents/:id/pipeline`

**Purpose.** Show what the seven stages did, how long each took, and what failed. Priya's
support-case screen; Sam's second opinion.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                          API docs   Admin   service · online                   │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Documents › contract.txt                                                        │
│     Document Processing  │  Helios Software LLC — Master Services Agreement   [ Export ▾ ] [ ⋯ ]            │
│                          │ ──────────────────────────────────────────────────────────────────────────       │
│▎ ▤ Documents          24 │  Record | Source & evidence | Pipeline | Ask | JSON                              │
│  ⚙ Configs            13 │ ──────────────────────────────────────────────────────────────────────────       │
│  ? Ask                   │  ◑ Degraded — the summary stage failed, the rest of the record is complete.      │
│  ◷ Jobs                1 │    summary: ARAG request timed out after 30000 ms       [ Reprocess ]            │
│  ⚒ Settings              │                                                                                  │
│                          │  Stage                                    Duration            Status             │
│  ────────────────────    │ ─────────────────────────────────────────────────────────────────────────        │
│  ● Knowledge Box online  │  ● process    OCR, layout, embeddings   ████████████  4 210 ms   ✓ Done          │
│  Built on Progress ARAG  │  ● classify   picked contract (97%)     █             318 ms     ✓ Done          │
│                          │  ● extract    contract_extraction        ████          1 502 ms   ✓ Done         │
│                          │  ● entities   9 entities                 ██             640 ms    ✓ Done         │
│                          │  ● summary    —                          ██████        30 001 ms  ⊘ Failed       │
│                          │  ● validate   1 issue raised             ▏               12 ms    ✓ Done         │
│                          │  ● standardize 8 fields, 8 quotes        ▏                4 ms    ✓ Done         │
│                          │ ─────────────────────────────────────────────────────────────────────────        │
│                          │  Total 36.7 s · Job 4f2c…a91  Copy id   · Started 12 Sep 2026, 09:38:04          │
│                          │                                                                                  │
│                          │  What each stage does                                              Hide ▴        │
│                          │  process      Progress Agentic RAG reads the file — OCR, visual layout           │
│                          │               and embeddings — and waits until it is searchable.                 │
│                          │  classify     An agent picks one of the eleven document types. Skipped           │
│                          │               when a config is forced on upload.                                 │
│                          │  extract      The type's stored ARAG search configuration runs, forcing          │
│                          │               the declared fields plus a verbatim quote for each.                │
│                          │  entities     People, organisations, dates, amounts and locations.               │
│                          │  summary      A plain-language summary and topic tags.                           │
│                          │  validate     Deterministic checks: amounts re-added, dates normalised,          │
│                          │               required fields confirmed. No model involved.                      │
│                          │  standardize  Everything is assembled into the canonical record and              │
│                          │               each quote is checked against the document's own text.             │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Data shown.** `meta.durationsMs` (bar width relative to the longest stage),
`meta.stageErrors`, the job's `events[]` (stage messages) fetched by `jobId`, `job.status`,
`job.createdAt`, `job.finishedAt`.

**Actions.** Reprocess; Copy job id; Open the job in Jobs; expand or collapse the glossary
(collapsed by default after the user's first visit, remembered in `localStorage`).

**Endpoints.** `GET /api/v1/documents/{id}`; `GET /api/v1/jobs/{id}`;
`GET /api/v1/jobs/{id}/events` while the document is `pending` or `processing`;
**NEW API** `POST /api/v1/documents/{id}/reprocess`.

---

### 3.7 Document detail — Ask tab — `/#/documents/:id/ask`

**Purpose.** Ask this one document a question and get an answer traced back to it.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                          API docs   Admin   service · online                   │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Documents › contract.txt                                                        │
│     Document Processing  │  Helios Software LLC — Master Services Agreement   [ Export ▾ ] [ ⋯ ]            │
│                          │ ──────────────────────────────────────────────────────────────────────────       │
│▎ ▤ Documents          24 │  Record | Source & evidence | Pipeline | Ask | JSON                              │
│  ⚙ Configs            13 │ ──────────────────────────────────────────────────────────────────────────       │
│  ? Ask                   │  Answers come from this document only. Nothing is remembered between             │
│  ◷ Jobs                1 │  visits — this conversation is not saved.                                        │
│  ⚒ Settings              │                                                                                  │
│                          │  Try: [ What is the termination notice period? ] [ Who are the parties? ]        │
│  ────────────────────    │       [ What is the governing law? ]  [ What is the total value? ]               │
│  ● Knowledge Box online  │                                                                                  │
│  Built on Progress ARAG  │                          ┌──────────────────────────────────────────┐            │
│                          │                          │ What is the termination notice period?   │            │
│                          │                          └──────────────────────────────────────────┘            │
│                          │  ┌──────────────────────────────────────────────────────┐                        │
│                          │  │ Either party may terminate for convenience on sixty   │                       │
│                          │  │ (60) days' written notice to the other party.         │                       │
│                          │  │                                                       │                       │
│                          │  │ ⟦ contract.txt ⟧   1 284 ms        Open in source ›   │                       │
│                          │  └──────────────────────────────────────────────────────┘                        │
│                          │                                                                                  │
│                          │  [ Ask a question about this document…                    ] [ Ask ]              │
│                          │  Answers are drawn from this document, not from the model's general              │
│                          │  knowledge. If it is not in the document, you will be told so.                   │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Data shown.** `answer`, `sources[]` (document titles today), `ms`. Suggested questions are
client-side, keyed by `docType` (four per type, written once in `public/app.js`).

**Endpoints.** `POST /api/v1/documents/{id}/ask`.

**Trust gap worth closing — NEW API (additive).** `AskResponse.sources` is a list of document
*titles*; with one document in the filter that is always the same single title, which is not a
citation a person can open. Extend `AskResponse` with an optional
`citations: [{ paragraphId: string, text: string, score?: number }]`, populated from the ARAG
`/ask` response the service already receives (`citations: true` is already requested in
`DocumentsService.ask`). The UI then renders `Open in source ›`, which jumps to
`/#/documents/:id/source?q=<quote>` with the paragraph highlighted — identical treatment to
field evidence, which is the point: one idea of "show me where", used everywhere. Until it
exists, the answer card shows the source title only and no jump link.



---

### 3.8 Configs — `/#/configs`

**Purpose.** Show what the product can read today, and make "a new document type" a five-minute
task rather than a project.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                          API docs   Admin   service · online                   │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Configs                                          [ + New config ]               │
│     Document Processing  │ ──────────────────────────────────────────────────────────────────────────       │
│                          │  [ 🔍 Search configs ]   [ All ▾ ]                     13 configs                 │
│  ▤ Documents          24 │                                                                                  │
│▎ ⚙ Configs            13 │  Custom (2)                                                                      │
│  ? Ask                   │  Name                   Fields  ARAG configuration   Documents  State            │
│  ◷ Jobs                1 │ ─────────────────────────────────────────────────────────────────────────        │
│  ⚒ Settings              │  Insurance Card              4  dip_custom_insura…          7  ✓ Ready  ⋯        │
│                          │  Freight Consignment         6  dip_custom_freight…         0  ▲ Not      ⋯      │
│  ────────────────────    │                                                             provisioned          │
│  ● Knowledge Box online  │                                                                                  │
│  Built on Progress ARAG  │  Built in (11)                                                                   │
│                          │  Invoice                    12  dip_invoice                14  ✓ Ready  ⋯        │
│                          │  Receipt                     8  dip_receipt                 2  ✓ Ready  ⋯        │
│                          │  Purchase order              8  dip_purchase_order          3  ✓ Ready  ⋯        │
│                          │  Contract                    8  dip_contract                1  ✓ Ready  ⋯        │
│                          │  Medical claim              13  dip_medical_claim           4  ✓ Ready  ⋯        │
│                          │  Pre-authorisation          14  dip_preauthorisation        1  ✓ Ready  ⋯        │
│                          │  Bank statement              8  dip_bank_statement          0  ✓ Ready  ⋯        │
│                          │  Résumé                      9  dip_resume                  0  ✓ Ready  ⋯        │
│                          │  Form                        5  dip_form                    0  ✓ Ready  ⋯        │
│                          │  Report                      5  dip_report                  0  ✓ Ready  ⋯        │
│                          │  Generic                     6  dip_generic                 0  ✓ Ready  ⋯        │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Data shown.** `ExtractionConfig.name`, `fields.length`, `aragConfig`, `provisioned`,
`builtin` — plus **NEW API** `documentCount` (number of documents whose `meta.config` is this
config). Without it the table cannot answer "is anything using this?", which is the question
that matters before a delete.

**Row actions.** Open; Use for an upload (opens the upload drawer with the config preselected);
Edit (custom only); Re-provision (when `provisioned` is false); Delete (custom only,
confirmation naming the config and the document count).

**Endpoints.** `GET /api/v1/extraction-configs`; `DELETE /api/v1/extraction-configs/{id}`;
**NEW API** `documentCount` on `ExtractionConfig`; **NEW API** `q`, `kind=builtin|custom`,
`sort` query params; **NEW API** `POST /api/v1/extraction-configs/{id}/provision` →
`200 ProvisionResult` (re-provision one config; today only the admin-only
`POST /api/v1/admin/provision` exists, which re-provisions all thirteen and is the wrong
granularity for an operator fixing one).

---

### 3.9 Config detail and field builder — `/#/configs/:id`, `/#/configs/new`

**Purpose.** Make the schema legible for a built-in, and editable for a custom one. This is the
"new document types stop being a project" promise made concrete.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                          API docs   Admin   service · online                   │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Configs › New config                                                            │
│     Document Processing  │  New extraction config                       [ Cancel ] [ Save config ]          │
│                          │ ──────────────────────────────────────────────────────────────────────────       │
│  ▤ Documents          24 │  Name                                 ┌ What saving does ────────────────┐       │
│▎ ⚙ Configs            13 │  [ Insurance Card              ]      │ Saving provisions a stored ARAG  │       │
│  ? Ask                   │                                       │ search configuration that pins   │       │
│  ◷ Jobs                1 │  Description (optional)               │ the model, full_resource         │       │
│  ⚒ Settings              │  [ Member-facing medical scheme  ]    │ grounding, the prompt and a JSON │       │
│                          │  [ card, front and back.        ]    │ schema built from these fields.  │        │
│  ────────────────────    │                                       │ Every document uploaded with     │       │
│  ● Knowledge Box online  │  Fields                               │ this config is then read the     │       │
│  Built on Progress ARAG  │ ───────────────────────────────────   │ same way.                        │       │
│                          │  Label            Type      Req.     │                                  │        │
│                          │  [Insurer      ] [text  ▾] [✓]  ✕    │ Fields become the machine keys   │        │
│                          │  [Member number] [text  ▾] [✓]  ✕    │ insurer, member_number,          │        │
│                          │  [Plan         ] [text  ▾] [ ]  ✕    │ plan, valid_to.                  │        │
│                          │  [Valid to     ] [text  ▾] [ ]  ✕    └──────────────────────────────────┘        │
│                          │  + Add field                         ┌ Tips ────────────────────────────┐        │
│                          │                                      │ Name fields as they appear on    │        │
│                          │  Describe each field (optional) ▾     │ the page. Capture amounts as     │       │
│                          │                                      │ text — they are parsed and       │        │
│                          │                                      │ checked afterwards.              │        │
│                          │                                      └──────────────────────────────────┘        │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

For an existing config the same screen is read-only for built-ins: name, description, the
stored ARAG configuration name, the field table with types and required markers, the document
count, and `Use for an upload` / `View documents using this config` actions. A custom config
adds `Edit`, `Re-provision` and `Delete`.

**Actions.** Add / remove / reorder fields (drag handle or Move up / Move down buttons —
keyboard-reachable, not drag-only); type select (`text`, `number/amount`, `list`); required
toggle; per-field description under a disclosure; Save.

**Validation.** Name required, 1–80 characters. At least one field with a label. 1–40 fields
(`ExtractionConfigCreate` limits). Duplicate labels warn but are allowed — the service
de-duplicates keys (`buildCustomSchema`). Errors appear beside the offending control and in a
summary above the actions; the save button is never disabled without a visible reason.

**Endpoints.** `GET /api/v1/extraction-configs/{id}`; `POST /api/v1/extraction-configs`;
`DELETE /api/v1/extraction-configs/{id}`; **NEW API** `PUT /api/v1/extraction-configs/{id}`
(replace `name`, `description`, `fields`; re-provision the ARAG search configuration; `409` on
a built-in; guarded by `requireWriter`). Without `PUT`, editing means delete-and-recreate,
which breaks `meta.config` on every document already processed with the old id.

---

### 3.10 Ask — `/#/ask`

**Purpose.** A first-class home for grounded Q&A, reachable without first finding the document
in a list. Alex's screen.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                          API docs   Admin   service · online                   │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Ask                                                                             │
│     Document Processing  │ ──────────────────────────────────────────────────────────────────────────       │
│                          │  Document                                                                        │
│  ▤ Documents          24 │  [ 🔍 contract.txt — Helios Software LLC, Master Services Agreement  ▾ ]          │
│  ⚙ Configs            13 │  Answers come from the selected document only. There is no cross-document        │
│▎ ? Ask                   │  search: each question is scoped to one file.                                    │
│  ◷ Jobs                1 │                                                                                  │
│  ⚒ Settings              │  Try: [ What is the termination notice period? ] [ Who are the parties? ]        │
│                          │       [ What is the governing law? ]  [ What is the total value? ]               │
│  ────────────────────    │                                                                                  │
│  ● Knowledge Box online  │                       ┌─────────────────────────────────────────────────┐        │
│  Built on Progress ARAG  │                       │ What is the termination notice period?          │        │
│                          │                       └─────────────────────────────────────────────────┘        │
│                          │  ┌───────────────────────────────────────────────────────────────┐               │
│                          │  │ Either party may terminate for convenience on sixty (60)       │              │
│                          │  │ days' written notice to the other party.                       │              │
│                          │  │ ⟦ contract.txt ⟧  1 284 ms                  Open in source ›   │              │
│                          │  └───────────────────────────────────────────────────────────────┘               │
│                          │                                                                                  │
│                          │  [ Ask a question about this document…                     ] [ Ask ]             │
│                          │  Not saved — this conversation disappears when you leave the page.               │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Document picker.** A combobox over ready documents, searched server-side with the new `q`
parameter, showing `filename — counterparty, identifier`. Preselected from `?doc=<id>`. Only
`ready` and `degraded` documents are selectable; `pending`, `processing` and `failed` appear
greyed with the reason.

**Endpoints.** `GET /api/v1/documents?status=ready&q=…&view=compact` (**NEW API** params);
`POST /api/v1/documents/{id}/ask`.

---

### 3.11 Jobs — `/#/jobs` (list) and `/#/jobs/:id` (drawer)

**Purpose.** See the work in flight, cancel what is stuck, and explain what happened to
something that failed.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                          API docs   Admin   service · online                   │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Jobs                                     ┌─────────────────────────────┐        │
│     Document Processing  │ ─────────────────────────────────────────│ Job 4f2c…a91             ✕  │         │
│                          │  [ All statuses ▾ ]      Auto-refresh │ ───────────────────────────── │          │
│  ▤ Documents          24 │                                          │ remittance.png              │         │
│  ⚙ Configs            13 │  Document        Status      Stage   Ela… │ ◐ Running · 00:34           │        │
│  ? Ask                   │ ─────────────────────────────────────────│                             │         │
│▎ ◷ Jobs                1 │  remittance.png  ◐ Running   extract  34s │ ● process    ✓  4 210 ms    │        │
│  ⚒ Settings              │  invoice-rev.txt ✓ Succeeded  —      6.1s │ ● classify   ✓    318 ms    │        │
│                          │  scan-0041.pdf   ⊘ Failed    process  31s │ ● extract    ◐ running      │        │
│  ────────────────────    │  contract.txt    ✓ Succeeded  —     36.7s │ ● entities   ○ waiting      │        │
│  ● Knowledge Box online  │  invoice.txt     ✓ Succeeded  —      5.4s │ ● summary    ○ waiting      │        │
│  Built on Progress ARAG  │  preauth-form…   ⊗ Cancelled extract 12s  │ ● validate   ○ waiting      │        │
│                          │                                          │ ● standardize ○ waiting     │         │
│                          │                          1–20 of 61  ‹ 1 │                             │         │
│                          │                                          │ Open document ›             │         │
│                          │                                          │ Raw JSON ▾                  │         │
│                          │                                          │ ───────────────────────────  │        │
│                          │                                          │        [ Cancel job ]       │         │
│                          │                                          └─────────────────────────────┘         │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Data shown.** `Job.ref` resolved to the document filename, `status`, `stage`, elapsed
(`finishedAt - createdAt`, or now), `createdAt`, `error.message` on failure. The drawer adds
the full event timeline (`<arag-job-timeline>`), the raw JSON behind a disclosure, and cancel.

**Live behaviour.** While any job is `queued` or `running`, the list subscribes to that job's
SSE stream (`GET /api/v1/jobs/{id}/events`) rather than polling. The "Auto-refresh" control is
a pause switch for demos and screenshots, not a poll interval.

**Endpoints.** `GET /api/v1/jobs`; `GET /api/v1/jobs/{id}`; `GET /api/v1/jobs/{id}/events`;
`DELETE /api/v1/jobs/{id}`. **NEW API** on `GET /api/v1/jobs`: `page`, `page_size` and a
paged response (`items` kept, plus `page`, `page_size`, `total`, `next_page`), `sort`
(`-created_at` default, `created_at`, `duration`, `status`), and `q` matched against the
document filename. Today the operation takes only `status`, `ref` and `limit`, so there is no
second page — a deployment that has run 200 documents shows 50 jobs and no way to reach the
rest.

---

### 3.12 Settings — `/#/settings/*`

**Purpose.** Answer, without an admin token: what is this connected to, what will it accept,
what does it look like, and where is the API.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                          API docs   Admin   service · online                   │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Settings                                                                        │
│     Document Processing  │ ──────────────────────────────────────────────────────────────────────────       │
│                          │  Connection | Extraction | Branding | API                                        │
│  ▤ Documents          24 │ ──────────────────────────────────────────────────────────────────────────       │
│  ⚙ Configs            13 │  ┌ Knowledge Box ───────────────────────────────────────────────────────┐        │
│  ? Ask                   │  │ ● Connected · 142 ms                              [ Test again ]     │        │
│  ◷ Jobs                1 │  │ Knowledge Box   3f9a…c21        Region      europe-1                 │        │
│▎ ⚒ Settings              │  │ Endpoint        https://europe-1.rag.progress.cloud                  │        │
│                          │  │ Mode            Live                                                 │        │
│  ────────────────────    │  └──────────────────────────────────────────────────────────────────────┘        │
│  ● Knowledge Box online  │  ┌ Processing ──────────────────────────────────────────────────────────┐        │
│  Built on Progress ARAG  │  │ Generative model    chatgpt-azure-4o-mini                            │        │
│                          │  │ Extract strategy    Visual extraction on for images and PDFs         │        │
│                          │  │ Grounding (mean)    0.91 across 24 records                           │        │
│                          │  └──────────────────────────────────────────────────────────────────────┘        │
│                          │  Changing any of these means changing the deployment's environment               │
│                          │  variables and restarting. Operators: Admin → Connection.                        │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

Four tabs:

| Tab | Shows | Endpoints |
| --- | --- | --- |
| Connection | Connection state and latency, Knowledge Box id (truncated), region, endpoint, live vs mock, generative model, extract strategy, mean grounding | `GET /readyz`; **NEW API** `GET /api/v1/settings` |
| Extraction | Default config for uploads (stored client-side), accepted file types with extensions, max upload size, max question length, the 7 pipeline stages with one line each, link to Configs | **NEW API** `GET /api/v1/settings` |
| Branding | The effective branding, with a live preview tile showing the brand band, sidebar and a button in the current colours; the `BRAND_*` variable name beside each value; a note that changes need a restart | `GET /api/v1/branding` |
| API | Usage counters for this workspace, links to Redoc (`/api/v1/docs`), Swagger (`/api/v1/swagger`) and the raw document (`/api/v1/openapi.json`), a short explanation of API keys / the session cookie / the admin token, and `Run the guided sample again` | **NEW API** `GET /api/v1/usage` |

**NEW API `GET /api/v1/settings`** — `auth: "api"`, secret-free, the operator-visible subset
of what `GET /api/v1/admin/config` already computes:

```json
{
  "version": "1.0.0",
  "mode": "live",
  "arag": { "ok": true, "ms": 142, "kbId": "3f9a…c21", "region": "europe-1",
            "baseUrl": "https://europe-1.rag.progress.cloud", "mock": false },
  "generativeModel": "chatgpt-azure-4o-mini",
  "extractStrategy": { "enabled": true, "label": "Visual extraction on for images and PDFs" },
  "upload": { "maxBytes": 26214400,
              "accepted": [ { "mime": "application/pdf", "extensions": [".pdf"] }, … ] },
  "ask": { "maxQuestionChars": 1200 },
  "features": { "agentConfig": true, "reprocess": true, "bulkDelete": true },
  "docs": { "redoc": "/api/v1/docs", "swagger": "/api/v1/swagger", "openapi": "/api/v1/openapi.json" }
}
```

The `kbId` is truncated server-side (first four and last three characters) — it is an
identifier an operator needs to recognise, not a secret to publish in full. `extractStrategy`
exposes a boolean and a label, never the strategy id, matching the existing `/readyz`
discipline.

**NEW API `GET /api/v1/usage`** — `auth: "api"`. The *workspace* numbers only: documents by
status, `degraded`, `needsReview`, jobs by status, mean grounding score, documents processed in
the last 24 hours and 7 days. Deliberately excludes uptime, ARAG call counts, error counts and
configuration — those stay behind `GET /api/v1/admin/usage`. The split is the honest one: the
operator sees their own work; the operator of the service sees the machine.

---

### 3.13 Admin — sign-in

**Purpose.** Look like the door to a different product, and say what to do when there is no key.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                       API docs   Open app   admin · signed in                  │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│                          │                                                                                  │
│                          │                    ┌────────────────────────────────────────┐                    │
│                          │                    │   ▙▚ Progress Agentic RAG              │                    │
│                          │                    │                                        │                    │
│                          │                    │   Document Processing — operations     │                    │
│                          │                    │                                        │                    │
│                          │                    │   Admin token                          │                    │
│                          │                    │   [ ••••••••••••••••••••••••  ]        │                    │
│                          │                    │                                        │                    │
│                          │                    │   [ Sign in ]                          │                    │
│                          │                    │                                        │                    │
│                          │                    │   The token is the ADMIN_TOKEN set for │                    │
│                          │                    │   this deployment. It is exchanged for │                    │
│                          │                    │   a cookie and never stored in the     │                    │
│                          │                    │   page.                                │                    │
│                          │                    │                                        │                    │
│                          │                    │   Open the app ›                       │                    │
│                          │                    └────────────────────────────────────────┘                    │
│                          │                                                                                  │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

The sidebar is not rendered before sign-in — a nav the visitor cannot use is noise. The
Progress wordmark (`arag-logo.svg`, grey/green, on the white card) is the only brand element,
replaced by `branding.logoUrl` when set.

Two distinct failures, two distinct messages: a wrong token gives `401` → *"That token was not
accepted."*; `ADMIN_TOKEN` unset gives `403` → *"Admin access is disabled for this deployment.
Set ADMIN_TOKEN and restart to enable it."* (the route already distinguishes them —
`src/routes/admin.ts`). The second is not a failure the visitor can fix by typing harder, and
must not be dressed as one.

**Endpoints.** `POST /api/v1/admin/login`; `GET /api/v1/admin/health` (the probe that decides
whether to show the app or the sign-in).

---

### 3.14 Admin — Overview — `/admin/#/overview`

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                       API docs   Open app   admin · signed in                  │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Overview                                        Refreshed 12 s ago  ⟳           │
│     Operations           │ ──────────────────────────────────────────────────────────────────────────       │
│                          │  ┌ Service ──┬ Knowledge ┬ Documents ┬ Jobs ─────┬ Grounding ┬ ARAG ────┐        │
│▎ ▤ Overview              │  │ ● Healthy │ ● 142 ms  │    24     │ 1 running │   0.91    │ 0 errors │        │
│  ⚡ Connection            │  │ v1.0.0    │ 3f9a…c21  │ 2 degrade │ 1 failed  │ 24 scored │ 318 calls│        │
│  ⚙ Configs               │  └───────────┴───────────┴───────────┴───────────┴───────────┴──────────┘        │
│  ◷ Jobs                  │                                                                                  │
│  ▤ Logs                  │  ┌ Needs attention ─────────────────────────────────────────────────────┐        │
│  ◫ Usage                 │  │ ⊘ scan-0041.pdf failed — Knowledge Box unreachable      1 h ago  ›   │        │
│  ✦ Branding              │  │ ◑ contract.txt degraded — summary stage timed out      2 h ago  ›   │         │
│  ⚿ Security              │  │ ▲ Freight Consignment config is not provisioned        Provision ›   │        │
│                          │  └──────────────────────────────────────────────────────────────────────┘        │
│  ────────────────────    │                                                                                  │
│  ● Live Knowledge Box    │  ┌ Configuration ───────────────┬ Recent activity ──────────────────────┐        │
│  Built on Progress ARAG  │  │ Extract strategy  visual     │ 09:41  document.created invoice-rev…  │        │
│                          │  │ Model  chatgpt-azure-4o-mini │ 09:41  job.succeeded 4f2c…a91         │        │
│                          │  │ Data dir   /data             │ 09:38  arag.request 200 /ask  318 ms  │        │
│                          │  │ Uptime     4 h 12 min        │ 08:57  job.failed  scan-0041.pdf      │        │
│                          │  └──────────────────────────────┴───────────────────────────────────────┘        │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Regions.** Six-tile stat strip; a "Needs attention" list (failed documents, degraded
documents, unprovisioned configs) where every row is a link to the thing that needs doing; the
effective configuration summary; the last ten log lines.

**Endpoints.** `GET /api/v1/admin/health`; `GET /api/v1/admin/usage`;
`GET /api/v1/admin/logs?limit=10`; `GET /api/v1/documents?degraded=true&view=compact`
(**NEW API** params); `GET /api/v1/extraction-configs`.

---

### 3.15 Admin — Connection — `/admin/#/connection`

**Purpose.** Prove the deployment is talking to the Knowledge Box the operator thinks it is,
and show what the extraction agents actually run against.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                       API docs   Open app   admin · signed in                  │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Connection                                          [ Test connection ]         │
│     Operations           │ ──────────────────────────────────────────────────────────────────────────       │
│                          │  ● Connected · 142 ms · last tested 12 Sep 2026, 09:52                           │
│  ▤ Overview              │                                                                                  │
│▎ ⚡ Connection            │  Knowledge Box   3f9a…c21     Region    europe-1                                 │
│  ⚙ Configs               │  Endpoint        https://europe-1.rag.progress.cloud                             │
│  ◷ Jobs                  │  Resources       1 284        Mode      Live (ARAG_MOCK unset)                   │
│  ▤ Logs                  │  Model           chatgpt-azure-4o-mini    Reranker  default                      │
│  ◫ Usage                 │  Extract strat.  visual-llm-extract       Timeout   30 000 ms                    │
│  ✦ Branding              │                                                                                  │
│  ⚿ Security              │  Stored ARAG search configurations (13)        [ Re-provision all ]              │
│                          │ ─────────────────────────────────────────────────────────────────────────        │
│  ────────────────────    │  Name                  Kind   Model                 Strategy      State          │
│  ● Live Knowledge Box    │  dip_invoice           ask    chatgpt-azure-4o-mini full_resource ✓   ›          │
│  Built on Progress ARAG  │  dip_medical_claim     ask    chatgpt-azure-4o-mini full_resource ✓   ›          │
│                          │  dip_custom_freight…   ask    —                     —             ▲   ›          │
│                          │                                                                                  │
│                          │  Not created by this product (2): kb_default_ask, analytics_v2                   │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

Opening a row shows a drawer with the full stored configuration — prompt, `answer_json_schema`,
model, RAG strategy — in `<arag-json>`. This is the screen that answers "what is the model
actually being told?" without opening the ARAG dashboard.

**Endpoints.** `GET /api/v1/admin/health`; `GET /api/v1/admin/config`;
`GET /api/v1/admin/search-configurations`; `POST /api/v1/admin/provision`. **NEW API**:
`GET /api/v1/admin/search-configurations?name=dip_invoice` (filter to one, so the drawer does
not refetch every configuration in the Knowledge Box to show one).

---

### 3.16 Admin — Configs, Jobs, Logs, Usage

These three are the same pattern as their operator counterparts with operator powers added; the
wireframes are compact because the layout is identical to §3.8 and §3.11.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                       API docs   Open app   admin · signed in                  │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Logs                                  [ Live tail ● on ]  [ Download ]          │
│     Operations           │ ──────────────────────────────────────────────────────────────────────────       │
│                          │  [ All levels ▾ ] [ 🔍 contains…        ]  [ Last 200 ▾ ]        624 lines        │
│  ▤ Overview              │ ─────────────────────────────────────────────────────────────────────────        │
│  ⚡ Connection            │  09:41:02  info   document.created   invoice-review.txt  4f2c…a91    ›           │
│  ⚙ Configs               │  09:41:08  info   job.succeeded      4f2c…a91  6 148 ms             ›            │
│  ◷ Jobs                  │  09:38:04  warn   arag.request       503 /ask  retry 1              ›            │
│▎ ▤ Logs                  │  08:57:31  error  job.failed         scan-0041.pdf  KB unreachable  ›            │
│  ◫ Usage                 │ ─────────────────────────────────────────────────────────────────────────        │
│  ✦ Branding              │  Older ▾                                                                         │
│  ⚿ Security              │                                                                                  │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

- **Admin → Configs** — the operator table from §3.8 plus `Re-provision all`, `Re-provision`
  per row, and a drawer showing the stored ARAG search configuration. Destructive deletes are
  confirmed with the document count.
- **Admin → Jobs** — the list from §3.11 across all jobs with a `kind` filter, a date range, and
  cancel available on every queued or running job.
- **Admin → Logs** — a real table, not a black terminal pane: timestamp, level chip, message,
  and the structured fields expanded in a drawer. Live tail is a toggle (the current
  `<arag-log refresh="5000">` polls unconditionally, which makes the screen unreadable while
  reading). `Download` saves the current filtered view as NDJSON, client-side.
  **NEW API**: `GET /api/v1/admin/logs` gains `before` (ISO timestamp cursor) so `Older ▾`
  can page backwards beyond the 500-record ceiling.
- **Admin → Usage** — the counters from `GET /api/v1/admin/usage` as a stat strip plus a
  documents-per-day bar chart for the last 14 days, derived client-side from
  `GET /api/v1/documents?view=compact&page_size=200` (no new state required). A sparkline of
  ARAG calls over time is **not** proposed: the counters are cumulative since boot and there is
  no time series to draw, and inventing one would be a chart that lies.

---

### 3.17 Admin — Branding — `/admin/#/branding`

**Purpose.** Close the D-25 gap the marketing JSON admits to: *"the admin view of the effective
branding that D-25 also calls for is not built yet."*

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                       API docs   Open app   admin · signed in                  │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Branding                                                                        │
│     Operations           │ ──────────────────────────────────────────────────────────────────────────       │
│                          │  Effective values                      ┌ Preview ─────────────────────┐          │
│  ▤ Overview              │  Product name     Document Processing  │ ▌Progress Agentic RAG        │          │
│  ⚡ Connection            │    BRAND_PRODUCT_NAME                  │ ──────────────────────────── │          │
│  ⚙ Configs               │  Tagline          Documents in,        │ ▙▚  Document Processing      │          │
│  ◷ Jobs                  │    BRAND_TAGLINE  validated records out │ Documents in, validated…     │         │
│  ▤ Logs                  │  Logo             (default wordmark)    │                              │         │
│  ◫ Usage                 │    BRAND_LOGO_URL                       │ [ Primary ] [ Secondary ]    │         │
│▎ ✦ Branding              │  Primary colour   #2b2bb2  ██          │ ● Ready  ▲ Warning  ⊘ Failed │          │
│  ⚿ Security              │    BRAND_PRIMARY_COLOR                  └──────────────────────────────┘         │
│                          │  Accent colour    #00b563  ██          Assets are read from                      │
│  ────────────────────    │    BRAND_ACCENT_COLOR                   /data/branding and served                │
│  ● Live Knowledge Box    │  Powered by       shown                 from /branding/.                         │
│  Built on Progress ARAG  │    BRAND_POWERED_BY                     Changes need a restart.                  │
│                          │  Footer           Open source · Apache-2.0                                       │
│                          │  Docs URL         /api/v1/docs      Support URL  —                               │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

Read-only by design: branding is environment configuration, and a form that appears to save but
cannot would be a lie. Each row names its `BRAND_*` variable so the operator knows exactly what
to change. The preview renders the real components with the real tokens — band, sidebar header,
both button variants and the three status chips — so a partner can see that their chosen colour
does not collide with the status palette before they deploy it.

**Endpoints.** `GET /api/v1/branding`; `GET /api/v1/admin/config` (`branding.effective` and
`branding.howToChange` already exist).

---

### 3.18 Admin — Security — `/admin/#/security`

**Purpose.** State what is protecting this deployment, and hold the destructive actions behind
one clearly-marked door.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG  ▪ ▪ ▪                       API docs   Open app   admin · signed in                  │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  ▙▚ Progress Agentic RAG │  Security                                                                        │
│     Operations           │ ──────────────────────────────────────────────────────────────────────────       │
│                          │  ┌ Credentials ─────────────────────────────────────────────────────────┐        │
│  ▤ Overview              │  │ API keys        2 configured   ·····a1b2   ·····9f04                │         │
│  ⚡ Connection            │  │ Admin token     set                                                  │        │
│  ⚙ Configs               │  │ Session cookie  12 h, SameSite=Lax, HttpOnly                         │        │
│  ◷ Jobs                  │  │ Writes always require a credential: deletes and config creation,     │        │
│  ▤ Logs                  │  │ even when API_KEYS is unset.                                         │        │
│  ◫ Usage                 │  └──────────────────────────────────────────────────────────────────────┘        │
│  ✦ Branding              │  ┌ Request protection ──────────────────────────────────────────────────┐        │
│▎ ⚿ Security              │  │ Rate limit   40 req/s, burst 80      CORS      same-origin only      │        │
│                          │  │ Max upload   25 MB                   Headers   CSP, HSTS, nosniff on  │       │
│  ────────────────────    │  └──────────────────────────────────────────────────────────────────────┘        │
│  ● Live Knowledge Box    │  ┌ Retention ───────────────────────────────────────────────────────────┐        │
│  Built on Progress ARAG  │  │ Delete documents older than [ 30 ] days                              │        │
│                          │  │ 4 documents would be deleted from the store and the Knowledge Box.    │       │
│                          │  │                                              [ Preview ] [ Purge ]   │        │
│                          │  └──────────────────────────────────────────────────────────────────────┘        │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Purge is the most destructive action in the product** and gets the full treatment: a
`Preview` that reports the exact count and the oldest and newest dates affected, then a
confirmation dialog listing the count again and requiring the word `DELETE` to be typed, then a
result panel listing what was deleted and what failed. Nothing is deleted by a single click.

**Endpoints.** `GET /api/v1/admin/config`; `POST /api/v1/admin/purge`. **NEW API**:
`POST /api/v1/admin/purge` gains `dryRun: boolean` → returns
`{ olderThanDays, wouldDelete: integer, oldest: date-time, newest: date-time, ids: string[] }`
and deletes nothing. Without it the confirmation dialog can only guess at the blast radius, and
a confirmation that cannot state the consequence is theatre.

**NEW API (small)**: `GET /api/v1/admin/security` → `{ apiKeys: { count, hints: ["…a1b2"] },
adminTokenSet, sessionTtlSec, cors, rateLimit: { rps, burst }, maxUploadBytes, headers:
{ csp, hsts, nosniff }, writesRequireCredential: true, retention: { defaultOlderThanDays } }`.
Every value is already known to `describeEnv` and the app options; this exposes them in one
shape rather than making the UI reverse-engineer `admin/config`. Creating and revoking API keys
is **out of scope**: `API_KEYS` is an environment variable with no store behind it, so a
create button would have nothing to write to. Say so on the screen — *"API keys are set with
the API_KEYS environment variable"* — rather than shipping a disabled button.

---

## 4. State inventory

Every surface must define five states: **loading**, **empty**, **partial / degraded**,
**error** and **ready**. A screen that only has "ready" is a prototype.

### 4.1 Document lifecycle

The API has four statuses; the product shows five, because `ready` covers two materially
different situations. `Degraded` is derived: `status === "ready" && meta.stageErrors?.length > 0`.

| State | Chip | What happened | What the user is told to do next | Available actions |
| --- | --- | --- | --- | --- |
| Queued | `◷ Queued` neutral | Uploaded; the job is waiting for a worker (concurrency is 2) | "Waiting to start. This usually takes a few seconds." | Cancel job |
| Processing | `◐ Processing` info, animated | A stage is running; the current stage is named | "Reading the document — <stage>." with elapsed time | Cancel job, watch the pipeline |
| Ready | `● Ready` success | All seven stages completed | Nothing, unless issues or low grounding say otherwise | Everything |
| Degraded | `◑ Degraded` warning | Finished, but a stage failed; the record is missing that stage's output | "The <stage> stage failed, so this record has no <summary/entities>. The extracted fields are unaffected." | Reprocess, export, ask |
| Failed | `⊘ Failed` danger | The pipeline could not complete | The `error` message verbatim, plus one line of advice keyed to the failure class | Reprocess, delete, open the job |

**Failure classes and their advice** (matched on the error text the pipeline already produces):

| Class | Detection | Advice line |
| --- | --- | --- |
| Knowledge Box unreachable | `arag` network / timeout / 5xx | "The Knowledge Box did not respond. Check Settings → Connection, then reprocess." |
| Processing timed out | `waitProcessed` / `waitSearchable` exhausted | "Progress Agentic RAG did not finish reading this file in time. Large scans can need a second attempt." |
| Unsupported or corrupt file | 415, or zero extracted characters | "This file could not be read. Check it opens, and that it is one of the accepted types." |
| Upload too large | 413 | "This file is larger than the 25 MB limit for this deployment." |
| Cancelled | job `cancelled` | "Processing was cancelled. Reprocess to run it again." |
| Unknown | anything else | "Processing failed. The job's timeline shows which stage stopped." |

### 4.2 Per-screen states

| Screen | Loading | Empty (first run) | Empty (filtered) | Error |
| --- | --- | --- | --- | --- |
| Documents | 6 skeleton rows (`.dip-skeleton`), stat strip tiles show `—`, filters interactive | Redirect to `/#/welcome` | "No documents match these filters." + `Clear all filters` (secondary) — never the upload CTA, the user has documents | "Could not load documents." + `Try again`; the last good list stays on screen underneath rather than being wiped |
| Document detail | Header skeleton, trust strip skeleton, 5 field skeletons | n/a | n/a | 404 → "This document no longer exists. It may have been deleted or purged." + `Back to documents`. Other → retry |
| Source & evidence | Text pane skeleton | "No evidence was returned for this document." + what that means (§5.5) | n/a | `/text` 404 → fall back to "The source text is no longer available." and disable the jump links, keeping the quotes visible |
| Pipeline | Stage rows greyed, timings `—` | n/a | n/a | Job missing → "The job for this document is no longer stored." with the record's own `durationsMs` shown instead |
| Configs | 4 skeleton rows | Impossible — 11 built-ins always exist | "No configs match." + clear | Retry |
| Config detail | Field skeletons | n/a | n/a | 404 → "That config no longer exists." + back |
| Ask | Answer bubble shows an animated "Thinking…" bubble with the question already echoed | "Pick a document to ask about." | n/a | Answer bubble becomes an error alert with the message and `Try again`; the question stays in the input so it need not be retyped |
| Jobs | 5 skeleton rows | "No jobs yet. Upload a document to start one." | "No jobs match." | Retry, last good list retained |
| Settings | Value placeholders `—` | n/a | n/a | Per-card error alert; other cards still render |
| Admin (all) | As above | Per screen | Per screen | `401` anywhere → return to sign-in with "Your admin session expired. Sign in again." |

### 4.3 Loading rules

1. **Never a full-page spinner.** Layout renders immediately; only data regions show skeletons.
2. **Skeletons only above 300 ms.** Below that they flash; the region stays blank.
3. **Optimistic where it is safe.** An uploaded document appears in the list as `Queued`
   immediately from the `202` response, before any list refetch.
4. **Never block on a background poll.** A failed status poll degrades the connection pill; it
   does not interrupt the screen.

### 4.4 Partial and degraded states

| Situation | Surface | Treatment |
| --- | --- | --- |
| A stage failed (`meta.stageErrors`) | Document detail, Documents list, Pipeline | Warning banner naming the stage and what is missing; the affected panel (e.g. Summary) shows "Not produced — the summary stage failed." rather than an empty box |
| No evidence at all (`evidence: []`) | Trust strip | "No evidence returned" in place of a score, plus one line: "This record's fields are not backed by quotes. Treat every value as unchecked." Never show `0%` — a missing measurement and a measured zero are different facts |
| `groundingScore` absent (nothing extracted) | Trust strip | "No fields extracted" |
| Source text unavailable | Source tab | Quotes render, jump links disabled with a tooltip explaining why |
| Mock Knowledge Box | Every record header, Welcome, Settings | Persistent `Mock data` chip and the fixture explanation. Non-dismissible |
| Knowledge Box unreachable | Sidebar pill, Settings, Admin overview | Pill turns red with "Knowledge Box offline"; uploads are blocked at the drawer with the reason, rather than accepted and failed a minute later |

### 4.5 Error message pattern

> **What happened** (plain, past tense) · **why it matters or what is affected** (one clause)
> · **the action** (a button or link that actually recovers).

Errors never show a bare status code in the body copy; the code and `X-Request-Id` go in a
`Details ▾` disclosure, because Priya needs them and Dana does not. HTTP problem documents
already carry `title` and `detail` — use `detail` verbatim when it is human, and map to the
table above when it is not.

### 4.6 Destructive-action confirmations

| Action | Confirmation | Why |
| --- | --- | --- |
| Delete one document | Dialog naming the file: "Delete invoice-review.txt? This also deletes the resource from the Knowledge Box. This cannot be undone." | Deletes remote state |
| Delete a selection | Dialog stating the count and listing the first five filenames | Blast radius must be visible |
| Delete a custom config | Dialog naming the config and its `documentCount`: "7 documents were processed with this config. Their records are unaffected." | Reassurance is part of the confirmation |
| Purge by age | Two steps: preview (exact count and date range), then a dialog requiring the word `DELETE` typed | The only bulk irreversible action in the product |
| Cancel a job | No dialog — it is reversible by reprocessing, and a dialog on a running job wastes the moment it needs to be cancelled in | |

Confirmation dialogs put focus on **Cancel**, not the destructive button; the destructive button
is `.arag-btn.danger` and carries the verb, not "OK".

---

## 5. Trust surfaces

This is the wedge. Three separate signals arrive with every record — **confidence** (the
model's self-report), **verification** (our check of the quote against the document's own
extracted text), and **validation** (deterministic arithmetic and presence checks). They are
frequently confused, they mean different things, and the design's first job is to keep them
apart.

| Signal | Source | What it actually says | Failure mode if designed badly |
| --- | --- | --- | --- |
| Confidence | `ExtractedField.confidence` (model, heuristic when absent) | "The model felt sure" | Reads as proof. A confident hallucination scores 0.98 |
| Verification | `Evidence.verified` — `exact` \| `normalised` \| `unverified`, plus *no evidence at all* | "This quote does / does not appear in the document" | Buried in a tooltip, as it is today |
| Validation | `ValidationIssue` from `validateNormalize` | "The numbers do not add up / a required field is missing" | Rendered as a generic yellow box nobody reads |
| Grounding | `meta.groundingScore` — share of fields with a verified quote | "How much of this record is backed by the page" | A bare percentage with no denominator |

**The governing rule: verification outranks confidence, everywhere.** Where the two conflict —
high confidence, unverified quote — the field reads as a risk. Nothing in this UI may give a
confident-but-unverified value a green treatment.

### 5.1 The trust strip (`.dip-grounding`)

The first element of every document detail page, full width, above the fields.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Grounding  92%  ████████████████████░   11 of 12 fields carry a quote     │
│                                         found in this document.           │
│                                         10 exact · 1 near match · 1 none  │
│ ● Ready    Invoice · 97% classifier     ▲ 1 warning     6.1 s   What is   │
│                                                                 this? ⓘ   │
└───────────────────────────────────────────────────────────────────────────┘
```

Rules:

1. **Always show the denominator.** "92%" alone is a number; "11 of 12 fields carry a quote
   found in this document" is a claim someone can check. The sentence is the primary element;
   the percentage is the index.
2. **Three bands, worded not just coloured.** ≥ 85 % → *Strong* (`--arag-accent-500`);
   50–84 % → *Partial* (`--arag-warn-*`); < 50 % → *Weak* (`--arag-danger-*`). The band word
   appears in the tooltip and the `aria-label`; the bar is never the only carrier.
3. **Breakdown always visible**, not on hover: exact / near match / none. The live measurement
   the marketing material quotes — 10 exact, 1 normalised, 0 unverified — is exactly this line.
4. **`What is this? ⓘ`** opens a popover, not a paragraph on the page: *"Each extracted value is
   asked for with the sentence that supports it. We then look for that sentence in the text
   Progress Agentic RAG read from your document. Exact means we found it character for
   character; near match means we found it after ignoring case, spacing and punctuation; none
   means we did not find it, or the model returned no quote."*
5. **Absent is not zero.** No evidence → "No evidence returned"; no fields → "No fields
   extracted". Never `0%`.

### 5.2 The field row (`.dip-field`)

The atom of the record. One row carries value, provenance and doubt without becoming a wall.

```
┌ .dip-field ───────────────────────────────────────────────────────────────┐
│ Invoice date                                    ← .dip-field__label        │
│ 2026-08-03    raw “03/08/2026”                  ← __value + __raw          │
│ conf ████████░ 95%   ✓ Verified                 ← __conf + __verify        │
│ “Invoice Date: 03/08/2026”                 ↗    ← __evidence + jump        │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Label** — from `ExtractedField.label` (schema `labels`), sentence case.
- **Value** — the normalised value. Arrays render as a list, capped at five with "+ 3 more".
  `null`/empty renders as `Not found` in muted text, never as an empty cell.
- **Raw** — shown only when `raw !== String(value)`, because that difference *is* the
  normalisation the product claims to do: `$25,750.00` → `25750`, `03/08/2026` → `2026-08-03`.
  Hiding it hides the work.
- **Confidence** — a 60 px meter plus the number, in muted grey. Never green, never red:
  colouring confidence is what makes people read it as verification.
- **Verification chip** — the loud element. `✓ Verified` (accent-soft), `≈ Near match`
  (warn), `○ No quote returned` / `✗ Quote not found` (danger). Words, not just icons.
- **Evidence quote** — the quote, in quotation marks, italic, truncated at two lines with a
  disclosure. The matched span is `<mark>`-highlighted inside the quote when offsets exist.
- **Jump to source** `↗` — navigates to the Source tab with the offsets selected.
- **Unverified rows carry a 3 px danger left border** and are additionally surfaced in the
  "Check these first" group under the issues block.
- **A field with an `error`-severity issue carries the issue inline**, beneath the quote —
  the user should never have to correlate a banner at the top with a row at the bottom.

### 5.3 Validation issues

Rendered as `.arag-alert` with a severity mapping of `error` → `.error`, `warning` → `.warn`,
`info` → default. Two lines each: the message the service produced verbatim (they are precise
and specific — `subtotal (22500) + tax (2250) ≠ total (25750)`), then a written consequence
mapped by issue kind:

| Issue (from `validateNormalize`) | Consequence line |
| --- | --- |
| `subtotal + tax ≠ total` | "Check the printed total against the line items before posting." |
| `Required field "x" was not extracted` | "The schema requires this field. The document may not contain it, or it may be on a page that did not read cleanly." |
| `Could not parse amount "x"` | "The value is kept exactly as written and has not been converted to a number." |
| `Date "x" left as-is (not ISO-parseable)` | "The value is kept as written. Downstream systems expecting ISO dates will need to handle it." |
| Stage failure echoed into issues | "This part of the record is missing. Reprocess to try again." |

Every issue links to the field it names (`Go to field ›`), which focuses and briefly highlights
the row. Issues are counted in the list view as a chip with the maximum severity's colour.

### 5.4 Trust in the list

The Documents table carries a `Grounding` column and an `Issues` column, and the default sort
offers `Grounding: lowest first`. This is Dana's actual workflow from the marketing copy —
*"check the handful of values the system has flagged, instead of retyping every field"* — and it
only exists if the list can be ordered by doubt. The stat strip's "needs review" tile is the
same idea at the top of the page.

### 5.5 Honesty rules (non-negotiable)

1. No green tick anywhere on a field whose quote was not found.
2. No rounding that reaches 100 % unless every field matched exactly.
3. Never hide the unverified count behind a hover.
4. A `Mock Knowledge Box` chip appears on every record produced against the mock, in the list
   row and the detail header. Fixture output is never presented as extraction.
5. Grounding, confidence, validation and status colours are **never** overridden by white-label
   branding (§9.4). A partner may recolour their product; they may not recolour the evidence.
6. An answer from Ask with no citation is labelled "No source returned", not shown bare.

---

## 6. Onboarding and the guided sample path

### 6.1 First run

1. The app boots, fetches `GET /api/v1/branding`, `GET /readyz` and
   `GET /api/v1/documents?page_size=1`.
2. `total === 0` → `/#/welcome`. Otherwise → `/#/documents`.
3. Welcome offers exactly two doors (§3.1). No tour starts unasked; nothing is modal.
4. After the first document exists, `/#/welcome` is no longer the landing route, but stays
   reachable from Settings → API → `Run the guided sample again`, so the walkthrough can be
   replayed for a colleague or a recording.

### 6.2 The guided sample ("Try with a sample")

The tour is a **spotlight overlay over the real screens** (`.dip-tour`), never a mock. Each step
highlights one region, shows a step card with a sentence and `Back` / `Next` / `Skip tour`, and
advances on either the button or the user performing the action themselves. State lives in the
hash (`?tour=1&step=3`) so a step is directly linkable — which is what makes the showcase
recording reproducible.

Rules: at most 8 steps; every step describes something visible; `Esc` and `Skip tour` end it
immediately and it never restarts on its own; the overlay never covers the element it describes.

### 6.3 The exact click path (the showcase recording follows this)

The recording drops `showcase/fixtures/invoice-review.txt` — the invoice whose subtotal and tax
do not reconcile — so the validation and evidence surfaces have something real to show.

| # | Screen / route | Action | What is on screen | Screenshot |
| --- | --- | --- | --- | --- |
| 1 | `/#/welcome` | Land on first run | Headline, two cards, the mock-Knowledge-Box notice | `01-welcome.png` |
| 2 | `/#/welcome` | Click `Start the guided sample` | Tour step 1: "This is the queue. Everything you process lands here." | `02-tour-start.png` |
| 3 | `/#/documents` | Sample posts; row appears as `◷ Queued`, then `◐ Processing` with the stage name | The list with a live row; the stat strip counts up | `03-documents-processing.png` |
| 4 | `/#/documents` | Wait for `● Ready` | Row shows Invoice · 12 fields · 92 % · ▲ 1 | `04-documents-ready.png` |
| 5 | `/#/documents/:id` | Click the row | Trust strip (92 %, 11 of 12, 10 exact · 1 near · 1 none), the reconciliation warning, the field rows | `05-record.png` |
| 6 | `/#/documents/:id` | Expand the `Total` field's evidence | Quote `TOTAL DUE: $25,750.00` with the inline warning | `06-evidence-quote.png` |
| 7 | `/#/documents/:id/source` | Click `↗` on the `Invoice #` field | Source pane scrolled and highlighted at the quote; left rail sorted worst-first | `07-source-highlight.png` |
| 8 | `/#/documents/:id/pipeline` | Click the Pipeline tab | Seven stages with real timings and the totals line | `08-pipeline.png` |
| 9 | `/#/documents/:id` | Open `Export ▾`, choose CSV | The export menu open; a toast confirms the download | `09-export.png` |
| 10 | `/#/documents/:id/ask` | Ask "What is the total due and when?" | Answer with the source chip and latency | `10-ask.png` |
| 11 | `/#/configs/new` | Nav → Configs → `+ New config`; add `Insurer` and `Member number`; Save | The field builder, then the saved config listed as `✓ Ready` with its `dip_custom_*` name | `11-config-builder.png`, `12-config-saved.png` |
| 12 | `/#/settings/connection` | Nav → Settings | Connection card, model, extract strategy, mean grounding | `13-settings.png` |
| 13 | `/admin/#/overview` | Band → Admin → sign in | Stat strip, "Needs attention", recent activity | `14-admin-overview.png` |
| 14 | `/admin/#/connection` | Admin → Connection | The 13 stored ARAG search configurations, one drawer open showing the prompt and schema | `15-admin-connection.png` |
| 15 | `/api/v1/docs` | Band → API docs | Redoc | `16-api-docs.png` |

Narration stays as written in `showcase/SCRIPT.md`, with three changes: the opening beat now
describes a queue rather than a single-page demo; the evidence beat (steps 6–7) is new and is
the centre of the recording, not an aside; and the mock-Knowledge-Box caveat moves to step 3,
where the fixture output first appears.

---

## 7. Copy guidelines

### 7.1 Voice

Plain, specific, unhurried. The product's whole claim is that it shows rather than asserts, so
the copy asserts as little as possible. Rules:

1. **Sentence case everywhere** — navigation, buttons, table headers, chips, dialog titles.
   Never Title Case, never ALL CAPS except the `.arag-kpi .label` and `.arag-table th`
   micro-labels, where the kit already applies `text-transform: uppercase` at 0.72 rem.
2. **Say the noun.** "12 fields", "3 documents", "the Knowledge Box" — not "items", "records
   processed successfully", "your data".
3. **No exclamation marks. No emoji. No "wow" copy.** No "powerful", "seamless", "magic",
   "instantly", "effortlessly", "AI-powered".
4. **Numbers carry units and denominators.** "11 of 12 fields", "6.1 s", "25 MB", "142 ms".
5. **Second person for instructions, no person for states.** "Check the printed total" /
   "Processing failed" — not "We couldn't process your document".
6. **British English**: recognise, normalise, colour, behaviour, licence (noun) — except
   identifiers and API fields, which stay as the code spells them (`normalised` in
   `Evidence.verified` happens to agree; `standardize` is a stage name and stays).
7. **Never apologise for the product's design.** "Not available in this deployment" beats
   "Sorry, we don't support that yet".
8. **One sentence beats a paragraph. A label beats a sentence.**

### 7.2 Vocabulary — the words this product uses, and the ones it does not

| Use | Never | Why |
| --- | --- | --- |
| Document | File, asset, item | The user's word |
| Record | Result, output, payload | It is the canonical record |
| Field | Attribute, key-value, datapoint | Matches the API |
| Evidence / quote | Citation, reference, snippet | "Citation" means the ARAG feature that is unavailable with `answer_json_schema` |
| Verified / near match / no quote | Confidence (for verification), validated | Three different things (§5) |
| Grounding | Accuracy, confidence score, trust score | It measures quote coverage, nothing more |
| Issue | Error (for validation), problem | `error` is reserved for HTTP and pipeline failures |
| Extraction config | Template, model, profile | Matches `extraction-configs` |
| Knowledge Box | Index, database, vector store | The ARAG term |
| Job / stage | Task, step, workflow | Matches the API |
| Reprocess | Retry, re-run, refresh | One verb, used everywhere |

### 7.3 Exact strings

**Navigation**

| Element | Operator | Admin |
| --- | --- | --- |
| 1 | `Documents` | `Overview` |
| 2 | `Configs` | `Connection` |
| 3 | `Ask` | `Configs` |
| 4 | `Jobs` | `Jobs` |
| 5 | `Settings` | `Logs` |
| 6 | — | `Usage` |
| 7 | — | `Branding` |
| 8 | — | `Security` |
| Band | `API docs`, `Admin` | `API docs`, `Open app` |
| Sidebar foot | `Knowledge Box online` / `Knowledge Box offline` / `Mock Knowledge Box` | same |

**Status chips**

| Object | Chip text | Class |
| --- | --- | --- |
| Document | `Queued` | `.arag-chip.neutral` |
| Document | `Processing` | `.arag-chip.info` |
| Document | `Ready` | `.arag-chip.ok` |
| Document | `Degraded` | `.arag-chip.warn` |
| Document | `Failed` | `.arag-chip.danger` |
| Job | `Queued` / `Running` / `Succeeded` / `Failed` / `Cancelled` | neutral / info / ok / danger / warn |
| Config | `Ready` / `Not provisioned` | ok / warn |
| Evidence | `Verified` / `Near match` / `No quote returned` / `Quote not found` | ok / warn / danger / danger |
| Deployment | `Mock data` | warn |
| Grounding band | `Strong` / `Partial` / `Weak` | ok / warn / danger |

**Buttons** (sentence case, verb first, no trailing punctuation)

`Upload document` · `Upload 2` · `Start the guided sample` · `Try again` · `Reprocess` ·
`Cancel job` · `Delete` · `Delete document` · `Delete 2 documents` · `Export` · `Export CSV` ·
`Ask` · `New config` · `Save config` · `Add field` · `Re-provision` · `Re-provision all` ·
`Test connection` · `Preview` · `Purge` · `Sign in` · `Clear all filters` · `Show all fields` ·
`Open in source` · `Back to documents` · `Skip tour` · `Next` · `Back`

**Empty states**

| Where | Title | Body | Action |
| --- | --- | --- | --- |
| Documents, first run | `Read every document the first time` | `Drop in a document and get back a checked, structured record — with the sentence from the page behind every value.` | `Start the guided sample` / `Upload a document` |
| Documents, filtered | `No documents match these filters` | `Try a wider date range, or a different status.` | `Clear all filters` |
| Jobs, first run | `No jobs yet` | `Every upload starts a job. Its seven stages appear here while it runs.` | `Upload document` |
| Jobs, filtered | `No jobs match these filters` | — | `Clear all filters` |
| Configs, filtered | `No configs match` | — | `Clear all filters` |
| Ask, no document | `Pick a document to ask about` | `Answers come from one document at a time.` | — |
| Evidence, none | `No evidence was returned` | `The extraction returned no supporting quotes, so nothing could be checked against the document. Treat every value as unchecked.` | `Reprocess` |
| Entities, none | `No entities surfaced` | — | — |
| Fields, none | `No fields were extracted` | `Nothing matched this schema. Try a different extraction config.` | `Reprocess with another config` |
| Logs, filtered | `No log lines match` | — | `Clear filters` |

**Error messages** (pattern: what happened · what it affects · what to do)

| Situation | String |
| --- | --- |
| Upload rejected, type | `That file type is not accepted. This deployment reads PDF, PNG, JPEG, TIFF, DOCX, TXT, CSV and Markdown.` |
| Upload rejected, size | `That file is larger than the 25 MB limit for this deployment.` |
| Upload failed, network | `The upload did not reach the service. Check your connection and try again.` |
| List failed | `Could not load documents. The service did not respond.` + `Try again` |
| Document gone | `This document no longer exists. It may have been deleted or purged.` + `Back to documents` |
| Ask failed | `That question could not be answered. The Knowledge Box did not respond.` + `Try again` |
| Config save failed | `Could not save the config. <detail>` |
| Config delete blocked | `Built-in configs cannot be deleted.` |
| Cancel too late | `That job already finished, so it cannot be cancelled.` |
| Admin 401 | `That token was not accepted.` |
| Admin 403 | `Admin access is disabled for this deployment. Set ADMIN_TOKEN and restart to enable it.` |
| Session expired | `Your admin session expired. Sign in again.` |
| Knowledge Box down | `The Knowledge Box is not responding. Uploads are paused until it recovers.` |

**Tooltips and helper lines**

- Grounding: `Share of extracted fields backed by a quote found in this document.`
- Confidence: `How sure the model was of this value. It is not a check against the document.`
- Near match: `Found after ignoring case, spacing and punctuation.`
- Mock: `This deployment is running the mock Knowledge Box. Extraction comes from deterministic fixtures, not from a model reading the page.`
- Forced config: `Auto-classification was skipped — this config was chosen on upload.`

---

## 8. Visual system

Everything is built from `vendor/arag-platform/ui/arag-ui.css` tokens. `public/ui-ext.css`
defines no new colours — only new components, expressed in existing custom properties, plus the
five layout variables in §8.2. This is what keeps white-label working (§9.4).

### 8.1 Type scale

The kit's `--arag-font-display` (headings) and `--arag-font-text` (everything else), 14 px root.

| Role | Size | Weight | Where |
| --- | --- | --- | --- |
| Page title | 1.6 rem / 1.2 | 600 | `h1` in the page header |
| Section title | 1.2 rem / 1.2 | 600 | Card heads, drawer titles |
| Subsection | 1 rem | 600 | `h3`, field group headings |
| Body | 0.875 rem / 1.5 | 400 | Default |
| Table cell | 0.86 rem | 400 | `.arag-table` |
| Secondary / helper | 0.8 rem | 400 | `.small`, row sublines |
| Micro label | 0.72 rem, 0.05 em tracking, uppercase | 600 | `th`, `.arag-kpi .label` |
| Stat value | 1.9 rem | 600 | `.arag-kpi .value` |
| Mono | 0.85 em of context | 400 | Ids, ARAG configuration names, offsets, JSON |

Line length is capped at 72 characters for any explanatory paragraph (`max-width: 68ch`).
Numbers in tables use `font-variant-numeric: tabular-nums` (the kit's `.num` already does).

### 8.2 Spacing rhythm

A 4 px base, used as 4 / 8 / 12 / 16 / 24 / 32 / 48. Layout constants, declared once in
`ui-ext.css`:

```css
:root {
  --dip-sidebar-w: 232px;
  --dip-content-max: 1208px;
  --dip-gutter: 24px;
  --dip-row-h: 44px;      /* two-line table row: 44px; single-line: 36px */
  --dip-drawer-w: 480px;  /* 560px for the job drawer */
}
```

Vertical rhythm: 24 px between page-level regions, 16 px between cards, 12 px inside a card,
8 px between a label and its control, 4 px between a value and its caption.

### 8.3 Colour rules

| Token | Used for | Never used for |
| --- | --- | --- |
| `--arag-ink-950` | Brand band, log pane, toasts | Body text |
| `--arag-brand-600/700` | Primary buttons, links, active nav, focus, selection | Status, grounding |
| `--arag-brand-50` | Hover fills, table zebra, code backgrounds | Anything load-bearing |
| `--arag-accent-500 / -soft / -fg` | Ready, verified, succeeded, strong grounding | Primary actions |
| `--arag-warn-*` | Degraded, near match, partial grounding, warnings | Information |
| `--arag-danger-*` | Failed, unverified, errors, destructive buttons | Emphasis |
| `--arag-info-*` | Processing, neutral information | Success |
| `--arag-text-muted / -subtle` | Captions, raw values, confidence meters | Values a decision rests on |

**Progress green `#5ce500`.** It is a brand colour, not a UI colour: on white it is 1.6:1
against the background, far below any text threshold, and it reads as "success" to a user who
sees it on a row. It is allowed in exactly two places:

1. **Inside the wordmark artwork** — `arag-logo.svg` (grey/green, light surfaces: sidebar
   header, sign-in card) and `arag-logo-alt.svg` (white/green, dark surfaces: the ink-950 brand
   band). The SVGs are used unmodified.
2. **As a 2 px accent rule at the bottom of the brand band**, `border-bottom: 2px solid #5ce500`
   — a brand signature on a dark surface where its contrast is adequate and it carries no
   meaning.

It is forbidden as: text colour, icon colour, status colour, chart colour, button background,
focus ring, chip background, link colour, or any indication of success. Status green stays
`--arag-accent-500` / `--arag-accent-fg`, which is what the kit's contrast is built around.

### 8.4 Iconography

Inline SVG only. No icon font, no emoji, no image sprites (the current UI's `⤓`, `🖼`, `📄`, `✕`
all go).

- 16 × 16 viewBox for inline and table use; 20 × 20 for nav; 24 × 24 for empty states.
- `stroke="currentColor"`, `stroke-width="1.5"`, `fill="none"`,
  `stroke-linecap="round"`, `stroke-linejoin="round"`.
- Never the only label on an interactive control: either visible text, or `aria-label` plus a
  `title`.
- `aria-hidden="true"` on decorative icons.
- The set (17, defined once in `public/icons.js` as a `name → path` map): `document`, `upload`,
  `search`, `filter`, `sort`, `chevron-down`, `chevron-right`, `check`, `alert-triangle`,
  `x-circle`, `quote`, `external-link`, `download`, `trash`, `refresh`, `settings`, `clock`.

### 8.5 Density and elevation

One density. Table rows are 44 px (two-line) or 36 px (single-line), 10 px horizontal cell
padding as the kit sets. Cards use `--arag-shadow` and a 1 px border; drawers use the same
shadow with a stronger scrim; nothing else is elevated. No nested cards — a card inside a card
means the layout is wrong.

### 8.6 Responsive behaviour

| Breakpoint | Behaviour |
| --- | --- |
| ≥ 1280 px | Full layout. Detail screens split 7fr / 5fr. Source tab splits 360 px / fluid |
| 1024–1280 px | Content column fills; detail splits 6fr / 6fr; stat strip stays 4-up |
| 900–1024 px | Detail becomes one column: trust strip, issues, fields, then the inspector cards stacked beneath. Stat strip 2 × 2. Source tab stacks: evidence rail above, source pane below |
| ≤ 900 px | Sidebar collapses to a 56 px top bar with a menu button opening the nav as a left drawer; the brand band collapses to the wordmark only; tables drop the `Config` and `Fields` columns; drawers become 100 % width minus 32 px |
| ≤ 600 px | Tables become card lists (`.dip-datatable--cards`): each row renders as a stacked block with the filename as the heading and label/value pairs beneath; filters collapse behind a `Filters (2)` button opening a sheet; the stat strip scrolls horizontally; the page header's primary action becomes full width |

Nothing is hidden at any breakpoint without an equivalent path to it. `prefers-reduced-motion`
disables the pulsing status dot, the stage spinner and all transitions.

---

## 9. Component list mapped to the UI kit

### 9.1 Reused as-is from `arag-ui.css`

| Component | Class / element | Used on |
| --- | --- | --- |
| Brand band | `.arag-band` | Both apps' shell |
| Card | `.arag-card`, `> .head`, `> .body`, `.pad` | Everywhere |
| KPI tile | `.arag-kpi` | Stat strips |
| Buttons | `.arag-btn` + `.secondary` `.ghost` `.danger` `.sm` `.lg` | Everywhere |
| Form controls | `.arag-field`, `.arag-label`, `.arag-input`, `.arag-select`, `.arag-textarea`, `.arag-help`, `.arag-switch` | Filters, builder, settings |
| Chips | `.arag-chip` + `.ok` `.warn` `.danger` `.info` `.neutral` `.outline` | Status, verification, tags |
| Status pill | `.arag-status[data-state]` | Sidebar foot, connection |
| Table base | `.arag-table`, `.num` | Extended by `.dip-datatable` |
| Key/value list | `.arag-kv` | Inspector cards, settings |
| Stepper | `.arag-steps` + `.active` `.ok` `.error` `.skip` | Pipeline, job drawer |
| Dropzone | `.arag-dropzone` + `.drag` | Upload drawer |
| Alert | `.arag-alert` + `.ok` `.warn` `.error` | Issues, banners |
| Toast | `.arag-toast` | Confirmations |
| Modal | `.arag-modal`, `.arag-modal-backdrop` | Base for `.dip-confirm` |
| JSON / log viewers | `.arag-json`, `.arag-log` | Admin, JSON tab |
| Chat | `.arag-chat`, `.arag-bubble`, `.arag-cite` | Ask |
| Progress | `.arag-progress` | Upload progress, grounding bar base |
| Tabs | `.arag-tabs` | Base for `.dip-tabs` |
| Layout | `.arag-grid` (`cols-2/3/4`, `split`), `.arag-row`, `.arag-stack`, `.arag-divider` | Everywhere |
| Utilities | `.muted`, `.subtle`, `.small`, `.mono`, `.sr-only` | Everywhere |
| Web components | `<arag-status>`, `<arag-json>`, `<arag-log>`, `<arag-health>`, `<arag-job-timeline>` | Admin, pipeline |

`<arag-shell>` is **not** used: it renders a centred `.arag-container` with a horizontal nav,
which is the single-page layout this pass replaces. The band, header behaviour and
`applyBranding()` hook are reproduced by `.dip-app` (below), which must call the kit's exported
`applyBranding` so branding continues to work identically.

### 9.2 New components — `public/ui-ext.css`

All prefixed `.dip-`. Each is defined with the markup the implementation should produce and the
behaviour the CSS must supply. None introduces a colour that is not an existing token.

**1. App shell — `.dip-app`, `.dip-sidebar`, `.dip-sidenav`, `.dip-content`**

```html
<div class="dip-app">
  <div class="arag-band">…wordmark + band actions…</div>
  <div class="dip-app__body">
    <aside class="dip-sidebar">
      <a class="dip-brandmark" href="#/documents"><img src="/brand/arag-logo.svg" alt="Progress Agentic RAG"><span>Document Processing</span></a>
      <nav class="dip-sidenav" aria-label="Main">
        <a href="#/documents" aria-current="page"><svg …/>Documents<span class="dip-sidenav__badge">24</span></a>
        …
      </nav>
      <div class="dip-sidebar__foot"><arag-status endpoint="/readyz" label="Knowledge Box"></arag-status></div>
    </aside>
    <main class="dip-content" id="main">…</main>
  </div>
</div>
```

CSS: `.dip-app__body { display:grid; grid-template-columns: var(--dip-sidebar-w) minmax(0,1fr); min-height: calc(100vh - 44px) }`.
Sidebar: `position: sticky; top: 44px; height: calc(100vh - 44px); overflow:auto; background: var(--arag-surface-raised); border-right: 1px solid var(--arag-border); display:flex; flex-direction:column`.
Nav links: 36 px high, 8 px radius, 10 px gap, `color: var(--arag-text-muted)`; hover
`background: var(--arag-brand-50)`; `[aria-current="page"]` gets `background: var(--arag-brand-50); color: var(--arag-brand-600); font-weight:600` and a 3 px `--arag-brand-600` left bar via `::before`.
Badge: right-aligned, `.arag-chip.neutral` metrics, hidden when zero.
Content: `padding: 24px; max-width: calc(var(--dip-content-max) + 48px)`.
≤ 900 px: `grid-template-columns: 1fr`; sidebar becomes `position: fixed; transform: translateX(-100%)`, `.is-open` slides it in over a scrim.

**2. Page header — `.dip-pagehead`**

```html
<header class="dip-pagehead">
  <nav class="dip-breadcrumb" aria-label="Breadcrumb">…</nav>
  <div class="dip-pagehead__row"><h1>Documents</h1><div class="dip-pagehead__actions">…</div></div>
</header>
```
`display:flex; flex-direction:column; gap:4px; padding-bottom:16px; border-bottom:1px solid var(--arag-border); margin-bottom:16px`. The row is `display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap`.

**3. Breadcrumb — `.dip-breadcrumb`**

`<nav><ol><li><a>Documents</a></li><li aria-current="page">invoice-review.txt</li></ol></nav>`.
`ol` is a flex row, 0.8 rem, muted; separators are `::after { content: "›" }` on all but the
last; the current crumb is `color: var(--arag-text)` and not a link; long crumbs truncate with
`max-width: 40ch; text-overflow: ellipsis`.

**4. Tabs — `.dip-tabs`**

Anchor-based on top of `.arag-tabs`: `<div class="arag-tabs dip-tabs" role="tablist"><a role="tab" aria-selected="true" href="#/documents/ID">Record</a>…</div>`.
Adds: `a` inherits the kit's button styling (`background:none; border-bottom:2px solid transparent`), `overflow-x:auto; scrollbar-width:none` so tabs scroll on narrow screens, and `[aria-selected="true"]` keeps the kit's brand underline.

**5. Filter bar — `.dip-filterbar`**

```html
<div class="dip-filterbar">
  <div class="dip-search"><svg …/><input class="arag-input" type="search" placeholder="Search filename, type or value"></div>
  <select class="arag-select">…</select> …
  <span class="dip-filterbar__spacer"></span>
  <button class="arag-btn ghost sm dip-filterbar__clear">Clear all filters</button>
</div>
```
`display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:12px`. Selects are
`width:auto; min-width:140px`. `.dip-search` is `position:relative; flex:1 1 280px`; the icon is
absolutely positioned at 10 px with `pointer-events:none`, the input gets `padding-left:32px`.
`.dip-filterbar__clear` is `display:none` unless the bar has `.has-filters`. ≤ 600 px the whole
bar collapses behind a `Filters` button that opens a bottom sheet.

**6. Data table — `.dip-datatable`**

```html
<table class="arag-table dip-datatable dip-datatable--selectable">
  <caption class="sr-only">Documents, sorted by newest first</caption>
  <thead><tr>
    <th class="dip-datatable__check"><input type="checkbox" aria-label="Select all documents on this page"></th>
    <th aria-sort="none"><button type="button">File<svg class="dip-sortic"…/></button></th>
    …
  </tr></thead>
  <tbody><tr data-id="…" aria-selected="false">
    <td><input type="checkbox" aria-label="Select invoice-review.txt"></td>
    <td><a class="dip-datatable__primary" href="#/documents/…">invoice-review.txt</a>
        <span class="dip-datatable__sub">INV-2026-1188 · Globex Supply Co · 3 min ago</span></td>
    …
    <td class="dip-datatable__actions"><button class="dip-menu__trigger" aria-haspopup="menu">…</button></td>
  </tr></tbody>
</table>
```
CSS on top of `.arag-table`: sticky header (`thead th { position:sticky; top:0; z-index:2; background:var(--arag-surface-raised) }`);
`th button` is a full-width transparent button, left-aligned, inheriting the `th` micro-label
styling, with the sort glyph at 0 opacity until hover or `aria-sort != none`;
`tr[aria-selected="true"] td { background: var(--arag-brand-50) }`;
`.dip-datatable__primary` is 0.875 rem `--arag-text` 500; `__sub` is 0.78 rem `--arag-text-subtle`
on its own line; row min-height `var(--dip-row-h)`; the check and actions columns are
`width:1%; white-space:nowrap`; the whole row is clickable except in the check and actions cells
(implemented as a click handler that ignores those two `td`s — the anchor remains for keyboard
and middle-click).

**7. Bulk bar — `.dip-bulkbar`**

Sits in the table's footer row: `display:flex; gap:8px; align-items:center; padding:8px 10px;
background:var(--arag-brand-50); border-radius:var(--arag-radius)`; contains an
`aria-live="polite"` count, the action buttons and a `Clear selection` ghost button. Hidden
(`[hidden]`) when nothing is selected — it must not float over content, because a floating bar
hides the last row of the list it is acting on.

**8. Pagination — `.dip-pagination`**

`<nav class="dip-pagination" aria-label="Pagination"><span class="dip-pagination__count">1–20 of 24</span><button …>Previous</button><ol>…</ol><button …>Next</button><select class="arag-select">20/50/100 per page</select></nav>`.
`display:flex; justify-content:space-between; align-items:center; gap:12px; padding-top:12px`.
Page buttons are 28 × 28 with `aria-current="page"` on the active one; Previous/Next are
`.arag-btn.ghost.sm` and `disabled` at the ends.

**9. Drawer — `.dip-drawer`**

```html
<div class="dip-drawer__scrim" data-close></div>
<aside class="dip-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
  <header class="dip-drawer__head"><h2 id="drawer-title">Job 4f2c…a91</h2><button class="dip-drawer__close" aria-label="Close">…</button></header>
  <div class="dip-drawer__body">…</div>
  <footer class="dip-drawer__foot">…</footer>
</aside>
```
`position:fixed; inset:44px 0 0 auto; width:min(var(--dip-drawer-w), 100vw - 32px);
background:var(--arag-surface-raised); border-left:1px solid var(--arag-border);
box-shadow:var(--arag-shadow); display:flex; flex-direction:column; z-index:80;
transform:translateX(100%); transition:transform .18s ease` → `.is-open { transform:none }`
(no transition under `prefers-reduced-motion`). Scrim `position:fixed; inset:0;
background:rgba(0,18,60,.35); z-index:79`. Body scrolls; head and foot do not. Focus is trapped;
`Esc` closes; focus returns to the trigger.

**10. Confirm dialog — `.dip-confirm`**

Built on `.arag-modal-backdrop` / `.arag-modal` with `role="alertdialog" aria-modal="true"`,
`width:min(480px,100%)`, a `.dip-confirm__body` that names the object and states the
consequence, an optional `.dip-confirm__typed` input for purge-class actions (the confirm button
stays `disabled` until the input reads `DELETE`), and a footer whose buttons are ordered
`[ Cancel ] [ Delete document ]` with initial focus on Cancel.

**11. Empty state — `.dip-emptystate`**

```html
<div class="dip-emptystate"><svg class="dip-emptystate__icon" …/><h2>No documents match these filters</h2>
<p>Try a wider date range, or a different status.</p>
<div class="dip-emptystate__actions"><button class="arag-btn secondary">Clear all filters</button></div></div>
```
`border:1px dashed var(--arag-border); border-radius:var(--arag-radius-lg); padding:48px 24px;
text-align:center; color:var(--arag-text-muted); max-width:520px; margin:24px auto`. The icon is
24 px, `--arag-text-subtle`. Richer than `.arag-empty`, which stays for single-line inline cases.

**12. Stat strip — `.dip-statstrip`**

`display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:0;
border:1px solid var(--arag-border); border-radius:var(--arag-radius-lg);
background:var(--arag-surface-raised); overflow:hidden` with
`> * + * { border-left:1px solid var(--arag-border) }`. Children are `.arag-kpi`, optionally
wrapped in an `<a>` that filters the list. ≤ 900 px it becomes two columns and the left borders
are reassigned with `:nth-child` rules; ≤ 600 px it scrolls horizontally with
`scroll-snap-type:x mandatory`.

**13. Field / evidence row — `.dip-field`** *(the trust component, §5.2)*

```html
<div class="dip-field" id="field-invoice_date" tabindex="-1">
  <div class="dip-field__label">Invoice date</div>
  <div class="dip-field__value">2026-08-03 <span class="dip-field__raw">raw “03/08/2026”</span></div>
  <div class="dip-field__meta">
    <span class="dip-field__conf" title="How sure the model was of this value">
      <span class="arag-progress"><i style="width:95%"></i></span> 95%</span>
    <span class="arag-chip ok dip-field__verify">Verified</span>
  </div>
  <details class="dip-field__evidence"><summary>Evidence</summary>
    <blockquote class="dip-quote">“Invoice Date: <mark>03/08/2026</mark>”</blockquote>
    <a class="dip-field__jump" href="#/documents/ID/source?ev=invoice_date">Open in source</a>
  </details>
</div>
```
CSS: `display:grid; grid-template-columns:1fr auto; gap:2px 12px; padding:12px 0;
border-bottom:1px solid var(--arag-brand-50)`. `__label` 0.78 rem 600 muted; `__value`
0.95 rem `--arag-text`; `__raw` 0.78 rem subtle, before it a `·` separator. `__conf` uses
`.arag-progress` at `width:60px;height:4px` and never takes a semantic colour.
`.dip-field--unverified { border-left:3px solid var(--arag-danger-fg); padding-left:10px;
margin-left:-13px }`. `.dip-field:target, .dip-field.is-highlighted { background:var(--arag-brand-50) }`
with a 1.2 s fade. `.dip-quote` is `font-style:italic; color:var(--arag-text-muted);
border-left:2px solid var(--arag-border); padding-left:10px; margin:6px 0` and `mark` uses
`background:var(--arag-warn-bg); color:inherit`.

**14. Grounding strip — `.dip-grounding`**

```html
<section class="dip-grounding" data-band="strong">
  <div class="dip-grounding__score"><span class="dip-grounding__pct">92%</span>
    <span class="arag-progress"><i style="width:92%"></i></span></div>
  <p class="dip-grounding__claim">11 of 12 fields carry a quote found in this document.</p>
  <p class="dip-grounding__breakdown">10 exact · 1 near match · 1 no quote</p>
  <div class="dip-grounding__facts">…status, type, issues, duration, What is this?…</div>
</section>
```
`border:1px solid var(--arag-border); border-radius:var(--arag-radius-lg); padding:16px;
background:var(--arag-surface-raised); display:grid; grid-template-columns:auto 1fr;
gap:4px 16px`. `[data-band="strong"] .arag-progress > i { background:var(--arag-accent-500) }`,
`partial` → `#e0ab00`, `weak` → `--arag-danger-fg`. `__pct` is 1.9 rem display weight 600.
States `data-band="none"` (no evidence) and `data-band="empty"` (no fields) replace the score
with the sentence and hide the bar.

**15. Source pane — `.dip-source`**

`.dip-source { display:grid; grid-template-columns:360px minmax(0,1fr); gap:16px }`;
`.dip-source__text { font: 0.82rem/1.6 var(--arag-font-mono); white-space:pre-wrap;
max-height:70vh; overflow:auto; padding:12px; border:1px solid var(--arag-border);
border-radius:var(--arag-radius); background:var(--arag-surface-raised) }`;
`mark.dip-hit { background:var(--arag-warn-bg) }`,
`mark.dip-hit.is-active { background:var(--arag-brand-100); outline:2px solid var(--arag-brand-500) }`.
Stacks to one column below 1024 px.

**16. Stage timing row — `.dip-timeline`**

Extends `.arag-steps` with a duration bar: `li { grid-template-columns:20px 1fr 120px 90px }`
where the third column holds `<span class="dip-timeline__bar"><i style="width:38%"></i></span>`
(`--arag-brand-200` fill, `--arag-danger-fg` on a failed stage) and the fourth the formatted
duration, right-aligned and tabular.

**17. Row-actions menu — `.dip-menu`**

`<div class="dip-menu"><button class="dip-menu__trigger" aria-haspopup="menu" aria-expanded="false" aria-label="Actions for invoice-review.txt">⋯</button><div class="dip-menu__list" role="menu" hidden>…<button role="menuitem">Export JSON</button>…</div></div>`.
`.dip-menu__list { position:absolute; right:0; min-width:180px; background:var(--arag-surface-raised);
border:1px solid var(--arag-border); border-radius:var(--arag-radius); box-shadow:var(--arag-shadow);
padding:4px; z-index:60 }`; items are 32 px, full width, left-aligned, hover `--arag-brand-50`;
a destructive item is `color:var(--arag-danger-fg)` and separated by a 1 px rule. Closes on
`Esc`, outside click and selection; arrow keys move between items.

**18. Skeleton — `.dip-skeleton`**

`background:linear-gradient(90deg,var(--arag-brand-50) 25%,var(--arag-surface) 37%,var(--arag-brand-50) 63%);
background-size:400% 100%; animation:dip-shimmer 1.4s ease infinite; border-radius:4px; height:12px`
with `.dip-skeleton--row { height:var(--dip-row-h) }`. No animation under
`prefers-reduced-motion`; `aria-hidden="true"` and the region carries `aria-busy="true"`.

**19. Field builder row — `.dip-fieldrow`**

`display:grid; grid-template-columns:1fr 140px auto auto auto; gap:8px; align-items:center;
padding:6px 0` — label input, type select, required checkbox with a visible label, move
up/down buttons, remove button. ≤ 600 px it becomes two rows with the controls wrapping.
Replaces the current `.cfg-field-row` in `public/app.css`.

**20. Tour overlay — `.dip-tour`**

`.dip-tour__scrim { position:fixed; inset:0; background:rgba(0,18,60,.45); z-index:85 }`;
the highlighted element gets `.dip-tour__target { position:relative; z-index:86;
box-shadow:0 0 0 4px var(--arag-brand-500), 0 0 0 9999px rgba(0,18,60,.45); border-radius:var(--arag-radius) }`
(one element, one shadow — no cut-out SVG needed); `.dip-tour__card` is an absolutely
positioned 320 px card with the step count, one sentence, and `Back` / `Next` / `Skip tour`,
flipped to the other side of the target when it would leave the viewport.

**21. Sign-in — `.dip-signin`**

`min-height:calc(100vh - 44px); display:grid; place-items:center; padding:24px` with a
`.arag-card.pad` at `width:min(420px,100%)`, the wordmark at 28 px above the title, and the
error alert reserved in the layout so its appearance does not shift the button.

**22. Brandmark — `.dip-brandmark`**

`display:flex; align-items:center; gap:10px; padding:16px; min-height:64px` with
`img { height:24px; max-width:180px; object-fit:contain; object-position:left center }` and
`span { font-family:var(--arag-font-display); font-weight:600; font-size:0.95rem;
overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:150px }`. The band
variant (`.arag-band .dip-brandmark img`) is 20 px high and uses `arag-logo-alt.svg`.

### 9.3 Summary table

| Component | Class | Status |
| --- | --- | --- |
| Sidebar app shell | `.dip-app`, `.dip-sidebar`, `.dip-sidenav`, `.dip-content` | **NEW** |
| Page header | `.dip-pagehead` | **NEW** |
| Breadcrumb | `.dip-breadcrumb` | **NEW** |
| Tabs | `.dip-tabs` on `.arag-tabs` | **NEW (extension)** |
| Filter bar + search | `.dip-filterbar`, `.dip-search` | **NEW** |
| Data table, sort + selection | `.dip-datatable` on `.arag-table` | **NEW (extension)** |
| Bulk action bar | `.dip-bulkbar` | **NEW** |
| Pagination | `.dip-pagination` | **NEW** |
| Drawer | `.dip-drawer` | **NEW** |
| Confirm dialog | `.dip-confirm` on `.arag-modal` | **NEW (extension)** |
| Empty state | `.dip-emptystate` | **NEW** |
| Stat strip | `.dip-statstrip` wrapping `.arag-kpi` | **NEW** |
| Field / evidence row | `.dip-field`, `.dip-quote` | **NEW** |
| Grounding strip | `.dip-grounding` | **NEW** |
| Source pane | `.dip-source`, `mark.dip-hit` | **NEW** |
| Stage timing row | `.dip-timeline` on `.arag-steps` | **NEW (extension)** |
| Row-actions menu | `.dip-menu` | **NEW** |
| Skeleton | `.dip-skeleton` | **NEW** |
| Field builder row | `.dip-fieldrow` | **NEW** |
| Tour overlay | `.dip-tour` | **NEW** |
| Sign-in | `.dip-signin` | **NEW** |
| Brandmark | `.dip-brandmark` | **NEW** |

Nineteen of these are general-purpose and belong in the platform kit eventually — the sidebar
shell, page header, breadcrumb, tabs, filter bar, data table, bulk bar, pagination, drawer,
confirm dialog, empty state, stat strip, menu, skeleton and tour are not specific to documents.
Report them to the Head as kit candidates; the four that are genuinely this product's
(`.dip-field`, `.dip-grounding`, `.dip-source`, `.dip-fieldrow`) stay local.

### 9.4 White-label degradation

`applyBranding()` (exported by `arag-ui.js`) already sets `--arag-brand-500/600/700` and
`--arag-accent-400/500` from `GET /api/v1/branding`. The rules that make the redesign survive it:

1. **Every new component references tokens only.** No hard-coded hex in `ui-ext.css` except
   the two `#5ce500` occurrences permitted by §8.3 — and both live on elements that are removed
   when `poweredBy === false`.
2. **Logo.** `branding.logoUrl` replaces the wordmark in the sidebar and on sign-in. The band
   keeps `arag-logo-alt.svg` while `poweredBy` is true; when it is false the band is removed
   entirely and the sidebar carries the partner mark alone. `img` is constrained to
   `height:24px; max-width:180px; object-fit:contain`, so any aspect ratio degrades to a legible
   mark rather than a stretched one. An `onerror` handler hides the image and shows
   `productName` as text — a broken logo must never leave the header empty.
3. **Product name** truncates at 150 px with an ellipsis and a `title`; the tagline is hidden
   below 1024 px.
4. **Colours.** A partner's `primaryColor` may be light. Buttons keep `color:#fff` as the kit
   sets; `ui-ext.css` adds nothing that depends on the brand colour being dark, and no text is
   ever placed on `--arag-brand-600` outside a `.arag-btn`. If the Head wants a guarantee,
   propose a `BRAND_PRIMARY_CONTRAST` variable (default `#ffffff`) exposed on the branding
   payload — a one-line addition to `readBranding` and `BrandingSchema`.
5. **Status, verification, grounding and validation colours are never branded.** They come from
   `--arag-accent-*`, `--arag-warn-*`, `--arag-danger-*` and `--arag-info-*`, which
   `applyBranding` does not touch, and must stay that way: a partner who sets their brand colour
   to red must not turn every "Ready" chip into a warning.
6. **Footer and docs link** follow `footerText` and `docsUrl`; `supportUrl`, when set, adds a
   `Support` link to the sidebar foot and to every error state's `Details ▾` disclosure.
7. **The API contract is not branded** — `openapi.ts` keeps its own title, as D-25 records.

---

## 10. Accessibility notes

**Landmarks and focus order.** One `<header>` (band), one `<nav aria-label="Main">` in the
sidebar, one `<main id="main">`, one `<footer>`. A `Skip to content` link is the first focusable
element, visually hidden until focused (`.sr-only` plus a `:focus` rule). Focus order follows
the DOM: band → sidebar nav → page header → content.

**Focus visibility.** Never remove outlines. The kit's `.arag :focus-visible { box-shadow:
var(--arag-focus) }` applies; new components must not set `overflow:hidden` on a container that
would clip that ring (the stat strip and the drawer head are the two at risk — they use
`outline-offset` instead).

**Navigation.** `aria-current="page"` on the active link, not just a class. Badges are inside
the link with their meaning in the accessible name: `Documents, 24 documents, 2 need review`.

**Data table.** A native `<table>` with `<caption class="sr-only">` naming the current sort and
filters. Sortable headers carry `aria-sort="ascending|descending|none"` on the `<th>` and a
`<button>` inside it (never a click handler on the `th`). The select-all checkbox is labelled
"Select all documents on this page" and uses `indeterminate` for a partial selection. Row
checkboxes are labelled by the filename. Selection changes are announced by the bulk bar's
`aria-live="polite"` region: "2 documents selected". Row click is a convenience; the first cell
always contains a real anchor so the row is reachable and openable by keyboard.

**Drawer.** `role="dialog" aria-modal="true"` labelled by its heading. On open, focus moves to
the heading (`tabindex="-1"`); focus is trapped; `Esc` closes; on close, focus returns to the
trigger. Background content gets `inert` where supported, `aria-hidden="true"` otherwise.
Because drawers are routes, closing also pops the hash — Back closes the drawer.

**Confirm dialog.** `role="alertdialog"`, labelled by the title and described by the body.
Initial focus on Cancel. `Esc` cancels. The destructive button is never the default action of a
form.

**Tabs.** `role="tablist"` with anchors as `role="tab"`, `aria-selected`, `aria-controls`, and a
single `tabindex="0"` on the selected tab (roving tabindex). Left/Right move between tabs, Home
and End jump to the ends, Enter or Space activates; each panel is `role="tabpanel"`
`tabindex="0"` `aria-labelledby` its tab. Because each tab is a route, they also work with
plain Back and Forward.

**Live regions.** One polite live region per screen for asynchronous status: upload accepted,
job finished ("invoice-review.txt is ready — 12 fields extracted"), bulk action completed,
connection lost. Toasts (`.arag-toast`) get `role="status"`; errors get `role="alert"`. Never
more than one assertive announcement at a time.

**Trust surfaces.** Verification state is carried in text, never colour alone. Confidence meters
have `role="img"` with `aria-label="Confidence 95 per cent"`. The grounding bar is
`role="img" aria-label="Grounding: strong, 11 of 12 fields carry a verified quote"`. `Open in
source` moves focus to the `<mark>` (`tabindex="-1"`) and announces "Showing the quote for
Invoice date in the source text".

**Forms.** Every control has a `<label>`; the field builder's type select and required checkbox
are labelled per row ("Type for field 2", "Required — Member number"). Errors use
`aria-describedby` and `aria-invalid`, appear beside the control, and are summarised above the
submit button with links to each offending field.

**Motion and contrast.** `prefers-reduced-motion: reduce` disables the shimmer, the drawer
slide, the stage spinner and the pulsing status dot. All text meets 4.5:1 and all non-text
indicators 3:1 against their background — which is why `#5ce500` is confined to the artwork
(§8.3). Nothing conveys meaning by colour alone anywhere in the product.

**Keyboard shortcuts** (documented in Settings → API, all skippable): `/` focuses the search
box, `u` opens the upload drawer, `Esc` closes any overlay, `g` then `d`/`c`/`a`/`j`/`s` jumps
to a nav section. None override a browser or screen-reader shortcut, and none are required to
complete any task.

---

## Appendix A — consolidated API work

Everything the IA needs that `src/openapi.ts` does not have today. Author each in the spec
first, then the route, then the service, then the contract test (STANDARDS §2). Ordered by
what blocks the most screens.

### A.1 Blocking — the product cannot be built without these

| # | Operation | Shape | Blocks |
| --- | --- | --- | --- |
| 1 | `GET /api/v1/documents` — new params | `q`, `sort`, `config`, `date_from`, `date_to`, `degraded`, `has_issues`, `min_grounding`, `view=compact\|full`, multi-valued `doc_type` | Documents list (§3.2), Ask picker (§3.10), Admin overview (§3.14) |
| 2 | `GET /api/v1/documents` — response | Add `facets: { status, docType, degraded, needsReview }`; `view=compact` returns `DocumentSummary` (`id, filename, contentType, bytes, status, docType, createdAt, updatedAt, jobId, fieldCount, issueCounts{info,warning,error}, groundingScore, degraded, headline{identifier,counterparty}`) | Stat strip, filter counts, list payload size |
| 3 | `GET /api/v1/documents/{id}/text` | `200 { text, chars, truncated }`, `?max_chars` default 200000 | Source & evidence tab (§3.5) — jump-to-source is impossible without it |
| 4 | `GET /api/v1/documents/{id}/source` | `200` original bytes, `Content-Disposition: inline`; `404` with a problem document when unavailable | Source preview for a document opened from the list |
| 5 | `POST /api/v1/documents/{id}/reprocess` | `202 { document, job }`, optional `?config=`; `requireWriter` | Every failed and degraded recovery path (§4.1) |
| 6 | `GET /api/v1/settings` | Shape in §3.12 | Upload drawer's accepted types and size limit; Settings → Connection and Extraction |

### A.2 Required for the committed scope

| # | Operation | Shape |
| --- | --- | --- |
| 7 | `POST /api/v1/documents/export` | `{ ids: string[1..200], format: "json"\|"xml"\|"csv" }` → combined file, `Content-Disposition: attachment`. CSV gains a leading `document_id` column |
| 8 | `POST /api/v1/documents/bulk-delete` | `{ ids: string[1..200] }` → `{ deleted: string[], failed: [{id,error}] }`; `requireWriter` |
| 9 | `GET /api/v1/jobs` | Add `page`, `page_size`, `sort`, `q`; response keeps `items` and adds `page`, `page_size`, `total`, `next_page` |
| 10 | `PUT /api/v1/extraction-configs/{id}` | Replace `name`, `description`, `fields`; re-provision; `409` on built-ins; `requireWriter` |
| 11 | `POST /api/v1/extraction-configs/{id}/provision` | `200 ProvisionResult` for one config; `requireWriter` |
| 12 | `GET /api/v1/extraction-configs` | Add `documentCount` to `ExtractionConfig`; add `q`, `kind=builtin\|custom`, `sort` params |
| 13 | `GET /api/v1/usage` | Workspace counters only: documents by status, `degraded`, `needsReview`, jobs by status, mean grounding, last 24 h / 7 d volumes. `auth: "api"` |
| 14 | `GET /api/v1/samples` | `{ items: [{ id, title, filename, contentType, bytes, docType, description, url }] }` from a manifest beside `public/samples/` |
| 15 | `POST /api/v1/documents/sample` | `{ sampleId, config? }` → `202 { document, job }`; server-side read of the sample file, so the guided path is one call |
| 16 | `POST /api/v1/admin/purge` | Add `dryRun: boolean` → `{ olderThanDays, wouldDelete, oldest, newest, ids }`, deleting nothing |
| 17 | `GET /api/v1/admin/security` | `{ apiKeys{count,hints}, adminTokenSet, sessionTtlSec, cors, rateLimit{rps,burst}, maxUploadBytes, headers{csp,hsts,nosniff}, writesRequireCredential, retention{defaultOlderThanDays} }` |
| 18 | `GET /api/v1/admin/logs` | Add `before` (ISO timestamp cursor) for paging backwards |
| 19 | `GET /api/v1/admin/search-configurations` | Add `?name=` to fetch one |

### A.3 Additive improvements, worth doing in this pass

| # | Operation | Shape |
| --- | --- | --- |
| 20 | `POST /api/v1/documents/{id}/ask` | Add optional `citations: [{ paragraphId, text, score? }]` to `AskResponse`, from the ARAG response the service already receives — makes an answer jump to source like a field does (§3.7) |
| 21 | `GET /api/v1/branding` | Optional `primaryContrast` (`BRAND_PRIMARY_CONTRAST`, default `#ffffff`) so a light partner colour cannot produce white-on-white buttons (§9.4) |

### A.4 Explicitly out of scope

- **API key creation and revocation.** `API_KEYS` is an environment variable with no store; a
  create button would have nothing to write to. Admin → Security states this in words.
- **A cross-document ask.** `POST /documents/{id}/ask` is per-resource by design; the Ask screen
  says so rather than implying a search.
- **Review and correct.** Editing an extracted value is a roadmap item (the marketing FAQ says so
  plainly); nothing in this design implies a field is editable.
- **Webhooks, batch submission, ARAG call time series.** Roadmap; no UI here depends on them.

### A.5 Suggested build order

1. Spec and implement A.1 (1–6) — this unblocks the list, the detail screen and the trust
   surfaces, which are the whole judgement of the redesign.
2. Build `.dip-app`, `.dip-datatable`, `.dip-filterbar`, `.dip-pagination`, `.dip-emptystate`,
   `.dip-skeleton` and ship Documents + Document detail (Record) end to end.
3. Add `.dip-field`, `.dip-grounding`, `.dip-source` and the Source & evidence tab — this is the
   wedge and deserves the most careful pass.
4. A.2 (7–12) with Configs, Jobs and the bulk actions.
5. Settings and the admin restructure (13, 16–19).
6. Onboarding, the tour and the regenerated showcase (14–15).

---

## Appendix B — what this replaces

| Today | Becomes |
| --- | --- |
| `public/index.html` — one page, four numbered cards, a modal config manager, a prompt gallery | The operator app shell with five sections; the config manager becomes Configs; the prompt gallery moves to `docs/business/walkthrough-demo.md` where a reference belongs |
| `public/app.js` — 565 lines of direct DOM wiring | A hash router, a small render layer, one API module; the record-rendering functions (`evidenceBadge`, `evidenceHtml`, `valueHtml`) survive as the basis of `.dip-field` |
| `public/app.css` — `.cfg-field-row`, `.doc-preview`, `.prompt-card` | `public/ui-ext.css` with the components in §9.2; `.doc-preview` becomes `.dip-source` |
| `admin/index.html` — six tabs on one page | Eight routed screens in the same shell |
| Emoji glyphs `⤓ 🖼 📄 ✕` | Inline SVG from the 17-icon set (§8.4) |
| `<arag-shell>` horizontal nav | `.dip-app` sidebar shell, still calling the kit's `applyBranding()` |
