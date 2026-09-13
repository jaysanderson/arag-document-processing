# Design review checklist — Document Processing

**Time to work through: 30–45 minutes against a real deployment** (following each item
to the actual endpoint or file it names, not just reading the checklist).

Run this before approving a deployment (a new customer, a new environment, or a
material change to an existing one). Each item names the concrete thing to check in
this codebase or its running configuration — not a generic principle — and why it
matters for this specific product.

Companion documents: [`WORKSHOP.md`](WORKSHOP.md) (the reference architecture and
decision points behind these items), [`sizing-deployment.md`](sizing-deployment.md)
(the throughput/memory/cost numbers referenced below) and
[`key-value-schema-design.md`](key-value-schema-design.md) (schema-design guidance
behind the key-value section below).

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
- [ ] **API-key enforcement is reviewed as a real key store, not just the `API_KEYS`
      env var.** `API_KEYS` (seeded keys) still works, but it is one of four equivalent
      credentials now — the others are a minted key from `POST
      /api/v1/admin/api-keys {name}` (the plaintext `dip_<id>_<secret>` is returned
      **once**; only a salted SHA-256 digest is stored), `ADMIN_TOKEN` as a bearer
      token, and a same-origin session cookie from `POST /api/v1/session`. Whether any
      credential is *required at all* for reads is the live, editable setting
      `security.requireApiKey`, not a fixed env-var check. Don't review this from the
      environment: read `GET /api/v1/admin/settings`'s `applied.security` block, which
      reports `apiKeysEnforced` (whether `security.requireApiKey` is currently `true`),
      `storedApiKeys` (the live count of non-revoked keys in the store) and
      `seededApiKeys` (how many came from `API_KEYS`) — this is what's actually
      enforced right now, which may not match what `fly secrets list` shows.
      **Why it matters:** an unauthenticated public API accepts uploads (which cost
      ARAG processing and, depending on plan, spend) and can create arbitrary custom
      extraction configs; a deployment can also flip `requireApiKey` off after go-live
      without anyone touching a secret, so this needs checking at review time, not
      just at launch.
- [ ] **Key hygiene: named keys per caller, revoked on offboarding, `lastUsedAt`
      checked for staleness.** Mint one key per integration/caller via `POST
      /api/v1/admin/api-keys {name}` rather than sharing a single key across callers —
      `GET /api/v1/admin/api-keys` lists name/prefix/`lastUsedAt`/`revoked` (never the
      value), so a shared key can't be attributed to whoever actually used it.
      `DELETE /api/v1/admin/api-keys/{id}` revokes a key (the record is kept, with
      `revokedAt`, for audit) — confirm there's a process to revoke a caller's key when
      that integration or person is offboarded, not just to mint new ones going
      forward. `lastUsedAt` is the evidence a key is actually dead before revoking it,
      or actually alive when a caller claims their integration stopped working.
      **Why it matters:** a key store with no naming or revocation discipline is
      functionally the same shared secret `API_KEYS` was, just with extra steps.
- [ ] **`TRUST_PROXY` matches the actual deployment topology** (`fly` — the default,
      trusting `Fly-Client-IP` — `xff`, or `none`). Confirm this against where the
      product is actually deployed: getting this wrong doesn't just mislead logs, it
      breaks per-IP rate limiting, since the wrong header (or no header) is used to key
      the token bucket. **Why it matters:** on the wrong setting, rate limiting can
      silently key every request off the load balancer's own IP — a single bucket for
      all callers, not one per client.
- [ ] **`ALLOWED_ORIGINS` is explicit for any deployment with a browser-based caller
      other than this product's own workspace and operator console.** Empty means
      same-origin only, which is safe by default but will also silently break a
      legitimate third-party browser integration rather than erroring helpfully.
      **Why it matters:** this is the product's only CORS control (`cors()`
      middleware in `src/server.ts`) — there is no per-route override.
- [ ] **The upload MIME allowlist is reviewed against actual document sources.**
      `ALLOWED_MIME` in `src/services/documents.ts` accepts pdf, png, jpeg, webp, tiff,
      txt, md, csv, docx and nothing else; anything else is `415` before it reaches
      ARAG. Confirm this covers the customer's real input formats (a common gap: `.heic`
      photos from iPhones, or `.xlsx`) — and resist the temptation to widen it beyond
      what's actually needed. **Why it matters:** this is the security boundary that
      stops arbitrary bytes reaching the Knowledge Box; the audit that produced this
      product's rewrite found the prior version had no such boundary at all.

