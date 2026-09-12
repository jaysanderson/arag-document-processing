# Design review checklist — Document Processing

Run this before approving a deployment (a new customer, a new environment, or a
material change to an existing one). Each item names the concrete thing to check in
this codebase or its running configuration — not a generic principle — and why it
matters for this specific product.

Companion documents: [`WORKSHOP.md`](WORKSHOP.md) (the reference architecture and
decision points behind these items) and [`sizing-deployment.md`](sizing-deployment.md)
(the throughput/memory/cost numbers referenced below).

## Security

- [ ] **`ADMIN_TOKEN` is set, non-default, and rotated per environment.** Unset ⇒
      `/admin` and `/api/v1/admin/*` answer `403` with an explanatory detail (fails
      closed, not open) — but an environment that *never* sets it has no admin surface
      at all, including health/usage/logs/provisioning. Confirm it's a generated
      secret (`openssl rand -hex 24`, per `.env.example`), not the literal
      `dev-admin-token` value used for local development and this lab.
      **Why it matters:** the admin panel can trigger re-provisioning of every ARAG
      search configuration and purge documents — it is a privileged surface, not a
      read-only dashboard.
- [ ] **`API_KEYS` is set for any deployment with external callers.** When unset,
      `/api/v1/*` routes marked `auth: "api"` are open to anyone who can reach the
      host. The demo UI works either way (it obtains a same-origin session cookie via
      `POST /api/v1/session`), so "the demo still works" is not evidence the API is
      protected. **Why it matters:** an unauthenticated public API accepts uploads
      (which cost ARAG processing and, depending on plan, spend) and can create
      arbitrary custom extraction configs.
- [ ] **`TRUST_PROXY` matches the actual deployment topology** (`fly` — the default,
      trusting `Fly-Client-IP` — `xff`, or `none`). Confirm this against where the
      product is actually deployed: getting this wrong doesn't just mislead logs, it
      breaks per-IP rate limiting, since the wrong header (or no header) is used to key
      the token bucket. **Why it matters:** on the wrong setting, rate limiting can
      silently key every request off the load balancer's own IP — a single bucket for
      all callers, not one per client.
- [ ] **`ALLOWED_ORIGINS` is explicit for any deployment with a browser-based caller
      other than this product's own demo/admin UIs.** Empty means same-origin only,
      which is safe by default but will also silently break a legitimate third-party
      browser integration rather than erroring helpfully. **Why it matters:** this is
      the product's only CORS control (`cors()` middleware in `src/server.ts`) — there
      is no per-route override.
- [ ] **The upload MIME allowlist is reviewed against actual document sources.**
      `ALLOWED_MIME` in `src/services/documents.ts` accepts pdf, png, jpeg, webp, tiff,
      txt, md, csv, docx and nothing else; anything else is `415` before it reaches
      ARAG. Confirm this covers the customer's real input formats (a common gap: `.heic`
      photos from iPhones, or `.xlsx`) — and resist the temptation to widen it beyond
      what's actually needed. **Why it matters:** this is the security boundary that
      stops arbitrary bytes reaching the Knowledge Box; the audit that produced this
      product's rewrite found the prior version had no such boundary at all.

## Data protection and retention

- [ ] **A retention policy is agreed and scheduled, not left as "manual purge only."**
      There is **no automatic TTL sweeper** — `POST /api/v1/admin/purge
      {olderThanDays}` is the only mechanism, and it must be triggered (an operator, or
      a scheduled call) to ever run. Confirm who/what calls it and how often, before
      go-live, not after the first data-retention question from a customer's security
      team. **Why it matters:** this was a named audit finding on the prior version
      ("uploads stayed in the KB forever") — the fix exists, but only if it's actually
      invoked.
- [ ] **PII/PHI exposure in the Knowledge Box is understood and accepted.** Two of the
      eleven built-in schemas (`medical_claim`, `preauthorisation`) are specifically
      designed to extract health-adjacent PII (member numbers, diagnosis codes, patient
      names). The **source document itself** persists in the ARAG Knowledge Box until
      deleted (`DELETE /api/v1/documents/{id}` or a purge) — not just the extracted
      fields in this product's own store. Confirm the KB's own data-handling terms and
      region (`ARAG_REGION`/`ARAG_BASE_URL`) satisfy the customer's compliance
      requirements for the data types they'll actually upload. **Why it matters:**
      "delete the record" and "delete the source document from the KB" are the same
      action here (`deleteResource` is always called alongside the local delete) — but
      only once someone calls it.
