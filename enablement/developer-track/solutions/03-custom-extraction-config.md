# Solution 3 — Custom extraction config, API + UI + inspection

## 0. Bootstrap a session (needed for every write below)

Creating and deleting a config are writes to shared state, so they go through
`requireWriter` (`src/routes/guards.ts`) even when `API_KEYS` is unset — a document
upload does not need this, but a config create/delete does. Get a same-origin session
cookie once, the same call the demo UI makes, and reuse it:

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

```json
{
  "id": "cfg_234d8fc0",
  "name": "Vehicle Registration",
  "docType": "generic",
  "builtin": false,
  "aragConfig": "dip_custom_vehicle_registration",
  "provisioned": true,
  "fields": [
    { "key": "plate_number", "label": "Plate Number", "type": "string", "required": true },
    { "key": "owner_name", "label": "Owner Name", "type": "string", "required": false },
    { "key": "registration_expiry", "label": "Registration Expiry", "type": "string", "required": false }
  ]
}
```

Labels became keys automatically: `"Plate Number"` → `plate_number`, `"Registration
Expiry"` → `registration_expiry` (the `toKey()` helper in `schemas.ts` lowercases,
replaces runs of non-alphanumeric characters with `_`, and trims leading/trailing `_`).
The ARAG config name follows the same rule against the config's own name:
`"Vehicle Registration"` → `dip_custom_vehicle_registration`.

## 2. Use it to force extraction

```bash
CFG=cfg_234d8fc0   # substitute your own id
curl -sS -X POST "http://localhost:8080/api/v1/documents?config=$CFG" \
     -H 'Content-Type: text/plain' -H 'X-Filename: reg.txt' \
     --data-binary @public/samples/invoice.txt | jq -r .document.id
# … wait for the job (or just re-GET after a moment) …
curl -sS "http://localhost:8080/api/v1/documents/<id>" | jq '.meta.config, .meta.forced'
```

```
"Vehicle Registration"
true
```

No session cookie was needed for this call — creating a document stays
anonymous-friendly by design (see the note in `src/routes/guards.ts`); only the
config *create* above needed one. `meta.forced: true` and `meta.config` set to the
config's *name* (not its id) confirm classification was skipped entirely — the pipeline
used your three fields directly (see `runPipeline`'s `forced` branch in
`src/services/pipeline.ts`).

## 3. Through the UI

In the demo (`http://localhost:8080/`), the config manager form has one row per field
plus an "add field" control. Enter the same name and three fields, save, and the new
config appears immediately under a "Custom" optgroup in the upload selector — no page
reload needed, because saving calls `loadConfigs()`, which re-fetches
`GET /api/v1/extraction-configs` and re-renders the selector and the config-card list.
The browser already carries the session cookie the demo obtained on page load
(`ensureSession()` in `public/app.js`), so the save just works — there is no separate
UI-side auth flow to notice.

## 4. Inspect the stored ARAG search configuration

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
          "registration_expiry": { "type": "string" }
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
  this *is* derived from your `POST` body's `fields` array, via `buildCustomSchema()` in
  `schemas.ts`.
- **`config.generative_model`** is also visible here — worth checking against
  `ARAG_GENERATIVE_MODEL` if a deployment ever seems to be extracting with the wrong
  model.

Before this endpoint existed, inspecting a stored configuration meant writing a
throwaway script calling `AragClient.getSearchConfiguration` directly, or opening the
ARAG dashboard — `GET /api/v1/admin/search-configurations` (`src/routes/admin.ts`) makes
it a first-class, discoverable operation instead, and the admin panel's Extraction
configs tab now surfaces the same data visually.

## 5. Clean up

```bash
curl -sS -b /tmp/dip-cookies.txt -o /dev/null -w '%{http_code}\n' \
     -X DELETE "http://localhost:8080/api/v1/extraction-configs/$CFG"
# 204
curl -sS -b /tmp/dip-cookies.txt -o /dev/null -w '%{http_code}\n' \
     -X DELETE "http://localhost:8080/api/v1/extraction-configs/invoice"
# 409 — built-ins are not deletable (ConfigsService.delete returns "builtin", the route maps it to 409 Conflict)
```