## Configuration and change control

- [ ] **Every setting is reviewed as live and editable, not as a deploy-time fact.**
      DP-52: environment variables are only the *default* layer now — the product's
      JSON store holds an override layer, the effective value is read from live
      objects, and a change made through `PATCH /api/v1/admin/settings` takes effect
      immediately, with no restart. `PORT`, `HOST`, `DATA_DIR`, `NODE_ENV` and
      `ARAG_MOCK` are the only settings still environment-only by definition (a new
      bind address, store directory or transport genuinely is a restart). Review
      `GET /api/v1/admin/settings`'s `applied` block — it reports every effective
      value and which layer it came from (`source: "store" | "env" | "default"`) —
      rather than reading `fly secrets list` or `fly.toml` and assuming that's what's
      running. **Why it matters:** "what the environment says" is no longer "what the
      deployment is running." A design review conducted by inspecting secrets and
      config files alone can sign off on a deployment that isn't the one actually
      serving traffic.
- [ ] **Who holds the admin token is confirmed, deliberately.** The admin token is no
      longer just the door to a dashboard — it's now the credential that can change
      the Knowledge Box connection (`connection.kbId`, `baseUrl`, `apiKey`), the
      upload ceiling (`limits.maxUploadBytes`), the rate limiter
      (`limits.rateLimitRps`/`rateLimitBurst`) and the retention/purge scheduler
      (`retention.*`) live, with no deploy and no review gate beyond the token itself.
      Confirm who actually holds it and through what path (a real secrets manager, not
      a shared message), and that this list of people is one the deployment owner
      would recognize as "people who can change what this deployment does in
      production." **Why it matters:** the blast radius of a leaked or over-shared
      admin token grew with DP-52 — it used to unlock a dashboard, it now unlocks live
      reconfiguration of the parts of the system this whole checklist is reviewing.
