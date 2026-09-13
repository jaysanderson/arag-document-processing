# Document Processing — new screens for the full-implementation pass

**Status:** design, full-implementation pass (13 September 2026). **Audience:** the engineering
lead implementing `public/`, `admin/` and the `/api/v1` additions they require. **Scope:** the
screens the full-implementation brief adds on top of `design/PRODUCT-EXPERIENCE.md` — the
in-product API explorer, the key-value-fields surfaces, a fully editable Settings area, and the
four deferred items (cross-document ask, field correction, admin-log cursor paging, API-key CRUD).

This document is the contract between design and engineering for the *new* surfaces only.
`design/PRODUCT-EXPERIENCE.md` still governs everything it already specifies — the shell, the
Documents queue, the document detail tabs, the trust surfaces, the copy voice, the colour rules and
the accessibility baseline. Where the two disagree, this document wins for the screens listed here
and nowhere else.

Where it says **NEW API**, the operation or parameter does not exist in `src/openapi.ts` today and
must be authored in the spec before the route (TEAM-BRIEF hard rule 4). Appendix A lists every one
of them in build order.

Conventions: British English; hash routes written `/#/api`; API paths in full; kit classes prefixed
`.arag-` (vendored, never edited) and product classes `.dip-` (`public/ui-ext.css`). All wireframes
are drawn at **1440 px** — a 44 px band, a 232 px rail, a fluid content column capped at 1208 px
with 24 px gutters. The ASCII fixes regions, order and real labels, not measurements.

**Read alongside:** `FULL-IMPLEMENTATION-BRIEF.md` (the bar), `design/PRODUCT-EXPERIENCE.md` (the
product as designed), `DECISIONS.md` DP-32 … DP-43, `vendor/arag-platform/ui/arag-ui.css` +
`arag-ui.js` + `arag-ui.d.ts` (what the classes actually render),
`arag-platform/docs/ui-kit.md` and `arag-platform/CHANGELOG.md` § `[0.2.0]` (the component
inventory and the per-product migration map).

---

## 0. What this pass adds, and what it is built on

### 0.1 The migration this design assumes

`vendor/arag-platform/PLATFORM_VERSION` is already `0.2.0` in the working tree; `public/` has not
yet been migrated onto it. **Every screen in this document is specified in kit classes**, on the
assumption that the CHANGELOG 0.2.0 migration map has been applied first:

| Was (`ui-ext.css`) | Is (kit) |
| --- | --- |
| `.dip-app` / `.dip-app__body` / `.dip-sidebar` / `.dip-content` | `.arag-app` / `.body` / `.arag-rail` / `.arag-content` |
| `.dip-sidenav`, `.dip-brandmark` | `.arag-railnav`, `.arag-rail .ident` |
| `.dip-pagehead`, `.dip-breadcrumb`, `.dip-tabs` | `.arag-pagehead`, `.arag-breadcrumb`, `.arag-tabs` |
| `.dip-filterbar`, `.dip-search` | `.arag-filterbar`, `.arag-search`, `.arag-filterchip` |
| `.dip-datatable`, `.dip-bulkbar`, `.dip-pagination` | `.arag-datatable` + `.scroll`, `.arag-bulkbar`, `.arag-pagination` |
| `.dip-drawer*`, `.dip-confirm`, `.dip-menu*`, `.dip-popover` | `.arag-drawer`, `.arag-confirm`, `.arag-menu`, `.arag-popover` |
| `.dip-emptystate`, `.dip-statstrip`, `.dip-skeleton`, `.dip-split` | `.arag-emptystate`, `.arag-statstrip`, `.arag-skeleton`, `.arag-split` |
| `.dip-signin`, `.dip-tour__*`, `.dip-prose`, `.dip-chips` | `.arag-signin`, `tour()`, `.arag-prose`, `.arag-chips` |

**Stays local** (and this document keeps using it): `.dip-field*`, `.dip-grounding*`,
`.dip-source*`, `.dip-quote`, `.dip-fieldrow`, `.dip-timeline`/`.dip-stagecell`,
`.dip-uploadqueue`, `.dip-bar`, `.dip-entity`, `.dip-preview`, `mark.dip-hit`, `.dip-swatch`,
`.dip-suggestions`. Trust surfaces stay with the product that owns their semantics — the kit
deliberately declined `.arag-confidence`, and this pass does not re-propose it.

`public/lib/core.js` drops its copies of `renderShell`, `applyShellBranding`, `openDrawer`,
`confirmDialog`, `menuButton`, `wireTabs`, `popover`, `trapFocus`, `closeOverlay`, `emptyState`,
`errorState`, `skeletonRows`, `announce`, `icon`/`PATHS`, `fmtRelative`, `fmtBytes`/`fmtMs` and
imports them from `/ui/arag-ui.js`. It keeps `parseHash`, `buildHash`, `navigate`, `createRouter`,
`onLeave`, `runLeavers`, `headline`, `docState`, `statusChip`, `jobChip`, `failureAdvice`, `VERIFY`,
`verifyOf`, `pct`, `shortId`, `label`, `downloadResponse` — the product's own vocabulary.

### 0.2 The revised sitemap

New and changed routes only; everything else in `design/PRODUCT-EXPERIENCE.md` § 2.2 is unchanged.

```
Operator app  (public/index.html)
│
├─ /#/documents                       (changed) kv field filters added to the filter bar
│   ?q= &status= &doc_type= &config= &date_from= &sort= &page= &page_size=
│   &kv=<schemaId>.<fieldId>:<op>:<value>      ← NEW, repeatable
│  └─ /#/documents/:id
│      ├─ …/:id            .......... Record        (changed: field correction)
│      ├─ …/:id/source     .......... Source & evidence
│      ├─ …/:id/pipeline   .......... Pipeline      (changed: Corrections timeline)
│      ├─ …/:id/ask        .......... Ask
│      ├─ …/:id/compare    .......... NEW  Pipeline vs generator agent
│      └─ …/:id/json       .......... JSON          (changed: Record | Key-value fields)
│
├─ /#/configs/:id                     (changed) Knowledge Box schema card + generator agent card
│
├─ /#/ask                             (changed) One document | Everything in this workspace
│   ?scope=document|corpus &doc= &q= &doc_type= &kv=
│
├─ /#/api ........................... NEW  API explorer, index only
│  └─ /#/api/:operationId ........... NEW  one operation, deep-linkable
│      ?try=1                         opens with the try-it form expanded
│
└─ /#/settings                        (rebuilt) six groups, every value editable
   ├─ /#/settings/connection ........ default — Knowledge Box, model, reranker, timeout, strategy
   ├─ /#/settings/branding .......... product name, tagline, logo upload, colours, footer
   ├─ /#/settings/limits ............ upload size, accepted types, rate limits, concurrency
   ├─ /#/settings/keys .............. NEW  API keys: create, name, revoke, last used
   ├─ /#/settings/retention ......... NEW  retention policy, purge preview, typed purge
   └─ /#/settings/api ............... usage, docs links, credentials, shortcuts, guided sample

Admin app  (admin/index.html)
│
├─ /admin/#/overview                  unchanged
├─ /admin/#/jobs                      unchanged
├─ /admin/#/logs ................... (rebuilt) cursor paging, level segmented, follow, export
├─ /admin/#/usage                     unchanged
└─ /admin/#/security                  (changed) read-only posture; every lever moves to Settings
```

`/admin/#/connection`, `/admin/#/configs` and `/admin/#/branding` are **retired**, not emptied: the
things they showed are now editable in the operator app's Settings behind the same admin sign-in,
and a screen whose only purpose is to say "go and edit this elsewhere" is a placeholder by another
name. Their nav entries are removed. See § 5.1 — this is a decision the lead must ratify, because it
crosses into the admin app another engineer is editing.

### 0.3 Rail navigation after this pass

One new item. The order is still the workflow, not the alphabet, and `API` sits between the work
and the configuration because it is what Priya reaches for after she has seen the work.

| # | Label | Route | `icon()` | Badge |
| --- | --- | --- | --- | --- |
| 1 | Documents | `/#/documents` | `document` | documents needing review |
| 2 | Configs | `/#/configs` | `layers` | none |
| 3 | Ask | `/#/ask` | `quote` (product-local) | none |
| 4 | Jobs | `/#/jobs` | `clock` | queued + running |
| 5 | **API** | `/#/api` | `plug` | none |
| 6 | Settings | `/#/settings/connection` | `settings` | warning dot when the KB is unreachable |

Flat, not grouped. The kit's `--Heading` group syntax exists and six items is the point at which
grouping starts to earn its keep, but regrouping mid-pass rewrites every rail assertion in the e2e
suite and the showcase for a cosmetic gain. Flagged in § 5 as a decision, resolved here as "no".

Keyboard chords gain one: `g` then `i` jumps to the API explorer (`a` is already Ask). Documented
in Settings → API alongside the existing five.

### 0.4 Constraints carried into every screen below

These are restated because they are the ones the new screens are most likely to break.

1. **DP-34 — Progress green `#5ce500`.** Inside the wordmark artwork and the band's 2 px bottom
   rule. Nowhere else: not text, icon, status, chart, button, focus ring or chip. In this pass the
   two live risks are the **branding preview tile** (§ 3.4) and the **API explorer's method chips**
   (§ 1.5) — a `GET` chip in green would be both a colour violation and a meaning violation.
2. **DP-35 — status, verification, grounding and validation colours are never white-labelled.**
   The new chips this pass introduces (`Corrected`, `Rejected`, `Written`, `Agreed`, `Differs`)
   are trust surfaces and take `--arag-info-*`, `--arag-warn-*`, `--arag-danger-*` and
   `--arag-accent-*` directly. `applyBranding()` must not be able to move them.
3. **DP-43 — the ARAG wordmark appears exactly once on a signed-in screen.** The band carries it.
   **The current `public/views/settings.js` branding preview violates this** (it renders
   `/brand/arag-logo-alt.svg` and `/brand/arag-logo.svg` inside the preview card, making three on
   the page). § 3.4 specifies the replacement. The e2e assertion must run on Settings → Branding,
   not only on Documents, or it cannot catch this class of regression.
4. **DP-32 — hash routing.** Every new surface is a route. Filter and picker state lives in the
   hash query string; `history.replaceState` for filter changes, `location.hash = …` for
   navigations. A drawer is a route and Back closes it.
5. **DP-38 — typed confirmation for purge.** Preview first (`dryRun`), then
   `confirmDialog({ typed: "DELETE" })`. The API explorer must not become a way around this (§ 1.6).
6. **DP-39 — search runs over extracted values**, not just filenames. kv filtering (§ 2.4) extends
   this to the Knowledge Box and must not silently replace it.
7. **DP-40 — the viewer's settings are credential-free.** `GET /api/v1/settings` still carries no
   secret and no extract-strategy id. Editing is what needs the operator token, not reading.
8. **No placeholder screens.** A capability that is not provisioned does not get a greyed tab
   saying so — the Compare tab (§ 2.5) is absent until a generator agent exists, and the place that
   creates one is the config, where it belongs.
9. **No new dependencies, no build step.** Plain browser ES modules, the kit's two files, and a
   small amount of `.dip-` CSS. Every "new thing" below is labelled *product-local CSS* or
   *kit gap*.

---

## 1. The API explorer

### 1.1 Route, rail, breadcrumb

| | |
| --- | --- |
| Routes | `/#/api` — the index with no operation selected. `/#/api/:operationId` — one operation. `?try=1` opens with the try-it form expanded and focus in the first parameter. |
| Rail | Item 5, `API`, `icon("plug")`, no badge. `aria-current="page"` for every `/#/api*` route. |
| Breadcrumb | Index: none (the `<h1>` is enough). Operation: `API › Documents › listDocuments`, where the middle crumb is the operation's first tag, linking to `/#/api?tag=documents`. Last crumb `aria-current="page"`, the operation id in `--arag-font-mono`. |
| Page title | `API` on the index; the operation's `summary` on a detail route, with `<h1>` carrying the summary and the `.sub` line carrying `GET /api/v1/documents`. |
| Document title | `API — Document Processing` / `listDocuments — API — Document Processing`. |

The explorer reads `GET /api/v1/openapi.json` and nothing else. It needs no new API of its own,
which is the point: every operation this pass adds appears in it the moment it appears in the spec,
and an operation that is removed from the spec disappears from the UI. That is the mechanism by
which brief bar 2 stays true a month from now.

### 1.2 Layout at 1440 px

A two-pane split inside the content column: a 288 px operation index on the left, the operation
detail filling the rest. `.arag-split.rail-left.sticky` — the kit's two-column content component,
with the rail sticky so the index does not scroll away from a long response.

Not a drawer and not a modal: an operation's parameters, request, response and curl together are
taller than any drawer should be, and the whole surface has to be deep-linkable and printable.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌Progress Agentic RAG                                 API docs   Admin   service · online                   │
├──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┤
│  Document Processing     │  API › Documents › listDocuments                                                 │
│  Documents in, validated │  List documents with search, filters and sorting          [ Redoc ↗ ] [ Spec ↗ ] │
│                          │  GET /api/v1/documents                                                           │
│  ▤ Documents          24 │ ──────────────────────────────────────────────────────────────────────────       │
│  ▤ Configs            13 │ ┌ 37 operations ────────┐ ┌──────────────────────────────────────────────────┐   │
│  ” Ask                   │ │ [ 🔍 Filter operati…] │ │ Send as  [ This browser session        ▾ ]       │   │
│  ◷ Jobs                1 │ │                       │ │          Cookie from POST /api/v1/session.       │   │
│▎ ⚟ API                   │ │ DOCUMENTS          13 │ └──────────────────────────────────────────────────┘   │
│  ⚒ Settings              │ │ ▎GET    documents     │                                                        │
│                          │ │  POST   documents     │  Every parameter is optional and they combine with     │
│  ────────────────────    │ │  GET    …/{id}        │  AND. q is a case-insensitive substring match across    │
│  ● Knowledge Box online  │ │  DEL    …/{id}        │  the filename, the summary, the tags and the extracted  │
│  Built on Progress ARAG  │ │  GET    …/{id}/export │  field labels and values.                              │
│                          │ │  POST   …/{id}/ask    │                                                        │
│                          │ │  GET    …/{id}/text   │  ┌ Parameters ──────────────────────────────────────┐  │
│                          │ │  GET    …/{id}/source │  │ page          integer  query   min 1             │  │
│                          │ │  POST   …/sample      │  │ [ 1              ]                              │  │
│                          │ │  POST   …/{id}/repro… │  │                                                  │  │
│                          │ │  POST   …/bulk-delete │  │ page_size     integer  query   1–200, default 50 │  │
│                          │ │  POST   …/bulk-export │  │ [ 20             ]                              │  │
│                          │ │  GET    stats         │  │                                                  │  │
│                          │ │                       │  │ status        string   query   enum             │  │
│                          │ │ JOBS                4 │  │ [ Any                                    ▾ ]    │  │
│                          │ │  GET    jobs          │  │                                                  │  │
│                          │ │  GET    jobs/{id}     │  │ doc_type      string   query   repeatable       │  │
│                          │ │  DEL    jobs/{id}     │  │ [ invoice ✕ ] [ receipt ✕ ]  [ Add a value  ▾ ] │  │
│                          │ │  GET    …/{id}/events │  │                                                  │  │
│                          │ │                       │  │ q             string   query   ≤ 200 characters │  │
│                          │ │ EXTRACTION-CONFIGS  6 │  │ [ globex                                     ]  │  │
│                          │ │ SCHEMAS             1 │  └──────────────────────────────────────────────────┘  │
│                          │ │ SYSTEM              4 │                                                        │
│                          │ │ ADMIN               9 │   [ Send request ]   Reset          ⌘↵ to send         │
│                          │ └───────────────────────┘                                                        │
│                          │                            ┌ Response ─────────────────────────────────────────┐ │
│                          │                            │ ● 200 OK   118 ms   14.2 kB   application/json    │ │
│                          │                            │ x-request-id  3f9a2c…            All headers ▾    │ │
│                          │                            │ ─────────────────────────────────────────────────  │ │
│                          │                            │ { "items": [ { "id": "doc_01J…",                  │ │
│                          │                            │     "filename": "invoice-review.txt",             │ │
│                          │                            │     "status": "ready", … } ],                     │ │
│                          │                            │   "total": 24, "page": 1, "page_size": 20 }       │ │
│                          │                            └───────────────────────────────────────────────────┘ │
│                          │                            ┌ curl ────────────────────────────────────  [ Copy ] │
│                          │                            │ curl -s 'https://…/api/v1/documents?page=1\        │ │
│                          │                            │ &page_size=20&doc_type=invoice&q=globex' \         │ │
│                          │                            │   -H 'X-API-Key: $DIP_API_KEY'                     │ │
│                          │                            └────────────────────────────────────────────────────┘ │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

The index is grouped by tag in spec order (documents, jobs, extraction-configs, schemas, admin,
system), each group a `<h2>` with the operation count, each entry a link carrying a method chip and
the path with the `/api/v1` prefix elided (it is in the page header, and repeating it 37 times
costs the width the paths need). `.arag-search` filters the index across `operationId`, `summary`,
path and tag, live, with the result count announced politely.

On `/#/api` with no operation selected, the right pane is an `.arag-emptystate`, not a blank:

> **Pick an operation**
> Every screen in this product is built from these 37 operations, and nothing here is a mock — a
> request you send from this page hits the same service, with the same credential, as the rest of
> the app.
> `[ Start with GET /api/v1/documents ]`

### 1.3 Layout at ≤ 900 px

The rail becomes the kit's scrim drawer behind the band's hamburger — that is the kit's behaviour
and the explorer does nothing to it. Inside the content column:

- `.arag-split.rail-left` collapses to one column. The index is **not** stacked above the detail
  (37 operations is a long scroll to get past); it moves behind a full-width
  `[ ⚟ All operations (37) ▾ ]` button in the page header, which opens the index as a left drawer
  via `openDrawer({ side: "left", title: "Operations" })`. Selecting an operation closes it.
- The `Send as` control becomes full width above the parameters.
- Parameters, request, response and curl stack in that order.
- The response JSON and the curl snippet each sit in their own `overflow-x: auto` container. The
  page body never scrolls sideways.
- `Send request` becomes a full-width sticky footer button inside the detail pane, so it is
  reachable without scrolling past a twelve-parameter form.

At ≤ 600 px the method chip and the path in the index wrap to two lines; nothing is hidden.

### 1.4 Parameters, by kind

One `.arag-field` per parameter: `.arag-label` carrying the name in mono, then a meta line
(`type` · `in` · constraints · `required`), then the control, then `.arag-help` with the
parameter's `description` from the spec when it has one. Required parameters carry
`<span class="arag-chip danger">required</span>` and `required` on the control; the Send button
stays disabled until every required parameter has a value, with the reason named
("`id` is required").

