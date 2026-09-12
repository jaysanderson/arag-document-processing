# Security model

## Threat model

| Threat | Mitigation | Where |
|---|---|---|
| Arbitrary file upload into the Knowledge Box (malware, disallowed types, abuse of ARAG spend) | MIME allowlist (9 types) checked before any ARAG call; unknown types rejected `415` | `src/services/documents.ts`, `ALLOWED_MIME` |
| Header/response injection via a hostile filename (`Content-Disposition`) | `sanitiseFilename()` strips directories, control characters and anything outside `[A-Za-z0-9._ -]` | `src/services/documents.ts` |
| Oversized uploads exhausting memory/disk/ARAG spend | Two independent caps: `MAX_BODY_BYTES` (hard HTTP body cap, platform) and `DIP_MAX_UPLOAD_BYTES` (25 MB, product) | `src/services/documents.ts`, env |
| Unauthenticated access to operator functions (logs, config, purge, re-provision) | `ADMIN_TOKEN` required for every `/api/v1/admin/*` route and `/admin`; constant-time comparison | `vendor/arag-platform/src/http/app.ts` (`constantTimeEqual`), `src/routes/admin.ts` |
| Unauthenticated/abusive use of the public API | Optional `API_KEYS`; when unset the API is intentionally open (demo-friendly), when set every `auth: "api"` route requires a key or a session cookie | `App.enforceAuth` |
| An anonymous caller deleting data, cancelling jobs, or provisioning a KB search configuration just because `API_KEYS` was left empty | `requireWriter()` guards every write that changes shared state (`POST /extraction-configs`, `DELETE /documents/{id}`, `DELETE /jobs/{id}`, `DELETE /extraction-configs/{id}`) and always demands a credential — admin token, API key, **or** a same-origin session cookie from `POST /api/v1/session` — independent of whether `API_KEYS` is configured. Reads and document uploads stay anonymous-friendly so `curl` quickstarts keep working with no setup. | `src/routes/guards.ts` (`requireWriter`) |
| Brute-forcing the admin token or API keys | Constant-time comparison (`timingSafeEqual`) everywhere a secret is compared | `constantTimeEqual` |
| CSV export formula injection — a document's LLM-extracted field value (attacker-controlled, since it comes from an uploaded document) starting with `=`, `+`, `-` or `@` could execute as a formula when the CSV export is opened in Excel/Sheets/LibreOffice | Any such cell is prefixed with `'` before quoting (a plain negative number is exempted so amounts still read as numbers) | `csvCell()`, `src/services/formats.ts` |
| Denial of service via request flooding | Per-IP-or-API-key token-bucket rate limiting (`RATE_LIMIT_RPS`/`BURST`), `429` with `Retry-After` | `App.rateLimited` |
| IP-spoofing to defeat rate limiting | `TRUST_PROXY` controls which header (if any) is trusted for client IP; default `fly` trusts only `Fly-Client-IP`, set by Fly's edge and not client-controllable behind it | `Ctx.ip`, `vendor/arag-platform/src/http/app.ts` |
| Path traversal via static file serving (`/`, `/admin`, `/ui`) | Every resolved path is checked to stay under the static root (`realpathSync` + prefix check) before serving | `App.serveStatic` |
| Secrets leaking into logs, browsers, or error responses | Env-only secrets, logger redaction by key name, `describeEnv()` redaction for the admin config view, generic 500 detail in production, ARAG errors never echo the KB URL/token | `Logger.redact`, `describeEnv`, `App.mapError` |
| Cross-site request forgery against session-cookie-authenticated demo calls | `SameSite=Lax` cookies, same-origin CORS by default (`ALLOWED_ORIGINS` empty) | `Ctx.setCookie`, `cors()` |
| XSS / malicious script injection via a served page | CSP restricting script/style sources to self + the pinned CDN, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` | `securityHeaders()` |
| Data staying in the Knowledge Box (and local store) indefinitely after a demo/evaluation | Explicit `DELETE /documents/{id}` (always deletes the KB resource) and `POST /admin/purge` (age-based bulk delete) | `src/services/documents.ts` |
| An operator mistaking ARAG `security.groups` filtering for an authorisation boundary | Explicitly called out as **not** one | `SECURITY.md` |

## Authentication

Three independent mechanisms, checked in this order by `App.authenticate()`:

1. **`ADMIN_TOKEN`** — bearer token or the `arag_admin` HttpOnly cookie (set by
   `POST /api/v1/admin/login`, which itself just compares the posted token to
   `ADMIN_TOKEN`). Grants `admin: true`, which satisfies both `auth: "admin"` and
   `auth: "api"` routes, and bypasses rate limiting. **If `ADMIN_TOKEN` is unset, every
   admin route answers `403`** ("Admin access is disabled") rather than silently allowing
   or silently denying with a confusing 401 — the panel is off, not unlocked.
2. **`API_KEYS`** — comma-separated list; `X-API-Key` header or `Authorization: Bearer`.
   When `API_KEYS` is empty (the default), `auth: "api"` routes are open — appropriate for
   a local demo, not for a public deployment (see below).
3. **Session cookie (`arag_session`)** — an HMAC-signed, time-limited token issued by
   `POST /api/v1/session` (itself rate-limited). Lets the same-origin demo UI call
   API-key-protected routes without ever putting a real API key in browser JavaScript. The
   signing secret defaults to `ADMIN_TOKEN`, or a random per-boot value if that's unset too
   (in which case sessions and any admin-cookie state stop surviving a restart).

**Writes that change shared state are the exception to "open when `API_KEYS` is unset."**
`POST /api/v1/extraction-configs` (creates a config *and* provisions a real stored search
configuration in the Knowledge Box), `DELETE /api/v1/documents/{id}`,
`DELETE /api/v1/jobs/{id}` (cancel), and `DELETE /api/v1/extraction-configs/{id}` each call
`requireWriter()` (`src/routes/guards.ts`), which demands *any one* of the three mechanisms
above — even with `API_KEYS` empty. Deleting a document also deletes its Knowledge Box
resource, and creating a config writes into the KB's own configuration, so an anonymous
caller must not be able to destroy or pollute shared state purely because API keys were
never configured; the demo UI and every curl example in this documentation call
`POST /api/v1/session` first (or already hold a credential) precisely to satisfy this.
Reads and document uploads are unaffected — they stay anonymous-friendly so a `curl`
quickstart needs no setup (an upload only adds the caller's own document, and is
rate-limited regardless).

## Upload allowlist and filename sanitisation

