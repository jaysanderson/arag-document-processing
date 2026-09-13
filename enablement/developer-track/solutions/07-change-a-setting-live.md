# Solution 7 — Change a setting without a restart, and prove it through the API

A real transcript against a locally running instance (`make dev`, `ARAG_MOCK=1`) with
`ADMIN_TOKEN=lab-admin-token`. Timestamps, request ids, the mock's port and the audit
log's `seq` numbers will differ — `seq` is a monotonic counter over everything audited on
that instance, so yours depends on what you did in earlier sections. The shapes, the
values and the status codes will not differ.

Export the base URL and the header once so the calls below read cleanly:

```bash
B=http://localhost:8080
A='Authorization: Bearer lab-admin-token'
```

## 1. Read the settings document

```bash
curl -sS "$B/api/v1/admin/settings" -H "$A" | jq '{version, groups: [.groups[].id]}'
```

```json
{
  "version": 1,
  "groups": ["branding", "connection", "limits", "security", "retention", "operations"]
}
```

One field, in full:

```bash
curl -sS "$B/api/v1/admin/settings" -H "$A" \
  | jq '.groups[].fields[] | select(.key=="limits.maxUploadBytes")'
```

```json
{
  "key": "limits.maxUploadBytes",
  "group": "limits",
  "label": "Max upload size (bytes)",
  "description": "Uploads above this are rejected with 413 before anything reaches the Knowledge Box.",
  "type": "number",
  "envVar": "DIP_MAX_UPLOAD_BYTES",
  "secret": false,
  "adminOnly": false,
  "source": "env",
  "value": 26214400,
  "envSet": true,
  "constraints": { "min": 1024, "max": 1073741824 }
}
```

**The three layers**, reported per field as `source`:

| `source` | Means | How it got there |
|---|---|---|
| `default` | The built-in fallback | Nothing set it |
| `env` | The deployment's environment | `DIP_MAX_UPLOAD_BYTES` in `.env` / `fly secrets` |
| `store` | An in-product edit | Somebody `PATCH`ed it; it survives a restart and **overrides** the environment |

`envVar` and `envSet` are what let a UI offer a meaningful "reset": a reset has
somewhere to fall back **to** only when the environment actually sets the field.

### What makes `applied` different

```bash
curl -sS "$B/api/v1/admin/settings" -H "$A" | jq '.applied'
```

```json
{
  "settingsVersion": 1,
  "arag": { "kbId": "00000000-0000-4000-8000-000000000001", "baseUrl": "http://127.0.0.1:63135/api/v1",
            "timeoutMs": 60000, "mock": true, "generativeModel": "chatgpt-azure-4o",
            "reranker": "predict", "visualExtraction": true, "error": null },
  "limits": { "maxUploadBytes": 26214400, "maxBodyBytes": 26214400,
              "rateLimitRps": 5, "rateLimitBurst": 20 },
  "security": { "apiKeysEnforced": false, "storedApiKeys": 0, "seededApiKeys": 0,
                "adminEnabled": true, "allowedOrigins": [], "trustProxy": "fly" },
  "retention": { "days": 30, "autoPurgeEnabled": false, "purgeIntervalHours": 24,
                 "schedulerActive": false, "nextRunAt": null },
  "operations": { "logLevel": "info" },
  "branding": { "productName": "Document Processing", "tagline": "Documents in, validated records out", … }
}
```

The field list above is **what the store says**. `applied` is **what the running objects
say** — it is read back from the live ARAG client, the live rate limiter, the live upload
ceiling and the retention scheduler, not from the stored document. They are separate on
purpose: "I saved it" and "it is in force" are two different claims, and a settings screen
that conflates them cannot tell a partner whether their rebrand actually landed.
`schedulerActive` and `nextRunAt` are the clearest example — no stored value can tell you
whether a timer is actually running.

## 2. The secrets

```bash
curl -sS "$B/api/v1/admin/settings" -H "$A" \
  | jq '.groups[].fields[] | select(.secret) | {key, source, value, set, hint, adminOnly}'
```