| Kind | Detection | Control |
| --- | --- | --- |
| Path | `in: "path"` | Text input, always required, mono. Plus a resolver button — see below. |
| Query, enum | `schema.enum` | `.arag-select`, first option `Any` with an empty value (so an untouched optional enum is simply not sent). |
| Query, boolean | `schema.type === "boolean"` | `.arag-switch`. Tri-state is wrong here: the switch is accompanied by a `Send this parameter` checkbox only when the parameter has no default, otherwise off means "not sent". |
| Query, integer / number | `type: integer\|number` | `<input type="number">` with `min`/`max`/`step` from the schema and the bounds repeated in `.arag-help` ("1 – 200, default 50"). |
| Query, string | everything else | `.arag-input`, `maxlength` from `maxLength`, `placeholder` from `example`. |
| Query, repeated | `schema.type === "array"` (DP-42: `doc_type`) | A chip adder. Each value is an `.arag-filterchip` with a remove button; the adder is a `.arag-select` when the item schema has an enum, an `.arag-input` with Enter-to-add otherwise. Serialised as repeated `?doc_type=a&doc_type=b`, which is the shape the platform's query validator accepts. |
| Body, JSON schema | `requestBody` with `application/json` | Two modes on an `.arag-segmented` — **Form** and **JSON** — wired with `wireSegmented`. Form generates one row per top-level property using the rules above; an array of scalars becomes the chip adder; a nested object or an `oneOf` falls back to a mono textarea for that property alone. JSON is a full-height mono `.arag-textarea` pre-filled from the schema's `example` or a generated skeleton, validated on blur (`JSON.parse` plus a required-property check) with the error shown beneath it. Default mode: **Form** when every property is a scalar or an array of scalars, **JSON** otherwise. Switching modes carries the values across; a JSON body the form cannot express disables the Form segment with the reason. |
| Body, multipart file | `multipart/form-data` (`POST /api/v1/documents`) | `.arag-dropzone` plus a visible `<input type="file">`, the accepted extensions and size limit read from `GET /api/v1/settings` rather than hard-coded, and a second route in: `[ Use a bundled sample ▾ ]` listing `GET /api/v1/samples`. Without the sample option the explorer's most important operation is unusable to anyone who has not first found a PDF, which is exactly the stranger the brief cares about. Non-file parts of the same body (`config`) render as ordinary fields. |
| Header | `in: "header"` | Rendered read-only with the value the credential picker will send, so the user can see `X-API-Key: dip_a91f…` without being able to hand-edit it into something the picker contradicts. |
| Admin-token required | `security` is `adminSecurity` | The operation head carries `<span class="arag-chip neutral">Operator token</span>`. See § 1.7. |

**Resolvers.** A path parameter named `id` on a `documents` operation gets
`[ Pick a document ]` beside it, opening a drawer with the ten most recent documents (filename,
headline identifier, status) and a search box; picking one fills the field and closes the drawer.
The same for `jobs` (`Pick a job`) and `extraction-configs` (`Pick a config`). Typing a `doc_01J…`
identifier by hand is the single largest piece of friction in any API explorer, and this product
already has the pickers.

`Reset` clears every parameter to its schema default and empties the response pane.

### 1.5 The credential picker

A sticky card at the top of the detail pane, `Send as`, a `.arag-select` plus a helper line that
changes with the selection. The choice is remembered per browser in `localStorage`
(`dip.api.credential`); the **key material never is**.

| Option | What it sends | Helper line |
| --- | --- | --- |
| `This browser session` (default) | Nothing extra — the same-origin cookie from `POST /api/v1/session` | `The cookie this tab already holds. This is what the rest of the app uses.` |
| `An API key` | `X-API-Key: <value>` | `Paste a key. It is held in this tab only, never saved, and cleared when you close it.` |
| `The operator session` | Nothing extra — the admin cookie, when one exists | `The operator cookie from the admin sign-in. Only the operator operations need it.` |
| `No credential` | Nothing | `Sends the request with no credential, so you can see what an unauthenticated caller gets.` |

Choosing `An API key` reveals a `<input type="password">` with a `Show` toggle and, when
`GET /api/v1/api-keys` returns rows, a `.arag-select` of key **names** above it — picking a name
fills the label of the field, not its value, because the product stores hashes and cannot hand back
a key it issued (§ 3.5). The copy says so: *"Keys are stored as hashes. Pick the name so the curl
is labelled correctly, then paste the key itself."*

`The operator session` is offered only when `GET /api/v1/admin/health` answers 200 — the explorer
probes it once on mount. When it does not, the option is present but disabled, with
`Sign in as operator ›` beside it, which opens the same in-shell sign-in drawer Settings uses
(§ 3.3) rather than navigating to `/admin/`.

Nothing in this picker can be used to escalate: it chooses among credentials the browser already
has or the user already holds. There is no "send as admin" that the server would not otherwise
honour.

**Method chips.** `.dip-method` (product-local CSS, and a **kit gap** — proposed as `.arag-method`
in 0.3.0). Five variants, all from existing tokens, none green:

| Method | Treatment |
| --- | --- |
| `GET` | `--arag-brand-50` fill, `--arag-brand-700` text |
| `POST` | `--arag-info-soft` fill, `--arag-info-fg` text |
| `PUT` | `--arag-warn-soft` fill, `--arag-warn-fg` text |
| `DELETE` | `--arag-danger-soft` fill, `--arag-danger-fg` text |
| any other | `--arag-surface-sunken` fill, `--arag-text-muted` text |

`GET` is deliberately the action colour rather than success green: a green `GET` chip would be the
DP-34 violation and, worse, would read as "this one worked".

### 1.6 Sending, and guarding what it sends

**The explorer calls the live service.** There is no sandbox, no replay and no mock mode, and the
UI says so once, in the index empty state and again in a persistent line under `Send as`:
*"Requests go to this deployment. Nothing here is simulated."* A sandbox that quietly diverged from
the real service would be worse than no explorer at all.

An operation is **destructive** when its method is `DELETE`, or its `operationId` is in the product's
list: `bulkDeleteDocuments`, `adminPurge`, `adminProvision`, `provisionExtractionConfig`,
`reprocessDocument`, `updateExtractionConfig`, and every `PUT /api/v1/settings/*` this pass adds.
Method alone is not enough — `POST /api/v1/admin/purge` deletes more than any `DELETE` in the spec.

Destructive operations get three things:

1. A standing `.arag-alert.warn` at the top of the detail pane, above the parameters:
   *"This operation changes data. `DELETE /api/v1/documents/{id}` also deletes the resource from the
   Knowledge Box, and it cannot be undone."* The second sentence is per-operation copy, taken from
   the spec's `description` when it carries the consequence and written by hand when it does not.
2. `Send request` becomes `.arag-btn.danger` and carries the verb — `Send DELETE`, `Send purge`.
3. `confirmDialog({ danger: true, … })` before the request leaves, with the **exact request line**
   in the body so the blast radius is visible:

   > **Send `DELETE /api/v1/documents/doc_01J8…`?**
   > This deletes the document and its Knowledge Box resource. It cannot be undone.
   > `[ Cancel ]  [ Send DELETE ]`

   `adminPurge` and `bulkDeleteDocuments` additionally take `typed:` — `DELETE` for purge (matching
   DP-38 exactly, so the explorer cannot be a softer path to the same action than the Settings
   screen) and `delete 12` for a bulk delete of twelve ids. `adminPurge` also grows a
   `[ Dry run first ]` secondary button that sets `dryRun: true` and sends without a confirmation,
   because a preview deletes nothing and asking twice for it teaches people to click through.

Requests are sent with `fetch`, `credentials: "same-origin"`, and are cancellable: while in flight,
`Send request` becomes `Cancel request` and aborts the `AbortController`. Leaving the screen aborts
it too (`onLeave`).

### 1.7 The response pane

One card, `Response`, replaced wholly on each send. Never appended to — an explorer that grows a
transcript makes the page unreadable by the fourth request. The previous response is kept in memory
and reachable from `[ ‹ Previous response ]` in the card head, which is enough history for the
"what changed when I added that parameter" question and no more.

**Status line.** `<span class="arag-chip">` coloured by class — `ok` for 2xx, `info` for 3xx,
`warn` for 4xx, `danger` for 5xx and for a network failure — carrying `200 OK`, then the duration
(`118 ms`), the byte size (`14.2 kB`) and the `Content-Type`. `role="status"` so it is announced.

**Headers.** Six are shown inline because they are the ones that change what the caller must do:
`content-type`, `content-disposition`, `x-request-id`, `retry-after`, `location`,
`ratelimit-remaining`. Everything else sits behind `All headers ▾` (`<details>`), rendered as
`.arag-kv`.

**Bodies**, by content type:

| Response | Rendering |
| --- | --- |
| `application/json` | `<arag-json>`, plus `.arag-snippet` + `wireCopy()` for `[ Copy JSON ]`. Objects deeper than two levels render collapsed; arrays longer than 50 entries render the first 50 with `… 174 more entries` and a `Show all` button. |
| `application/problem+json` | The product's error pattern, not a JSON dump: `.arag-alert.error` carrying `title` as its heading and `detail` as its body, with `status`, `type` and `x-request-id` beneath in `.arag-kv`. The raw document follows in `<arag-json>` under `Raw problem document ▾`. This is the one place the explorer is allowed to be prettier than the wire, because a 422 from a kv write is the thing a developer most needs to read (§ 2.3). |
| `text/event-stream` (`GET /api/v1/jobs/{id}/events`) | `Send request` reads `Start stream`. The pane becomes an `.arag-log` that appends `event: stage` / `data: {…}` line pairs as they arrive, with `.arag-pill-live` in the card head, an event counter, elapsed time and `[ Stop stream ]`. Auto-scroll follows the tail until the user scrolls up, then pauses with `[ Jump to latest ]`. The stream is closed on stop, on leaving the route, and when the job reaches a terminal state (the pane then reads `Stream ended — the job finished.`). Kit: the existing `sse()` helper. |
| NDJSON (`application/x-ndjson`, if any operation adopts it) | Same log pane, one row per line, each row's JSON expandable. |
| Binary — `image/*`, `application/pdf` (`GET …/{id}/source`) | Never dumped into the pane. A file card: the filename parsed from `Content-Disposition`, the media type, the size, and `[ Download ]` (an object URL, revoked on the next send). Images additionally show a ≤ 320 px preview; PDFs show the first page only if that is free, otherwise nothing — a broken embed is worse than a download button. |
| `text/csv`, `application/xml` (`GET …/{id}/export`, `POST …/bulk-export`) | The file card, plus `Show the first 100 lines ▾` rendering into `.arag-snippet`. Downloading and inspecting are different jobs and both belong here. |
| `204 No Content` | `The response had no body.` in `.muted`, with the headers still shown. |
| Network failure / abort | `.arag-alert.error`: `The request did not reach the service. Check your connection and try again.` / `Request cancelled.` |

**Redaction.** Response bodies are shown verbatim — they are what the caller would get. The one
exception is `POST /api/v1/api-keys`, whose response carries a plaintext key exactly once: the
explorer renders it with the same create-once treatment as Settings (§ 3.5), including the warning
sentence, and the curl for that operation never echoes it.

### 1.8 The curl block

`.arag-snippet` + `wireCopy()`, regenerated on every parameter change (not only on send), so it is
useful before the first request as much as after it.

```
curl -s 'https://docs.example.com/api/v1/documents?page=1&page_size=20&doc_type=invoice' \
  -H 'X-API-Key: $DIP_API_KEY'
```

Rules:

- The host is `location.origin`, so a copied command works from the reader's shell against the
  deployment they are looking at.
- **Credentials are never inlined.** `An API key` renders `-H 'X-API-Key: $DIP_API_KEY'`;
  `This browser session` renders `-b 'dip_session=$DIP_SESSION'` with a comment line
  `# the session cookie this tab holds`; `The operator session` renders
  `-H 'X-Admin-Token: $ADMIN_TOKEN'` — the token form rather than the cookie, because that is what
  a script would use. `No credential` renders no auth flag at all.
- A JSON body renders as `--json '<pretty body>'` on its own continuation lines, pretty-printed,
  single-quoted with internal single quotes escaped.
- A multipart body renders `-F 'file=@invoice-review.txt' -F 'config=invoice'`.
- Repeated query parameters repeat.
- A destructive operation's curl carries a leading comment: `# deletes the resource in the Knowledge Box`.
- `[ Copy ]` announces `curl command copied` politely.

### 1.9 States

| State | Treatment |
| --- | --- |
| Loading the spec | Page header renders immediately; the index and the detail pane show `skeletonRows(8)` and `skeletonRows(6)`. Below 300 ms, nothing (the general rule). |
| Spec unavailable | Whole-pane `errorState`: **`Could not load the API description`** / *"The explorer builds itself from `/api/v1/openapi.json`, and that document did not load. The reference at Redoc may still work."* Actions: `[ Try again ]` `[ Open Redoc ↗ ]`. |
| Index empty after filtering | `.arag-emptystate` inside the index column: **`No operations match`** / *"Try the tag, the path or the operation id."* + `Clear the filter`. |
| No operation selected | The index empty state in § 1.2. |
| Unknown `operationId` in the route | `.arag-emptystate`: **`No operation called `listDocs``** / *"It may have been renamed or removed from the API. The index lists everything this deployment publishes."* + `Back to the index`. Never a redirect — a stale link in a doc should say what went wrong. |
| Idle, before the first send | The response card is not rendered at all. An empty box labelled Response is noise. |
| In flight | `aria-busy="true"` on the detail pane; the button reads `Cancel request`; a determinate-free `.arag-progress` hairline under the button. `announce("Sending GET /api/v1/documents")`. |
| Required parameter missing | Send disabled, `aria-describedby` pointing at a line under the button: `id is required.` With more than one: `id and format are required.` |
| Invalid JSON body | Send disabled; the error under the textarea: `That is not valid JSON — unexpected token at line 4.` |
| 401 / 403 from the request | Rendered as an ordinary response (it *is* the answer), with one extra line above the body: `This credential was not accepted. Try "The operator session", or sign in as operator.` + the sign-in link. The explorer never hides a real 401 behind its own error state. |
| Operator operation, no operator session | Send is disabled before any request is made, with `.arag-alert` above the parameters: **`This operation needs the operator token.`** / *"Sign in as operator to send it. Reading the parameters and copying the curl work either way."* + `[ Sign in as operator ]`. The parameters stay interactive — a developer copying the curl for a CI script does not need to be signed in. |
| Rate limited (429) | The response renders normally; `retry-after` is promoted into a sentence above the body: `The service asked you to wait 4 seconds before retrying.` The ask operation's tighter bucket (DP-41) makes this a state people will actually hit. |
| Stale | Navigating between operations mid-flight aborts the previous request; the response pane clears rather than showing the old operation's answer under the new operation's heading. |

### 1.10 Keyboard and screen reader

**Focus order**: skip link → band → rail nav → page header (title, `Redoc`, `Spec`) → index search
→ index list → credential picker → parameters in spec order → `Send request` → `Reset` → response
card → curl `Copy`.

- The index is a `<nav aria-label="Operations">` containing one `<ul>` per tag with an `<h2>`;
  the selected entry carries `aria-current="page"`. Up/Down move within the list natively (they are
  links); `/` focuses the index search from anywhere on the screen (consistent with the Documents
  list); Escape in the search clears it.
- `⌘↵` / `Ctrl+↵` from anywhere in the parameter form sends the request; the hint is shown beside
  the button and listed in Settings → API.
- The response card gets `tabindex="-1"` and receives focus when a response arrives, so a
  keyboard user is not left at the bottom of a form wondering whether anything happened.
- `announce()` strings, in order of a typical send: `"Sending GET /api/v1/documents"` →
  `"200 OK, 118 milliseconds, 14.2 kilobytes"` → on error `"422 Unprocessable Content. The request
  body did not match the schema."`. For a stream: `"Streaming job events"`, then every tenth event
  `"41 events"`, then `"Stream ended"`. Never more than one assertive announcement; all of these
  are polite, on `#aragLive`.
- The status chip is `role="status"`; the problem-document alert is `role="alert"`.
- The destructive confirm is the kit's — `role="alertdialog"`, focus on Cancel, Escape cancels,
  typed confirmation where specified.
- The method chip's accessible name is the word, not the colour: `<span class="dip-method get">GET</span>`
  with no `aria-hidden`, and the link's accessible name is `GET /api/v1/documents, list documents`.
- The parameter meta line is associated with its control by `aria-describedby`, so a screen reader
  reads `page, integer, query, minimum 1` rather than leaving the constraints as orphan text.
- The curl block is `<pre tabindex="0">` inside a labelled region, so it can be scrolled by
  keyboard; the copy button's accessible name is `Copy the curl command`.

### 1.11 Copy

| Element | String |
| --- | --- |
| `<h1>` (index) | `API` |
| Index subtitle | `Every operation this deployment publishes, with a form that calls it.` |
| Index search placeholder | `Filter operations` |
| Index result count | `37 operations` / `4 operations match` |
| Credential label | `Send as` |
| Live-service note | `Requests go to this deployment. Nothing here is simulated.` |
| Parameters heading | `Parameters` |
| No-parameters line | `This operation takes no parameters.` |
| Body mode segments | `Form` · `JSON` |
| Body JSON reset | `Reset to the example` |
| File field | `Choose a file, or drop one here` · `[ Use a bundled sample ▾ ]` |
| Send | `Send request` · `Send DELETE` · `Send purge` · `Start stream` |
| In flight | `Cancel request` · `Stop stream` |
| Secondary | `Reset` · `Dry run first` · `Previous response` |
| Send hint | `⌘↵ to send` |
| Response heading | `Response` |
| Headers disclosure | `All headers ▾` |
| Empty body | `The response had no body.` |
| Binary card | `invoice-review.txt · text/plain · 3.1 kB` + `[ Download ]` |
| Preview disclosure | `Show the first 100 lines ▾` |
| Stream ended | `Stream ended — the job finished.` |
| curl heading | `curl` |
| Copy confirmation (toast) | `Copied` |
| Operator gate | `This operation needs the operator token.` / `Sign in as operator to send it. Reading the parameters and copying the curl work either way.` |
| Spec failure | `Could not load the API description` / `The explorer builds itself from /api/v1/openapi.json, and that document did not load. The reference at Redoc may still work.` |
| Unknown operation | `No operation called <id>` / `It may have been renamed or removed from the API. The index lists everything this deployment publishes.` |
| Destructive banner | `This operation changes data. <consequence> It cannot be undone.` |

### 1.12 Kit-candidate contract — `.arag-apiexplorer` / `apiExplorer()`

**Proposed for `arag-platform` v0.3.0.** Every accelerator has the same obligation under brief bar 2
and will otherwise build this three times. Report to the Head with this contract.

**Generic — belongs in the kit:**

- Parsing an OpenAPI 3.1 document into tags → operations → parameters, and keeping the index in
  spec order.
- The index: grouping, counts, live filter, `aria-current`, selection.
- The operation header: method chip, path, summary, description, security badge.
- Generating a parameter form from JSON Schema — every rule in § 1.4 except the resolvers.
- The send pipeline: building the URL and body, `AbortController`, timing, byte counting.
- The response renderer: status chip, promoted headers, `all headers` disclosure, `application/json`
  via `<arag-json>`, `application/problem+json` as an alert, `text/event-stream` and NDJSON as a log
  pane, binary as a file card, `204`, network failure.
