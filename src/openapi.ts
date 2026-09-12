/**
 * OpenAPI 3.1 document for Document Processing — the single source of truth for the
 * public API. Authored before the routes (STANDARDS §2): every `/api/v1` route is
 * validated with `operationSchemas(openapi, …)` and the contract tests fail the build
 * if a route is missing from this document or a response drifts from its schema.
 */
import {
  buildOpenApi,
  jsonBody,
  jsonResponse,
  pageSchema,
  standardResponses,
} from "../vendor/arag-platform/src/index.ts";

import { DOC_TYPE_VALUES } from "./types.ts";

export const VERSION = "1.0.0";

/** The spec's document-type enums come from the code, so the two cannot drift. */
const DOC_TYPES = DOC_TYPE_VALUES;

const ExtractedField = {
  type: "object",
  required: ["key", "label", "value"],
  properties: {
    key: { type: "string", description: "Stable machine key, e.g. invoice_number" },
    label: { type: "string", description: "Human label" },
    value: {
      description: "Normalised value (string, number, boolean, null, or an array of those)",
      anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "null" },
        { type: "array", items: {} },
      ],
    },
    raw: { type: "string", description: "Value exactly as the model returned it, before normalisation" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    page: { type: "integer", minimum: 0 },
  },
};

const Entity = {
  type: "object",
  required: ["text", "type"],
  properties: {
    text: { type: "string" },
    type: {
      type: "string",
      description: "PERSON | ORG | DATE | MONEY | LOCATION | EMAIL | PHONE | ID | OTHER",
    },
    salience: { type: "number" },
  },
};

const ValidationIssue = {
  type: "object",
  required: ["field", "severity", "message"],
  properties: {
    field: { type: "string" },
    severity: { type: "string", enum: ["info", "warning", "error"] },
    message: { type: "string" },
  },
};

