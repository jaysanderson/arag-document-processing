# Solution 3 — Custom extraction config, API + workspace + inspection

## 0. Bootstrap a session (needed for every write below)

Creating, updating, deleting and re-provisioning a config are writes to shared state, so
they go through `requireWriter` (`src/routes/guards.ts`) — a document upload does not
need this, but a config create/delete/provision does. Any of an API key, the admin
token, or a same-origin session cookie satisfies it; a session cookie is the
lowest-friction one for a `curl` transcript. Get one the same way the workspace does on
page load, and reuse it:

```bash
curl -sS -c /tmp/dip-cookies.txt -X POST http://localhost:8080/api/v1/session
```

## 1. Create it through the API

```bash
curl -sS -b /tmp/dip-cookies.txt -X POST 'http://localhost:8080/api/v1/extraction-configs' \
  -H 'Content-Type: application/json' \
  -d '{
        "name": "Vehicle Registration",
        "fields": [
          { "label": "Plate Number", "required": true },
          { "label": "Owner Name" },
          { "label": "Registration Expiry" }
        ]
      }' | jq .
```

Real output (verified against the mock; your `id` will differ):

```json
{
  "id": "cfg_4e07d764",
  "name": "Vehicle Registration",
  "docType": "generic",
  "description": "Custom extraction config: Vehicle Registration",
  "builtin": false,
  "aragConfig": "dip_custom_vehicle_registration",
  "provisioned": true,
  "kvSchemaId": "dip_custom_vehicle_registration",
  "kvFields": {
    "plate_number": "plate_number",
    "owner_name": "owner_name",
    "registration_expiry": "registration_expiry"
  },
  "provisioning": {
    "state": "provisioned",
    "searchConfiguration": { "name": "dip_custom_vehicle_registration", "state": "provisioned" },
    "keyValueSchema": {
      "state": "provisioned",
      "at": "2026-09-13T09:12:28.407Z",
      "schemaId": "dip_custom_vehicle_registration",
      "fields": 3
    }
  },
  "fields": [
    { "key": "plate_number", "label": "Plate Number", "type": "string", "required": true },
    { "key": "owner_name", "label": "Owner Name", "type": "string", "required": false },
    { "key": "registration_expiry", "label": "Registration Expiry", "type": "string", "required": false }
  ],
  "createdAt": "2026-09-13T09:12:28.404Z",
  "updatedAt": "2026-09-13T09:12:28.404Z"
}
```

Labels became keys automatically: `"Plate Number"` → `plate_number`, `"Registration
Expiry"` → `registration_expiry` (the `toKey()` helper in `schemas.ts` lowercases,
replaces runs of non-alphanumeric characters with `_`, and trims leading/trailing `_`).
The ARAG config name follows the same rule against the config's own name:
`"Vehicle Registration"` → `dip_custom_vehicle_registration`. `kvSchemaId` is always the
same string as `aragConfig` — this one `POST` provisioned both a search configuration
*and* a key-value schema (DP-46), and `provisioning.state` is `"provisioned"` only
because both halves report `"state": "provisioned"` individually.

## 2. Use it to force extraction, and check what the record kept

```bash
CFG=cfg_4e07d764   # substitute your own id
curl -sS -X POST "http://localhost:8080/api/v1/documents?config=$CFG" \
     -H 'Content-Type: text/plain' -H 'X-Filename: reg.txt' \
     --data-binary @public/samples/invoice.txt | jq -r .document.id
# … wait for the job (or just re-GET after a moment) …
curl -sS "http://localhost:8080/api/v1/documents/<id>" \
  | jq '{config: .meta.config, configLabel: .meta.configLabel, forced: .meta.forced, schema: .meta.schema}'
```

```json
{
  "config": "cfg_4e07d764",
  "configLabel": "Vehicle Registration",
  "forced": true,
  "schema": "custom_vehicle_registration"
}
```