- The curl builder, including credential redaction and multipart/JSON body forms.
- The destructive confirmation, delegated to `confirmDialog`.
- Keyboard and focus behaviour, the live-region strings' shape (the *words* stay with the product).

**Product's — stays here:**

- Which credential modes exist, how they are obtained, and what each one puts on the wire. That is
  a product's auth model, not the kit's.
- The resolvers (`Pick a document`, `Pick a job`, `Pick a config`, `Use a bundled sample`) — they
  are queries against this product's own API.
- The destructive predicate beyond `DELETE`, and each operation's consequence sentence.
- The operator-gate copy and where its sign-in link goes.
- Any product-specific response shape that deserves a nicer rendering than JSON.

**Proposed API:**

```js
import { apiExplorer } from "/ui/arag-ui.js";

const explorer = apiExplorer(root, {
  // Required. A parsed OpenAPI 3.1 document, or a URL to fetch one from.
  spec: "/api/v1/openapi.json",
  basePath: "/api/v1",

  // The host owns the URL. The kit never touches location.
  route: {
    get: () => currentOperationId,          // string | null
    set: (operationId) => navigate(`/api/${operationId}`),
  },

  // Ordered; the first is the default. `apply` mutates the outgoing request.
  credentials: [
    { id: "session", label: "This browser session", help: "…", apply(req) {} },
    { id: "key", label: "An API key", help: "…", secret: true,
      apply(req, value) { req.headers["X-API-Key"] = value; },
      curl: (v) => `-H 'X-API-Key: $DIP_API_KEY'` },
    { id: "admin", label: "The operator session", available: () => probeAdmin(),
      unavailable: { text: "Sign in as operator ›", onSelect: openSignIn } },
    { id: "none", label: "No credential", apply() {} },
  ],

  // "Help me fill this in", by parameter name or `${operationId}.${name}`.
  resolvers: {
    params: { id: pickDocument, "getJob.id": pickJob, "provisionExtractionConfig.id": pickConfig },
    file: pickSample,
  },

  // Guardrails. `destructive` defaults to `op.method === "delete"`.
  destructive: (op) => op.method === "delete" || DESTRUCTIVE.has(op.operationId),
  consequence: (op) => CONSEQUENCE[op.operationId],       // one sentence, shown and confirmed
  typedConfirm: (op, req) => (op.operationId === "adminPurge" ? "DELETE" : null),

  curl: { host: location.origin, comment: (op) => CONSEQUENCE[op.operationId] },

  // Hooks.
  onSend: (op, req) => {}, onResponse: (op, res, meta) => {},
  labels: { /* every string in § 1.11, so the kit ships no product voice */ },
});

explorer.setOperation("listDocuments");
explorer.getOperation();     // → { operationId, method, path, tag, spec }
explorer.destroy();          // aborts in-flight requests and closes streams
```

**Markup contract** (the host owns none of it; this is what the kit renders):

```html
<div class="arag-apiexplorer">
  <nav class="arag-apiexplorer__index" aria-label="Operations">
    <div class="arag-search">…</div>
    <h2>Documents <span class="count">13</span></h2>
    <ul><li><a href="#" aria-current="page">
      <span class="arag-method get">GET</span><span class="path">/documents</span></a></li></ul>
  </nav>
  <section class="arag-apiexplorer__op" aria-labelledby="opTitle">
    <header class="arag-apiexplorer__ophead">…</header>
    <div class="arag-apiexplorer__cred">…</div>
    <form class="arag-apiexplorer__params">…</form>
    <div class="arag-apiexplorer__resp" tabindex="-1">
      <div class="arag-apiexplorer__status">…</div>…</div>
    <div class="arag-snippet">…curl…</div>
  </section>
</div>
```

New classes the kit would own: `.arag-apiexplorer` and its five children, plus `.arag-method`
(`.get .post .put .patch .delete`). Everything else reuses `.arag-split`, `.arag-search`,
`.arag-field`, `.arag-select`, `.arag-input`, `.arag-switch`, `.arag-textarea`, `.arag-filterchip`,
`.arag-dropzone`, `.arag-segmented`, `.arag-chip`, `.arag-alert`, `.arag-kv`, `.arag-snippet`,
`<arag-json>`, `.arag-log`, `.arag-pill-live`, `.arag-progress`, `.arag-emptystate`,
`.arag-skeleton`, `.arag-card`, `.arag-btn`.

**Until 0.3.0 lands**, build it here as `.dip-apiexplorer*` + `.dip-method` in `public/ui-ext.css`,
keeping the class structure above so the migration is a rename. That is the same route `.dip-*`
took into 0.2.0 and it worked.

### 1.13 API coverage — the inventory this screen must show

37 operations across six tags, from `src/openapi.ts` as it stands, plus the ones this pass adds
(Appendix A). The explorer is generated, so this table is a review aid, not a thing to hand-maintain:

| Tag | Operations |
| --- | --- |
| `documents` (13) | `listDocuments`, `createDocument`, `getDocument`, `deleteDocument`, `exportDocument`, `askDocument`, `getDocumentText`, `getDocumentSource`, `createSampleDocument`, `reprocessDocument`, `bulkDeleteDocuments`, `bulkExportDocuments`, `getStats` |
| `jobs` (4) | `listJobs`, `getJob`, `cancelJob`, `jobEvents` |
| `extraction-configs` (6) | `listExtractionConfigs`, `createExtractionConfig`, `getExtractionConfig`, `updateExtractionConfig`, `deleteExtractionConfig`, `provisionExtractionConfig` |
| `schemas` (1) | `listSchemas` |
| `system` (4) | `getSettings`, `listSamples`, `getBranding`, `createSession` |
| `admin` (9) | `adminLogin`, `adminHealth`, `adminConfig`, `adminUsage`, `adminLogs`, `adminSearchConfigurations`, `adminSecurity`, `adminProvision`, `adminPurge` |

Every one of them already has a screen or control except `listSchemas`, `adminConfig` and
`createSession`, which the explorer now covers. That closes brief bar 2 for the existing surface;
Appendix A keeps it closed for the new one.

### 1.14 What a Playwright journey must assert

`test/e2e/api-explorer.spec.ts`:

1. `/#/api` renders the index with a count matching `openapi.json`'s operation count, and the six
   tag headings in spec order.
2. Filtering the index to `bulk` leaves exactly two entries; clearing restores the count.
3. Clicking `GET /api/v1/documents` navigates to `/#/api/listDocuments`; reloading that URL lands on
   the same operation (deep link).
4. The parameter form renders `page_size` as a number input with `min="1"` and `max="200"`, `status`
   as a select whose first option is `Any`, and `doc_type` as a chip adder that serialises two
   values as two `doc_type` query parameters in the curl block.
5. `Send request` produces a `200 OK` status chip, a duration, and a JSON body containing `total`.
6. The curl block contains `location.origin` and **does not contain** any key material; switching
   the credential to `An API key` and pasting a value changes the curl to `$DIP_API_KEY` and leaves
   the literal out of the DOM (`expect(page.content()).not.toContain(key)`).
7. `DELETE /api/v1/documents/{id}` shows the destructive banner, `Send DELETE` is
   `.arag-btn.danger`, and clicking it opens `role="alertdialog"` with focus on Cancel; Escape
   cancels and nothing is deleted.
8. `adminPurge` requires the typed word `DELETE` before its confirm button enables, and
   `Dry run first` sends without a dialog and returns a count.
9. With no operator session, `adminUsage` disables Send and shows the operator gate; the curl block
   is still populated.
10. `GET /api/v1/jobs/{id}/events` renders `.arag-pill-live`, appends at least one `event:` line,
    and stops when `Stop stream` is clicked; navigating away leaves no open `EventSource`
    (asserted via a console/network check).
11. `GET /api/v1/documents/{id}/source` renders a file card with a `Download` button and does not
    render the bytes into the page.
12. A 422 from `POST /api/v1/extraction-configs` renders `role="alert"` with the problem title, and
    the raw document is behind a disclosure.
13. Keyboard: `/` focuses the index search; `⌘/Ctrl+Enter` in the form sends; focus lands on the
    response card after a send.
14. At 390 px: the index is behind `All operations (37)`, opening it traps focus, Escape closes it,
    and `document.body.scrollWidth <= 390`.
15. Exactly one `img[src*="arag-logo"]` on the page (DP-43).

---

## 2. Key-value fields — the headline capability

ARAG now stores typed, validated structured data on a resource as **key-value fields** conforming
to a Knowledge-Box-scoped schema. This is the difference between "we extracted values and kept
them in our own store" and "the structured values live in the Knowledge Box, searchable and
filterable". Four surfaces carry it, and the design problem in all four is the same: the product
now has **two places a value can live**, and the user must always be able to tell which one they
are looking at and which one a filter ran against.

### 2.0 The model, stated once

| Thing | Shape | Budget |
| --- | --- | --- |
| kv-schema | `{ id, name, fields: [{ id, type, required?, repeated?, range? , description }] }`, scoped to the Knowledge Box (`/kb/{kbid}/kv-schemas`) | **20 schemas per Knowledge Box** |
| kv field | `type` ∈ `text` `integer` `float` `boolean` `date`; modifiers `required`, `repeated`, `range` | **50 fields per schema** |
| Written values | inline as `key_values.<schemaId>.data` on resource create/update, or one at a time with `PUT /kb/{kbid}/resource/{rid}/key_value/{field_id}` | validated at write; **422** on mismatch |
| Filtering | filter expressions in search and catalog | — |
| Generator agent | a Data Augmentation agent whose schema and field descriptions guide extraction and which writes the values itself | — |

**This product's mapping.** One extraction config provisions one kv-schema, id `dip_<configId>`
(`dip_invoice`, `dip_purchase_order`, `dip_cfg_01J8…`). Field ids are the config's field keys
unchanged, so `invoice_total` in the record is `invoice_total` in the Knowledge Box and the two are
obviously the same thing. Types are derived from the **normalised** value, not the raw one, because
the normalised value is what a filter has to compare:

| Config field | Detected by | kv type | Modifiers |
| --- | --- | --- | --- |
| `string`, key or label names a date | `/date/i` on key or label, or `parseDateISO` succeeds on the sample | `date` | |
| `string` declared with `money()` | description contains `capture exactly as written` | `float` | — the normalised number; the raw string stays on the record |
| `string` | otherwise | `text` | |
| `number` | integral in the schema | `integer` | |
| `number` | otherwise | `float` | |
| `array` | | item type | `repeated` |
| any, in `schema.required` | | | `required` |

The mapping is a **default, shown and overridable** in the config field builder — a new
`Knowledge Box type` column (§ 2.2). Guessing silently and then failing at write with a 422 is the
worst of both worlds; guessing visibly and letting someone fix it is the whole job.

**Two honesty rules, non-negotiable, alongside the § 5.5 rules already in force:**

10. A value shown in the Documents list, on the Record tab or in an export is **the product's
    record**. A value shown under Key-value fields is **what is in the Knowledge Box**. Where they
    differ, both are shown and the difference is named — never reconciled behind the scenes.
11. A kv-backed filter and a local filter are never rendered identically (§ 2.4). A user who
    filters by invoice total and gets six results must be able to find out, without asking, that
    eighteen other documents were not considered because their values were never written.

---

### 2.1 Configs list — the budget strip

**Route** `/#/configs` (unchanged). **Breadcrumb** none. **Rail** Configs.

The list gains one column and one strip. Both exist because the 20 × 50 budget is a real wall a
partner will hit at config 21, and a wall you cannot see coming is an outage.

```
┌──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┐
│  ▤ Documents          24 │  Configs                                              [ + New config ]           │
│  ▤ Configs            13 │ ──────────────────────────────────────────────────────────────────────────       │
│  ” Ask                   │  ┌ Knowledge Box schemas ────────────────────────────────────────────────┐       │
│  ◷ Jobs                1 │  │ 13 of 20 used  ████████████████░░░░░░░       7 left                   │       │
│▎ ⚟ API                   │  │ One schema for each extraction config. A Knowledge Box holds 20.      │       │
│  ⚒ Settings              │  │                                        [ Provision all (2 out of date) ]     │
│                          │  └──────────────────────────────────────────────────────────────────────┘       │
│                          │  [ 🔍 Search configs ]  [ Kind ▾ ]                    Clear all filters          │
│                          │                                                                                  │
│                          │  Name                 Fields  ARAG configuration    KB schema      Docs          │
│                          │ ─────────────────────────────────────────────────────────────────────────        │
│                          │  Invoice              12/50   dip-invoice           ● Provisioned    9   ⋯       │
│                          │  Purchase order       11/50   dip-purchase-order    ● Provisioned    3   ⋯       │
│                          │  Medical claim        14/50   dip-medical-claim     ▲ Out of date    4   ⋯       │
│                          │  Supplier onboarding  18/50   dip-cfg-01J8K2        ⊘ Not provisioned 0   ⋯      │
│                          │  Freight manifest     52/50   dip-cfg-01J8M9        ⊘ Over the limit  0   ⋯      │
│                          │ ─────────────────────────────────────────────────────────────────────────        │
│                          │                                                      1–13 of 13                  │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Kit classes.** `.arag-pagehead` (`.row`, `.actions`); the budget strip is an `.arag-card` whose
body holds an `.arag-meter` — the kit's meter, not a new bar; `.arag-filterbar` + `.arag-search`;
`.arag-datatable` + `.scroll` + `wireTable`; `.arag-chip` for the schema state; `.arag-menu` via
`menuButton` for the row actions; `.arag-pagination`.

**Nothing new is needed here.** The `Fields` column becomes `12/50` — a ratio, not a count, because
the denominator is the constraint. It renders `--arag-warn-fg` at ≥ 45 and `--arag-danger-fg` above
50.

**Schema state chips** (words, never colour alone):

| Chip | Class | Means | Row action |
| --- | --- | --- | --- |
| `Provisioned` | `ok` | The kv-schema in the Knowledge Box matches this config's fields | `Re-provision` |
| `Out of date` | `warn` | The config changed after the schema was written | `Provision` (primary in the menu) |
| `Not provisioned` | `warn` | No kv-schema exists for this config yet | `Provision` |
| `Over the limit` | `danger` | The config has more than 50 fields, or the Knowledge Box already holds 20 schemas | `Remove a field ›` / `Free a schema ›` |
| `Failed` | `danger` | The last provision attempt returned an error | `Provision` + the error in the drawer |

**Budget strip copy.**

- Heading: `Knowledge Box schemas`
- Under the meter: `One schema for each extraction config. A Knowledge Box holds 20.`
- At 18–19: `.arag-alert.warn` — `Two schemas left. A new config cannot be provisioned once all 20 are used.`
- At 20: `.arag-alert.error` — `All 20 schemas are in use. Delete a config's schema before provisioning another — the config and its records are unaffected.` The `+ New config` button stays enabled (a config with no schema is still useful for extraction); the **Provision** action on a new config is what is blocked, with that sentence beside it.
- `Provision all` reads `Provision all` when everything is current and `Provision all (2 out of date)` otherwise, and is disabled with `title="Every schema is current"` in the first case.

**States.** Loading: `skeletonRows(4)` in the table, the meter shows `—` and no fill.
Error: `errorState` replacing the table, the budget strip retained if it loaded.
Permission: provisioning writes to the Knowledge Box and needs a writer credential — the menu item
is present and disabled with `title="Provisioning needs a credential."`, never hidden.

---

### 2.2 Config detail — the Knowledge Box schema card

**Route** `/#/configs/:id` (unchanged; new card). **Breadcrumb** `Configs › Invoice`.

```
┌──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┐
│  ▤ Documents          24 │  Configs › Invoice                                                               │
│  ▤ Configs            13 │  Invoice                                     [ Re-provision ] [ Duplicate ] [ ⋯ ]│
│  ” Ask                   │  Built-in · 12 fields · 9 documents processed                                    │
│  ◷ Jobs                1 │ ──────────────────────────────────────────────────────────────────────────       │
│▎ ⚟ API                   │  ┌ Fields ───────────────────────────────┐ ┌ Knowledge Box schema ────────────┐  │
│  ⚒ Settings              │  │ Label       Key          Type   Req.  │ │ ● Provisioned · 12 of 50 fields  │  │
│                          │  │ Invoice no. invoice_num… string  ✓    │ │ ████░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  │
│                          │  │ Invoice date invoice_date string ✓    │ │                                  │  │
│                          │  │ Vendor      vendor_name  string  ✓    │ │ Schema id   dip_invoice          │  │
│                          │  │ Subtotal    subtotal     string       │ │ Written     13 Sep 2026, 09:12   │  │
│                          │  │ Tax         tax          string       │ │ Records     9 written · 0 rejected│ │
│                          │  │ Total       total        string  ✓    │ │                                  │  │
│                          │  │ …                                     │ │ Field           KB type   Mods   │  │
│                          │  └───────────────────────────────────────┘ │ invoice_number  text      req.   │  │
│                          │                                            │ invoice_date    date      req.   │  │
│                          │  ┌ Data Augmentation generator agent ────┐ │ vendor_name     text      req.   │  │
│                          │  │ ⊘ Not provisioned                     │ │ subtotal        float            │  │
│                          │  │                                       │ │ tax             float            │  │
│                          │  │ A generator agent fills this schema   │ │ total           float     req.   │  │
│                          │  │ in the Knowledge Box from the field   │ │ line_items      text      repeat.│  │
│                          │  │ descriptions, without this product's  │ │ …                                │  │
│                          │  │ pipeline. It does not return the      │ │                                  │  │
│                          │  │ sentence a value came from, so its    │ │ [ Re-provision ]  Schema JSON ▾  │  │
│                          │  │ values cannot be verified here.       │ └──────────────────────────────────┘  │
│                          │  │                                       │                                       │
│                          │  │ [ Add a generator agent ]             │                                       │
│                          │  └───────────────────────────────────────┘                                       │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Kit classes.** `.arag-breadcrumb`; `.arag-pagehead` (`.row`, `.sub`, `.actions`);
`.arag-split` for the two columns; `.arag-card` × 3; `.arag-table` for the field lists;
`.arag-meter` for the 12-of-50 bar; `.arag-chip` for the state; `<arag-json>` behind
`Schema JSON ▾` (a `<details>`); `.arag-btn`, `.arag-btn.secondary`; `menuButton` for `⋯`.
Nothing new.

**The Knowledge Box schema card, row by row.**

| Row | Content |
| --- | --- |
| State | `.arag-status[data-state]` + the chip vocabulary from § 2.1, then `12 of 50 fields` and the meter |
| `Schema id` | `dip_invoice`, mono, with a copy button |
| `Written` | absolute timestamp of the last successful provision, `Never` when unprovisioned |
| `Records` | `9 written · 0 rejected`, the rejected count linking to `/#/documents?kv_rejected=true` |
| Field table | one row per field: field id (mono), KB type, modifiers (`required`, `repeated`, `range 0–1000000`), and the description carried over from the config field, truncated with `.arag-truncate` and a `title` |
| Foot | `[ Re-provision ]` and `Schema JSON ▾` |

