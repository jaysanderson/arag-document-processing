# Walkthrough: the admin panel (`/admin/`)

The operator's view of the product: health, configuration, jobs, logs and data retention.
Open <http://localhost:8080/admin/>.

## Sign-in

The first thing you see is **"Admin sign-in"** — a password-style input labelled "admin
token" and a **Sign in** button, with a note that the token is "exchanged for an HttpOnly
cookie and never stored in the page." Enter the `ADMIN_TOKEN` configured for this
deployment (in local dev, whatever is set in `.env`, or `dev-admin-token` if that's what
this instance was started with) and click **Sign in** (or press Enter). A wrong token shows
a red error banner under the form; nothing else on the page is reachable until sign-in
succeeds.

Once signed in, six tabs appear across the top: **Overview**, **Extraction configs**,
**Jobs**, **Logs**, **Configuration**, **Retention**.

## Overview

The default tab. On the left, a health panel (an `<arag-health>` widget reading
`GET /api/v1/admin/health`) shows whether the service and its ARAG connection are healthy.
On the right:

- **"Pipeline settings"** — a small key/value list: **Extract strategy** (the configured
  ARAG extract-strategy id, or a dash if none), **Generative model**, **Documents** (a
  running count by status). Next to the heading, a **"Test KB connection"** button re-runs
  the health check on demand rather than waiting for the panel's own refresh.
- **"Usage"** — six KPI tiles: **Requests** (with uptime), **ARAG calls** (with average
  latency), **ARAG errors**, **Documents** (with ready/failed counts), **Jobs succeeded**
  (with running/queued counts), and **Jobs failed** (with cancelled count) — refreshed with
  the **Reload** button next to the heading. A collapsed **"Raw JSON"** disclosure below the
  tiles shows the same data as the underlying `GET /api/v1/admin/usage` response, for
  anyone who wants the exact numbers rather than the rounded tile view.

## Extraction configs

Lists every extraction config — built-in and custom — in a table: **Name**, **Kind**
(a "built-in" or "custom" chip), **ARAG search configuration** (the underlying stored
config name, e.g. `dip_invoice_extraction`), **Fields** (count), and **Provisioned** (a
"yes"/"not yet" chip). Explanatory text above the table spells out what "provisioned" means:
each config is backed by a stored ARAG search configuration that pins the model, the
`full_resource` grounding strategy, the prompt and the field schema.

Two buttons in the header: **Reload** refreshes the table, and **Re-provision all**
re-sends every config to ARAG as a search configuration — safe to click any time (it's
idempotent), and exactly what you'd use after resetting a Knowledge Box or switching the
generative model. Clicking it shows a live "Provisioning…" message, then a summary banner
("N provisioned, N failed") once done.

Below the table, a collapsed **"Inspect the stored ARAG search configurations (model, RAG
strategy, prompt, schema)"** disclosure — click to expand it and see the actual
configuration objects as stored in the Knowledge Box, fetched live rather than reconstructed
locally, so what you see here is guaranteed to match what the KB is really running.

## Jobs

A two-panel view. On the left, **"Recent jobs"** — a table of every processing job (kind,
status, current stage, created time) with a **Reload** button; click any row to select it.
On the right, **"Job detail"** shows the selected job's full timeline (the same
stage-by-stage view the demo shows live) plus the raw job JSON below it. A **Cancel** button
appears next to the "Job detail" heading only while the selected job is still queued or
running — clicking it stops that job in place. This is the same job list any document
upload creates; useful for investigating a stuck or failed run without needing to know the
job id in advance.

## Logs

A live-updating table of recent log lines (an `<arag-log>` widget polling
`GET /api/v1/admin/logs` every 5 seconds, up to 200 at a time), with two controls above it:
a **level** dropdown (all levels, debug, info, warn, error) and a **filter…** text box that
matches a substring anywhere in the log line. Useful for confirming what actually happened
during a specific upload — every ARAG call is logged with its path, status and timing,
without ever showing the API key or KB URL.

## Configuration

A single read-only panel: **"Effective configuration (secrets redacted)"**, a raw JSON view
of every environment variable actually in effect for this running instance, plus the store
file paths, extraction config summary, and the full route list. Secret-looking values
(anything with "token", "key", "secret" or "password" in its name) are shown as a bullet
count (e.g. `•••(64 chars)`) rather than their real value — enough to confirm a secret is
set, without ever displaying it.

## Retention

A **"Data retention"** panel: an explanation that this deletes documents older than N days
from the local store *and* their resources from the Knowledge Box, and that `0` clears
everything. Below it, an **"Older than (days)"** number input (defaulting to 30) and a red
**Purge** button. Clicking Purge runs the deletion immediately and shows a result summary
(how many were deleted, and any that failed) underneath. There is no scheduled/automatic
purge — this is the only way documents are cleaned up in bulk, and it's a deliberate,
manual, auditable action (every purge shows up in the Logs tab and the Overview tab's
Usage tiles).

## Related

- [`walkthrough-demo.md`](walkthrough-demo.md) — the end-user side of the product.
- [`../architecture/security-model.md`](../architecture/security-model.md) — what each of these controls actually protects.
- [`../developer/api-reference.md`](../developer/api-reference.md) — the underlying `/api/v1/admin/*` routes this panel calls.