No credential was needed for this call — creating a document stays anonymous-friendly by
design; only the config *create* above needed one. `meta.forced: true` confirms
classification was skipped and the pipeline used your three fields directly.

**`meta.config` is the id; `meta.configLabel` is the wording.** The same split holds on
every path a record can take:

| Path | `meta.config` | `meta.configLabel` |
|---|---|---|
| Forced custom (`?config=cfg_…`) | `"cfg_4e07d764"` | `"Vehicle Registration"` |
| Forced built-in (`?config=purchase_order`) | `"purchase_order"` | `"purchase order"` |
| Auto-classified | `"invoice"` | `"invoice"` |
| DA agent (`?config=agent`, with agent output on the resource) | `"generic"` | `"ARAG DA agent (persisted)"` |

The first three rows are from runs against the mock in this lab. **The fourth is read
from the source** (`runPipeline`'s agent branch in `src/services/pipeline.ts`), not
observed here: the mock's resources carry no Data Augmentation agent output, so
`?config=agent` logs a `classify` `skip` and falls back to live extraction — try it and
you will get the auto-classified row instead. It is worth knowing anyway, because it is
the one path where the two fields genuinely disagree about *kind*: the values came from
an agent rather than an extraction config, so there is no config id to store and
`meta.config` falls back to the `generic` schema the record was built against, while the
label still says where the values actually came from.

The id is the one that carries obligations. Five things read it, and you can check the
first two right now:

```bash
curl -sS "http://localhost:8080/api/v1/documents?config=$CFG" | jq '.total'
# 1
curl -sS "http://localhost:8080/api/v1/extraction-configs/$CFG" | jq '.documentCount'
# 1
```

The other three are `POST /documents/{id}/reprocess` (which re-resolves the
configuration from the record), the Key-value view (which fetches
`/extraction-configs/<meta.config>` to show each field's declared kv type — Exercise 6),
and a generator agent finding its way back to the configuration it belongs to
(`src/services/generators.ts`).

The label exists for exactly one reason: the record header has to say "Vehicle
Registration", not "Cfg 4e07d764". Two fields, because one value cannot be both a stable
identifier and readable prose — which is the general lesson here, and the one this
product got wrong until 13 September.

> **If you are working from an older copy of this sheet**, it told you to expect
> `?config=` to return `0` and called it a known defect. It was: the forced branch of
> the pipeline stored `forced.label` in `meta.config` even though `resolve()` returned a
> `configId` right beside it, and all five consumers above broke quietly. It is fixed —
> the id is stored on every path, the label moved to `meta.configLabel`, and the contract
> test now asserts the id, the label, the filter and the document count rather than
> asserting the bug.

## 3. Through the workspace

At `http://localhost:8080/#/configs/new`, fill in the same name and three fields and
save. The new config appears immediately at `#/configs/:id`, and in
`GET /api/v1/extraction-configs` with `builtin: false` — no page reload needed, because
saving calls the same `POST /api/v1/extraction-configs` `curl` used in step 1, and the
Configs list re-fetches after a save. The browser already carries the session cookie the
workspace obtained on page load, so the save just works — there is no separate
workspace-only auth flow to notice.

## 4. Re-provision a single config

```bash
curl -sS -b /tmp/dip-cookies.txt -X POST "http://localhost:8080/api/v1/extraction-configs/$CFG/provision" | jq .
```

```json
{
  "schema": "custom_vehicle_registration",
  "aragConfig": "dip_custom_vehicle_registration",
  "ok": true,
  "keyValueSchema": { "state": "provisioned", "at": "2026-09-13T08:38:42.529Z" }
}
```

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "http://localhost:8080/api/v1/extraction-configs/$CFG/provision"
# 401 — writer-gated, same as create/delete
```

This is the single-config, writer-gated endpoint: it re-provisions and separately
reports both the search configuration (`ok`) and the key-value schema
(`keyValueSchema`), and it's idempotent — calling it again with nothing changed
re-provisions the same objects and reports the same shape, it doesn't error or drift.
`POST /api/v1/admin/provision` (admin-gated, `Authorization: Bearer $ADMIN_TOKEN`) does
the same thing for **every** config in one call — `items[]`, one entry per config, plus
an `ok`/`failed` summary — which is what you'd run after a bulk schema change instead of
calling `.../provision` once per config.

## 5. Inspect the stored ARAG search configuration

`GET /api/v1/admin/search-configurations` is a read-only admin endpoint that fetches
the `dip_*` search configurations straight from the Knowledge Box — exactly what the
extraction agents run against, without opening the ARAG dashboard or writing any code.
It's gated by the **admin** credential (not the session cookie from step 0 — a
different, stronger gate):

```bash
curl -sS http://localhost:8080/api/v1/admin/search-configurations \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq '.items[] | select(.name=="dip_custom_vehicle_registration")'
```

Real output (verified against the mock):

```json
{
  "name": "dip_custom_vehicle_registration",
  "kind": "ask",
  "config": {
    "generative_model": "chatgpt-azure-4o",
    "reranker": "predict",
    "rag_strategies": [{ "name": "full_resource" }],
    "prompt": { "system": "You are a precise document-data extraction engine. …" },
    "answer_json_schema": {
      "name": "custom_vehicle_registration",
      "description": "Custom extraction config: Vehicle Registration",
      "parameters": {
        "type": "object",
        "properties": {
          "plate_number": { "type": "string" },
          "owner_name": { "type": "string" },
          "registration_expiry": { "type": "string" },
          "evidence": {
            "type": "array",
            "description": "One entry per field you filled in, quoting the document verbatim. …",
            "items": {
              "type": "object",
              "properties": {
                "field": { "type": "string", "description": "The property name this quote supports." },
                "quote": { "type": "string", "description": "Verbatim text copied from the document." }
              },
              "required": ["field", "quote"]
            }
          }
        },
        "required": ["plate_number"]
      }
    }
  }
}
```

- **`config.rag_strategies`** controls grounding — `full_resource` means the model gets
  the *whole* document, not just retrieved snippets. This is set the same way for every
  config, built-in or custom; it isn't something the `POST` body can override.
- **`config.answer_json_schema`** is the JSON Schema the model is forced to return —
  the three custom fields come straight from your `POST` body's `fields` array via
  `buildCustomSchema()` in `schemas.ts`. The `evidence` property is not one you asked
  for — every schema, built-in or custom, gets it appended
  (`EVIDENCE_PROPERTY` in `schemas.ts`): ARAG rejects `answer_json_schema` combined with
  its own citation feature, so the product gets grounding another way, by asking the
  model to quote the document verbatim for each field it fills and then checking that
  quote against the document's own extracted text.
- **`config.generative_model`** is also visible here — worth checking against
  `ARAG_GENERATIVE_MODEL` if a deployment ever seems to be extracting with the wrong
  model.

Before this endpoint existed, inspecting a stored configuration meant writing a
throwaway script calling `AragClient.getSearchConfiguration` directly, or opening the
ARAG dashboard — `GET /api/v1/admin/search-configurations` (`src/routes/admin.ts`) makes
it a first-class, discoverable operation instead.

## 6. Clean up

```bash
curl -sS -b /tmp/dip-cookies.txt -o /dev/null -w '%{http_code}\n' \
     -X DELETE "http://localhost:8080/api/v1/extraction-configs/$CFG"
# 204
curl -sS -b /tmp/dip-cookies.txt -o /dev/null -w '%{http_code}\n' \
     -X DELETE "http://localhost:8080/api/v1/extraction-configs/invoice"
# 409 — built-ins are not deletable (ConfigsService.delete returns "builtin", the route maps it to 409 Conflict)
```

Delete both the API-created and the workspace-created config the same way — deleting a
custom config also deprovisions its kv schema, which is what keeps the 20-schema-per-KB
ceiling (DP-46) from filling up with abandoned configs.