Content type is resolved from the declared type (or extension fallback) and checked
against a 9-entry allowlist (pdf, png, jpeg, webp, tiff, txt, md, csv, docx —
`ALLOWED_MIME` in `src/services/documents.ts`) *before* any byte reaches ARAG; anything
else is `415` with the allowlist itself in the problem detail. `sanitiseFilename()` takes
the basename, strips control characters, and replaces every character outside
`[A-Za-z0-9._ -]` with `_`, capped at 120 characters — this is what goes into
`Content-Disposition` on export and is stored as the record's `filename`. The prototype
this product replaced forwarded `X-Filename` unsanitised straight into a response header
(AUDIT finding #7); this closes it.

## Rate limiting and `TRUST_PROXY`

A token-bucket limiter, keyed by API key when present, else by `ctx.ip`
(`RATE_LIMIT_RPS=5`, `RATE_LIMIT_BURST=20` by default — verified live: the 21st request in
a burst against a fresh bucket returns `429`, and the bucket refills at 5/sec).
Admin-authenticated requests and routes marked `noRateLimit` (health, OpenAPI/docs) are
exempt — notably, *opening* the SSE job-events stream costs a token like any other request
(only the long-lived stream itself isn't separately throttled), so an anonymous client
can't hold unbounded concurrent streams. `TRUST_PROXY` decides
which header — if any — is trusted to compute `ctx.ip`:

| Value | Behaviour | When to use |
|---|---|---|
| `fly` (default) | Trusts `Fly-Client-IP`, set by Fly's edge and not spoofable from outside it | Deploying on Fly (the shipped topology) |
| `xff` | Trusts the first entry of `X-Forwarded-For` | Behind a reverse proxy you control that sets XFF correctly and strips any client-supplied one |
| `none` | Uses the raw socket address | Direct exposure with no proxy in front |

Never set `xff` behind an infrastructure that doesn't strip client-supplied
`X-Forwarded-For` — a client can rotate the header per request and get an effectively
unlimited rate.

## Secrets handling and redaction

Secrets come only from environment variables (`.env` locally, `fly secrets set` in
production) — never from files in the repo. Three independent redaction points:

- **Logger** (`vendor/arag-platform/src/log/logger.ts`): any object key matching
  `/(token|key|secret|password|authorization|cookie)/i` is replaced with `•••` before a
  record is written to the ring buffer or stdout — recursively, six levels deep.
- **`describeEnv()`** (admin config view): the same key pattern (minus
  `authorization`/`cookie`, which don't appear in env var names) redacts to
  `•••(N chars)`, so an operator can confirm a secret is *set* and roughly how long it is
  without ever seeing it.
- **Error mapping**: `AragError` from a `401` upstream is mapped to a `502` whose detail
  names the misconfigured variable (`ARAG_API_KEY`) but never the token value or the KB
  base URL; in `NODE_ENV=production`, every other `5xx` detail is the generic "Internal
  server error" rather than the real exception message.

## Data retention and purge

There is **no automatic retention** in the MVP — uploaded documents live in the Knowledge
Box and the local store until explicitly deleted:

- `DELETE /api/v1/documents/{id}` deletes the local record and calls
  `DELETE /kb/{kb}/resource/{rid}` (best-effort — a KB-side failure is logged but doesn't
  block the local delete).
- `POST /api/v1/admin/purge {olderThanDays}` (admin-only) deletes every document older than
  the given age from both places; `olderThanDays: 0` deletes everything.
- This is a deliberate design choice recorded in [DP-08](../../DECISIONS.md): an
  operator-driven or cron-driven purge is auditable (it shows up in `/api/v1/admin/logs`
  and `/api/v1/admin/usage`); a silent background TTL sweeper is not. **An operator running
  this in production with real documents must schedule `purge` themselves** — nothing calls
  it automatically.

## Security headers and CSP

`securityHeaders()` (applied globally in `src/server.ts`) sets, on every response:

- `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), geolocation=(), microphone=(self)`.
- `Strict-Transport-Security` (production only, `NODE_ENV=production`).
- A `Content-Security-Policy` allowing `'self'` plus `https://cdn.jsdelivr.net` for scripts
  and styles (Redoc/Swagger UI and the UI kit's CDN dependency) and
  `https://fonts.googleapis.com`/`gstatic.com` for fonts. `img-src` allows `data:`/`blob:`
  and any `https:` origin (document preview thumbnails); `frame-src` additionally allows
  `blob:` (`src/server.ts` passes `securityHeaders({ frameSrc: ["blob:"] })`) so the demo
  can preview an uploaded PDF in an `<iframe>` from a `blob:` URL without relaxing the
  policy for anything else.

CORS (`cors()`) is same-origin-only by default (`ALLOWED_ORIGINS` empty); set it explicitly
to allow a separate frontend origin.

## Before exposing this publicly, an operator must

1. Set `ADMIN_TOKEN` (a long random value — `openssl rand -hex 24`, as `.env.example`
   suggests) — otherwise the admin panel is entirely disabled, not insecurely open, but
   also unusable for the operator.
2. Decide on `API_KEYS`: leaving it unset means the document API is open to anyone who can
   reach the URL. For a public production deployment, set at least one key and distribute
   it out of band; the demo UI keeps working unauthenticated via the session-cookie path.
3. Set `ALLOWED_ORIGINS` if any UI other than this product's own `public/`/`admin/` will
   call the API cross-origin.
4. Confirm `TRUST_PROXY` matches the actual network path (see above) — wrong here silently
   breaks per-client rate limiting.
5. Tune `RATE_LIMIT_RPS`/`BURST` for expected legitimate traffic; the defaults (5 rps,
   burst 20) are conservative and tuned for a demo, not a production API.
6. Schedule `POST /api/v1/admin/purge` (cron, or a manual runbook) if documents contain
   real personal or sensitive data — nothing does this automatically (see above).
7. Confirm `NODE_ENV=production` is set (enables HSTS and generic 500 details).
8. Read [`limits.md`](limits.md) and [`deployment-topologies.md`](deployment-topologies.md#multi-instance-considerations)
   before running more than one instance — the JSON store and in-process job queue are not
   safe to share or split across instances as shipped.

## Related

- [`limits.md`](limits.md) — the exact numbers behind every limit named here.
- [`deployment-topologies.md`](deployment-topologies.md) — where this runs and what changes under multiple instances.
- Root [`SECURITY.md`](../../SECURITY.md) — vulnerability reporting and supported versions.