const Document = {
  type: "object",
  description: "Canonical, format-agnostic record for one document.",
  required: [
    "id",
    "resourceId",
    "filename",
    "contentType",
    "bytes",
    "status",
    "docType",
    "fields",
    "entities",
    "tags",
    "issues",
    "meta",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", description: "Document id (equal to the ARAG resource id)" },
    resourceId: { type: "string", description: "ARAG resource id" },
    filename: { type: "string" },
    contentType: { type: "string" },
    bytes: { type: "integer" },
    status: { type: "string", enum: ["pending", "processing", "ready", "failed"] },
    jobId: { type: "string" },
    docType: { type: "string", enum: [...DOC_TYPES] },
    docTypeConfidence: { type: "number", minimum: 0, maximum: 1 },
    fields: { type: "array", items: { $ref: "#/components/schemas/ExtractedField" } },
    entities: { type: "array", items: { $ref: "#/components/schemas/Entity" } },
    summary: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    issues: { type: "array", items: { $ref: "#/components/schemas/ValidationIssue" } },
    error: { type: "string" },
    meta: {
      type: "object",
      required: ["processedAt", "schema", "model", "durationsMs"],
      properties: {
        processedAt: { type: "string", format: "date-time" },
        schema: { type: "string" },
        model: { type: "string" },
        sourceChars: { type: "integer" },
        durationsMs: { type: "object", additionalProperties: { type: "number" } },
        config: { type: "string" },
        forced: { type: "boolean" },
        searchConfiguration: { type: "string" },
        extractStrategy: { type: "string" },
        stageErrors: {
          type: "array",
          items: { type: "string" },
          description:
            'Stages that failed during the run ("<stage>: <message>"). Present only when a stage ' +
            "failed: the pipeline degrades gracefully, so a `ready` record can still be missing the " +
            "output of a stage that errored. The same failures also appear in `issues`.",
        },
      },
      additionalProperties: true,
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const DocumentAccepted = {
  type: "object",
  required: ["document", "job"],
  properties: {
    document: { $ref: "#/components/schemas/Document" },
    job: { $ref: "#/components/schemas/Job" },
  },
};

const AskRequest = {
  type: "object",
  required: ["question"],
  properties: { question: { type: "string", minLength: 1, maxLength: 1200 } },
  additionalProperties: false,
};

const AskResponse = {
  type: "object",
  required: ["answer", "sources", "ms"],
  properties: {
    answer: { type: "string" },
    sources: { type: "array", items: { type: "string" } },
    ms: { type: "integer" },
  },
};

const ConfigField = {
  type: "object",
  required: ["key", "label", "type"],
  properties: {
    key: { type: "string" },
    label: { type: "string" },
    type: { type: "string", enum: ["string", "number", "array"] },
    description: { type: "string" },
    required: { type: "boolean" },
  },
};

const ExtractionConfig = {
  type: "object",
  required: ["id", "name", "docType", "description", "builtin", "aragConfig", "fields"],
  properties: {
    id: { type: "string", description: "Use as the `config` parameter on upload" },
    name: { type: "string" },
    docType: { type: "string" },
    description: { type: "string" },
    builtin: { type: "boolean", description: "Built-in configs cannot be deleted" },
    aragConfig: {
      type: "string",
      description: "Stored ARAG search configuration (kind: ask) backing this config",
    },
    provisioned: { type: "boolean" },
    fields: { type: "array", items: { $ref: "#/components/schemas/ConfigField" } },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const ExtractionConfigCreate = {
  type: "object",
  required: ["name", "fields"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
    description: { type: "string", maxLength: 400 },
    fields: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: {
        type: "object",
        required: ["label"],
        properties: {
          key: { type: "string", maxLength: 60 },
          label: { type: "string", minLength: 1, maxLength: 80 },
          type: { type: "string", enum: ["string", "number", "array"] },
          description: { type: "string", maxLength: 300 },
          required: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

const Schema = {
  type: "object",
  required: ["name", "docType", "description", "fields", "required"],
  properties: {
    name: { type: "string" },
    docType: { type: "string", enum: [...DOC_TYPES] },
    description: { type: "string" },
    required: { type: "array", items: { type: "string" } },
    fields: { type: "array", items: { $ref: "#/components/schemas/ConfigField" } },
  },
};

const ProvisionResult = {
  type: "object",
  required: ["schema", "aragConfig", "ok"],
  properties: {
    schema: { type: "string" },
    aragConfig: { type: "string" },
    ok: { type: "boolean" },
    error: { type: "string" },
  },
};

const apiSecurity = [{ ApiKey: [] }, { Bearer: [] }];
const adminSecurity = [{ AdminToken: [] }];
const idParam = { name: "id", in: "path", required: true, schema: { type: "string", maxLength: 128 } };

export const openapi = buildOpenApi({
  info: {
    title: "Document Processing API",
    version: VERSION,
    description:
      "Turn any document into a canonical, validated record. Upload a PDF, image, or text " +
      "file; a job runs the pipeline on Progress Agentic RAG (process → classify → extract → " +
      "entities → summary → validate → standardize) and returns structured fields, entities, a " +
      "summary and validation issues, exportable as JSON, XML or CSV.",
  },
  tags: [
    { name: "documents", description: "Upload documents and read canonical records" },
    { name: "jobs", description: "Asynchronous processing jobs and their event streams" },
    { name: "extraction-configs", description: "Built-in and custom extraction configurations" },
    { name: "schemas", description: "Document types and their extraction fields" },
    { name: "admin", description: "Operator endpoints (ADMIN_TOKEN)" },
    { name: "system", description: "Health and session" },
  ],
  schemas: {
    ExtractedField,
    Entity,
    ValidationIssue,
    Document,
    DocumentPage: pageSchema("#/components/schemas/Document"),
    DocumentAccepted,
    AskRequest,
    AskResponse,
    ConfigField,
    ExtractionConfig,
    ExtractionConfigCreate,
    Schema,
    ProvisionResult,
  },
  paths: {
    "/api/v1/documents": {
      get: {
        operationId: "listDocuments",
        tags: ["documents"],
        summary: "List documents (newest first)",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          {
            name: "page_size",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          },
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: ["pending", "processing", "ready", "failed"] },
          },
          { name: "doc_type", in: "query", schema: { type: "string", enum: [...DOC_TYPES] } },
        ],
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/DocumentPage" }),
          ...standardResponses,
        },
        security: apiSecurity,
      },
      post: {
        operationId: "createDocument",
        tags: ["documents"],
        summary: "Upload a document and start the processing job",
        description:
          "Accepts `multipart/form-data` with a `file` part, or a raw body with an `X-Filename` " +
          "header. `config` selects the extraction configuration: `auto` classifies the document, " +
          "`agent` reads fields persisted by an ARAG Data Augmentation agent, or pass an " +
          "extraction-config id. Returns 202 with the document record and the job to watch.",
        parameters: [
          {
            name: "config",
            in: "query",
            description: "auto | agent | <extraction config id>",
            schema: { type: "string", maxLength: 80, default: "auto" },
          },
          {
            name: "X-Filename",
            in: "header",
            description: "Filename for raw-body uploads (ignored for multipart)",
            schema: { type: "string", maxLength: 200 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: { type: "string", format: "binary" },
                  config: { type: "string" },
                },
              },
            },
            "application/pdf": { schema: { type: "string", format: "binary" } },
            "image/png": { schema: { type: "string", format: "binary" } },
            "image/jpeg": { schema: { type: "string", format: "binary" } },
            "text/plain": { schema: { type: "string" } },
            "application/octet-stream": { schema: { type: "string", format: "binary" } },
          },
        },
        responses: {
          202: jsonResponse({ $ref: "#/components/schemas/DocumentAccepted" }, "Accepted"),
          413: {
            description: "Upload too large",
            content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
          },
          415: {
            description: "Unsupported media type",
            content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
          },
          ...standardResponses,
        },
        security: apiSecurity,
      },
    },
    "/api/v1/documents/{id}": {
      parameters: [idParam],
      get: {
        operationId: "getDocument",
        tags: ["documents"],
        summary: "Get the canonical record for one document",
        responses: { 200: jsonResponse({ $ref: "#/components/schemas/Document" }), ...standardResponses },
        security: apiSecurity,
      },
      delete: {
        operationId: "deleteDocument",
        tags: ["documents"],
        summary: "Delete a document and its ARAG resource",
        description:
          "Requires a credential even when `API_KEYS` is unset: an API key, the admin token, or a same-origin session cookie from `POST /api/v1/session`.",
        responses: { 204: { description: "Deleted" }, ...standardResponses },
        security: apiSecurity,
      },
    },
    "/api/v1/documents/{id}/export": {
      parameters: [idParam],
      get: {
        operationId: "exportDocument",
        tags: ["documents"],
        summary: "Download the record as JSON, XML or CSV",
        parameters: [
          {
            name: "format",
            in: "query",
            schema: { type: "string", enum: ["json", "xml", "csv"], default: "json" },
          },
        ],
        responses: {
          200: {
            description: "Standardised export",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Document" } },
              "application/xml": { schema: { type: "string" } },
              "text/csv": { schema: { type: "string" } },
            },
          },
          ...standardResponses,
        },
        security: apiSecurity,
      },
    },
    "/api/v1/documents/{id}/ask": {
      parameters: [idParam],
      post: {
        operationId: "askDocument",
        tags: ["documents"],
        summary: "Ask a grounded question about one document",
        requestBody: jsonBody({ $ref: "#/components/schemas/AskRequest" }),
        responses: { 200: jsonResponse({ $ref: "#/components/schemas/AskResponse" }), ...standardResponses },
        security: apiSecurity,
      },
    },
    "/api/v1/jobs": {
      get: {
        operationId: "listJobs",
        tags: ["jobs"],
        summary: "List processing jobs",
        parameters: [
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: ["queued", "running", "succeeded", "failed", "cancelled"] },
          },
          { name: "ref", in: "query", description: "Filter by document id", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
        ],
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items"],
            properties: { items: { type: "array", items: { $ref: "#/components/schemas/Job" } } },
          }),
          ...standardResponses,
        },
        security: apiSecurity,
      },
    },
    "/api/v1/jobs/{id}": {
      parameters: [idParam],
      get: {
        operationId: "getJob",
        tags: ["jobs"],
        summary: "Get a job",
        responses: { 200: jsonResponse({ $ref: "#/components/schemas/Job" }), ...standardResponses },
        security: apiSecurity,
      },
      delete: {
        operationId: "cancelJob",
        tags: ["jobs"],
        summary: "Cancel a running job",
        description:
          "Requires a credential even when `API_KEYS` is unset: an API key, the admin token, or a same-origin session cookie from `POST /api/v1/session`.",
        responses: { 204: { description: "Cancelled" }, ...standardResponses },
        security: apiSecurity,
      },
    },
    "/api/v1/jobs/{id}/events": {
      parameters: [idParam],
      get: {
        operationId: "jobEvents",
        tags: ["jobs"],
        summary: "Server-sent events for a job (event names: event, job)",
        description:
          "Replays the job's events so far, then streams new ones. `event` carries a JobEvent " +
          "(stage, status, ms, message); `job` carries the job itself on each status change and " +
          "closes the stream when the job finishes.",
        responses: {
          200: {
            description: "text/event-stream",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
          ...standardResponses,
        },
        security: apiSecurity,
      },
    },
    "/api/v1/extraction-configs": {
      get: {
        operationId: "listExtractionConfigs",
        tags: ["extraction-configs"],
        summary: "List built-in and custom extraction configurations",
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items"],
            properties: {
              items: { type: "array", items: { $ref: "#/components/schemas/ExtractionConfig" } },
            },
          }),
          ...standardResponses,
        },
        security: apiSecurity,
      },
      post: {
        operationId: "createExtractionConfig",
        tags: ["extraction-configs"],
        summary: "Create a custom extraction configuration",
        description:
          "Persists the config and provisions a stored ARAG search configuration (kind `ask`) " +
          "that pins the model, the full_resource RAG strategy, the grounding prompt and the " +
          "answer_json_schema built from these fields. Because it writes into the Knowledge Box, " +
          "it requires a credential even when `API_KEYS` is unset: an API key, the admin token, " +
          "or a same-origin session cookie from `POST /api/v1/session`.",
        requestBody: jsonBody({ $ref: "#/components/schemas/ExtractionConfigCreate" }),
        responses: {
          201: jsonResponse({ $ref: "#/components/schemas/ExtractionConfig" }, "Created"),
          ...standardResponses,
        },
        security: apiSecurity,
      },
    },
    "/api/v1/extraction-configs/{id}": {
      parameters: [idParam],
      get: {
        operationId: "getExtractionConfig",
        tags: ["extraction-configs"],
        summary: "Get one extraction configuration",
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/ExtractionConfig" }),
          ...standardResponses,
        },
        security: apiSecurity,
      },
      delete: {
        operationId: "deleteExtractionConfig",
        tags: ["extraction-configs"],
        summary: "Delete a custom extraction configuration (built-ins are not deletable)",
        description:
          "Requires a credential even when `API_KEYS` is unset: an API key, the admin token, or a same-origin session cookie from `POST /api/v1/session`.",
        responses: {
          204: { description: "Deleted" },
          409: {
            description: "Built-in configuration cannot be deleted",
            content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
          },
          ...standardResponses,
        },
        security: apiSecurity,
      },
    },
    "/api/v1/schemas": {
      get: {
        operationId: "listSchemas",
        tags: ["schemas"],
        summary: "List document types and the fields each extraction schema captures",
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items"],
            properties: { items: { type: "array", items: { $ref: "#/components/schemas/Schema" } } },
          }),
          ...standardResponses,
        },
        security: apiSecurity,
      },
    },
    "/api/v1/session": {
      post: {
        operationId: "createSession",
        tags: ["system"],
        summary: "Issue a same-origin session cookie for the demo UI",
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["ok", "expiresInSec"],
            properties: { ok: { type: "boolean" }, expiresInSec: { type: "integer" } },
          }),
          ...standardResponses,
        },
      },
    },
    "/api/v1/admin/login": {
      post: {
        operationId: "adminLogin",
        tags: ["admin"],
        summary: "Exchange the admin token for an HttpOnly cookie",
        requestBody: jsonBody({
          type: "object",
          required: ["token"],
          properties: { token: { type: "string", minLength: 1, maxLength: 400 } },
          additionalProperties: false,
        }),
        responses: {
          200: jsonResponse({ type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }),
          ...standardResponses,
        },
      },
    },
    "/api/v1/admin/health": {
      get: {
        operationId: "adminHealth",
        tags: ["admin"],
        summary: "Service health, KB connection test, extract strategy and model",
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["ok", "version", "arag"],
            properties: {
              ok: { type: "boolean" },
              version: { type: "string" },
              uptimeSec: { type: "number" },
              arag: { type: "object", additionalProperties: true },
              extractStrategy: { type: ["string", "null"] },
              generativeModel: { type: "string" },
              documents: {
                type: "object",
                additionalProperties: { type: "number" },
                description:
                  "Counts by status plus `degraded`: records that finished but lost a stage " +
                  "(see the record's `meta.stageErrors`).",
              },
            },
            additionalProperties: true,
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/config": {
      get: {
        operationId: "adminConfig",
        tags: ["admin"],
        summary: "Effective configuration (secrets redacted)",
        responses: {
          200: jsonResponse({ type: "object", additionalProperties: true }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/usage": {
      get: {
        operationId: "adminUsage",
        tags: ["admin"],
        summary: "Usage counters (requests, ARAG calls, jobs, documents)",
        responses: {
          200: jsonResponse({ type: "object", additionalProperties: true }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/logs": {
      get: {
        operationId: "adminLogs",
        tags: ["admin"],
        summary: "Recent log records",
        parameters: [
          {
            name: "level",
            in: "query",
            schema: { type: "string", enum: ["debug", "info", "warn", "error"] },
          },
          { name: "contains", in: "query", schema: { type: "string", maxLength: 200 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 200 } },
        ],
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items"],
            properties: { items: { type: "array", items: { $ref: "#/components/schemas/LogRecord" } } },
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/search-configurations": {
      get: {
        operationId: "adminSearchConfigurations",
        tags: ["admin"],
        summary: "Read the stored ARAG search configurations this product provisions",
        description:
          "Fetches the `dip_*` search configurations straight from the Knowledge Box, so an " +
          "operator can confirm which model, RAG strategy, prompt and answer_json_schema the " +
          "extraction agents are actually running against — without opening the ARAG dashboard.",
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items"],
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  required: ["name", "kind"],
                  properties: {
                    name: { type: "string" },
                    kind: { type: "string" },
                    config: { type: "object", additionalProperties: true },
                  },
                },
              },
              other: {
                type: "array",
                items: { type: "string" },
                description: "Names of search configurations in the KB that this product did not create.",
              },
            },
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/provision": {
      post: {
        operationId: "adminProvision",
        tags: ["admin"],
        summary: "Re-provision every extraction configuration as an ARAG search configuration",
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items", "ok", "failed"],
            properties: {
              ok: { type: "integer" },
              failed: { type: "integer" },
              items: { type: "array", items: { $ref: "#/components/schemas/ProvisionResult" } },
            },
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/purge": {
      post: {
        operationId: "adminPurge",
        tags: ["admin"],
        summary: "Delete documents older than N days from the store and the Knowledge Box",
        requestBody: jsonBody({
          type: "object",
          properties: { olderThanDays: { type: "number", minimum: 0, maximum: 3650, default: 30 } },
          additionalProperties: false,
        }),
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["deleted", "failed"],
            properties: {
              olderThanDays: { type: "number" },
              deleted: { type: "array", items: { type: "string" } },
              failed: {
                type: "array",
                items: {
                  type: "object",
                  properties: { id: { type: "string" }, error: { type: "string" } },
                },
              },
            },
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
  },
});
