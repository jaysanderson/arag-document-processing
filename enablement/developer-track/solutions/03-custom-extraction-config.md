# Solution 3 — Custom extraction config, API + UI + inspection

## 1. Create it through the API

```bash
curl -sS -X POST 'http://localhost:8080/api/v1/extraction-configs' \
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
  "id": "cfg_d6b4cd6d",
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
CFG=cfg_d6b4cd6d   # substitute your own id
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

`meta.forced: true` and `meta.config` set to the config's *name* (not its id) confirm
classification was skipped entirely — the pipeline used your three fields directly (see
`runPipeline`'s `forced` branch in `src/services/pipeline.ts`).

## 3. Through the UI

In the demo (`http://localhost:8080/`), the config manager form has one row per field
plus an "add field" control. Enter the same name and three fields, save, and the new
config appears immediately under a "Custom" optgroup in the upload selector — no page
reload needed, because saving calls `loadConfigs()`, which re-fetches
`GET /api/v1/extraction-configs` and re-renders the selector and the config-card list.
There is no separate UI-side validation logic beyond "non-empty name, at least one
field" — the same two checks `ConfigsService.create` would reject via the API.

## 4. Inspect the stored ARAG search configuration

```bash
cat > /tmp/inspect-config.ts <<'EOF'
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProduct } from "./src/server.ts";
import { Logger, readEnv } from "./vendor/arag-platform/src/index.ts";

const env = readEnv({ ARAG_MOCK: "1", ADMIN_TOKEN: "inspect", DATA_DIR: mkdtempSync(join(tmpdir(), "dip-")) });
const product = await createProduct(env, { log: new Logger({ level: "error", write: () => undefined }), persist: false });
const created = await product.configs.create({
  name: "Vehicle Registration",
  fields: [
    { label: "Plate Number", required: true },
    { label: "Owner Name" },
    { label: "Registration Expiry" },
  ],
});
console.log(JSON.stringify(await product.arag.getSearchConfiguration(created.aragConfig), null, 2));
await product.close();
EOF
node /tmp/inspect-config.ts
rm /tmp/inspect-config.ts
```

```json
{
  "kind": "ask",
  "config": {
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

This script mirrors the exact pattern `test/api.test.ts` uses to assert the same thing
("The stored ARAG search configuration really exists in the (mock) KB") — reading that
test after running this script is a good way to see the same fact expressed as an
assertion instead of a `console.log`.

## 5. Clean up

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE "http://localhost:8080/api/v1/extraction-configs/$CFG"
# 204
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE "http://localhost:8080/api/v1/extraction-configs/invoice"
# 409 — built-ins are not deletable (ConfigsService.delete returns "builtin", the route maps it to 409 Conflict)
```
