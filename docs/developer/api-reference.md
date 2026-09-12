# API reference — Document Processing API v1.0.0

Turn any document into a canonical, validated record. Upload a PDF, image, or text file; a job runs the pipeline on Progress Agentic RAG (process → classify → extract → entities → summary → validate → standardize) and returns structured fields, entities, a summary and validation issues, exportable as JSON, XML or CSV.

Generated from `openapi.json` — do not edit by hand. Interactive docs: `/api/v1/docs` (Redoc) and `/api/v1/swagger` (try it out).

## Authentication

- **ApiKey** — apiKey header X-API-Key: Required only when API_KEYS is configured.
- **Bearer** — http bearer : API key or admin token as a bearer token.
- **AdminToken** — http bearer : ADMIN_TOKEN; required for /admin routes.

## documents

### `GET /api/v1/documents`

**List documents (newest first)**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `page` | query | integer |  |  |
| `page_size` | query | integer |  |  |
| `status` | query | string |  |  |
| `doc_type` | query | string |  |  |

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

**Delete a document and its ARAG resource**

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

**Ask a grounded question about one document**

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

## jobs

### `GET /api/v1/jobs`

**List processing jobs**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `status` | query | string |  |  |
| `ref` | query | string |  | Filter by document id |
| `limit` | query | integer |  |  |

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

**Cancel a running job**

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

**Create a custom extraction configuration** — Persists the config and provisions a stored ARAG search configuration (kind `ask`) that pins the model, the full_resource RAG strategy, the grounding prompt and the answer_json_schema built from these fields.

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


### `DELETE /api/v1/extraction-configs/{id}`

**Delete a custom extraction configuration (built-ins are not deletable)**

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

## system

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

**Delete documents older than N days from the store and the Knowledge Box**

Request body (`application/json`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `olderThanDays` | number |  |  |

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

### DocumentAccepted

| Field | Type | Required | Description |
|---|---|---|---|
| `document` | [Document](#document) | yes |  |
| `job` | [Job](#job) | yes |  |

### AskRequest

| Field | Type | Required | Description |
|---|---|---|---|
| `question` | string | yes |  |

### AskResponse

| Field | Type | Required | Description |
|---|---|---|---|
| `answer` | string | yes |  |
| `sources` | array of string | yes |  |
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

