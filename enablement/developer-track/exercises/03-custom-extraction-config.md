# Exercise 3 — Create a custom extraction config through the API and the workspace

**Time budget:** 20 minutes.
**Matches:** LAB.md Section 3. Needs `ADMIN_TOKEN` set (Section 0) and a writer
credential for the write calls (see the hint below).

## Task

Create a custom extraction config called `"Vehicle Registration"` with three fields —
`Plate Number` (required), `Owner Name`, and `Registration Expiry` — once through the
API and once through the workspace, then inspect the ARAG objects it provisions using
the admin API.

1. `POST /api/v1/extraction-configs` with the fields above. Note the returned `id`,
   `aragConfig`, `kvSchemaId` and `kvFields` — creating a config now provisions **two**
   Knowledge Box objects (DP-46), not one, and the response reports each separately
   under `provisioning`.
2. Upload `public/samples/invoice.txt` (or any sample) with `?config=<your id>`, then
   answer two questions from the finished record: which of `meta.config` and
   `meta.configLabel` is the id and which is the human wording, and why the record
   carries both rather than one. Then check the two things that depend on it —
   `GET /api/v1/documents?config=<your id>` and the config's own `documentCount`.
3. Open the workspace at `http://localhost:8080/#/configs/new` and recreate the same
   config by hand. Confirm it appears immediately at `#/configs/:id` and in
   `GET /api/v1/extraction-configs`.
4. Call `POST /api/v1/extraction-configs/{id}/provision` on either config (writer-gated)
   and confirm it re-provisions and re-reports both the search configuration and the
   key-value schema. This is the single-config version; `POST /api/v1/admin/provision`
   (admin-gated) does the same for every config at once.
5. Call `GET /api/v1/admin/search-configurations` (admin-gated) and find your second
   config's entry by its `aragConfig` name. Identify, in the `config` object, which
   field controls the RAG grounding strategy and which field is the JSON Schema the
   model is forced to fill.
6. Delete both configs you created (`DELETE /api/v1/extraction-configs/{id}`) and
   confirm a built-in (e.g. `invoice`) refuses deletion with `409`.

## Why the record carries two config fields

`meta.config` is the config **id** (`cfg_...` for a custom config, the doc type for a
built-in) and `meta.configLabel` is the human wording ("Vehicle Registration",
"purchase order"). The id is the contract — it is what `?config=` filters on, what
`documentCount` counts, what reprocess re-resolves, what the Key-value view looks up to
show a field's declared type, and what a generator agent uses to find its way back to
the configuration it belongs to. The label exists because the record header has to read
"Insurance Card", not "Cfg abc123".

Until 13 September the forced path stored the label in `meta.config` and there was no
`meta.configLabel`, which broke all five of those quietly — a previous version of this
exercise sheet told you to expect `?config=` to return nothing. If you are reading an
older copy, that note is out of date: the filter works now, and this exercise asserts
that it does.

## Acceptance criteria

- [ ] The `POST` response has `provisioned: true`, a `kvSchemaId`, and
      `provisioning.state: "provisioned"` with both `searchConfiguration` and
      `keyValueSchema` present — all without any separate "provision" call.
- [ ] The forced upload's record has `meta.forced: true`, `meta.config` equal to the
      `cfg_...` **id** the `POST` returned, and `meta.configLabel: "Vehicle Registration"`.
- [ ] `GET /api/v1/documents?config=<your id>` returns that document, and the config's
      own `documentCount` reads `1` — both read the id, which is why step 2 matters.
- [ ] `POST /api/v1/extraction-configs/{id}/provision` returns `200` with an `ok: true`
      search-configuration result and a `keyValueSchema` result, for a config you own;
      called with no credential it answers `401`.
- [ ] The config created through the workspace is visible in
      `GET /api/v1/extraction-configs` immediately after saving, with `builtin: false`.
- [ ] `GET /api/v1/admin/search-configurations`'s matching item has a
      `config.rag_strategies` array containing `{ "name": "full_resource" }` and a
      `config.answer_json_schema.parameters.properties` object containing exactly your
      three (snake_case) field keys plus an `evidence` array — every schema gets an
      `evidence` property appended (the grounding contract every extraction schema
      carries; see `EVIDENCE_PROPERTY` in `schemas.ts`), so "exactly your fields" means
      "your fields plus that one".
- [ ] Both custom configs are deleted by the end of the exercise, and
      `DELETE /api/v1/extraction-configs/invoice` returns `409`.

## Hints

- Field keys are derived from labels automatically (`toKey` in `schemas.ts`) unless you
  pass an explicit `key` — `"Plate Number"` becomes `plate_number`.
- The config id for a custom config always starts with `cfg_`; built-in ids are the doc
  type itself (e.g. `invoice`).
- Creating, updating, deleting and (re-)provisioning a config are writes to shared
  state, so — unlike a plain document upload — they require a writer credential: any of
  a seeded `API_KEYS` entry, an API key minted through Settings → API keys or
  `POST /api/v1/admin/api-keys`, the `ADMIN_TOKEN` as a bearer token, or a same-origin
  session cookie from `POST /api/v1/session` (`curl -c cookies.txt` then
  `-b cookies.txt` is the lowest-friction one for a `curl` transcript).
  `GET /api/v1/admin/search-configurations` and `POST /api/v1/admin/provision` are a
  *different*, stronger gate — they need the admin credential specifically
  (`Authorization: Bearer <ADMIN_TOKEN>`), not just any writer credential.
- The workspace's Configs → New configuration page talks to the exact same
  `/api/v1/extraction-configs` endpoint as `curl` — there is no separate "UI-only" code
  path to inspect.
- `aragConfig` is deterministic: `dip_custom_<slugified name>` for a custom config,
  `dip_<schema name>` for a built-in — and `kvSchemaId` is always the same string as
  `aragConfig`, since both Knowledge Box objects for one config share an id.

If you get stuck, [`solutions/03-custom-extraction-config.md`](../solutions/03-custom-extraction-config.md) has the exact commands, the
workspace steps, and the real admin API output.
