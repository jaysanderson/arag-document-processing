# API reference — Document Processing API v1.0.0

Turn any document into a canonical, validated record. Upload a PDF, image, or text file; a job runs the pipeline on Progress Agentic RAG (process → classify → extract → entities → summary → validate → standardize) and returns structured fields, entities, a summary and validation issues, exportable as JSON, XML or CSV.

Generated from `openapi.json` — do not edit by hand. Interactive docs: `/api/v1/docs` (Redoc) and `/api/v1/swagger` (try it out).

## Authentication

- **ApiKey** — apiKey header X-API-Key: Required only when API_KEYS is configured.
- **Bearer** — http bearer : API key or admin token as a bearer token.
- **AdminToken** — http bearer : ADMIN_TOKEN; required for /admin routes.

## documents

### `GET /api/v1/documents`

**List documents (newest first) with search, filters and sorting** — Every parameter is optional and they combine with AND. `q` is a case-insensitive substring match across the filename, the summary, the tags and the extracted field labels and values — so a user can find a document by the supplier on it, not only by the name it was uploaded under.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `page` | query | integer |  |  |
| `page_size` | query | integer |  |  |
| `status` | query | string |  |  |
| `doc_type` | query | array of string |  | Document type. Repeat the parameter to select several (`?doc_type=invoice&doc_type=receipt`). |
| `q` | query | string |  | Free-text search over filename, summary, tags and extracted field values |
| `sort` | query | string |  | Field to order by (default `created_at`) |
| `order` | query | string |  |  |
| `date_from` | query | string |  | Only documents created at or after this instant (ISO 8601 or YYYY-MM-DD) |
| `date_to` | query | string |  | Only documents created at or before this instant (ISO 8601 or YYYY-MM-DD) |
| `config` | query | string |  | Only documents extracted with this extraction configuration id |
| `degraded` | query | boolean |  | `true` returns only records that finished with a failed stage (`meta.stageErrors`); `false` excludes them. |
| `has_issues` | query | boolean |  | `true` returns only records carrying at least one validation issue |
| `min_grounding` | query | number |  | Only records whose `meta.groundingScore` is at least this. Records with no score are excluded — an unmeasured record is not a well-grounded one. |

Responses:

- `200` OK — `application/json` [DocumentPage](#documentpage)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `POST /api/v1/documents`

**Upload a document and start the processing job** — Accepts `multipart/form-data` with a `file` part, or a raw body with an `X-Filename` header. `config` selects the extraction configuration: `auto` classifies the document, `agent` reads fields persisted by an ARAG Data Augmentation agent, or pass an extraction-config id. Returns 202 with the document record and the job to watch.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `config` | query | string |  | auto | agent | <extraction config id> |
| `X-Filename` | header | string |  | Filename for raw-body uploads (ignored for multipart) |

Request body (`multipart/form-data`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | string |  |  |
| `config` | string |  |  |

Request body (`application/pdf`): string

_string_

Request body (`image/png`): string

_string_

Request body (`image/jpeg`): string

_string_

Request body (`text/plain`): string

_string_

Request body (`application/octet-stream`): string

_string_

Responses:

- `202` Accepted — `application/json` [DocumentAccepted](#documentaccepted)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `413` Upload too large — `application/problem+json` [Problem](#problem)
- `415` Unsupported media type — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/documents/{id}`

**Get the canonical record for one document**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `200` OK — `application/json` [Document](#document)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `DELETE /api/v1/documents/{id}`

**Delete a document and its ARAG resource** — Requires a credential even when `API_KEYS` is unset: an API key, the admin token, or a same-origin session cookie from `POST /api/v1/session`.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `204` Deleted
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/documents/{id}/export`

**Download the record as JSON, XML or CSV**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |
| `format` | query | string |  |  |

Responses:

- `200` Standardised export — `application/json` [Document](#document)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `POST /api/v1/documents/{id}/ask`

**Ask a grounded question about one document** — Answers from this document's own text. Every call is a generative model call against the Knowledge Box, so this route has its own, tighter rate-limit bucket than the shared public one — an anonymous caller can still try the product without a credential, but cannot use it as an unbounded model proxy.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Request body (`application/json`): [AskRequest](#askrequest)


Responses:

- `200` OK — `application/json` [AskResponse](#askresponse)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/documents/{id}/text`

**The document's own extracted text** — The text Progress Agentic RAG read from the file at ingestion — what every extraction stage saw, and what `Evidence.start`/`Evidence.end` index into. Without it a client can show an evidence quote but cannot show it *in the document*.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |
| `max_chars` | query | integer |  |  |

Responses:

- `200` OK — `application/json` [DocumentText](#documenttext)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/documents/{id}/source`

**The original uploaded file** — Streams the bytes back from the ARAG resource, `Content-Disposition: inline`, so a reviewer can see the page the values came from. Answers 404 when the resource no longer holds the file; a client should then fall back to the extracted text.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `200` The original file — `application/octet-stream` string
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `POST /api/v1/documents/sample`

**Process one of the bundled sample documents** — Reads the sample from disk server-side and runs it through the ordinary upload path, so the first-run flow is one call rather than a fetch followed by an upload. The sample ids come from `GET /api/v1/samples`.

Request body (`application/json`): [SampleRequest](#samplerequest)


Responses:

- `202` Accepted — `application/json` [DocumentAccepted](#documentaccepted)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `POST /api/v1/documents/{id}/reprocess`

**Re-run the pipeline over a document already in the Knowledge Box** — The recovery action for a failed or degraded record: the resource is already uploaded, so this queues a fresh job over it rather than asking the user to upload the file again. Returns 202 with the reset record and the new job to watch. Requires a credential even when `API_KEYS` is unset (it spends model calls): an API key, the admin token, or a same-origin session cookie from `POST /api/v1/session`.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |
| `config` | query | string |  | Extraction configuration to use for the re-run (default: the original one) |

Responses:

- `202` Accepted — `application/json` [DocumentAccepted](#documentaccepted)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `409` The document is already queued or processing — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `POST /api/v1/documents/bulk-delete`

**Delete several documents and their ARAG resources** — Best-effort: each id is attempted and reported separately, so one missing document does not abandon the rest of the selection. Requires the same credential as a single delete.

Request body (`application/json`): [BulkDeleteRequest](#bulkdeleterequest)


Responses:

- `200` OK — `application/json` [BulkDeleteResult](#bulkdeleteresult)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `POST /api/v1/documents/bulk-export`

**Download several records as one JSON, XML or CSV file** — JSON returns an array of records; XML wraps them in a `<documents>` root; CSV emits one header and one row per extracted field across every selected record, so a spreadsheet can reconcile a whole batch in one pass. Ids that do not exist are skipped and named in the `X-Skipped-Ids` response header.

Request body (`application/json`): [BulkExportRequest](#bulkexportrequest)


Responses:

- `200` Standardised export of the selected records — `application/json` array of [Document](#document)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/stats`

**Workspace counters: documents by status and type, grounding, jobs** — What the documents overview strip shows. Cheap and credential-free, so a list screen can poll it while a pipeline runs without an admin token.

Responses:

- `200` OK — `application/json` [Stats](#stats)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer

## system

### `GET /api/v1/settings`

**Effective, non-secret runtime settings for the workspace** — Connection state, extraction configuration, upload limits and branding — everything the Settings screen shows a signed-in user. Secrets (the extract-strategy id, tokens, keys) stay behind `ADMIN_TOKEN` on `/api/v1/admin/config`.

Responses:

- `200` OK — `application/json` [Settings](#settings)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/samples`

**Bundled sample documents for the first-run flow** — The catalogue behind “Try with a sample”: each entry names a file served from `/samples/`, which the client uploads to `POST /api/v1/documents` like any other document. Nothing here is special-cased in the pipeline.

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/branding`

**Effective white-label branding for this deployment** — Public and secret-free — it contains only what a visitor already sees. Both UIs fetch it before they paint; a partner's own front end can too. Configured with `BRAND_*` environment variables; assets live in `DATA_DIR/branding/` and are served from `/branding/`. See `docs/developer/white-label.md`.

Responses:

- `200` OK — `application/json` [Branding](#branding)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: public


### `POST /api/v1/session`

**Issue a same-origin session cookie for the demo UI**

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: public

## jobs

### `GET /api/v1/jobs`

**List processing jobs**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `status` | query | string |  |  |
| `ref` | query | string |  | Filter by document id |
| `limit` | query | integer |  |  |
| `page` | query | integer |  |  |
| `page_size` | query | integer |  | Preferred over `limit`, which stays for compatibility |
| `sort` | query | string |  |  |
| `order` | query | string |  |  |
| `q` | query | string |  | Match the job id, its kind, or the document id it refers to |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/jobs/{id}`

**Get a job**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `200` OK — `application/json` [Job](#job)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `DELETE /api/v1/jobs/{id}`

**Cancel a queued or running job** — Requires a credential even when `API_KEYS` is unset: an API key, the admin token, or a same-origin session cookie from `POST /api/v1/session`. A job that has already finished cannot be cancelled and answers 409.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `204` Cancelled
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `409` The job already finished (succeeded, failed or cancelled) — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/jobs/{id}/events`

**Server-sent events for a job (event names: event, job)** — Replays the job's events so far, then streams new ones. `event` carries a JobEvent (stage, status, ms, message); `job` carries the job itself on each status change and closes the stream when the job finishes.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `200` text/event-stream — `text/event-stream` string
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer

## extraction-configs

### `GET /api/v1/extraction-configs`

**List built-in and custom extraction configurations**

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `POST /api/v1/extraction-configs`

**Create a custom extraction configuration** — Persists the config and provisions a stored ARAG search configuration (kind `ask`) that pins the model, the full_resource RAG strategy, the grounding prompt and the answer_json_schema built from these fields. Because it writes into the Knowledge Box, it requires a credential even when `API_KEYS` is unset: an API key, the admin token, or a same-origin session cookie from `POST /api/v1/session`.

Request body (`application/json`): [ExtractionConfigCreate](#extractionconfigcreate)


Responses:

- `201` Created — `application/json` [ExtractionConfig](#extractionconfig)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/extraction-configs/{id}`

**Get one extraction configuration**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `200` OK — `application/json` [ExtractionConfig](#extractionconfig)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `PUT /api/v1/extraction-configs/{id}`

**Replace a custom extraction configuration** — Replaces the name, description and fields, and re-provisions the stored ARAG search configuration. The id is kept, so `meta.config` on every document already processed with this configuration stays meaningful — which delete-and-recreate would break. Built-in configurations answer 409. Requires a writer credential.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Request body (`application/json`): [ExtractionConfigCreate](#extractionconfigcreate)


Responses:

- `200` OK — `application/json` [ExtractionConfig](#extractionconfig)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `409` Built-in configuration cannot be edited — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `DELETE /api/v1/extraction-configs/{id}`

**Delete a custom extraction configuration (built-ins are not deletable)** — Requires a credential even when `API_KEYS` is unset: an API key, the admin token, or a same-origin session cookie from `POST /api/v1/session`.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `204` Deleted
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `409` Built-in configuration cannot be deleted — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `POST /api/v1/extraction-configs/{id}/provision`

**Re-provision one configuration's stored ARAG search configuration** — Idempotent. `POST /api/v1/admin/provision` re-provisions all of them and needs the admin token; this is the granularity an operator needs to fix the one config that did not take. Requires a writer credential.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `200` OK — `application/json` [ProvisionResult](#provisionresult)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer

## schemas

### `GET /api/v1/schemas`

**List document types and the fields each extraction schema captures**

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer

## admin

### `POST /api/v1/admin/login`

**Exchange the admin token for an HttpOnly cookie**

Request body (`application/json`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `token` | string | yes |  |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: public


### `GET /api/v1/admin/health`

**Service health, KB connection test, extract strategy and model**

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `GET /api/v1/admin/config`

**Effective configuration (secrets redacted)**

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `GET /api/v1/admin/usage`

**Usage counters (requests, ARAG calls, jobs, documents)**

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `GET /api/v1/admin/logs`

**Recent log records**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `level` | query | string |  |  |
| `contains` | query | string |  |  |
| `limit` | query | integer |  |  |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `GET /api/v1/admin/search-configurations`

**Read the stored ARAG search configurations this product provisions** — Fetches the `dip_*` search configurations straight from the Knowledge Box, so an operator can confirm which model, RAG strategy, prompt and answer_json_schema the extraction agents are actually running against — without opening the ARAG dashboard.

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `GET /api/v1/admin/security`

**What is protecting this deployment** — Credentials in force, rate limits, CORS, upload ceiling and retention default, in one shape. Key values are never returned — only how many there are and the last four characters of each, which is what an operator needs to tell two keys apart.

Responses:

- `200` OK — `application/json` [SecurityPosture](#securityposture)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `POST /api/v1/admin/provision`

**Re-provision every extraction configuration as an ARAG search configuration**

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `POST /api/v1/admin/purge`

**Delete documents older than N days from the store and the Knowledge Box** — With `dryRun: true` nothing is deleted: the response reports how many documents would go and the date range they span, so a confirmation dialog can state the blast radius instead of guessing at it.

Request body (`application/json`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `olderThanDays` | number |  |  |
| `dryRun` | boolean |  |  |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken

## Schemas

### Problem

RFC 9457 problem details

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | yes |  |
| `title` | string | yes |  |
| `status` | integer | yes |  |
| `detail` | string |  |  |
| `instance` | string |  |  |
| `requestId` | string |  |  |
| `errors` | array of object |  |  |

### Health

| Field | Type | Required | Description |
|---|---|---|---|
| `ok` | boolean | yes |  |
| `version` | string |  |  |
| `arag` | object |  |  |
| `uptimeSec` | number |  |  |

### Job

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes |  |
| `kind` | string | yes |  |
| `status` | string (`queued`, `running`, `succeeded`, `failed`, `cancelled`) | yes |  |
| `progress` | number | yes |  |
| `stage` | string |  |  |
| `message` | string |  |  |
| `input` | object |  |  |
| `result` | object |  |  |
| `error` | object |  |  |
| `events` | array of [JobEvent](#jobevent) |  |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |
| `finishedAt` | string |  |  |
| `durationsMs` | object |  |  |

### JobEvent

| Field | Type | Required | Description |
|---|---|---|---|
| `ts` | string | yes |  |
| `stage` | string | yes |  |
| `status` | string (`start`, `progress`, `ok`, `error`, `skip`) | yes |  |
| `message` | string |  |  |
| `ms` | number |  |  |
| `data` | object |  |  |

### LogRecord

| Field | Type | Required | Description |
|---|---|---|---|
| `ts` | string | yes |  |
| `level` | string | yes |  |
| `msg` | string | yes |  |

### ExtractedField

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | Stable machine key, e.g. invoice_number |
| `label` | string | yes | Human label |
| `value` | object | yes | Normalised value (string, number, boolean, null, or an array of those) |
| `raw` | string |  | Value exactly as the model returned it, before normalisation |
| `confidence` | number |  |  |
| `page` | integer |  |  |

### Entity

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes |  |
| `type` | string | yes | PERSON | ORG | DATE | MONEY | LOCATION | EMAIL | PHONE | ID | OTHER |
| `salience` | number |  |  |

### Evidence

A verbatim quote from the document supporting one extracted field, checked against the document's own extracted text rather than taken on trust.

| Field | Type | Required | Description |
|---|---|---|---|
| `field` | string | yes | The `ExtractedField.key` this quote supports |
| `quote` | string | yes | The quote exactly as the model returned it |
| `verified` | string (`exact`, `normalised`, `unverified`) | yes | `exact`: the quote appears character-for-character in the document. `normalised`: it appears once case, whitespace and punctuation are normalised. `unverified`: it does not appear — treat the field as ungrounded. |
| `paragraphId` | string |  | ARAG retrieval paragraph containing the quote (`<rid>/<type>/<field>/<start>-<end>`) |
| `start` | integer |  | Offset into the extracted text (exact matches only) |
| `end` | integer |  |  |

### ValidationIssue

| Field | Type | Required | Description |
|---|---|---|---|
| `field` | string | yes |  |
| `severity` | string (`info`, `warning`, `error`) | yes |  |
| `message` | string | yes |  |

### Document

Canonical, format-agnostic record for one document.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Document id (equal to the ARAG resource id) |
| `resourceId` | string | yes | ARAG resource id |
| `filename` | string | yes |  |
| `contentType` | string | yes |  |
| `bytes` | integer | yes |  |
| `status` | string (`pending`, `processing`, `ready`, `failed`) | yes |  |
| `jobId` | string |  |  |
| `docType` | string (`invoice`, `receipt`, `contract`, `resume`, `purchase_order`, `medical_claim`, `preauthorisation`, `bank_statement`, `form`, `report`, `generic`) | yes |  |
| `docTypeConfidence` | number |  |  |
| `fields` | array of [ExtractedField](#extractedfield) | yes |  |
| `entities` | array of [Entity](#entity) | yes |  |
| `summary` | string |  |  |
| `tags` | array of string | yes |  |
| `issues` | array of [ValidationIssue](#validationissue) | yes |  |
| `evidence` | array of [Evidence](#evidence) | yes |  |
| `error` | string |  |  |
| `meta` | object | yes |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |

### DocumentPage

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | array of [Document](#document) | yes |  |
| `page` | integer | yes |  |
| `page_size` | integer | yes |  |
| `total` | integer | yes |  |
| `next_page` | boolean |  |  |
| `facets` | [Facets](#facets) |  |  |

### DocumentAccepted

| Field | Type | Required | Description |
|---|---|---|---|
| `document` | [Document](#document) | yes |  |
| `job` | [Job](#job) | yes |  |

### BulkDeleteRequest

| Field | Type | Required | Description |
|---|---|---|---|
| `ids` | array of string | yes |  |

### BulkDeleteResult

Per-id outcome. A bulk delete is best-effort: ids that could not be deleted are reported rather than failing the whole request.

| Field | Type | Required | Description |
|---|---|---|---|
| `deleted` | array of string | yes |  |
| `failed` | array of object | yes |  |

### BulkExportRequest

| Field | Type | Required | Description |
|---|---|---|---|
| `ids` | array of string | yes |  |
| `format` | string (`json`, `xml`, `csv`) |  |  |

### Stats

Workspace counters for the documents overview — no credentials required.

| Field | Type | Required | Description |
|---|---|---|---|
| `documents` | object | yes | Counts by lifecycle status plus `total` and `degraded`. |
| `byDocType` | object | yes |  |
| `groundingScore` | number,null |  | Mean grounding score across stored records; null when none has one. |
| `fields` | integer |  | Total extracted fields across every record |
| `issues` | integer |  | Total open validation issues across every record |
| `lastProcessedAt` | string,null |  |  |
| `jobs` | object | yes |  |

### Settings

Effective, non-secret runtime settings for the signed-in workspace: what this deployment is connected to, how it extracts, and what it accepts. Everything here is already visible to a user of the product; secrets stay behind ADMIN_TOKEN.

| Field | Type | Required | Description |
|---|---|---|---|
| `product` | object | yes |  |
| `connection` | object | yes |  |
| `extraction` | object | yes |  |
| `uploads` | object | yes |  |
| `branding` | [Branding](#branding) | yes |  |
| `security` | object |  |  |

### Sample

A bundled sample document the first-run flow can process in one click.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes |  |
| `title` | string | yes |  |
| `description` | string |  |  |
| `filename` | string | yes |  |
| `contentType` | string | yes |  |
| `url` | string | yes | Static path to fetch the sample's bytes from |
| `kind` | string (`text`, `image`) |  |  |
| `expectedDocType` | string (`invoice`, `receipt`, `contract`, `resume`, `purchase_order`, `medical_claim`, `preauthorisation`, `bank_statement`, `form`, `report`, `generic`) |  |  |

### SampleRequest

| Field | Type | Required | Description |
|---|---|---|---|
| `sampleId` | string | yes |  |
| `config` | string |  | auto | agent | <extraction config id> |

### DocumentText

The document's own extracted text — the exact text every extraction stage read, and the text `Evidence.start`/`Evidence.end` are offsets into.

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes |  |
| `chars` | integer | yes | Length of the full extracted text, before truncation |
| `truncated` | boolean | yes |  |

### Facets

Counts across the whole collection (not the current page), for filter chips and the overview strip.

| Field | Type | Required | Description |
|---|---|---|---|
| `total` | integer | yes |  |
| `status` | object | yes |  |
| `docType` | object | yes |  |
| `degraded` | integer | yes |  |
| `needsReview` | integer | yes | Records carrying a warning/error issue, or a grounding score below 0.5 |

### SecurityPosture

What is protecting this deployment. Values only — never a key or a token.

| Field | Type | Required | Description |
|---|---|---|---|
| `apiKeys` | object | yes |  |
| `adminTokenSet` | boolean | yes |  |
| `sessionTtlSec` | integer |  |  |
| `cors` | array of string |  |  |
| `rateLimit` | object | yes |  |
| `maxUploadBytes` | integer | yes |  |
| `maxBodyBytes` | integer |  |  |
| `trustProxy` | string |  |  |
| `headers` | object |  |  |
| `writesRequireCredential` | boolean | yes |  |
| `retention` | object |  |  |

### AskRequest

| Field | Type | Required | Description |
|---|---|---|---|
| `question` | string | yes |  |

### AskResponse

| Field | Type | Required | Description |
|---|---|---|---|
| `answer` | string | yes |  |
| `sources` | array of string | yes | Titles of the resources retrieved |
| `citations` | array of object |  | The retrieval paragraphs behind the answer, so a caller can show where it came from rather than only which file it came from. Empty when retrieval returned nothing. |
| `ms` | integer | yes |  |

### ConfigField

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes |  |
| `label` | string | yes |  |
| `type` | string (`string`, `number`, `array`) | yes |  |
| `description` | string |  |  |
| `required` | boolean |  |  |

### ExtractionConfig

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Use as the `config` parameter on upload |
| `name` | string | yes |  |
| `docType` | string | yes |  |
| `description` | string | yes |  |
| `builtin` | boolean | yes | Built-in configs cannot be deleted |
| `aragConfig` | string | yes | Stored ARAG search configuration (kind: ask) backing this config |
| `provisioned` | boolean |  |  |
| `documentCount` | integer |  | Documents in this workspace extracted with this configuration |
| `fields` | array of [ConfigField](#configfield) | yes |  |
| `createdAt` | string |  |  |
| `updatedAt` | string |  |  |

### ExtractionConfigCreate

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes |  |
| `description` | string |  |  |
| `fields` | array of object | yes |  |

### Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes |  |
| `docType` | string (`invoice`, `receipt`, `contract`, `resume`, `purchase_order`, `medical_claim`, `preauthorisation`, `bank_statement`, `form`, `report`, `generic`) | yes |  |
| `description` | string | yes |  |
| `required` | array of string | yes |  |
| `fields` | array of [ConfigField](#configfield) | yes |  |

### ProvisionResult

| Field | Type | Required | Description |
|---|---|---|---|
| `schema` | string | yes |  |
| `aragConfig` | string | yes |  |
| `ok` | boolean | yes |  |
| `error` | string |  |  |

### Branding

| Field | Type | Required | Description |
|---|---|---|---|
| `productName` | string | yes |  |
| `tagline` | string |  |  |
| `logoUrl` | string |  |  |
| `primaryColor` | string |  |  |
| `accentColor` | string |  |  |
| `poweredBy` | boolean | yes |  |
| `footerText` | string |  |  |
| `docsUrl` | string |  |  |
| `supportUrl` | string |  |  |

