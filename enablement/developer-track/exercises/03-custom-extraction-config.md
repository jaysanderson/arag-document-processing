# Exercise 3 — Create a custom extraction config through the API and the UI

**Time budget:** 10 minutes.
**Matches:** LAB.md Section 3.

## Task

Without touching any source code, create a custom extraction config called
`"Vehicle Registration"` with three fields — `Plate Number` (required), `Owner Name`,
and `Registration Expiry` — once through the API and once through the demo UI, then
inspect the ARAG search configuration the second one provisions.

1. `POST /api/v1/extraction-configs` with the fields above. Note the returned
   `id` and `aragConfig`.
2. Upload `public/samples/invoice.txt` (or any sample) with `?config=<your id>` and
   confirm `meta.config` on the resulting record reads `"Vehicle Registration"`.
3. Open the demo UI and recreate the same config by hand through the config manager
   form. Confirm it appears in the config selector's "Custom" group immediately.
4. Write a short throwaway Node script (see LAB.md Section 3.3 for the pattern) that
   boots the product against the mock ARAG and calls
   `product.arag.getSearchConfiguration(aragConfig)` to print the raw stored
   configuration for one of your two configs. Identify, in the printed JSON, which
   field controls the RAG grounding strategy and which field is the JSON Schema the
   model is forced to fill.
5. Delete both configs you created (`DELETE /api/v1/extraction-configs/{id}`) and
   confirm a built-in (e.g. `invoice`) refuses deletion with `409`.

## Acceptance criteria

- [ ] The `POST` response has `provisioned: true` without any separate "provision" call.
- [ ] The forced upload's record has `meta.forced: true` and `meta.config: "Vehicle Registration"`.
- [ ] The config created through the UI is visible in `GET /api/v1/extraction-configs`
      immediately after saving, with `builtin: false`.
- [ ] Your inspection script prints a `config.rag_strategies` array containing
      `{ "name": "full_resource" }` and a `config.answer_json_schema.parameters.properties`
      object with exactly your three (snake_case) field keys.
- [ ] Both custom configs are deleted by the end of the exercise, and
      `DELETE /api/v1/extraction-configs/invoice` returns `409`.

## Hints

- Field keys are derived from labels automatically (`toKey` in `schemas.ts`) unless you
  pass an explicit `key` — `"Plate Number"` becomes `plate_number`.
- The config id for a custom config always starts with `cfg_`; built-in ids are the doc
  type itself (e.g. `invoice`).
- The UI's config manager talks to the exact same `/api/v1/extraction-configs` endpoint
  as `curl` — there is no separate "UI-only" code path to inspect.
- `aragConfig` is deterministic: `dip_custom_<slugified name>` for a custom config,
  `dip_<schema name>` for a built-in.

If you get stuck, [`solutions/03-custom-extraction-config.md`](../solutions/03-custom-extraction-config.md) has the exact commands, the
UI steps, the inspection script, and its real output.