- [ ] **The audit log is read by somebody, and exported before it's lost.** `GET
      /api/v1/admin/audit` is the only record of who changed what — settings edits,
      API-key create/revoke, config create/edit/delete/provision, field corrections,
      purges and document deletes all land there, paged by a stable sequence cursor.
      It lives in the same JSON store as everything else, with a default 5,000-entry
      cap and FIFO eviction once that's exceeded (see `sizing-deployment.md`) —
      confirm someone is actually reading it, and that it's exported on a schedule
      that keeps ahead of the cap for any customer with a compliance or "who did this"
      requirement. **Why it matters:** an audit trail nobody reads, and that silently
      rolls off after 5,000 entries with no export configured, answers "who changed
      what" only for a recent window — which is not what "audited" usually means to a
      customer's security team.
- [ ] **Secrets stay write-only in review, by design — confirm the review doesn't
      fight that.** `applied.security`/`applied.connection` report secret fields
      (`adminToken`, `connection.apiKey`) as `{set, hint}` only, never a value, even to
      an admin-authenticated caller. A design review should confirm a secret *is set*
      and, from `hint`, plausibly the right one — not ask anyone to produce the value
      itself as evidence. **Why it matters:** this is deliberate (DP-52) so that a
      review, a support ticket or a screen-share can't leak a live credential; treat a
      request to see the raw value as the process gap, not the settings API.

## Data protection and retention

- [ ] **A retention policy is agreed and scheduled, not left as "manual purge only."**
      There is **no automatic TTL sweeper** — `POST /api/v1/admin/purge
      {olderThanDays}` is the only mechanism, and it must be triggered (an operator, or
      a scheduled call) to ever run. Confirm who/what calls it and how often, before
      go-live, not after the first data-retention question from a customer's security
      team. **Why it matters:** this was a named audit finding on the prior version
      ("uploads stayed in the KB forever") — the fix exists, but only if it's actually
      invoked.
- [ ] **PII/PHI exposure in the Knowledge Box is understood and accepted — as two
      copies, not one.** Two of the eleven built-in schemas (`medical_claim`,
      `preauthorisation`) are specifically designed to extract health-adjacent PII
      (member numbers, diagnosis codes, patient names). The **source document itself**
      persists in the ARAG Knowledge Box until deleted (`DELETE
      /api/v1/documents/{id}` or a purge) — that was already true. What's new: every
      extraction config's key-value fields are a **second** copy of the same extracted
      values, written into the Knowledge Box's filterable key-value index alongside
      the source document (DP-46). A `medical_claim` deployment therefore exports
      member numbers and diagnosis codes into a filterable KB-side index, not only
      into this product's own JSON store — review that exposure as its own line item,
      not as covered by reviewing the document store. Confirm the KB's own
      data-handling terms and region (`ARAG_REGION`/`ARAG_BASE_URL`) satisfy the
      customer's compliance requirements for the data types they'll actually upload.
      **Why it matters:** "delete the record" and "delete the source document and its
      key-value data from the KB" are the same action here — deleting the document
      deletes the resource and its key-value data together (`deleteResource` is always
      called alongside the local delete) — but nothing else does, and only once
      someone calls it.
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

## Key-value fields and filtering

- [ ] **The 20-schema/50-field ceiling is checked against how many document types this
      customer actually wants.** Every extraction config consumes one of a Knowledge
      Box's 20 key-value-schema slots (two if a generator agent is running for it);
      the 11 built-in types already consume 11. See `sizing-deployment.md`'s
      "Knowledge Box ceilings" section for the arithmetic and the remedy (a second
      Knowledge Box, or deleting unused configs — not more compute). **Why it
      matters:** this ceiling binds on the number of distinct document types, not on
      document volume, so a customer who sizes only for throughput can still be
      surprised by it.
- [ ] **Nothing is marked `required` in the provisioned key-value schema, and that's
      understood as deliberate, not a gap.** `provisionable()`
      (`src/services/configs.ts`) strips every `required` flag before a config's
      fields become a key-value schema, even though the extraction still asks for the
      field and the JSON-schema → kv mapper still projects `required` faithfully
      elsewhere (DP-47). Confirm this doesn't read, in review, as "the product forgot
      to enforce required fields" — it's the opposite. **Why it matters:** a key-value
      write is a full replace, and the live Knowledge Box refuses the *entire* write
      when a required key is absent. A required flag here would turn one missed field
      on one faded scan into total loss of every value the pipeline *did* extract for
      that resource — a required flag that converts partial success into total
      failure is not a safety property, and a reviewer who "fixes" this by re-adding
      `required` would be reintroducing a real production failure mode.
- [ ] **Per-field key-value type overrides are set for every field a customer intends
      to filter on.** `kv: { type, repeated, range }` on a built-in schema, or
      `kvType`/`kvRepeated`/`kvRange` on a custom config, is what makes numeric and
      date filtering possible at all — a JSON-schema heuristic alone would leave an
      invoice total as a string with no `gte`/`lte` filtering (DP-48). Confirm every
      amount and date the customer plans to filter on actually carries the right
      override (`money()` → `float`, `date()` → `date`) — for a custom config, this
      means reading the field definitions, not assuming the default heuristic covers
      it. **Why it matters:** a field with the wrong (or no) kv type override doesn't
      error at config-creation time; it just silently can't support the filter the
      customer will ask for later. See
      [`key-value-schema-design.md`](key-value-schema-design.md).
- [ ] **No compliance or reconciliation query is built on a key-value filter over
      mutable data — the overwrite trap makes that unsafe.** A key-value write is a
      full replace, and overwriting does **not** remove the old value from the
      Knowledge Box's filter index — there's no purge call (DP-51). A corrected or
      reprocessed resource still matches a filter on its *old* value indefinitely
      (verified: `kv=…:po_number:eq:PO-88421` still returns a resource after it was
      corrected to `PO-88422`, and so does a filter on the new value). The record's
      `meta.kv.filterIndexStale`/`meta.kv.superseded[]` state this on the record
      itself, but a filter *query* has no equivalent flag. Confirm nobody is building
      a "find all claims still coded X" or "which invoices are still marked Y"
      compliance query against a field that gets corrected or reprocessed. **Why it
      matters:** this is the kind of query a customer's compliance team reaches for
      by instinct, and it will silently return wrong results (both old and new
      values match) rather than erroring.
- [ ] **No count, total or "0 results" conclusion is built on a key-value filter —
      filtering is eventually consistent, not a live index.** Measured live (DP-55): a
      value readable on the record instantly via `show=values` was still not returned
      by a `/find` key-value filter roughly 66 seconds later, with no status to wait
      on; the matched count grew mid-window without ever including the resource just
      written. Confirm no dashboard, alert or acceptance test treats a kv-filtered
      list's count as exhaustive, and that anyone shown `filters.knowledgeBox` numbers
      understands them as "what matched so far," not "everything that matches."
      **Why it matters:** against the mock, the same filter is immediate — a demo or
      a test suite run against `ARAG_MOCK=1` will not surface this, and a reviewer who
      only exercises the mock can sign off on a query pattern that fails live.

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
- [ ] **No deployment depends on a generator agent's values appearing within a known
      time.** The Data Augmentation generator agent's lifecycle — start, stop, delete —
      has been verified live, including that deleting a *running* agent correctly
      answers `409` rather than succeeding or hanging (never assert this against the
      mock, which answers `204` instead — DP-54's 409 is live-only behaviour).
      What has **not** been verified live is end-to-end write latency:
      `observed.endToEndLatency` reports `false`, because every run started during
      verification was still `scheduled` twenty minutes later. Confirm no workflow,
      demo script or SLA assumes a generated value shows up within any particular
      window. **Why it matters:** the Compare tab and the record's comparison payload
      will look complete the moment the agent starts; nothing in the product signals
      "this hasn't actually written yet" beyond the flag itself.

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
- [ ] **`POST /api/v1/ask` (the cross-document ask) is counted as a second,
      independent user-triggered generative cost, not folded into the per-document
      cost above.** It runs retrieval and a model call over a *set* of documents
      (`filters` uses the same query parameter names as `GET /api/v1/documents`), not
      `full_resource` grounding on one record, and it has its own tight rate-limit
      bucket separate from `POST /documents/{id}/ask`. Confirm both ask endpoints are
      counted in any cost projection presented to a customer. **Why it matters:** it's
      easy to price "processing" and forget that both ask endpoints are real,
      user-triggered generative calls a customer's own usage pattern controls, not a
      fixed per-document cost.
- [ ] **The Data Augmentation generator agent is named as a Knowledge-Box-side cost
      this product starts but does not meter.** `GET /api/v1/admin/usage`'s
      `aragCalls`/`aragMs`/`aragErrors` count the calls *this product* makes to ARAG,
      which includes the one call that starts an agent — but not the generation work
      the agent then performs inside the Knowledge Box afterward (asynchronously,
      with `observed.endToEndLatency: false` — see Reliability above), which runs and
      is billed on the Knowledge Box side with no further call from this product to
      count. Confirm the customer understands that starting an agent is an
      operational decision with an ongoing cost this product's own usage reporting
      does not show. **Why it matters:** a cost review that only reads `admin/usage`
      will miss this entirely — it's real spend with no dashboard in this product that
      shows it.
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
      there is an actual calendar reminder or automation for rotation. `ADMIN_TOKEN`
      no longer requires a deploy to rotate at all: `security.adminToken` is a DP-52
      settings-store field — write-only, "set once, then rotate" — so
      `PATCH /api/v1/admin/settings {"security":{"adminToken":"…"}}` rotates it live,
      with no restart, and signs out every open admin session cookie immediately (a
      `fly secrets set ADMIN_TOKEN=…` + restart still works too, as the env-default
      layer, but is no longer the only or the fastest path). Confirm whoever owns
      rotation knows which path they're actually using and that the two don't drift —
      an env var set to one value while the store holds an override is the value that
      loses.
- [ ] **A KB-reset runbook exists and has been tried once.** After a KB reset or
      migration to a new Knowledge Box: (1) update `connection.kbId` (and `baseUrl`/
      `apiKey` if they've changed) — via `PATCH /api/v1/admin/settings`, live, with no
      restart, since DP-52 moved this off `ARAG_KB_ID`-at-boot-only (the ARAG client
      is rebuilt behind a proxy on a connection change, not reconstructed at boot); a
      `fly secrets set` + restart still works as the env-default layer, but is no
      longer required, (2) call `POST /api/v1/admin/provision` to re-create every
      search configuration **and** every key-value schema on the new KB (DP-46 — both
      are re-derived from each config, not carried over), (3) confirm
      `GET /api/v1/admin/health`'s `arag.ok` is `true` and
      `GET /api/v1/extraction-configs` shows `provisioned: true` across the board.
      Confirm someone has actually walked through this sequence once, in a
      non-production KB, before it's needed for real.
- [ ] **The workspace's and operator console's dependency on `/api/v1` alone is
      preserved.** Both surfaces (`public/`, `admin/`) consume only the public/admin
      API — no direct store or ARAG access. Confirm no deployment-specific
      customisation has broken this boundary (e.g. a reverse proxy that serves stale
      cached UI assets pointing at a different API base than intended).
