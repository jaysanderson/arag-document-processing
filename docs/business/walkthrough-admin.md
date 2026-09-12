# Walkthrough: the admin app (`/admin/`)

The operator's view of the product — Sam's screen, in the persona table in
[`overview.md`](overview.md): health, connection, configuration, jobs, logs, usage,
branding and security. Open <http://localhost:8080/admin/>. This is a different product
for a different person, not a tab inside the operator app — the sign-in boundary is
deliberately built to look like the door to somewhere else.

## Sign-in

The sidebar is not shown before sign-in — a nav the visitor cannot use yet is noise. A
centred card asks for the **Admin token** (a password-style input) and a **Sign in**
button, with a note that the token is "exchanged for a cookie and never stored in the
page." Enter the `ADMIN_TOKEN` configured for this deployment and click **Sign in** (or
press Enter).

Two distinct failures, worth pointing out as different things: a wrong token shows *"That
token was not accepted"* — something the visitor can fix by typing again — while a
deployment with no `ADMIN_TOKEN` set at all shows *"Admin access is disabled for this
deployment. Set ADMIN_TOKEN and restart to enable it"* — not a password problem, and the
copy does not pretend it is one. Once signed in, the sidebar appears with eight sections:
**Overview**, **Connection**, **Configs**, **Jobs**, **Logs**, **Usage**, **Branding**,
**Security**. If the session cookie ever expires while you're using the app, any screen
that hits a `401` drops you straight back to this sign-in card with *"Your admin session
expired. Sign in again."*

## Overview (`/admin/#/overview`)

The default screen after sign-in. A six-tile stat strip: **Service** (health status and
version), **Knowledge Box** (round-trip time), **Documents** (total, degraded, failed),
**Jobs** (running, queued, failed), **Grounding** (mean score), **ARAG calls** (count,
errors, expected provisioning conflicts). Click **Refresh** to re-pull all of it on
demand.

Underneath, a **Needs attention** table lists exactly what needs doing right now — failed
documents, degraded documents, and any extraction config that has not been provisioned —
each row a chip, a one-line description, a relative time, and an **Open ›** link straight
to the thing. When there is nothing to do, it says so plainly rather than showing an empty
table. Two more cards below that: **Configuration** (extract strategy, model, mode,
requests served) and **Recent activity** (the last log lines, with a link to the full
**Logs** screen).

## Connection (`/admin/#/connection`)

Proves the deployment is talking to the Knowledge Box you think it is, and shows what the
extraction agents actually run against. A banner at the top states connected/not-responding
and the round-trip time; click **Test connection** to re-run the check on demand. Below
that, a key/value block: Knowledge Box id, region, endpoint, resource count, mode (mock or
live), the generative model, and the extract strategy.

The **Stored ARAG search configurations** table lists every `dip_*` configuration this
product has provisioned — name, kind, model, RAG strategy. Click a row to open a drawer
showing the full stored configuration as the Knowledge Box actually holds it: the prompt,
the `answer_json_schema`, the model, the RAG strategy — fetched live, not reconstructed
locally, so what's on screen is guaranteed to match what is really running. A line under
the table names any search configurations in the Knowledge Box that this product did not
create, so nothing there is mistaken for one of the eleven-plus-custom configs.

**Re-provision all** re-sends every extraction config to the Knowledge Box as a search
configuration — safe to run any time, and exactly what you'd reach for after resetting a
Knowledge Box or switching the generative model. It shows a "Provisioning…" state, then a
summary: "N provisioned · N failed."

## Configs (`/admin/#/configs`)

The same table as the operator app's Configs screen, with the operator powers added: every
row carries its own **Re-provision** button, and a **Re-provision all** sits above the
table. Columns: Name, Kind (built in / custom), Fields, ARAG configuration, Documents,
State.

## Jobs (`/admin/#/jobs`)

Every job across the whole deployment, filterable by status. Click a row to open a drawer
with the job's kind, status, start time, elapsed time, a link to its document (when it has
one), the stage timeline, and the raw job JSON behind a disclosure. A **Cancel job** button
appears in the drawer footer only while the job is still queued or running.

## Logs (`/admin/#/logs`)

A real table, not a terminal pane: Time, Level (a chip), Message, with each structured
field summarised inline and the full record available in a drawer on click. A **level**
dropdown and a **contains** text filter narrow the view; **Live tail** is an explicit
toggle — the table does not refresh out from under you while you're reading it unless you
turn tailing on. **Download** saves the currently filtered lines as an NDJSON file,
client-side.

## Usage (`/admin/#/usage`)

Six KPI tiles — Requests, ARAG calls, ARAG errors, Client errors (4xx from the Knowledge
Box), Documents, Grounding — plus a **Documents processed, last 14 days** bar chart derived
from the stored records themselves, and a breakdown of job counts by status. Worth
explaining if asked: there's no chart of ARAG calls over time, because the call counters
are cumulative since boot rather than a time series — inventing one would be a chart that
lies.

## Branding (`/admin/#/branding`)

Read-only by design — branding is environment configuration, and a form that appeared to
save but couldn't would be a lie. Each effective value (product name, tagline, logo,
primary and accent colour, powered-by credit, footer, docs and support URLs) is shown next
to the `BRAND_*` variable that sets it, alongside a live preview tile rendering the brand
band, the sidebar mark, both button variants and the status chips in the current colours —
so a partner can see whether their chosen colour collides with the status palette before
they deploy it. The same effective values, and the same preview, are also visible without
an admin token at Settings → Branding in the operator app.

## Security (`/admin/#/security`)

Three cards:

- **Credentials** — how many API keys are configured (with the last few characters of each,
  never the full value), whether the admin token is set, the session cookie's lifetime, and
  a reminder that writes (deletes, config creation) always require a credential even when
  `API_KEYS` is unset. A note states plainly that API keys are set with the `API_KEYS`
  environment variable — there is no key store here to create or revoke one from.
- **Request protection** — the rate limit (requests/second and burst), CORS policy, the
  maximum upload and request body sizes, which security headers are on, and the trusted
  proxy setting.
- **Retention** — the destructive one, and it gets the full treatment. Set a number of days
  in **Delete documents older than**, then click **Preview** before anything happens: the
  panel reports the exact count and the oldest and newest dates affected, and nothing is
  deleted yet. Only once a preview has run does **Purge** become clickable. Clicking it
  opens a confirmation dialog restating the count and requiring you to type the word
  **DELETE** before the button will submit. The result panel then reports how many
  documents were deleted and how many failed. Every purge — preview or real — also shows up
  in the Logs screen and the Usage tiles, so there is always an audit trail of who ran it
  and when.

## Related

- [`walkthrough-demo.md`](walkthrough-demo.md) — the end-user side of the product.
- [`../architecture/security-model.md`](../architecture/security-model.md) — what each of these controls actually protects.
- [`../developer/api-reference.md`](../developer/api-reference.md) — the underlying `/api/v1/admin/*` routes this app calls.