- [ ] **What leaves the network is enumerated.** For every upload: (1) the raw document
      bytes go to the ARAG Knowledge Box on ingestion; (2) the document's content (via
      `full_resource` grounding) is sent to ARAG's configured generative model
      (`ARAG_GENERATIVE_MODEL`, e.g. an Azure-hosted OpenAI model) on every classify/
      extract/entities/summary call and every `ask`. Confirm this chain — this
      product → ARAG → the underlying model provider — is acceptable for the
      customer's data classification, especially for the medical/claims schemas.
      **Why it matters:** this is not a self-hosted-model deployment; every extraction
      is a real outbound call to a third-party-hosted LLM.
- [ ] **Logs and the job store are checked for incidental data exposure.** Application
      logs (`log.info("agent.extract", …)` etc.) intentionally carry only ids, counts
      and durations — never field values or document content (verified: no log call in
      `src/services/agents.ts` or `pipeline.ts` logs an extracted value). However, a
      **job's `input`** (persisted in the `jobs` collection, visible via
      `GET /api/v1/jobs/{id}` and the admin Jobs tab) does include the original
      **filename** — confirm filenames themselves don't carry PII (e.g.
      `John Smith - SSN Card.jpg`) that the customer wouldn't want sitting in the jobs
      store or admin panel.

## Reliability

- [ ] **Single-instance job execution is understood as a hard constraint, not a
      current limitation to scale past casually.** The `JobManager` and the JSON store
      both hold state in-process memory, backed by one Fly volume. Running more than
      one instance (`min_machines_running` raised, or Fly's autoscaling adding
      machines) causes **divergent, corrupting state** — this is not merely
      under-tested, it is architecturally unsupported today. Confirm `fly.toml`'s
      `min_machines_running = 1` is intentional and will not be "fixed" by someone
      raising it during a later infra review. **Why it matters:** this is the single
      highest-severity operational risk in the whole deployment — see
      `sizing-deployment.md` for the throughput ceiling this constraint implies.
