# Exercise 7 — Change a setting without a restart, and prove it through the API

**Time budget:** 20 minutes.
**Matches:** LAB.md Section 7. Needs the `ADMIN_TOKEN` you set in Section 0.

Every value this deployment reads from configuration is editable in the product, takes
effect immediately, survives a restart, and is audited (DP-52). An environment variable
is a **default**; the product's store is the **override**; the effective value is
**live**. A settings screen that needs a redeploy to take effect is a configuration
viewer, not a settings screen — this exercise is how you check the difference for
yourself, rather than taking the claim on trust.

## Task

1. **Read the settings document.** `GET /api/v1/admin/settings`. For one field of your
   choosing, find its `key`, `envVar`, `source`, `value` and `constraints`. Then find the
   `applied` block and work out what makes it different from the field list above it.
2. **Find a secret and confirm you cannot read it.** `connection.apiKey` and
   `security.adminToken` are secrets. Confirm that neither returns a value anywhere in
   the response, and note what they report instead.
3. **Change something with an observable consequence.** `PATCH` `limits.maxUploadBytes`
   down to `2048`. Then prove the change took effect **three different ways, without
   restarting the process**:
   - the field's own `source` and `value` in the settings document,
   - `applied.limits.maxUploadBytes`,
   - the credential-free `GET /api/v1/settings`, which is what the upload drawer reads.
4. **Prove it against real behaviour, not just a payload.** Upload a file larger than
   2048 bytes and confirm the status code and the problem detail.
5. **Prove the patch is atomic.** Send one `PATCH` containing a valid
   `branding.tagline` and an invalid `branding.primaryColor` in the same body. Confirm
   the status code, read the `errors` array, then confirm the *valid* half was not
   applied either.
6. **Read the audit trail for what you just did.** `GET /api/v1/admin/audit?action=settings`.
7. **Put it back.** `POST /api/v1/admin/settings/reset` for the key you changed, and
   confirm its `source` returns to `env`.
8. **Find the settings that are deliberately not editable.** Work out from
   `.env.example` (or `src/services/settings.ts`) which five environment variables stay
   environment-only, and be able to say why each one is a restart by definition.

## Acceptance criteria

- [ ] You can name the three layers a setting's value can come from, and read the layer
      off any field in the document.
- [ ] Neither `connection.apiKey` nor `security.adminToken` returns a value; each reports
      `set` and, when set, a `hint`.
- [ ] The `PATCH` response's `changed` array names exactly one key with its `before` and
      `after`, and `settings.version` has incremented.
- [ ] After the patch, `limits.maxUploadBytes` reports `"source": "store"` where it
      previously reported `"env"`.
- [ ] `applied.limits.maxUploadBytes` and the public `GET /api/v1/settings`'s
      `uploads.maxBytes` both read `2048` — with **no restart**.
- [ ] A 3 KB upload answers **413** with a detail naming the new ceiling.
- [ ] The mixed valid/invalid patch answers **400** with an `errors` array naming the
      offending key — and `GET /api/v1/branding` shows the tagline **unchanged**.
- [ ] The audit log has one `settings.update` and (after step 7) one `settings.reset`
      entry, each with an actor, a target, a `before` and an `after`.
- [ ] After the reset, `source` is `env` and `applied.limits.maxUploadBytes` is back to
      `26214400`.
- [ ] You can list the five environment-only variables and justify each.

## Hints

- `PATCH` accepts either shape: nested (`{"limits":{"maxUploadBytes":2048}}`) or flat
  (`{"limits.maxUploadBytes":2048}`). Only the keys you send are touched.
- `constraints` on the field tells you the bounds the API will enforce before you try —
  `limits.maxUploadBytes` has a `min` of 1024, so `{"maxUploadBytes": 10}` is a 400, not
  a very small ceiling.
- The distinction between the field list and `applied` is the whole point of the screen:
  the field list is what the **store** says, `applied` is what the **running objects**
  say. They are read from different places on purpose, so that "I saved it" and "it is in
  force" are two separate claims the UI can make honestly.
- `GET /api/v1/settings` (no credential) and `GET /api/v1/admin/settings` (admin token)
  are different endpoints with different audiences. The public one deliberately omits the
  extract-strategy id and every token (DP-40); a contract test asserts it.
- If you would rather watch this in the workspace: Settings → Limits is
  `http://localhost:8080/#/settings/limits`, and the admin panel's audit log is
  `http://localhost:8080/admin/#/audit`.
- Changing `connection.*` rebuilds the ARAG client rather than restarting the process —
  worth reading `buildArag` in `src/server.ts` to see how a live client swap is done
  without every downstream service holding a stale one.

If you get stuck, [`solutions/07-change-a-setting-live.md`](../solutions/07-change-a-setting-live.md)
has the full transcript with real output.