**Out of date** is the interesting state, and it must say *what* changed, not just *that*:

> **▲ Out of date**
> The config gained `purchase_order_ref` and changed `tax` from text to float after the schema was
> written. Documents processed since then have not had those values written to the Knowledge Box.
> `[ Re-provision ]`

**The field builder** (`/#/configs/new`, `/#/configs/:id/edit`) gains one column in `.dip-fieldrow`:

```
  Label                Key              Type      Knowledge Box type   Required
  [ Invoice total   ]  invoice_total    [ string ▾ ] [ float        ▾ ]   [✓]     ✕
                                                     Derived from string.
```

The `Knowledge Box type` select is pre-filled by the mapping table in § 2.0 and shows
`Derived from <type>.` beneath it until the user changes it, at which point it reads
`Set by hand.` Changing it marks the config out of date on save. A 51st field row renders
disabled with: `A Knowledge Box schema holds 50 fields. Remove one to add another.`

**Provisioning states.**

| State | Treatment |
| --- | --- |
| Idle | `[ Re-provision ]` / `[ Provision ]` |
| In flight | Button `Provisioning…`, disabled, `aria-busy` on the card. `announce("Provisioning the Knowledge Box schema for Invoice")` |
| Success | `toast("Knowledge Box schema provisioned", "ok")`; the card re-renders with the new timestamp; `announce("Provisioned. 12 fields written.")` |
| Partial | Possible: the ARAG search configuration provisions and the kv-schema does not, or vice versa. Both are reported separately in the card, never rolled into one green tick: `● ARAG search configuration provisioned` / `⊘ Knowledge Box schema failed — the Knowledge Box already holds 20 schemas.` |
| Failure | `.arag-alert.error` inside the card with the service's `detail` verbatim, a `Details ▾` carrying the status and `X-Request-Id`, and `[ Try again ]` |
| Budget refused | `The Knowledge Box already holds 20 schemas. Delete a schema from another config to provision this one.` + `[ See the schemas ]` → `/#/configs` |
| Permission | Provision disabled, `Provisioning needs a credential.` |

**Copy.**

| Element | String |
| --- | --- |
| Card heading | `Knowledge Box schema` |
| Unprovisioned body | `This config's fields are not yet a schema in the Knowledge Box. Until they are, extracted values stay in this product's store: they can be exported, but not filtered or searched through the Knowledge Box.` |
| Unprovisioned action | `Provision the schema` |
| Schema id label | `Schema id` |
| Agent card heading | `Data Augmentation generator agent` |
| Agent card body (none) | `A generator agent fills this schema in the Knowledge Box from the field descriptions, without this product's pipeline. It does not return the sentence a value came from, so its values cannot be verified here.` |
| Agent card action | `Add a generator agent` |
| Agent card body (provisioned) | `Provisioned 13 Sep 2026. Run it on a document from the document's Compare tab, or force it on upload by choosing this config with the agent path.` + `[ Remove the agent ]` |

**Playwright.** Provisioning a config writes a schema and the card shows `Provisioned` with the
field count; editing a field's KB type flips the card to `Out of date` with the named change;
a config with 20 schemas already used shows the budget refusal sentence rather than a bare error;
`Schema JSON ▾` reveals `<arag-json>` containing `dip_invoice`.

---

### 2.3 Document JSON tab — schema and written values

**Route** `/#/documents/:id/json` (existing tab, rebuilt).
**Breadcrumb** `Documents › invoice-review.txt`. **Tab** `JSON`, fifth of six (Record, Source &
evidence, Pipeline, Ask, Compare when present, JSON).

The tab becomes an `.arag-segmented` of two views — `Record` (what it shows today: the canonical
record as `<arag-json>`) and `Key-value fields` (new, the default when the document's config has a
provisioned kv-schema). `wireSegmented` handles the keyboard; the choice lives in the hash
(`?view=kv`) so it is linkable.

```
┌──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┐
│  ▤ Documents          24 │  Documents › invoice-review.txt                                                  │
│  ▤ Configs            13 │  Globex Supply Co Pty Ltd — INV-2026-1188          [ Export ▾ ] [ Ask ] [ ⋯ ]    │
│  ” Ask                   │ ──────────────────────────────────────────────────────────────────────────       │
│  ◷ Jobs                1 │  Record │ Source & evidence │ Pipeline │ Ask │ Compare │ ▎JSON                    │
│▎ ⚟ API                   │ ──────────────────────────────────────────────────────────────────────────       │
│  ⚒ Settings              │  [ Record ][▎Key-value fields ]                      [ Re-write to the KB ]      │
│                          │                                                                                  │
│                          │  ▲ One value was rejected by the Knowledge Box when this record was written.      │
│                          │    It is on the record and in exports, but it cannot be filtered on.              │
│                          │                                                                                  │
│                          │  Schema dip_invoice · written 13 Sep 2026, 09:41 · 11 of 12 fields written        │
│                          │                                                                                  │
│                          │  Field            KB type  Mods   Value in the Knowledge Box       State          │
│                          │ ─────────────────────────────────────────────────────────────────────────        │
│                          │  invoice_number   text     req.   INV-2026-1188                    ● Written      │
│                          │  invoice_date     date     req.   2026-08-03                       ● Written      │
│                          │  vendor_name      text     req.   Globex Supply Co Pty Ltd         ● Written      │
│                          │  subtotal         float           22500                            ● Written      │
│                          │  tax              float           2250                             ● Written      │
│                          │  total            float    req.   —                                ✗ Rejected     │
│                          │    422 · total: expected float, received "25,750.00 AUD"                          │
│                          │    On the record as "25,750.00 AUD". Not in the Knowledge Box, so it              │
│                          │    cannot be filtered on. Fix the value, or change the field to text.             │
│                          │  line_items       text     rep.   3 values                         ● Written      │
│                          │  payment_terms    text           —                                 ○ Empty        │
│                          │  purchase_order   text           —                                 ⊘ Not in schema│
│                          │ ─────────────────────────────────────────────────────────────────────────        │
│                          │  key_values.dip_invoice.data ▾        Schema JSON ▾                               │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Kit classes.** `.arag-tabs` + `wireTabs` (existing); `.arag-segmented` + `wireSegmented`;
`.arag-alert.warn` / `.error`; `.arag-datatable` without selection (`wireTable` with `onSort`
only — the field order is the schema's order by default, and sorting by state is the one sort worth
having); `.arag-chip` for the state column; `<arag-json>` behind the two disclosures;
`.arag-btn.secondary` for `Re-write to the KB`. Nothing new.

**The state vocabulary** — five values, each a chip and a sentence:

| State | Chip | Means |
| --- | --- | --- |
| `Written` | `ok` | The value is in the Knowledge Box and matches the record |
| `Differs` | `warn` | Both hold a value and they are not equal — shows both: `Knowledge Box: 22500` / `Record: 22550`, with `Re-write` |
| `Empty` | `neutral` | The field is in the schema, the extraction found nothing, and the field is not required |
| `Rejected` | `danger` | The write returned 422; the reason verbatim beneath, plus the consequence sentence |
| `Not in schema` | `neutral` outline | The record has a field the kv-schema does not — the config changed after the schema was provisioned. Links to `Configs › Invoice` with `The schema is out of date ›` |
| `Missing` | `danger` | Required in the schema and absent from both. `The Knowledge Box requires this field. The write for this record did not include it.` |

**How a 422 reads.** This is the single most important piece of copy in § 2, because it is where
the two stores disagree and where an engineer will spend their afternoon. Three sentences, always
in this order:

1. **The verbatim reason**, in mono, prefixed with the status:
   `422 · total: expected float, received "25,750.00 AUD"`
2. **Where the value actually is**: `On the record as "25,750.00 AUD".`
3. **What it costs, and the two fixes**: `Not in the Knowledge Box, so it cannot be filtered on.
   Fix the value, or change the field to text.` — `Fix the value` links to the Record tab with that
   field focused (the correction flow, § 4.2); `change the field to text` links to the config's
   field builder with that row focused.

The page-level alert counts them: `One value was rejected…` / `Three values were rejected…`, and
the whole document is reachable from `/#/documents?kv_rejected=true`, so a queue of "records the
Knowledge Box would not take" exists and is not something only a log knows about.

**`Re-write to the KB`** re-sends `key_values.<schemaId>.data` for this record. It is not
destructive (it overwrites values this product wrote, with values this product holds) so it takes
no confirmation, but it is a write: disabled without a credential, `aria-busy` while in flight,
`toast("11 values written, 1 rejected")` on completion, and the table re-renders from the response
rather than from an optimistic guess.

**States.**

| State | Treatment |
| --- | --- |
| Loading | `skeletonRows(6)` under a real header |
| No kv-schema for this config | `.arag-emptystate`: **`No Knowledge Box schema for this config`** / *"This document's extraction config has not been provisioned as a key-value schema, so its values live only in this product's store. Provisioning writes them to the Knowledge Box, where they can be filtered and searched."* + `[ Open the config ]` |
| Schema exists, nothing written | **`No values written yet`** / *"The schema exists but this record has not been written to it. This happens when a document was processed before the schema was provisioned."* + `[ Write this record to the Knowledge Box ]` |
| Document not ready | The segmented control is present, the kv view says `This document is still processing. Values are written after the validate stage.` |
| KB unreachable | `.arag-alert.error`: `The Knowledge Box did not respond, so the written values could not be read. The record below is this product's copy.` and the Record segment is selected automatically |
| Error | `errorState` inside the panel; the Record segment still works |
| Permission | `Re-write to the KB` disabled with `Writing needs a credential.` |