```json
{ "key": "connection.apiKey",   "source": "default", "value": null, "set": true, "hint": "…-key",  "adminOnly": true }
{ "key": "security.adminToken", "source": "env",     "value": null, "set": true, "hint": "…oken", "adminOnly": true }
```

`value` is **always `null`** for a secret. What you get instead is `set` (is a value in
force?) and `hint` (the last four characters, enough to tell two keys apart when you are
deciding which one to rotate). They are accepted by `PATCH` and returned by nothing —
including the audit log, where a secret's `before`/`after` are `null` and the fact that it
changed *is* the record.

> In this lab `connection.apiKey` reads `source: "default"` because `ARAG_MOCK=1` and the
> in-process mock owns the connection: its ids are the baseline an operator edits from, and
> the deployment's real credentials are deliberately not the default here. On a live
> deployment this reads `source: "env"`.

## 3. Change something with an observable consequence

```bash
curl -sS -X PATCH "$B/api/v1/admin/settings" -H "$A" \
     -H 'Content-Type: application/json' \
     -d '{"limits":{"maxUploadBytes":2048}}' | jq '{changed, version: .settings.version}'
```

```json
{
  "changed": [
    { "key": "limits.maxUploadBytes", "before": 26214400, "after": 2048, "secret": false }
  ],
  "version": 2
}
```

Three independent proofs, no restart:

```bash
# (a) the field's own layer and value
curl -sS "$B/api/v1/admin/settings" -H "$A" \
  | jq '.groups[].fields[] | select(.key=="limits.maxUploadBytes") | {source, value}'
# { "source": "store", "value": 2048 }

# (b) the live object
curl -sS "$B/api/v1/admin/settings" -H "$A" | jq '.applied.limits.maxUploadBytes'
# 2048

# (c) the credential-free endpoint the upload drawer actually reads
curl -sS "$B/api/v1/settings" | jq '.uploads.maxBytes'
# 2048
```

(c) is the one that matters to a user of the product: the upload drawer's accepted types
and size limit come from the API rather than from hard-coded markup (DP-40), so an
operator lowering the ceiling changes what the screen tells the next person who opens it.

## 4. Prove it against real behaviour

```bash
head -c 3000 /dev/urandom | base64 | head -c 3000 > /tmp/big.txt
curl -sS -o /tmp/413.json -w '%{http_code}\n' -X POST "$B/api/v1/documents" \
     -H 'Content-Type: text/plain' -H 'X-Filename: big.txt' --data-binary @/tmp/big.txt
cat /tmp/413.json
```

```
413
```
```json
{
  "type": "https://arag.dev/problems/payload-too-large",
  "title": "Payload too large",
  "status": 413,
  "detail": "Body exceeds 2048 bytes",
  "instance": "/api/v1/documents",
  "requestId": "79cbc11c-e697-4944-b7b2-f5400320da2c"
}
```

The process has not been restarted. The ceiling is enforced before anything reaches the
Knowledge Box, and the detail names the number that is actually in force — which is only
possible because the guard reads a getter rather than a boot-time constant.

## 5. The patch is atomic

```bash
curl -sS -X PATCH "$B/api/v1/admin/settings" -H "$A" \
     -H 'Content-Type: application/json' \
     -d '{"branding":{"primaryColor":"not-a-colour","tagline":"Should not be applied"}}'
```

```json
{
  "type": "https://arag.dev/problems/validation",
  "title": "Validation failed",
  "status": 400,
  "detail": "Invalid body: branding.primaryColor Must be a hex, rgb(), rgba(), hsl(), hsla() or CSS keyword colour (strict grammar)",
  "instance": "/api/v1/admin/settings",
  "errors": [
    { "path": "branding.primaryColor",
      "message": "Must be a hex, rgb(), rgba(), hsl(), hsla() or CSS keyword colour (strict grammar)" }
  ],
  "in": "body"
}
```

```bash
curl -sS "$B/api/v1/branding" | jq -r .tagline
# Documents in, validated records out
```

