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