**Keyboard and screen reader.** The segmented control is a `role="tablist"`-shaped
`.arag-segmented` with arrow keys (the kit's `wireSegmented`). The table's state column is read as
text, never as colour; a rejected row carries `aria-describedby` pointing at its reason line, so a
screen-reader user hears the reason with the row rather than after the table.
`announce("11 of 12 values written to the Knowledge Box. One rejected.")` on load, once.

**Playwright.** The kv segment lists every schema field with its type; a document whose `total` was
rejected shows `Rejected`, the verbatim 422 reason and both fix links; `Re-write to the KB` issues
one request and the table re-renders from its response; a config without a schema shows the empty
state and its link lands on the config; `?view=kv` deep-links the segment.

---

### 2.4 Documents list — filtering and faceting through the Knowledge Box

**Route** `/#/documents?…&kv=<schemaId>.<fieldId>:<op>:<value>` (repeatable).
**Breadcrumb** none. **Rail** Documents.

This is where the capability becomes a workflow: *"invoices from Globex over $10,000 that are still
unreviewed"* is one query across two stores, and the user has to be able to see the seam.

```
┌──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┐
│  ▤ Documents          24 │  Documents                                            [ + Upload document ]      │
│  ▤ Configs            13 │ ──────────────────────────────────────────────────────────────────────────       │
│  ” Ask                   │  ┌ 24 documents ─┬ 2 need review ─┬ 1 processing ─┬ Mean grounding ──┐           │
│  ◷ Jobs                1 │  │      24       │       2        │      1        │      0.91        │           │
│▎ ⚟ API                   │  └───────────────┴────────────────┴───────────────┴──────────────────┘           │
│  ⚒ Settings              │                                                                                  │
│                          │  [ 🔍 Search filename, type or value ] [Status ▾] [Type ▾] [Config ▾]             │
│                          │  [Uploaded: any ▾]  [ + Field filter ]   Sort: Newest first ▾   Clear all        │
│                          │                                                                                  │
│                          │  Status: Ready ✕    Knowledge Box: Invoice total ≥ 10 000 ✕                      │
│                          │  Knowledge Box: Vendor is “Globex Supply Co Pty Ltd” ✕                           │
│                          │                                                                                  │
│                          │  6 of 24 documents · 2 filters ran in the Knowledge Box, 1 in this workspace.     │
│                          │  18 documents were not considered: their values are not in the Knowledge Box. ⓘ   │
│                          │                                                                                  │
│                          │  ☐  File                    Type       Status    Fields  Ground.  Issues         │
│                          │ ─────────────────────────────────────────────────────────────────────────        │
│                          │  ☐  invoice-review.txt      Invoice    ● Ready      12     92%    ▲ 1  ⋯         │
│                          │     INV-2026-1188 · Globex Supply Co · total 25 750.00 · 3 min ago               │
│                          │  ☐  invoice-1187.pdf        Invoice    ● Ready      12    100%     —   ⋯         │
│                          │     INV-2026-1187 · Globex Supply Co · total 14 200.00 · 1 h ago                 │
│                          │ ─────────────────────────────────────────────────────────────────────────        │
│                          │                                                       1–6 of 6                   │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**The `+ Field filter` popover.** `popover(anchor, html)` from the kit, anchored to the button,
placed by `placeCard` so it never falls off-screen. Three steps in one card, each revealed as the
previous is answered — a three-select row is unreadable before you know what the first one does.

```
┌ Filter by an extracted value ────────────────────────┐
│ Field                                                │
│ [ Invoice · Invoice total                        ▾ ] │
│   Grouped by config. Only fields that are in a       │
│   Knowledge Box schema can be filtered.              │
│                                                      │
│ Is                                                   │
│ [ at least                                       ▾ ] │
│                                                      │
│ Value                                                │
│ [ 10000                                            ] │
│   float · 9 documents have a value · 120.00 – 96 000 │
│                                                      │
│              [ Cancel ]  [ Add filter ]              │
└──────────────────────────────────────────────────────┘
```

**Operators by type** — the list is short on purpose; every one of them has to map to a filter
expression the Knowledge Box actually supports.

| kv type | Operators |
| --- | --- |
| `text` | `is`, `is not`, `contains`, `is set`, `is not set` |
| `integer`, `float` | `is`, `is not`, `at least`, `more than`, `at most`, `less than`, `between`, `is set`, `is not set` |
| `date` | `is`, `on or after`, `on or before`, `between`, `is set`, `is not set` |
| `boolean` | `is true`, `is false`, `is set`, `is not set` |
| any, `repeated` | `includes`, `does not include`, `is set`, `is not set` |

**Facet counts.** For `text` and `boolean` fields the Value control is a list, not a free input:
each distinct value with its count from the Knowledge Box, ordered by count, capped at 20 with a
search box above it and `… 34 more values` beneath.

```
 Value
 [ 🔍 Filter values                                  ]
 ◉ Globex Supply Co Pty Ltd                        9
 ○ Acme Robotics Pty Ltd                           6
 ○ Meridian Health                                 4
 ○ Northwind Traders                               2
   … 34 more values
```

For `integer`, `float` and `date` there is no facet list — a count per distinct amount is noise.
The helper line carries the range instead: `float · 9 documents have a value · 120.00 – 96 000.00`,
and for dates `date · 21 documents have a value · 2026-01-04 – 2026-09-12`. When the Knowledge Box
returns no facet data at all the helper line says so rather than showing a false zero:
`Value counts are not available for this field.`

**NEW API** `GET /api/v1/kv-facets?field=dip_invoice.vendor_name` →
`{ field, type, count, values?: [{ value, count }], truncated, min?, max? }`. Cached for 60 s
client-side — a facet list is not worth a round trip per keystroke.

**Applied filters, and telling the two apart.** Every applied filter renders as an
`.arag-filterchip` below the filter bar. The distinction is carried in **words**, not an icon and
not a colour:

- Local: `Status: Ready ✕`, `Type: Invoice ✕`, `Search: globex ✕`
- Knowledge Box: `Knowledge Box: Invoice total ≥ 10 000 ✕`

plus `.dip-filterchip--kb` (**product-local CSS**): a 2 px dashed left border in
`--arag-border-strong` and `font-variant-numeric: tabular-nums` on the value. Dashed, not coloured,
because every colour in this product already means something. The chip's `aria-label` is
`Knowledge Box filter: Invoice total at least 10 000. Remove.`

**The count line** is the other half of the answer, and it is required whenever at least one kv
filter is set:

> `6 of 24 documents · 2 filters ran in the Knowledge Box, 1 in this workspace.`
> `18 documents were not considered: their values are not in the Knowledge Box.` ⓘ

The ⓘ opens a `popover`:

> *"A Knowledge Box filter matches against the typed values written to a resource's key-value
> fields. A document whose extraction config has no schema, or whose value was rejected at write,
> holds no value to match — so it is not excluded by the filter, it is never seen by it. Search,
> status and type filters run over this product's own store and see every document."*
> `[ Which documents are these? ]` → `/#/documents?kv_written=false`

That last link matters. "18 documents were not considered" is only honest if the user can see them.

**Composition and order.** Stated so the implementation and the count line agree:

1. kv filters run **first**, against the Knowledge Box, returning a set of resource ids.
2. The local filters (`q`, `status`, `doc_type`, `config`, `date_from`, `has_issues`, `degraded`,
   `min_grounding`) run over the store, **restricted to that set** when any kv filter is present.
3. Sorting and paging happen after the intersection. `total` in the response is the intersected
   count; two new response fields carry the rest of the story:
   `kv: { matched: 6, candidates: 24, unwritten: 18, filters: 2 }`.

The Knowledge Box is the authority on values; the store is the authority on status and grounding.
Running kv first also keeps the request to the Knowledge Box independent of paging, which is what
makes the facet counts stable while the user pages.

**Row subline.** When a kv filter is on a numeric or date field, that field's value joins the
subline — `INV-2026-1188 · Globex Supply Co · total 25 750.00 · 3 min ago` — because a user who
filtered by total wants to see totals. At most one such value; the subline is already carrying
three facts.

**States.**

| State | Treatment |
| --- | --- |
| Field list empty (no schema provisioned anywhere) | `+ Field filter` is disabled with `title="No extraction config has a Knowledge Box schema yet."`, and the popover, if opened by keyboard, renders `.arag-emptystate`: **`No fields to filter on`** / *"Filtering by extracted values needs an extraction config provisioned as a Knowledge Box schema."* + `[ Open Configs ]` |
| Facets loading | The value list shows three `.arag-skeleton.row`; the operator and field selects stay usable |
| Facets failed | `Value counts could not be loaded. You can still type a value.` and the list becomes a free input |
| KB unreachable while a kv filter is set | The list does **not** silently fall back to local-only results. `.arag-alert.error` above the table: **`The Knowledge Box did not respond, so the value filters could not run.`** / *"These results are filtered by status and search only."* + `[ Try again ]` `[ Remove the value filters ]`. The kv chips render `.arag-filterchip` with a struck-through label and `aria-disabled="true"`. |
| No results | `.arag-emptystate`: **`No documents match these filters`** / *"Two of these filters run in the Knowledge Box. A document whose values were never written there cannot match them."* + `[ Clear all filters ]` `[ Remove the value filters ]` |
| In flight | The table keeps the last good rows with `aria-busy="true"` and the kit's stale-refresh bar, exactly as the existing list does |

**Keyboard and screen reader.** `+ Field filter` is a `<button aria-haspopup="dialog"
aria-expanded>`; the popover traps focus, Escape closes it and returns focus to the button, and
`Add filter` is the form's submit. Each chip's `✕` is a real button with the accessible name
`Remove the filter: Invoice total at least 10 000`. The count line lives in the table's
`<caption class="sr-only">` as well as on screen, so the caption reads
`24 documents, 6 matching, filtered by status and two Knowledge Box value filters, sorted by newest first`.
`announce("6 of 24 documents. Two filters ran in the Knowledge Box.")` after each filter change,
debounced 400 ms.

**Playwright.** Adding a value filter appends a `kv=` parameter to the hash and the chip reads
`Knowledge Box: …`; the count line names both stores; the ⓘ popover's link lands on a list of
unwritten documents; a kv filter combined with `status=ready` produces the intersection and not the
union; with the Knowledge Box mocked to fail, the error alert appears and the results are **not**
silently local; the chip's remove button restores the full count; at 390 px the popover renders as
a sheet and the page does not scroll sideways.

---

### 2.5 Compare — this product's pipeline against the generator agent

**Route** `/#/documents/:id/compare`. **Breadcrumb** `Documents › invoice-review.txt`.
**Tab** `Compare`, between `Ask` and `JSON`. **Shown only** when the document's extraction config
has a provisioned generator agent — otherwise the tab is absent and the place to create one is the
config (§ 2.2). No greyed tab, no "coming soon".

```
┌──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┐
│  ▤ Documents          24 │  Documents › invoice-review.txt                                                  │
│  ▤ Configs            13 │  Globex Supply Co Pty Ltd — INV-2026-1188          [ Export ▾ ] [ Ask ] [ ⋯ ]    │
│  ” Ask                   │ ──────────────────────────────────────────────────────────────────────────       │
│  ◷ Jobs                1 │  Record │ Source & evidence │ Pipeline │ Ask │ ▎Compare │ JSON                    │
│▎ ⚟ API                   │ ──────────────────────────────────────────────────────────────────────────       │
│  ⚒ Settings              │  9 of 12 values agree · 2 differ · 1 only from the agent   [ Re-run the agent ]  │
│                          │                                                                                  │
│                          │  ▲ The generator agent does not return the sentence a value came from, so this    │
│                          │    product cannot check its values against the document. The evidence contract    │
│                          │    applies to the left-hand column only.                                          │
│                          │                                                                                  │
│                          │  ┌ This product's pipeline ───────────┬ Generator agent ───────────────────────┐  │
│                          │  │ extract → validate · 6.1 s         │ dip-invoice-gen · ran 13 Sep, 09:44   │  │
│                          │  ├────────────────────────────────────┼───────────────────────────────────────┤  │
│                          │  │ Invoice number                     │ Invoice number              ● Agree   │  │
│                          │  │ INV-2026-1188                      │ INV-2026-1188                         │  │
│                          │  │ ✓ Verified                         │ Not grounded                          │  │
│                          │  │ “Invoice No: INV-2026-1188”        │ —                                     │  │
│                          │  ├────────────────────────────────────┼───────────────────────────────────────┤  │
│                          │  │ Total                              │ Total                      ▲ Differs  │  │
│                          │  │ 25750    raw “$25,750.00”          │ 25570                                 │  │
│                          │  │ ≈ Near match                       │ Not grounded                          │  │
│                          │  │ “Total Due: $25,750.00”            │ —                     [ Use this ⋯ ]  │  │
│                          │  ├────────────────────────────────────┼───────────────────────────────────────┤  │
│                          │  │ Payment terms                      │ Payment terms         ◐ Only the agent│  │
│                          │  │ Not found                          │ Net 30 days                           │  │
│                          │  │ —                                  │ Not grounded          [ Use this ⋯ ]  │  │
│                          │  ├────────────────────────────────────┼───────────────────────────────────────┤  │
│                          │  │ Line items                         │ —                     ◑ Only here     │  │
│                          │  │ 3 values  ✓ Verified               │ Not in the agent's schema             │  │
│                          │  └────────────────────────────────────┴───────────────────────────────────────┘  │
│                          │                                                                                  │
│                          │  Grounding 92% on the left. The agent's values are not scored — nothing was       │
│                          │  checked against the document. What is this? ⓘ                                    │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Kit classes.** `.arag-split.even` for the two columns; `.arag-alert.warn` for the honesty banner;
`.arag-chip` for the row state; `.arag-btn.secondary` for `Re-run the agent`; `menuButton` for the
per-row `⋯`; `popover` for `What is this? ⓘ`. **Product-local**: `.dip-field` (reused verbatim on
the left, so a field reads identically here and on the Record tab) and a new `.dip-compare`
grid wrapper holding the aligned pairs.

**Row states**, aligned by field key, ordered by state (`Differs` first, then `Only the agent`,
then `Only here`, then `Agree`) because the differences are the reason the screen exists:

| State | Chip | Means |
| --- | --- | --- |
| `Agree` | `ok` | Both produced a value and the normalised values are equal |
| `Differs` | `warn` | Both produced a value and they are not equal |
| `Only the agent` | `info` | The pipeline found nothing; the agent wrote a value |
| `Only here` | `neutral` | The pipeline found a value; the field is not in the agent's schema, or the agent wrote nothing |
| `Neither` | `neutral` outline | Collapsed into `… 3 fields where neither produced a value ▾` at the foot, never given a row of its own |

**The honest labelling, spelled out.** This is the part that must not be softened:

1. The left column carries the full evidence contract — the verification chip, the quote, the jump
   to source — because it earned it.
2. The right column carries **no verification chip, ever**. Every agent value shows
   `Not grounded` in `--arag-text-muted` with a `title`:
   *"The generator agent returns values, not the sentences they came from. Nothing on this side has
   been checked against the document."* If a future agent does return a source paragraph, the label
   becomes `Source: paragraph 12` and still reads `not checked by this product` beneath it — a
   paragraph reference is not a verified quote.
3. The banner above the table states the same thing in full, and is not dismissible.
4. The grounding score is reported for the left column only, with the denominator, and the right
   column is explicitly **not scored**: *"The agent's values are not scored — nothing was checked
   against the document."* Never `0%`; never a second gauge.
5. `Agree` is `ok` green because the two paths agreeing is real information — but it is agreement,
   not verification, and the chip's `title` says so: *"Both paths produced the same value. Only the
   left-hand value was checked against the document."*

**`Use this ⋯`** on an agent row opens the row menu with `Use the agent's value`, which routes into
the field-correction flow (§ 4.2) pre-filled with the agent's value and a fixed reason,
`Taken from the generator agent`. The resulting field is marked `Corrected` with the provenance
`generator agent`, **not** `a person` — the audit has to say which. It is never marked verified.

**Actions.**

| Action | Behaviour |
| --- | --- |
| `Run the generator agent` | Shown when the agent is provisioned but has not run on this document. `POST /api/v1/documents/{id}/agent-run` → `202 { job }`; the panel switches to a running state with the job's stage and elapsed time, streamed from `/api/v1/jobs/{id}/events` |
| `Re-run the agent` | Same, with a note in the head: `Last run 13 Sep 2026, 09:44.` |
| `Export this comparison` | CSV of `field, pipeline_value, agent_value, state, verification` — the artefact an evaluation actually needs |

**States.**

| State | Treatment |
| --- | --- |
| Loading | Two columns of `skeletonRows(5)` with the real heads |
| Agent provisioned, never run | `.arag-emptystate`: **`The generator agent has not run on this document`** / *"Running it fills the same Knowledge Box schema from the field descriptions, without this product's pipeline, so the two can be compared."* + `[ Run the generator agent ]` |
| Running | `.arag-pill-live` in the head, the stage name, elapsed time, `[ Cancel ]`; the pipeline column stays fully readable throughout |
| Agent run failed | `.arag-alert.error` with the service's message verbatim and the failure advice line from § 4.1 of the existing design; `[ Run it again ]` |
| Pipeline record degraded | The left head carries the existing degraded banner; comparison continues on the fields that exist |
| Agent produced nothing | **`The generator agent returned no values`** / *"It ran without error and wrote nothing to the schema. The field descriptions may not match what is on this document."* + `[ Open the config ]` |
| KB unreachable | `errorState` for the right column only; the left column renders from the local record |
| Permission | `Run` / `Re-run` disabled with `Running the agent needs a credential.` |

**≤ 900 px.** The two columns do **not** stay side by side — 180 px each is unreadable. The layout
becomes one card per field, the state chip in the card head, and the two values stacked inside it,
labelled `This product` and `Generator agent`:

```
┌ Total                                        ▲ Differs ┐
│ This product     25750   raw “$25,750.00”              │
│                  ≈ Near match                          │
│                  “Total Due: $25,750.00”               │
│ Generator agent  25570   Not grounded   [ Use this ⋯ ] │
└────────────────────────────────────────────────────────┘
```

**Keyboard and screen reader.** The comparison is a real `<table>` with
`<caption class="sr-only">Extracted values from this product's pipeline and from the generator
agent, twelve fields, two differ</caption>`, `<th scope="col">` on the two column heads and
`<th scope="row">` on the field label, so a screen reader announces
`Total, this product, 25750, near match` and `Total, generator agent, 25570, not grounded`.
Sorting by state is the one sortable column (`aria-sort`). `announce("Comparison ready. Nine of
twelve values agree, two differ, one only from the agent.")` on load.

**Playwright.** The Compare tab is absent for a document whose config has no agent and present when
it has one; running the agent streams a job and lands on a comparison; a differing field renders
`Differs` with both values; **no element in the agent column carries a verification chip**
(`expect(agentColumn.locator('.dip-field__verify')).toHaveCount(0)`); the banner is present and not
dismissible; `Use the agent's value` opens the correction editor pre-filled and the saved field is
labelled `Corrected` with the agent provenance and no verified chip; at 390 px the layout is one
card per field.

---

## 3. Settings, fully editable

Brief bar 1: *"Nothing the product reads from configuration may be read-only in the UI except
secrets, which are set once and then shown as 'set · rotate'."* The existing Settings area is
entirely read-only and says so in words — *"Read-only: branding is environment configuration, so a
form that appeared to save would be a lie."* That sentence was true of the old architecture and is
now false. It goes, and so does every other apology for a missing form.

### 3.1 Information architecture

One Settings area, six groups, in the operator app's shell. The admin app keeps only what is
genuinely *operations* — Overview, Jobs, Logs, Usage and a read-only Security posture. Every
editable value lives once, here.

| # | Tab | Route | Who can read | Who can edit | Contents |
| --- | --- | --- | --- | --- | --- |
| 1 | Connection | `/#/settings/connection` (default) | anyone | operator | Knowledge Box id, region, base URL, ARAG API key (secret), generative model, reranker, request timeout, extract strategy, connection test |
| 2 | Branding | `/#/settings/branding` | anyone | operator | Product name, tagline, logo upload, primary colour, accent colour, footer text, powered-by, docs URL, support URL, live preview |
| 3 | Limits | `/#/settings/limits` | anyone | operator | Max upload size, accepted types, public rate limit, ask rate limit, max question length, job concurrency |
| 4 | API keys | `/#/settings/keys` | operator | operator | Create, name, scope, expiry, last used, revoke |
| 5 | Retention | `/#/settings/retention` | anyone | operator | Retention policy, purge preview, typed purge |
| 6 | API | `/#/settings/api` | anyone | — | Usage, docs links, the API explorer, credentials explainer, guided sample, keyboard shortcuts |

**Why one area with per-group locks rather than two apps.** The brief says operator-only changes
sit behind the admin sign-in *in the same shell*. Splitting the same setting across two apps is how
the current product ended up with a read-only branding screen in one place and a read-only branding
screen in the other. A viewer arriving at `/#/settings/connection` sees the real, non-secret,
effective values — DP-40 already guarantees that payload is safe — and a footer that says exactly
what unlocks editing. An operator signs in without leaving the page.

`/#/settings/keys` is the one tab a viewer cannot read at all: a list of key names and last-used
times is an inventory of who can call the service. Its locked state renders the group and the
sign-in prompt, and no rows.

### 3.2 The per-field pattern — effective value and where it came from

Every setting is one `.dip-setting` row (**product-local CSS**; proposed to the kit as
`.arag-setting` in 0.3.0 — it is generic and all three accelerators need it).

```
┌ .dip-setting ─────────────────────────────────────────────────────────────┐
│ Generative model                              [ Set here ]  ↩ Reset       │  ← label + provenance + reset
│ [ chatgpt-azure-4o-mini                                            ▾ ]    │  ← control
│ Used for classification, extraction and every ask.                        │  ← .arag-help
│ Environment default: chatgpt-azure-4o-mini · ARAG_GENERATIVE_MODEL         │  ← .dip-setting__origin
└───────────────────────────────────────────────────────────────────────────┘
```

| Part | Rule |
| --- | --- |
| Label | `<label>` bound to the control. Sentence case. Always visible — no placeholder-as-label. |
| Provenance badge | `.arag-chip.neutral` reading **`Environment default`** when the store holds nothing for this key, `.arag-chip.info` reading **`Set here`** when it does. Two states only; "unset" is not a third, because a setting with no environment default and no stored value shows `Not set` as its *value* and `Environment default` as its provenance. |
| Reset | `↩ Reset` (`.arag-btn.ghost.sm`) appears only when the badge reads `Set here`. Clicking it calls `DELETE /api/v1/settings/{group}/{key}`, the badge flips back, and the control repopulates with the environment value. No confirmation — it is reversible by retyping. |
| Helper | One sentence saying what the setting does, present tense, no hedging. |
| Origin line | `.dip-setting__origin`, `.small.muted`, always present: `Environment default: <value> · <ENV_VAR>` in mono. When there is no environment default: `No environment default · <ENV_VAR>`. Priya needs the variable name; Dana ignores the line; nobody has to ask what "overrides" means. |

The origin line is what makes the override model legible without a paragraph of explanation, and it
is why the `GET /api/v1/settings` response has to change shape.

**NEW API — `GET /api/v1/settings` (extended).** Every value becomes a triple. Still `auth: "api"`,
still no secret, still no extract-strategy id (DP-40 unchanged):

```json
{
  "connection": {
    "kbId":            { "value": "3f9a…c21", "source": "environment", "env": "ARAG_KB_ID", "editable": true },
    "generativeModel": { "value": "chatgpt-azure-4o-mini", "source": "store",
                         "default": "chatgpt-azure-4o-mini", "env": "ARAG_GENERATIVE_MODEL", "editable": true },
    "apiKey":          { "set": true, "hint": "…a91f", "rotatedAt": "2026-09-10T04:12:00Z",
                         "source": "store", "env": "ARAG_API_KEY", "secret": true }
  },
  "branding": { … }, "limits": { … }, "retention": { … },
  "capabilities": { "edit": false, "reason": "operator-token-required" }
}
```

`capabilities.edit` is how the screen decides between the editable and the locked rendering without
guessing from a 401 it has not yet received.

### 3.3 Locking, and signing in without leaving the page

A group a viewer may read but not edit renders **the real values, in disabled controls**, with one
`.arag-alert` at the foot of the group:

> **Editing these settings needs the operator token.**
> The values above are what this deployment is using now.
> `[ Sign in as operator ]`

`Sign in as operator` opens `openDrawer({ title: "Operator sign-in" })` containing the same form as
the admin app's `.arag-signin` card — one password field, one button, the two distinct failure
messages (DP `401` → *"That token was not accepted."*, `403` → *"Admin access is disabled for this
deployment. Set ADMIN_TOKEN and restart to enable it."*). On success it calls
`POST /api/v1/admin/login`, closes, re-fetches `GET /api/v1/settings`, and re-renders the group in
edit mode with focus on the first control. The rail gains a foot row `Signed in as operator ·
Sign out` (`.arag-status[data-state="ok"]`), which is the only permanent sign that the session
exists, and `Sign out` calls the logout endpoint and re-locks every group in place.

**DP-43 check:** the drawer carries no wordmark. The band already has the only one.

### 3.4 Save, dirty, error

**Per card, not per page.** A page-level save bar for six cards means a user cannot tell which of
their changes is being rejected.

| State | Treatment |
| --- | --- |
| Clean | No footer bar. The card head carries no chip. |
| Dirty | The card head gains `.arag-chip.warn` `Unsaved`; a footer bar appears inside the card: `3 unsaved changes` on the left, `[ Discard ]` `[ Save changes ]` on the right. `Save changes` is `.arag-btn`, `Discard` is `.arag-btn.ghost`. |
| Leaving dirty | `onLeave` intercepts the hash change and calls `confirmDialog({ title: "Leave without saving?", body: "Three changes to Connection will be lost.", confirmLabel: "Leave", danger: true })`. Cancel restores the hash. |
| Saving | `Save changes` reads `Saving…`, disabled; `aria-busy="true"` on the card; every control disabled; `announce("Saving connection settings")`. |
| Saved | Footer bar disappears; `toast("Connection settings saved", "ok")`; affected provenance badges flip to `Set here`; the card foot shows `Last changed by the operator · just now`; `announce("Connection settings saved. Three changes applied.")`. |
| Saved, effect | Every setting in this area is read from the store per request, so the card foot says **`In effect now.`** The three exceptions state themselves: upload size and accepted types read **`In effect for the next upload.`**; job concurrency reads **`In effect for the next job. Running jobs keep the old value.`**; nothing in this product needs a restart, and no copy anywhere may say it does. |
| Field error | `aria-invalid="true"` + `aria-describedby` on the control, the message directly beneath it in `--arag-danger-fg`: `Must be between 1 and 200.` The footer bar's Save stays enabled — the user fixes it and saves; disabling Save on a field error hides which field is wrong. |
| Save rejected | `.arag-alert.error` at the top of the card with the problem document's `detail` verbatim, plus a summary line linking to each offending field: `Two values were not accepted: Request timeout, Reranker.` Each link focuses its control. |
| Save rejected, 401 | The group re-locks and the alert reads `Your operator session expired. Sign in again to save.` + `[ Sign in as operator ]` — **with the edits preserved in the form**, so nothing is retyped. |
| Conflict (409) | `Someone else changed these settings while you were editing. [ Show what changed ] [ Save anyway ]` — the diff rendered in a drawer. Two operators on one deployment is rare and losing an afternoon's configuration to a silent overwrite is not acceptable at any rate. |

### 3.5 The five groups

#### 3.5.1 Connection — `/#/settings/connection`

```
┌──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┐
│  ▤ Documents          24 │  Settings                                                                        │
│  ▤ Configs            13 │ ──────────────────────────────────────────────────────────────────────────       │
│  ” Ask                   │  ▎Connection │ Branding │ Limits │ API keys │ Retention │ API                     │
│  ◷ Jobs                1 │ ──────────────────────────────────────────────────────────────────────────       │
│  ⚟ API                   │  ┌ Knowledge Box ──────────────────────────────────────── Unsaved ─────┐         │
│▎ ⚒ Settings              │  │ ● Connected · 142 ms · 24 resources          [ Test connection ]    │         │
│                          │  │                                                                     │         │
│  ────────────────────    │  │ Knowledge Box id                       [ Environment default ]      │         │
│  ● Knowledge Box online  │  │ [ 3f9a2c7e-4d11-4b90-9f22-0a1b2c3dc21                          ]    │         │
│  Signed in as operator   │  │ The Knowledge Box every document is written to and read from.       │         │
│  Sign out                │  │ Environment default: 3f9a…c21 · ARAG_KB_ID                          │         │
│                          │  │                                                                     │         │
│                          │  │ Region                                 [ Environment default ]      │         │
│                          │  │ [ europe-1                                                    ▾ ]   │         │
│                          │  │ Sets the base URL unless one is given below.                        │         │
│                          │  │ Environment default: europe-1 · ARAG_REGION                         │         │
│                          │  │                                                                     │         │
│                          │  │ Base URL                               [ Set here ]  ↩ Reset        │         │
│                          │  │ [ https://europe-1.rag.progress.cloud                          ]    │         │
│                          │  │ Overrides the region. Leave empty to use the region's URL.          │         │
│                          │  │ Environment default: (none) · ARAG_BASE_URL                         │         │
│                          │  │                                                                     │         │
│                          │  │ ARAG API key                                                        │         │
│                          │  │ ● Set · ends a91f · rotated 3 days ago          [ Rotate ]          │         │
│                          │  │ Never shown after it is set. Rotating replaces it immediately.      │         │
│                          │  │ Environment default: set · ARAG_API_KEY                             │         │
│                          │  ├─────────────────────────────────────────────────────────────────────┤        │
│                          │  │ 2 unsaved changes            [ Discard ]  [ Save changes ]           │        │
│                          │  └─────────────────────────────────────────────────────────────────────┘        │
│                          │  ┌ Processing ─────────────────────────────────────────────────────────┐        │
│                          │  │ Generative model · Reranker · Request timeout · Extract strategy     │        │
│                          │  │ In effect now.                                                      │        │
│                          │  └─────────────────────────────────────────────────────────────────────┘        │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

| Setting | Control | Notes |
| --- | --- | --- |
| Knowledge Box id | `.arag-input`, mono, 36 chars | Validated as a UUID; changing it is the biggest change in the product and the save confirmation says so (below) |
| Region | `.arag-select` — `europe-1`, `aws-us-east-2-1`, `Custom (use the base URL)` | |
| Base URL | `.arag-input`, url | Empty ⇒ derived from the region. Helper states the precedence. |
| ARAG API key | secret row (§ 3.6) | |
| Generative model | `.arag-select` of the models the deployment advertises, plus `Other…` revealing a text input — a partner on a model this build has never heard of must not be stuck |
| Reranker | `.arag-select` — `Knowledge Box default`, `predict`, `none` | |
| Request timeout | number, seconds, 5–300 | Helper: `How long to wait for the Knowledge Box before a stage fails.` |
| Extract strategy | `.arag-switch` **Visual extraction for images and PDFs** | DP-40 holds: the switch and its label are all the viewer sees; the strategy id stays behind `GET /api/v1/admin/config`. The operator, when signed in, additionally sees the id in `.small.mono` beneath. |

`Test connection` calls **NEW API** `POST /api/v1/settings/connection/test` with the *current form
values, including an unsaved candidate key*, and persists nothing. Result inline:
`● Connected · 142 ms · 24 resources` or `⊘ Could not connect — 401 from the Knowledge Box. The API
key was not accepted.` Testing before saving is the difference between a settings screen and a
trap.

**Changing the Knowledge Box id** is confirmed, because it silently orphans every record:

> **Point this deployment at a different Knowledge Box?**
> The 24 documents in this workspace were written to `3f9a…c21`. They stay in this product's store,
> but their source, their evidence and their key-value fields live in the old Knowledge Box and
> will not be readable.
> `[ Cancel ] [ Change the Knowledge Box ]`

#### 3.5.2 Branding — `/#/settings/branding`

Two columns, `.arag-split`: the settings on the left, the live preview on the right, sticky.

| Setting | Control |
| --- | --- |
| Product name | `.arag-input`, ≤ 60, required. Helper: `Shown in the rail, the browser tab and every export.` |
| Tagline | `.arag-input`, ≤ 90. Empty hides the line. |
| Logo | `.arag-dropzone` accepting SVG, PNG, WebP ≤ 512 kB, plus a file input and `Remove the logo`. **NEW API** `POST /api/v1/settings/branding/logo` (multipart) → `{ logoUrl }`, written to `DATA_DIR/branding` and served from `/branding/`. |
| Primary colour | `<input type="color">` + a mono hex input, kept in step |
| Accent colour | same |
| Footer text | `.arag-input`, ≤ 120 |
| Powered-by credit | `.arag-switch`. Helper: `Shows the Progress brand band above the rail. Turning it off removes the band.` |
| Docs URL / Support URL | url inputs; support, when set, adds a `Support` link to the rail foot and every error's `Details ▾` |

**The preview, and DP-43.** The preview tile renders the chrome the values produce — and it must
not put a second Progress wordmark on the screen. Where the band's wordmark would be, it renders a
labelled placeholder, not the artwork:

```
┌ Preview ───────────────────────────────────────────┐
│ ┌──────────────────────────────────────────────┐   │
│ │ ░░ Progress wordmark ░░              ▪ ▪ ▪  │   │  ← ink-950, 2 px #5ce500 rule, no <img>
│ └──────────────────────────────────────────────┘   │
│ ┌──────────┬───────────────────────────────────┐   │
│ │ [ logo ] │  Documents                        │   │  ← the partner's mark, at true size
│ │ Acme Doc │  ─────────────────────────────    │   │
│ │ Read it  │  [ Primary ] [ Secondary ]        │   │
│ │  once    │  ● Ready ▲ Degraded ⊘ Failed      │   │
│ └──────────┴───────────────────────────────────┘   │
│ Status, verification, grounding and validation      │
│ colours are never branded: a partner may recolour   │
│ their product, but not the evidence.                │
└─────────────────────────────────────────────────────┘
```

The placeholder is a `<span class="dip-wordmark-ph" aria-hidden="true">Progress wordmark</span>` —
a dashed outline in `--arag-ink-700` on the ink strip, with `.sr-only` text
`The Progress Agentic RAG wordmark appears here when the powered-by credit is on.` Turning the
powered-by switch off removes the strip from the preview and from the page, which is the honest
preview of what that switch does. **Exactly one `img[src*="arag-logo"]` remains on the screen —
the band's.**

The partner logo preview uses the uploaded file via an object URL before it is saved, at
`height:24px; max-width:180px; object-fit:contain`, with an `onerror` handler that hides the image
and shows the product name as text. A broken logo must never leave the identity block empty.

The whole preview updates on input, not on save, and carries a line above it:
`Preview — not saved yet.` while the card is dirty.

#### 3.5.3 Limits — `/#/settings/limits`

| Setting | Control | Helper |
| --- | --- | --- |
| Maximum upload size | number + unit select (MB), 1–200 | `Applies to each file. The upload drawer shows this limit.` |
| Accepted file types | a chip adder over the known MIME types with their extensions | `A type removed here is rejected at upload with a message naming what is accepted.` |
| Public rate limit | two numbers: `requests per second` and `burst` | `Applies to every /api/v1 route without its own limit.` |
| Ask rate limit | two numbers | `Every ask is a generative call against the Knowledge Box. This bucket is deliberately tighter.` (DP-41) |
| Maximum question length | number, 100–8000 characters | `Longer questions are rejected before they reach the Knowledge Box.` |
| Job concurrency | number, 1–8 | `How many documents are processed at once. In effect for the next job.` |

Setting the public rate limit to `0` means *no limit*, and the helper says so beneath the input
when it is zero: `0 means no limit. The e2e suite runs this way; a public deployment should not.`

#### 3.5.4 API keys — `/#/settings/keys`

The real key store that replaces the `API_KEYS` environment variable. Operator-only, end to end.

```
┌──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┐
│  ⚒ Settings              │  Connection │ Branding │ Limits │ ▎API keys │ Retention │ API                     │
│                          │ ──────────────────────────────────────────────────────────────────────────       │
│                          │  Keys let a service call this API without a browser session.  [ + Create a key ] │
│                          │                                                                                  │
│                          │  Name                 Key          Scope        Created      Last used           │
│                          │ ─────────────────────────────────────────────────────────────────────────        │
│                          │  Showcase recorder    dip_a91f…    Read         12 Sep 2026  2 min ago      ⋯    │
│                          │  Nightly export       dip_7c02…    Read         02 Sep 2026  11 h ago       ⋯    │
│                          │  ERP ingest           dip_51bd…    Read & write 28 Aug 2026  Never used     ⋯    │
│                          │  Old pilot key        dip_0e44…    Read         04 Jul 2026  Revoked        ⋯    │
│                          │ ─────────────────────────────────────────────────────────────────────────        │
│                          │  4 keys · 1 revoked                                                              │
│                          │                                                                                  │
│                          │  ▲ API keys are not enforced on this deployment. Reads and uploads are open to    │
│                          │    anyone who can reach it. Creating a key does not turn enforcement on —         │
│                          │    set API_KEYS_REQUIRED, or Limits → Require a credential for reads.             │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Kit classes.** `.arag-datatable` + `wireTable` (`onSort` only — bulk-revoking keys is not a
workflow anyone wants), `menuButton` for the row menu, `openDrawer` for create, `confirmDialog` for
revoke, `.arag-snippet` + `wireCopy` for the reveal, `.arag-emptystate`. Nothing new.

**Columns.** Name; key prefix (`dip_a91f…`, mono — enough to match a key in a log, not enough to
use); scope (`Read` / `Read & write`); created (absolute, `title` with the time); last used
(relative, `title` absolute, `Never used` in muted, `Revoked <date>` in `--arag-danger-fg` for a
revoked key). Revoked keys stay in the table, greyed, because "which key did that call use" is a
question asked after the key is gone.

**Create.** `openDrawer({ title: "Create an API key" })`:

| Field | Control |
| --- | --- |
| Name | `.arag-input`, required, ≤ 60. Helper: `What this key is for. It appears in the log beside every call it makes.` |
| Scope | `.arag-segmented` — `Read` / `Read & write`. Helper for write: `Uploads, deletes, config changes, corrections and purges.` |
| Expires | `.arag-select` — `Never`, `In 30 days`, `In 90 days`, `In a year` |

Footer: `[ Cancel ] [ Create key ]`.

**The create-once reveal.** On success the drawer body is *replaced* — not followed by a toast:

```
┌ Create an API key ───────────────────────────── ✕ ┐
│                                                    │
│  ▲ This is the only time this key is shown.        │
│    It is stored as a hash and cannot be shown      │
│    again. Copy it now.                             │
│                                                    │
│  ┌──────────────────────────────────────── Copy ┐  │
│  │ dip_a91f4c7e2b0d48119a3f6c5e8d2b7014        │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  Name        Showcase recorder                     │
│  Scope       Read                                  │
│  Expires     Never                                 │
│                                                    │
│  Use it as X-API-Key, or as a bearer token.        │
│  curl -H 'X-API-Key: dip_a91f…' …      [ Copy ]    │
│                                                    │
│ ──────────────────────────────────────────────────  │
│                          [ I have copied it ]      │
└────────────────────────────────────────────────────┘
```

In this one state the drawer's Escape and scrim-click dismissal are **disabled**, and the close `✕`
is replaced by `I have copied it`. This is the only modal in the product that cannot be dismissed
by Escape, and the reason is that a key lost at this moment is unrecoverable. The behaviour is
announced: `announce("Your new API key is shown once. Copy it before closing.")`, and the dialog's
`aria-describedby` points at the warning. Closing returns focus to `+ Create a key`.

**Revoke.** Row menu → `Revoke`, then `confirmDialog({ danger: true })`:

> **Revoke “Nightly export”?**
> Any integration using this key gets a 401 on its next call. This cannot be undone — create a new
> key instead of un-revoking this one.
> `[ Cancel ] [ Revoke key ]`

Row menu also carries `Copy the prefix` and `Rename…` (an inline drawer with the name field alone).

**Enforcement.** The alert above the table is load-bearing and appears whenever
`security.apiKeysEnforced` is false. Creating keys while enforcement is off is legitimate — you
provision before you switch — but the screen must never imply that a key is protecting anything
that is not protected.

**States.** Empty: `.arag-emptystate` — **`No API keys yet`** / *"A key lets a service call this API
without a browser session. Keys are shown once, stored as a hash, and can be revoked at any time."*
+ `[ Create a key ]`. Locked (viewer): the group heading, the explanatory sentence, and the sign-in
alert — no rows and no counts. Loading: `skeletonRows(4)`. Error: `errorState` with retry.

#### 3.5.5 Retention — `/#/settings/retention`

Two cards: the policy, and the manual purge.

**Policy.** `Delete records older than` — `.arag-select`: `Never`, `30 days`, `90 days`, `1 year`,
`Custom…`. When set, a second row: `Run automatically` (`.arag-switch`) with the helper
`Checked once a day. Nothing is deleted while this is off — the policy only shows what would go.`
Beneath both, always: `Deleting a record also deletes its resource, its evidence and its key-value
fields from the Knowledge Box.`

**Purge now** (DP-38, unchanged in shape and re-stated here because it is the only bulk irreversible
action in the product):

```
┌ Purge now ──────────────────────────────────────────────────────────┐
│ Delete documents older than  [ 90 ] days        [ Preview ]         │
│                                                                      │
│ ┌ Preview ─────────────────────────────────────────────────────┐    │
│ │ 12 documents would be deleted.                                │    │
│ │ Oldest 04 Jul 2026 · newest 14 Jun 2026                       │    │
│ │ invoice-0031.pdf, claim-118.png, preauth-form.png, and 9 more │    │
│ │ Nothing has been deleted.              [ Delete 12 documents ]│    │
│ └───────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

`Preview` calls `POST /api/v1/admin/purge` with `dryRun: true` and deletes nothing. The preview is
required: `Delete 12 documents` does not exist until a preview has run, and changing the day count
clears the preview. The confirm is `confirmDialog({ typed: "DELETE", danger: true })`:

> **Delete 12 documents?**
> This deletes 12 records from this product and 12 resources from the Knowledge Box. It cannot be
> undone.
> Type `DELETE` to confirm. `[ ______ ]`
> `[ Cancel ] [ Delete 12 documents ]`

On success: `toast("12 documents deleted")`, `announce("12 documents deleted.")`, the preview card
is replaced by `Deleted 12 documents on 13 September 2026. [ Preview again ]`.

#### 3.5.6 API — `/#/settings/api`

Unchanged in purpose, with three edits: the usage strip stays; the credentials card drops the
sentence *"API keys are set with the `API_KEYS` environment variable; there is no key store to
create or revoke one from"* and links to `Settings → API keys` instead; and a new card sits second:

> **API explorer**
> Every operation this deployment publishes, with a form that calls it and a curl you can copy.
> `[ Open the API explorer ]` → `/#/api`

Keyboard shortcuts gain `g then i — Jump to the API explorer`.

### 3.6 The secret pattern

Two secrets exist: the ARAG API key (Connection) and, conceptually, the admin token (which is not
editable here — it is the credential that authorises editing, and a screen that can change its own
lock is a footgun; it stays an environment variable and Settings says so).

```
ARAG API key
● Set · ends a91f · rotated 3 days ago                       [ Rotate ]
Never shown after it is set. Rotating replaces it immediately.
Environment default: set · ARAG_API_KEY
```

| State | Rendering |
| --- | --- |
| Set | `.arag-status[data-state="ok"]` + `Set · ends a91f · rotated 3 days ago` + `[ Rotate ]`. The four-character hint is the tail, which is what a partner's key-management page shows them. |
| Set from the environment, never rotated here | `Set · from the environment` + `[ Rotate ]`. Rotating writes to the store, and the provenance badge on the row flips to `Set here`. |
| Not set | `.arag-status[data-state="warn"]` + `Not set — the Knowledge Box cannot be reached` + `[ Set the key ]` |

`Rotate` opens a drawer: one `<input type="password">` with a `Show` toggle, `[ Test this key ]`
(which calls the connection test with the candidate and reports inline, persisting nothing), and
`[ Save the key ]`. On save: `toast("API key replaced")`, and the row reads
`Set · ends 3b7c · rotated just now`. Copy beneath the field: `The current key is never shown. The
new key replaces it immediately — any service still using the old key will get a 401.`

The value is never echoed back by the API, never logged, never placed in the DOM outside the
password input, and cleared from memory when the drawer closes.

### 3.7 States, keyboard and screen reader (whole area)

| State | Treatment |
| --- | --- |
| Loading | The tabs render immediately; each card shows its real heading and `skeletonRows(4)`; provenance badges are absent rather than guessed |
| Empty | Not applicable — a settings area is never empty |
| Error | Per card. A failed `GET /api/v1/settings` puts `errorState` in the panel with `[ Try again ]`; a failed sub-fetch (the connection test, the key list) fails inside its own card and leaves the rest usable |
| Permission denied | Per group, § 3.3. Controls are `disabled`, not hidden or removed: a viewer must be able to read the deployment's configuration, which DP-40 already makes safe |
| Stale | Re-entering a tab re-fetches; a dirty card is **not** overwritten by the re-fetch — the new values are held and offered as the 409 flow (§ 3.4) only if they differ |
| In flight | § 3.4 |
| Success | § 3.4 |

**Focus order:** skip link → band → rail → tabs → each card in DOM order (heading is not focusable;
controls are) → the card's footer bar when present. Tabs are `role="tablist"` with anchors as
`role="tab"`, roving `tabindex`, Left/Right/Home/End — the kit's `wireTabs`, and because each tab is
a route, Back works.

**Screen reader.** Each card is `<section aria-labelledby>`. The provenance badge is inside the
control's accessible description: `Generative model, combo box, set here, environment default
chatgpt-azure-4o-mini`. The dirty footer bar is `role="status" aria-live="polite"` so
`3 unsaved changes` is announced as it changes. Save results are announced once, politely. The
create-key reveal is `role="alertdialog"` with `aria-describedby` on the warning. Every colour
input is paired with a text input carrying the hex, so colour is never the only way to read or set
a value.

**≤ 900 px.** The tab strip scrolls horizontally with the kit's `.arag-tabs` overflow behaviour —
never collapsed into a select, which would hide five of the six group names. Cards go full width;
`.arag-split` on Branding stacks with the preview **below** the fields (a preview above the thing
it previews is a picture nobody connects to the form). The provenance badge and `Reset` move to
their own line under the control. The card footer bar becomes two full-width stacked buttons,
`Save changes` first. The API-keys table drops the `Key` and `Created` columns; the row menu keeps
everything.

### 3.8 Settings inventory (for the final report's table)

| Setting | Route | Stored | NEW API |
| --- | --- | --- | --- |
| KB id, region, base URL, model, reranker, timeout, extract strategy | `/#/settings/connection` | store, env default | `PUT /api/v1/settings/connection` |
| ARAG API key | `/#/settings/connection` | store, hashed reference | `PUT /api/v1/settings/connection/api-key` |
| Connection test | `/#/settings/connection` | — | `POST /api/v1/settings/connection/test` |
| Product name, tagline, colours, footer, powered-by, docs, support | `/#/settings/branding` | store, env default | `PUT /api/v1/settings/branding` |
| Logo file | `/#/settings/branding` | `DATA_DIR/branding` | `POST /api/v1/settings/branding/logo` |
| Upload size, accepted types, rate limits, question length, concurrency | `/#/settings/limits` | store, env default | `PUT /api/v1/settings/limits` |
| API keys | `/#/settings/keys` | store, hashed | `GET/POST /api/v1/api-keys`, `DELETE /api/v1/api-keys/{id}`, `PATCH` for rename |
| Retention policy | `/#/settings/retention` | store | `PUT /api/v1/settings/retention` |
| Purge | `/#/settings/retention` | — | `POST /api/v1/admin/purge` (exists, `dryRun` exists) |
| Reset one setting | every group | — | `DELETE /api/v1/settings/{group}/{key}` |

### 3.9 What a Playwright journey must assert

`test/e2e/settings.spec.ts` — one test per group, each following the brief's shape
**edit → reload → value persisted → effect visible**:

1. **Connection.** Change the generative model, save, reload the page: the value persists and the
   provenance badge reads `Set here`. `↩ Reset` restores the environment value and the badge reads
   `Environment default`. `Test connection` reports a latency without saving.
2. **Connection, secret.** The ARAG key row never renders the key; `Rotate` → save → the row reads
   `rotated just now` and `expect(page.content()).not.toContain(candidateKey)`.
3. **Connection, KB change.** Editing the Knowledge Box id and saving opens `role="alertdialog"`
   naming the document count; cancelling leaves the value unchanged.
4. **Branding.** Change the product name, save, reload: the rail identity block and
   `document.title` both show it. Upload a PNG logo: the preview shows it before saving, and after
   saving the rail shows it. **Exactly one `img[src*="arag-logo"]` on the page throughout** (DP-43),
   including while the preview is rendered.
5. **Branding, DP-35.** Apply a red `primaryColor`, save, and assert the computed
   `--arag-danger-fg` and the `Ready` chip's colour are unchanged.
6. **Limits.** Reduce the maximum upload size, save, then open the upload drawer: the accepted-size
   line shows the new limit and a larger file is rejected with the new number in the message.
7. **Keys.** Create a key: the plaintext is shown once, Escape does not close that drawer, and
   `I have copied it` does; reopening the list shows the row with `Never used`; calling
   `GET /api/v1/documents` with the key sets `Last used` to a relative time; revoking it returns
   401 on the next call and the row reads `Revoked`.
8. **Retention.** `Preview` reports a count and deletes nothing (document count unchanged);
   `Delete N documents` is absent before a preview; the confirm requires the typed word `DELETE`.
9. **Locking.** Signed out, every control on Connection is `disabled` and the values are still
   readable; `/#/settings/keys` shows no rows; `Sign in as operator` opens a drawer, a wrong token
   shows `That token was not accepted.`, the right one unlocks the group in place without a
   navigation.
10. **Dirty guard.** Edit a field, click another tab: the leave confirmation appears; `Cancel`
    keeps the edit.
11. **≤ 900 px.** The tab strip scrolls rather than collapsing, the Branding preview sits below the
    fields, and `document.body.scrollWidth <= 390`.

---

## 4. The remaining deferred items

`design/PRODUCT-EXPERIENCE.md` § A.4 put three things explicitly out of scope with reasons. Those
reasons were true then and are not now: there is a key store, the Knowledge Box holds typed values
across the corpus, and a record can carry provenance. Each one below says what changed.

---

### 4.1 Cross-document ask

> *Was out of scope because:* "`POST /documents/{id}/ask` is per-resource by design; the Ask screen
> says so rather than implying a search." *What changed:* nothing about that endpoint — this is a
> second, different endpoint over the whole Knowledge Box, and the distinction is now a visible
> control rather than an unstated limitation.

**Route** `/#/ask?scope=corpus&q=…&doc_type=…&kv=…` — the per-document form stays at
`/#/ask?scope=document&doc=<id>`, and the bare `/#/ask` opens whichever was used last (stored in
`localStorage`, defaulting to `document`, because the grounded single-document answer is the
product's strongest moment and should be the one a stranger meets first).
**Rail** Ask. **Breadcrumb** none.

```
┌──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┐
│  ▤ Documents          24 │  Ask                                                                             │
│  ▤ Configs            13 │ ──────────────────────────────────────────────────────────────────────────       │
│▎ ” Ask                   │  [ One document ][▎Everything in this workspace ]                                 │
│  ◷ Jobs                1 │                                                                                  │
│  ⚟ API                   │  Answers come from the 22 documents in this workspace's Knowledge Box.            │
│  ⚒ Settings              │  Two are still processing and are not searchable yet.                            │
│                          │                                                                                  │
│                          │  Limit to  [ Type: Invoice ✕ ] [ Knowledge Box: Total ≥ 10 000 ✕ ] [ + Filter ]  │
│                          │                                                                                  │
│                          │  ┌────────────────────────────────────────────────────────────────────────────┐  │
│                          │  │ ⟩ Which suppliers have invoiced more than $10,000 this quarter?           │  │
│                          │  │                                                                            │  │
│                          │  │ ⟨ Two suppliers. Globex Supply Co Pty Ltd on INV-2026-1188 for            │  │
│                          │  │   $25,750.00 [1] and INV-2026-1187 for $14,200.00 [2]; Northwind          │  │
│                          │  │   Traders on INV-2026-0996 for $11,480.00 [3].                            │  │
│                          │  │                                                                            │  │
│                          │  │   Sources                                                                  │  │
│                          │  │   [1] invoice-review.txt · INV-2026-1188 · Globex Supply Co         ↗     │  │
│                          │  │       “Total Due: $25,750.00”                                              │  │
│                          │  │   [2] invoice-1187.pdf · INV-2026-1187 · Globex Supply Co           ↗     │  │
│                          │  │       “Amount payable $14,200.00”                                          │  │
│                          │  │   [3] invoice-0996.pdf · INV-2026-0996 · Northwind Traders          ↗     │  │
│                          │  │       “TOTAL 11,480.00”                                                    │  │
│                          │  │   3 quotes from 3 documents · chatgpt-azure-4o-mini · 2.4 s               │  │
│                          │  └────────────────────────────────────────────────────────────────────────────┘  │
│                          │                                                                                  │
│                          │  [ Ask something about these documents                                      ]    │
│                          │                                                     0 / 1 200   [ Ask ]          │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Kit classes.** `.arag-segmented` + `wireSegmented` for the scope switch; `.arag-filterchip` and
the § 2.4 filter popover for `Limit to`; `.arag-chat` / `.arag-bubble` / `.arag-cite` for the
conversation; `.arag-textarea` + `.arag-btn` for the composer; `openDrawer({ wide: true })` for the
source drawer; `.arag-emptystate`. Nothing new.

**Scope switch.** Two segments, `One document` and `Everything in this workspace`. Switching to
`One document` reveals the existing document picker; switching to corpus reveals the `Limit to`
row. The conversation is **not** carried across the switch — a question answered from one document
and the same question answered from twenty are different answers, and stacking them in one thread
invites the reader to compare things that are not comparable. Switching clears the thread with a
one-line note: `Cleared — this asks a different question.`

**Scope line.** Always present above the composer, and specific:
`Answers come from the 22 documents in this workspace's Knowledge Box. Two are still processing and
are not searchable yet.` When a `Limit to` filter is set it changes to
`Answers come from the 6 documents matching these filters.` The count is real, from the same
intersection the Documents list uses (§ 2.4), so the two screens never disagree.

**`Limit to`** reuses the § 2.4 popover exactly — type, config, and kv field filters, rendered as
the same two kinds of chip with the same `Knowledge Box:` prefix. A corpus ask restricted by an
extracted value is the capability's best demonstration and it costs one component.

**Citations.** Numbered `[1]`…`[n]` inline in the answer, each an `.arag-cite` button. Every
citation carries **the document, not just the paragraph** — that is the whole difference from the
single-document ask. The Sources block below the answer lists one row per citation: filename, the
headline identifier and counterparty, the quote, and `↗`.

Clicking a citation or `↗` opens `openDrawer({ wide: true, title: filename })` showing that
document's source text with the quoted span `<mark class="dip-hit">`-highlighted and scrolled to,
plus `[ Open the full record › ]` in the drawer foot. A drawer, not a navigation, because the
thread is the work and losing it to check a quote is the failure mode this screen exists to avoid.
The drawer is a route (`/#/ask?…&source=<docId>&p=<paragraphId>`), so Back closes it.

Citations grouped by document get a count: when three quotes come from one document, the Sources
block shows the document once with `3 quotes` and the quotes nested beneath.

**Honesty.** Unchanged from § 5.5 rule 6 and extended:

- An answer with no citations renders the answer **and** `.arag-alert.warn`:
  **`No source returned`** / *"The model answered without quoting any document. Treat it as
  unverified."* Never suppressed, never shown bare.
- A citation whose quote cannot be located in that document's text renders the quote with
  `Quote not found in this document` beneath it and a disabled `↗` — the same verification
  vocabulary the record uses, because it is the same check.
- The footer line always carries the counts, the model and the duration:
  `3 quotes from 3 documents · chatgpt-azure-4o-mini · 2.4 s`.
- The mock deployment's persistent `Mock data` chip applies here too.

**NEW API** `POST /api/v1/ask` — `auth: "api"`, in the tighter ask bucket (DP-41: `rps 1,
burst 10`), body `{ question, doc_type?: string[], config?: string, kv?: string[], max_sources?: 1–10 }`,
response:

```json
{ "answer": "…",
  "citations": [ { "documentId": "doc_01J…", "filename": "invoice-review.txt",
                   "headline": { "identifier": "INV-2026-1188", "counterparty": "Globex Supply Co" },
                   "paragraphId": "…", "quote": "Total Due: $25,750.00",
                   "verified": "exact", "start": 812, "end": 836, "score": 0.91 } ],
  "documentsSearched": 22, "model": "chatgpt-azure-4o-mini", "ms": 2412 }
```

`verified` is computed the same way a field's evidence is (DP-36's text fetch and the exact /
normalised / unverified ladder), so one vocabulary covers both screens.

**States.**

| State | Treatment |
| --- | --- |
| Empty, corpus | `.arag-emptystate`: **`Ask across every document here`** / *"Questions are answered from the documents in this workspace's Knowledge Box, with the quote from each document behind every claim."* Below it, three starter questions drawn from the workspace's actual configs (`Which suppliers have invoiced more than $10,000?`), each a button that fills the composer. |
| Empty, no searchable documents | **`Nothing to ask yet`** / *"Documents become searchable once they finish processing."* + `[ Upload a document ]` |
| Thinking | The question renders immediately in its bubble; the answer bubble shows the kit's animated thinking state with `Searching 22 documents…`; `[ Ask ]` becomes `[ Stop ]` |
| Answer with zero results | `No document in this workspace matched that question.` + `[ Widen the filters ]` when filters are set |
| Error | The answer bubble becomes `.arag-alert.error`: `That question could not be answered. The Knowledge Box did not respond.` + `[ Try again ]`, and **the question stays in the composer** so it is not retyped |
| Rate limited | `You are asking faster than this deployment allows. Try again in 4 seconds.` with a live countdown on the button |
| Over length | The counter turns `--arag-danger-fg` at the limit and `Ask` disables: `Questions are limited to 1 200 characters.` |
| KB unreachable | The composer disables with `Asking needs the Knowledge Box, which is not responding.` |

**Keyboard and screen reader.** The composer is a `<textarea>`; `⌘↵`/`Ctrl+↵` sends, `↵` inserts a
newline (a question worth asking across a corpus is often two lines). The thread is
`role="log" aria-live="polite"`, so the answer is announced when it lands but the typing is not.
Citations are `<button>`s with the accessible name `Source 1, invoice-review.txt, Total Due
$25,750.00`. The source drawer moves focus to its heading, traps, Escape closes, focus returns to
the citation. `announce("Answer ready. Three quotes from three documents.")`.

**≤ 900 px.** The scope segmented control goes full width; `Limit to` chips wrap; the source drawer
is full width minus 32 px; the composer sticks to the bottom of the viewport with the character
counter above it.

**Playwright.** Switching to corpus scope changes the hash and clears the thread; asking returns an
answer with at least one numbered citation; each citation names a document; clicking one opens a
drawer with the quote marked and Back closes it; an answer with no citations renders the
`No source returned` alert; a kv `Limit to` filter changes the scope line's count and the same
filter on the Documents list returns the same count.

---

### 4.2 Field correction

> *Was out of scope because:* "Editing an extracted value is a roadmap item; nothing in this design
> implies a field is editable." *What changed:* the values now live in the Knowledge Box, where a
> wrong value is not just a wrong record but a wrong filter result for everyone. Correcting one is
> now the cheapest way to keep the corpus honest — provided the correction can never be mistaken
> for verification.

**Route** the Record tab, `/#/documents/:id?edit=<fieldKey>` (the editing field lives in the hash so
Back cancels and a link can open a record with a field ready to correct).
**Breadcrumb** `Documents › invoice-review.txt`.

**The control.** Each `.dip-field` row gains a row-actions `⋯` (`menuButton`) carrying
`Copy value`, `Jump to source`, `Correct this value` and — once corrected —
`Revert to the extracted value`. Not an always-visible pencil: a persistent edit affordance on
every field makes the record read as a draft, and the product's claim is that it is a checked
record you rarely have to touch.

**The editor**, inline in the row, never a drawer — the quote must stay visible beside the value
being changed:

```
┌ .dip-field.is-editing ────────────────────────────────────────────────────┐
│ Invoice total                                                       ⋯     │
│ [ 25750                                    ]   extracted “$25,750.00”     │
│ Why is it changing?                                                       │
│ [ Wrong value read from the page                                      ▾ ] │
│   · Wrong value read from the page                                        │
│   · The value is on a page that did not read cleanly                      │
│   · The document itself is wrong                                          │
│   · Other — say why                                                       │
│ The extracted value and its quote are kept. This correction is recorded    │
│ against your operator session.                                            │
│                                       [ Cancel ]  [ Save correction ]     │
└───────────────────────────────────────────────────────────────────────────┘
```

The input is typed from the field's kv type — a `date` field gets a date input, `float` a number
input, `boolean` a switch, `repeated` a chip adder — so a correction cannot itself produce the 422
that a mistyped value would. The raw extracted value is shown beside it for comparison and is never
editable. `Other — say why` reveals a required one-line text input.

**What happens to the evidence and the verification badge.** This is the part that must not be got
wrong:

```
┌ .dip-field.is-corrected ──────────────────────────────────────────────────┐
│ Invoice total                                                       ⋯     │
│ 25750                                        ✎ Corrected                  │
│ was 25570 · extracted, near match                                         │
│ “Total Due: $25,750.00”                                              ↗    │
│ Quote from the extraction. It supports the extracted value, not this      │
│ correction.                                                               │
│ Corrected by the operator · 13 Sep 2026, 11:04 · Wrong value read from    │
│ the page                                                                  │
└───────────────────────────────────────────────────────────────────────────┘
```

1. **A correction never earns `✓ Verified`.** Verification means "we found this quote in the
   document". A person typing a value is a different fact and gets its own chip — `✎ Corrected`,
   `.arag-chip.info`, `--arag-info-*` — which is neither the accent green of verification nor the
   danger red of an unverified quote. It is a third thing and it looks like a third thing.
2. **The quote stays, and is relabelled.** `Quote from the extraction. It supports the extracted
   value, not this correction.` Deleting the quote would destroy the evidence that the extraction
   was wrong, which is exactly the evidence an auditor wants.
3. **The previous value stays**, as `was 25570 · extracted, near match`, carrying the verification
   state it had.
4. **Grounding excludes corrected fields from both numerator and denominator**, and the trust strip
   says so in the sentence, not only in the number:
   `Grounding 91% — 10 of 11 fields carry a quote found in this document. 1 field was corrected by
   a person and is not scored.` A correction must never raise or lower the grounding score; a score
   that improves because someone typed over the evidence would be the single most dishonest thing
   this product could do.
5. **Exports carry both.** JSON: `value`, plus `corrected: { previousValue, previousRaw,
   previousVerified, by, at, reason, source }`. CSV: the corrected value in the value column plus
   `<key>_corrected_from` and `<key>_corrected_by` columns. XML: a `<corrected>` child. A downstream
   system must be able to tell a machine-read value from a human-supplied one without parsing prose.
6. **`source`** is `person` or `generator agent` (§ 2.5's `Use the agent's value`). Never blank.

**What is written back to the Knowledge Box.** `PUT /kb/{kbid}/resource/{rid}/key_value/{field_id}`
with the corrected value alone. The kv-schema holds typed scalars and has nowhere to put "who and
why", and burning two of the 50 fields per schema on provenance columns would cost a partner a
quarter of their budget. So:

> `The Knowledge Box holds the corrected value, so filters and searches see it. Who corrected it,
> when and why lives in this product's record and in the operator log.`

That sentence appears once, in the `What is this? ⓘ` popover on the trust strip, and is the
documented limitation. If the write returns 422 the correction is **not** saved locally either —
the two stores must not diverge because of a failed write — and the editor stays open with the
verbatim reason and the § 2.3 fix links.

**Audit.** **NEW API** `PUT /api/v1/documents/{id}/fields/{key}` (body
`{ value, reason, note? }`, `requireWriter`) → the updated `DocumentRecord`. And
`DELETE /api/v1/documents/{id}/fields/{key}/correction` to revert. Both emit a log record
`document.field.corrected` / `document.field.reverted` with
`{ documentId, filename, field, from, to, reason, actor, source }`, visible in Admin → Logs and
filterable by event name (§ 4.3).

The document's **Pipeline tab** gains a `Corrections` section beneath the stage timeline — an
`.arag-timeline` with one entry per correction: the field label, from → to, who, when, the reason.
It is the record's own history and it belongs next to the record's own timeline.

**Permission.** Corrections need a writer credential, like deletes. Without one the menu item is
**present and disabled** with `title="Corrections need a credential."` — hiding it teaches nothing
and makes the capability undiscoverable in the read-only demo the showcase records.

**States.**

| State | Treatment |
| --- | --- |
| Idle | `⋯` in the row, no visible editor |
| Editing | The row expands; focus moves to the input; Escape cancels (and pops `?edit=`); `Save correction` disabled until the value differs from the current one |
| Validation | Typed inputs constrain; a `date` that will not parse shows `Enter a date as YYYY-MM-DD.` under the control |
| Saving | `Save correction` reads `Saving…`; the row is `aria-busy` |
| Saved | The row re-renders corrected; `toast("Invoice total corrected")`; `announce("Invoice total corrected to 25750. The field is no longer scored for grounding.")`; the trust strip re-renders with the new denominator |
| Save failed, 422 from the KB | The editor stays open, `.arag-alert.error` inside it with the verbatim reason and `[ Change the field type in the config ]` |
| Save failed, other | The editor stays open with the message and `[ Try again ]`; nothing is written |
| Reverted | The row returns to its extracted value and its original verification chip; `announce("Invoice total reverted to the extracted value.")` |
| Permission denied | Menu item disabled with its reason |
| Document not ready | The menu item is absent — there is nothing to correct until the extraction has run |

**Keyboard and screen reader.** The row menu is the kit's — `aria-haspopup="menu"`, arrow keys,
Escape closes the menu without closing the record. The editor's input is labelled by the field
label (`Correct the value of Invoice total`); the reason select is labelled `Why is it changing?`;
the explanatory line is the input's `aria-describedby`. The corrected row's accessible text reads
`Invoice total, 25750, corrected, was 25570, extracted, near match` — the whole story, in order,
without colour. The trust strip's `aria-label` gains the exclusion:
`Grounding: strong, 10 of 11 scored fields carry a verified quote, 1 field corrected and not scored`.

**≤ 900 px.** The editor's value input and the extracted value stack; the action buttons become
full width, `Save correction` first.

**Playwright.** `test/e2e/correction.spec.ts`:

1. The row menu offers `Correct this value`; opening it puts `?edit=invoice_total` in the hash and
   Back cancels.
2. Saving a correction re-renders the row with the `Corrected` chip, the `was …` line and the
   relabelled quote; **no `Verified` chip appears on a corrected row**.
3. The trust strip's denominator drops by one and its sentence names the corrected field.
4. Reloading the page preserves the correction (persisted) and the kv value in the Knowledge Box
   matches (asserted through `GET /api/v1/documents/{id}/key-values`).
5. The JSON export carries `corrected.previousValue` and the CSV carries
   `invoice_total_corrected_from`.
6. `Revert to the extracted value` restores the original value, the original verification chip and
   the original grounding denominator.
7. Admin → Logs contains a `document.field.corrected` record naming the field and the actor.
8. Without a credential the menu item is present and disabled.
9. A correction that the Knowledge Box rejects with 422 leaves the local record unchanged and shows
   the verbatim reason.

---

### 4.3 Admin log with cursor paging

> *Was deferred because* the log returned only the most recent records with no way back. An
> operator investigating a failure an hour ago could not reach it.

**Route** `/admin/#/logs?level=&q=&event=&before=<iso>`. **Rail** Logs (admin app).
**Breadcrumb** none.

```
┌──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┐
│  ▤ Overview              │  Logs                                              [ ⭘ Follow ] [ Download ]     │
│  ◷ Jobs                  │ ──────────────────────────────────────────────────────────────────────────       │
│▎ ▤ Logs                  │  [ All ][ Info ][ Warn ][ Error ]  [ 🔍 Search text ] [ Event ▾ ] [ Before ▾ ]   │
│  ◫ Usage                 │                                                       Clear all filters          │
│  ⛨ Security              │                                                                                  │
│                          │  ┌──────────────────────────────────────────────────────────────────────────┐    │
│                          │  │ 11:04:22.914 INFO  document.field.corrected  invoice-review.txt          │    │
│                          │  │   field=invoice_total from=25570 to=25750 actor=operator                 │    │
│                          │  │ 11:04:19.220 INFO  arag.kv.write  doc_01J8K2 fields=12 rejected=1        │    │
│                          │  │ 11:04:19.118 WARN  arag.kv.reject  total expected float received "25,7…" │    │
│                          │  │ 11:03:58.004 INFO  job.stage  extract doc_01J8K2 1 842 ms                │    │
│                          │  │ 11:03:51.772 ERROR arag.request  504 after 30 000 ms  /kb/…/ask          │    │
│                          │  │ …                                                                        │    │
│                          │  └──────────────────────────────────────────────────────────────────────────┘    │
│                          │                                                                                  │
│                          │  [ ‹ Newer ]   200 lines · 11:04:22 back to 10:51:07   [ Older › ]              │
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

**Kit classes.** `.arag-segmented` + `wireSegmented` for the level filter; `.arag-filterbar` +
`.arag-search`; `.arag-log` for the pane (the kit's dark log viewer); `.arag-pill-live` for Follow;
`.arag-pagination` **shape** for the cursor control; `.arag-btn.ghost` for Download;
`.arag-emptystate`. Nothing new.

**Cursor, not page numbers.** A log has no stable page 2 — new records arrive at the head and
shift everything. The control is therefore two directional buttons and a range statement, never
`1 2 3 ›`:

- `[ ‹ Newer ]` is disabled until the reader has paged backwards at least once. The client keeps a
  stack of the cursors it has used, so `Newer` is exact rather than a re-query that could return a
  different window.
- `[ Older › ]` sends `?before=<the oldest timestamp on screen>` and is disabled when the response
  returns fewer than `limit` records, with the reason shown in place of the range:
  `The oldest record this deployment keeps.`
- The middle text is the range, always absolute and always with the count:
  `200 lines · 11:04:22 back to 10:51:07`.

**NEW API** — `GET /api/v1/admin/logs` gains `before` (ISO timestamp cursor), `limit` (1–500,
default 200), `level` (`info|warn|error`), `q` (substring over the message and the fields) and
`event` (exact event name). The response gains `next_before` (the cursor to send for the following
page, absent when exhausted) and `events` (the distinct event names in the window, which is what
fills the `Event ▾` select without a second endpoint).

**Follow.** `.arag-pill-live` toggle. On, it polls the head every 3 s and prepends new records with
a one-second highlight. It is **disabled while the reader is paged back**, with the reason stated
rather than the button silently doing nothing: `Following is paused while you are looking at older
lines. [ Jump to the latest ]`. Turning Follow on from a paged-back position jumps to the head
first. `prefers-reduced-motion` removes the highlight animation, not the update.

**`Before ▾`** is a `datetime-local` input in a small popover: `Show lines before […]`, which is how
an operator gets to 03:14 last Tuesday without clicking `Older` forty times.

**`Download`** saves the current window as newline-delimited JSON, named
`logs-2026-09-13T1104.ndjson`. The current window, not everything — a button that might download a
gigabyte without saying so is a trap.

**States.**

| State | Treatment |
| --- | --- |
| Loading | `skeletonRows(8)` inside the log pane's frame; the filters stay interactive |
| Empty, unfiltered | `.arag-emptystate`: **`No log records yet`** / *"Records appear as the service handles requests and runs jobs."* |
| Empty, filtered | **`No log lines match these filters`** + `[ Clear all filters ]` |
| End of history | `Older ›` disabled; the range line reads `The oldest record this deployment keeps.` |
| Error | `errorState` replacing the pane, `[ Try again ]`; the last good window is retained beneath |
| 401 | The whole admin app returns to sign-in with `Your admin session expired. Sign in again.` |
| Following | `.arag-pill-live` active, `Live` in its label, new lines prepended |
| Following paused | The pill reads `Paused` and the reason line appears |

**Keyboard and screen reader.** The log pane is `<div role="log" aria-live="off" tabindex="0">` —
`off` deliberately: a live-region log that announces every line makes a screen reader unusable
during a busy minute. Instead, Follow announces a summary every ten seconds:
`announce("14 new log lines")`. The level control is the kit's segmented control with arrow keys.
`[ ‹ Newer ]` / `[ Older › ]` are real buttons with the accessible names
`Show newer log lines` / `Show older log lines`, and after a page the pane receives focus and
`announce("200 lines, 11:04:22 back to 10:51:07")` fires. Each record's level is a word in the
line, not a colour — `INFO`, `WARN`, `ERROR` — so the pane reads correctly with no colour at all.

**≤ 900 px.** The level segmented control goes full width above the search; `Event ▾` and
`Before ▾` move into a `Filters (2)` sheet; the log pane keeps its own horizontal scroll (log lines
are the one thing allowed to scroll sideways, inside their container); the cursor control becomes
two stacked full-width buttons with the range line between them.

**Playwright.** `Older ›` fetches with a `before` parameter and the range line changes;
`‹ Newer` returns to exactly the previous window; at the end of history `Older ›` is disabled with
the stated reason; Follow is disabled while paged back and its reason is visible; filtering by
level narrows the lines and the count; `Download` produces an ndjson attachment; a correction made
in the operator app appears in the log as `document.field.corrected` with the field name.

---

## 5. Decisions the lead must make

Four, in order of how much they cost to change later.

**5.1 — Retire `/admin/#/connection`, `/admin/#/configs` and `/admin/#/branding`?**
This design consolidates every editable value into the operator app's Settings behind an in-shell
operator sign-in (§ 3.1, § 3.3), which is what the brief's *"operator-only changes sit behind the
admin sign-in, in the same shell"* asks for. The consequence is that three admin screens another
engineer is editing right now lose their reason to exist, and the admin app becomes Overview, Jobs,
Logs, Usage and a read-only Security posture. The alternative — editable forms in both apps — means
two implementations of every setting and two places to be wrong. **Recommendation: consolidate.**
If the lead declines, the fallback is that Settings stays read-only for operator groups and links
out to `/admin/`, and § 3.3's in-shell sign-in is dropped; everything else in § 3 survives.

**5.2 — Is the API explorer built as `.dip-*` now, or does the kit ship `.arag-apiexplorer` first?**
§ 1.12 specifies it as a kit component and recommends building it locally as `.dip-apiexplorer*`
with the kit's class structure, so the 0.3.0 migration is a rename — the same route `.dip-*` took
into 0.2.0. If the Head would rather land it in the platform first, this product's timeline depends
on a platform release. **Recommendation: build local, report the contract, migrate at 0.3.0.**

**5.3 — Does the kv type mapping get a manual override?**
§ 2.0 and § 2.2 give the config field builder a `Knowledge Box type` column defaulted by a
heuristic and editable by hand. The alternative is a pure derivation with no override, which is
simpler and will be wrong for at least the money fields, where the record keeps the string and the
filter needs the number. **Recommendation: keep the override.** The cost is one column and one
"out of date" trigger.

**5.4 — Do corrected fields leave the grounding score, or get their own score?**
§ 4.2 rule 4 excludes them from both numerator and denominator and says so in the sentence. The
alternative — counting a correction as verified — is dishonest and this design will not specify it;
the other alternative — counting it as unverified — punishes the person who fixed the record and
makes correcting things feel like damaging them. **Recommendation: exclude, and say so.** The lead
should confirm, because it changes a number the marketing material quotes.

One smaller call, resolved here rather than escalated: the rail stays **flat at six items** rather
than adopting the kit's `--Heading` groups (§ 0.3), because regrouping rewrites every rail
assertion in the e2e suite and the showcase for a cosmetic gain.

---

## Appendix A — new API operations this design needs

Author each in `src/openapi.ts` first, then the route, then the service, then the contract test.
Ordered by how many screens each unblocks.

### A.1 Blocking

| # | Operation | Shape | Blocks |
| --- | --- | --- | --- |
| 1 | `GET /api/v1/settings` — reshape | Every value becomes `{ value, source: "environment"\|"store", default, env, editable }`; adds `capabilities.edit` | All of § 3 |
| 2 | `PUT /api/v1/settings/connection` | `{ kbId?, region?, baseUrl?, generativeModel?, reranker?, timeoutMs?, visualExtraction? }`; operator; 409 on a concurrent change | § 3.5.1 |
| 3 | `PUT /api/v1/settings/branding` | the branding fields; operator | § 3.5.2 |
| 4 | `PUT /api/v1/settings/limits` | `{ maxUploadBytes, acceptedMime[], rateLimit{rps,burst}, askRateLimit{rps,burst}, maxQuestionChars, jobConcurrency }`; operator | § 3.5.3 |
| 5 | `DELETE /api/v1/settings/{group}/{key}` | resets one setting to its environment default; operator | the `↩ Reset` affordance everywhere |
| 6 | `GET /api/v1/api-keys`, `POST /api/v1/api-keys`, `PATCH /api/v1/api-keys/{id}`, `DELETE /api/v1/api-keys/{id}` | list / create (plaintext once) / rename / revoke; operator; keys stored hashed | § 3.5.4, and the explorer's key picker |
| 7 | `GET /api/v1/extraction-configs/{id}` — extend | adds `kvSchema { id, state, fields[{id,type,required,repeated,range,description}], provisionedAt, drift[] }` and `agent { provisioned, id, lastRunAt }` | § 2.1, § 2.2 |
| 8 | `GET /api/v1/documents/{id}/key-values` | `{ schemaId, schema[], values{}, states{}, rejected[{field,reason}], writtenAt }` | § 2.3 |
| 9 | `GET /api/v1/documents` — `kv` param | repeatable `kv=<schemaId>.<fieldId>:<op>:<value>`; response gains `kv { matched, candidates, unwritten, filters }` | § 2.4 |

### A.2 Required for the committed scope

| # | Operation | Shape |
| --- | --- | --- |
| 10 | `POST /api/v1/settings/connection/test` | tests candidate values without persisting → `{ ok, ms, resources, error? }`; operator |
| 11 | `PUT /api/v1/settings/connection/api-key` | `{ apiKey }` → `{ set, hint, rotatedAt }`; operator; never echoes the value |
| 12 | `POST /api/v1/settings/branding/logo` | multipart, ≤ 512 kB, SVG/PNG/WebP → `{ logoUrl }`; operator |
| 13 | `PUT /api/v1/settings/retention` | `{ olderThanDays\|null, autoPurge }`; operator |
| 14 | `POST /api/v1/documents/{id}/key-values` | re-writes this record to the Knowledge Box → the § A.1/8 shape; `requireWriter` |
| 15 | `GET /api/v1/kv-facets?field=` | `{ field, type, count, values?[{value,count}], truncated, min?, max? }` |
| 16 | `PUT /api/v1/documents/{id}/fields/{key}` | `{ value, reason, note? }` → the updated record; `requireWriter`; writes the kv field and emits the audit record |
| 17 | `DELETE /api/v1/documents/{id}/fields/{key}/correction` | reverts; `requireWriter`; audited |
| 18 | `POST /api/v1/ask` | § 4.1's body and response; `auth: "api"`; the ask rate-limit bucket (DP-41) |
| 19 | `GET /api/v1/admin/logs` — extend | `before`, `limit`, `level`, `q`, `event`; response gains `next_before` and `events[]` |
| 20 | `GET /api/v1/kv-schemas` | `{ items[{ id, configId, fieldCount, state, provisionedAt }], budget { used, limit: 20, fieldLimit: 50 } }` |

### A.3 For the generator-agent path

| # | Operation | Shape |
| --- | --- | --- |
| 21 | `POST /api/v1/extraction-configs/{id}/agent` | provisions a Data Augmentation generator agent for this config's kv-schema; `DELETE` removes it; `requireWriter` |
| 22 | `POST /api/v1/documents/{id}/agent-run` | `202 { job }`; `requireWriter` |
| 23 | `GET /api/v1/documents/{id}/comparison` | `{ pipeline[], agent[], rows[{ key, label, pipelineValue, pipelineRaw, pipelineVerified, agentValue, state }], summary { agree, differ, agentOnly, pipelineOnly, neither }, agentRanAt }` |
| 24 | `GET /api/v1/documents/{id}/comparison?format=csv` | the same as a CSV attachment |

### A.4 Suggested build order

1. **A.1/1–5** and § 3.5.1–3.5.3 — the settings spine. It is the brief's first bar and everything
   else is easier once the store overrides the environment.
2. **A.1/6** and § 3.5.4 — the key store. The explorer's credential picker and the showcase both
   want it.
3. **A.1/7–8**, **A.2/14**, **A.2/20** and § 2.1–2.3 — kv provisioning and the document view. This
   is the headline capability and deserves the most careful pass.
4. **A.1/9**, **A.2/15** and § 2.4 — kv filtering, which is the capability becoming a workflow.
5. **The API explorer** (§ 1) — it needs no new API, so it can land in parallel with 1–4 and will
   surface each new operation as it is specified.
6. **A.2/16–17** and § 4.2 — field correction, which depends on the kv write path from step 3.
7. **A.2/18** and § 4.1 — cross-document ask.
8. **A.2/19** and § 4.3 — the admin log cursor.
9. **A.3** and § 2.5 — the generator agent and the comparison view.

---

## Appendix B — component summary

| Surface | Kit components used | New, and where it lives |
| --- | --- | --- |
| API explorer | `.arag-split.rail-left.sticky`, `.arag-search`, `.arag-field`/`.arag-input`/`.arag-select`/`.arag-switch`/`.arag-textarea`, `.arag-filterchip`, `.arag-dropzone`, `.arag-segmented`, `.arag-chip`, `.arag-alert`, `.arag-kv`, `.arag-snippet` + `wireCopy`, `<arag-json>`, `.arag-log`, `.arag-pill-live`, `.arag-progress`, `.arag-emptystate`, `.arag-skeleton`, `openDrawer`, `confirmDialog`, `popover`, `announce`, `sse` | `.dip-apiexplorer*`, `.dip-method` — **kit gap**, proposed as `.arag-apiexplorer` / `apiExplorer()` and `.arag-method` for 0.3.0 (§ 1.12) |
| Configs budget + schema card | `.arag-meter`, `.arag-card`, `.arag-table`, `.arag-chip`, `.arag-datatable`, `menuButton`, `<arag-json>` | none |
| Document key-value view | `.arag-segmented` + `wireSegmented`, `.arag-datatable`, `.arag-alert`, `.arag-chip`, `<arag-json>` | none |
| kv filtering | `.arag-filterbar`, `.arag-filterchip`, `popover` + `placeCard`, `.arag-skeleton`, `.arag-emptystate` | `.dip-filterchip--kb` — **product-local CSS**, one dashed border rule |
| Comparison | `.arag-split.even`, `.arag-alert`, `.arag-chip`, `menuButton`, `popover`, `.arag-pill-live` | `.dip-compare` grid — **product-local CSS**; reuses `.dip-field` verbatim |
| Settings | `.arag-tabs` + `wireTabs`, `.arag-card`, `.arag-field` family, `.arag-switch`, `.arag-dropzone`, `.arag-datatable`, `.arag-chip`, `.arag-status`, `.arag-alert`, `.arag-snippet`, `openDrawer`, `confirmDialog`, `.arag-emptystate`, `.arag-skeleton` | `.dip-setting` (label + provenance + reset + origin line), `.dip-wordmark-ph` — **product-local CSS**; `.dip-setting` proposed to the kit as `.arag-setting` for 0.3.0 |
| Cross-document ask | `.arag-segmented`, `.arag-chat`/`.arag-bubble`/`.arag-cite`, `.arag-filterchip`, `openDrawer`, `.arag-emptystate`, `mark` | none beyond `.dip-source`/`mark.dip-hit`, which already exist |
| Field correction | `menuButton`, `.arag-chip`, `.arag-timeline`, `.arag-alert`, `.arag-field` family | `.dip-field.is-editing`, `.dip-field.is-corrected` — **product-local CSS**, two modifiers on an existing component |
| Admin logs | `.arag-segmented`, `.arag-filterbar`, `.arag-search`, `.arag-log`, `.arag-pill-live`, `.arag-pagination` (shape), `.arag-emptystate` | none |

Two kit gaps, both reported to the Head: `.arag-apiexplorer` / `apiExplorer()` (with `.arag-method`)
and `.arag-setting`. Everything else this pass needs is either already in 0.2.0 or is genuinely
this product's — a filter chip that says it ran in the Knowledge Box, a field row that can be
edited and corrected, and a two-column comparison of one pipeline against another.