The valid half was **not** applied. Every field is validated before anything is written,
and one bad value fails the whole patch with an RFC 9457 problem naming each offending
key. A partial apply would leave an operator unable to say what state their deployment is
in after a typo — which is exactly the moment they most need to know.

## 6. The audit trail

```bash
curl -sS "$B/api/v1/admin/audit?action=settings" -H "$A" \
  | jq '{total, items: [.items[] | {seq, actor: .actor.type, action, target, before, after}]}'
```

```json
{
  "total": 1,
  "items": [
    { "seq": 3, "actor": "admin", "action": "settings.update",
      "target": "limits.maxUploadBytes", "before": 26214400, "after": 2048 }
  ]
}
```

`action=settings` is a **prefix** match, so it catches `settings.update` and
`settings.reset` together. Paging is by sequence number, not offset, so an entry written
while you are reading cannot duplicate or hide a row.

## 7. Put it back

```bash
curl -sS -X POST "$B/api/v1/admin/settings/reset" -H "$A" \
     -H 'Content-Type: application/json' \
     -d '{"keys":["limits.maxUploadBytes"]}' \
  | jq '{changed, applied: .settings.applied.limits.maxUploadBytes,
         field: (.settings.groups[].fields[] | select(.key=="limits.maxUploadBytes") | {source, value})}'
```

```json
{
  "changed": [ { "key": "limits.maxUploadBytes", "before": 2048, "after": 26214400, "secret": false } ],
  "applied": 26214400,
  "field": { "source": "env", "value": 26214400 }
}
```

Reset is not "set it back to 26214400" — it **removes the store override**, so the field
falls back to whatever the environment says *now*. That difference matters on a
deployment where the environment variable itself changed while an override was masking it.

Re-run the audit query and you now have two rows: `settings.update` and `settings.reset`.

## 8. The settings that are deliberately not editable

Five environment variables stay environment-only, and each is a restart **by definition**
rather than by omission:

| Variable | Why it cannot be a live setting |
|---|---|
| `PORT` | A new listening port is a new socket. The process has to rebind. |
| `HOST` | Same: a new bind address is a new socket. |
| `DATA_DIR` | The store is loaded into memory at boot from this directory. Moving it under a running process would strand every open collection. |
| `NODE_ENV` | Read at boot to decide error verbosity, cookie flags and logging shape. |
| `ARAG_MOCK` | Chooses the transport itself — an in-process mock server versus a live HTTP client. Not a value, a different object graph. |

Everything else — the Knowledge Box connection, the model, the reranker, the timeout,
the extract strategy, every branding field, the upload and body ceilings, the rate
limiter, the admin token, API-key enforcement, CORS origins, the trusted-proxy mode,
retention and the purge scheduler, the log level — is editable in the product and live
immediately.

## Notes on the choices

- **Why the environment is the default and the store is the override**, rather than the
  other way round. A fresh deployment has to work from its environment alone, with no
  store and nobody to click anything — that is what `fly secrets` and a container image
  give you. But an operator who then changes something in the product must not have their
  change silently reverted by the next deploy shipping the old environment. Defaults
  below, deliberate edits above.
- **Why a connection change rebuilds the ARAG client instead of restarting.**
  `AragClient` resolves its base URL and captures its credentials in its constructor, so a
  changed Knowledge Box means a *new* client. Everything downstream holds a proxy
  (`buildArag` in `src/server.ts`) rather than the client itself, so nothing can be left
  holding a stale one — which is the bug this shape exists to make impossible.
- **Why secrets are write-only rather than masked.** A masked value is still a value in a
  response body, a log, a proxy cache and a browser's memory. `set` plus a four-character
  `hint` is enough to operate a rotation and carries nothing worth stealing.
- **Why every change is audited.** Once settings are editable at runtime, "what is this
  deployment configured to do" stops being answerable from the repository and the
  deployment manifest. The audit log is the only remaining record of who changed what, and
  it is the first thing a design review should ask to read — see the architect track's
  [`design-review-checklist.md`](../../architect-track/design-review-checklist.md).