- [ ] **Restart behaviour is tested, not assumed.** On restart, the JSON store reloads
      each collection from disk into memory (`Collection`'s constructor in
      `jsonstore.ts`); any job that was `running` at the moment of restart is not
      resumed automatically — confirm what actually happens to an in-flight document
      on a Fly machine restart/redeploy (recommendation: check the job's status after a
      deliberate `fly deploy` during a test upload, don't assume). **Why it matters:**
      a deploy during business hours is a normal operational event, not an edge case.
- [ ] **Provisioning idempotency is exercised, not just trusted.** `POST
      /api/v1/admin/provision` re-creates every built-in and custom search
      configuration and is safe to call repeatedly (`POST` falling back to `PATCH` on
      409). Confirm this actually gets called after any KB reset or migration to a new
      KB — a fresh KB with no search configurations means every extraction fails until
      this runs (it also runs automatically, non-blocking, at boot — but a KB that
      doesn't exist yet at boot time, or a boot-time provisioning failure, will need
      the manual endpoint). **Why it matters:** this is the recovery path after a KB
      reset — verify it's known, not just that it exists in code.
- [ ] **Soft-stage failure behaviour is explained to whoever consumes the API.** Every
      pipeline stage is `soft: true` — a failing `entities` or `summary` call still
      leaves the job `succeeded` and the record `ready`, just with an empty or partial
      section and a stage error visible in the job's event log. Confirm downstream
      consumers check `issues`/stage errors rather than assuming a `ready` record is
      always complete. **Why it matters:** this is a deliberate design choice
      (DP-09) that trades completeness guarantees for availability — the right trade-off
      for a demo-grade extraction tool, but one a strict compliance workflow needs to
      know about explicitly.

## Observability

- [ ] **`GET /api/v1/admin/health` is wired into the deployment's actual health
      monitoring**, not just `/healthz` (liveness only). `admin/health` includes the
      real ARAG connection check (`arag.health()`) and document-status counts —
      `/healthz`/`/readyz` are what Fly's own `[[http_service.checks]]` polls, and
      `readyz` does check ARAG connectivity, but confirm whatever *external* monitoring
      the customer runs (Datadog, PagerDuty, etc.) also polls something ARAG-aware, not
      just process-liveness.
- [ ] **`GET /api/v1/admin/usage` and `GET /api/v1/admin/logs` are reachable by
      whoever will actually operate this in production**, and that person has the
      admin token through a real secrets-management path (not a shared Slack message).
      **Why it matters:** usage tracks ARAG call counts/errors/latency — the first
      place to look when a customer reports "processing is slow" or "extraction is
      failing," and logs are the only structured record of what happened, redacted of
      secrets by design.
- [ ] **Log retention expectations are set correctly.** Only the **last 500** log
      records are kept in memory (STANDARDS §7) — there is no persistent log store in
      this product. Confirm the deployment ships logs to an external sink (Fly's own
      log aggregation, or a forwarder) if historical debugging beyond "the last few
      hundred lines" is a requirement.

## Cost

- [ ] **LLM calls per document are counted and multiplied by expected volume**, not
      estimated loosely. Counted directly from `src/services/pipeline.ts`:

      | Upload mode | Model calls per successful document (typical) | Worst case (both retries fire) |
      |---|---|---|
      | `auto` (classify + extract) | 4 (`classify`, `extract`, `entities`, `summary`) | 6 |
      | forced config (`?config=<id>`) | 3 (`extract`, `entities`, `summary`) | 5 |
      | `agent` (DA-agent fields) | 2 (`entities`, `summary` only — reading persisted fields is a plain `getResource` call, not a model call) | 3 |

      Plus **one additional call per `POST /documents/{id}/ask` invocation** — a
      user-triggered cost, not a per-processing cost, and unbounded by anything in this
      product beyond the standard rate limiter. **Why it matters:** at real volume (see
      `sizing-deployment.md`), the difference between `auto` and a forced config is a
      genuine, multiplicative cost lever — if the caller already knows the document
      type, forcing the config saves one full model call per document, at scale.
- [ ] **The generative model choice is a deliberate cost/quality decision, confirmed
      with the customer, not left at the default.** `ARAG_GENERATIVE_MODEL` (default
      `chatgpt-azure-4o` in this deployment) must be multimodal for visual extraction —
      confirm the chosen model's per-token cost against expected document volume and
      average document size (larger documents mean more tokens under `full_resource`
      grounding, since the whole document is in context on every call).
- [ ] **Retries are accounted for, not assumed away.** The empty-result retry on
      `extract` and `entities` (see the developer track's knowledge check, Q8) means a
      genuinely flaky KB state can double the model-call cost for a subset of
      documents — this is rare in steady state but worth a note in any cost projection
      presented to a customer as a hard ceiling rather than a typical case.

## Operability

- [ ] **The deploy path is documented and has been exercised, not just written down.**
      `docker build` locally and `fly config validate -c fly.toml` (`make docker`,
      `make fly-validate`) both need to have actually been run against the target
      configuration before go-live — a `Dockerfile`/`fly.toml` that merely looks
      correct is not the same as one that has been built and validated.
- [ ] **Secret rotation has a known procedure.** `ARAG_API_KEY` is a 90-day
      service-account key (per this product's own `.env` provenance comment) — confirm
      there is an actual calendar reminder or automation for rotation, and that
      rotating `ADMIN_TOKEN`/`API_KEYS` doesn't require a deploy with downtime (it
      doesn't — they're read from the environment at boot, so a `fly secrets set` +
      restart is sufficient, but confirm this is understood by whoever owns rotation).
- [ ] **A KB-reset runbook exists and has been tried once.** After a KB reset or
      migration to a new `ARAG_KB_ID`: (1) update the secret, (2) restart or wait for
      the next deploy, (3) call `POST /api/v1/admin/provision` to re-create every
      search configuration, (4) confirm `GET /api/v1/admin/health`'s `arag.ok` is
      `true` and `GET /api/v1/extraction-configs` shows `provisioned: true` across the
      board. Confirm someone has actually walked through this sequence once, in a
      non-production KB, before it's needed for real.
- [ ] **The demo and admin UI's dependency on `/api/v1` alone is preserved.** Both
      surfaces (`public/`, `admin/`) consume only the public/admin API — no direct
      store or ARAG access. Confirm no deployment-specific customisation has broken
      this boundary (e.g. a reverse proxy that serves stale cached UI assets pointing
      at a different API base than intended).
