/**
 * OpenAPI 3.1 document for Document Processing — the single source of truth for the
 * public API. Authored before the routes (STANDARDS §2): every `/api/v1` route is
 * validated with `operationSchemas(openapi, …)` and the contract tests fail the build
 * if a route is missing from this document or a response drifts from its schema.
 */
import {
  BrandingSchema,
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

const Evidence = {
  type: "object",
  description:
    "A verbatim quote from the document supporting one extracted field, checked against " +
    "the document's own extracted text rather than taken on trust.",
  required: ["field", "quote", "verified"],
  properties: {
    field: { type: "string", description: "The `ExtractedField.key` this quote supports" },
    quote: { type: "string", description: "The quote exactly as the model returned it" },
    verified: {
      type: "string",
      enum: ["exact", "normalised", "unverified"],
      description:
        "`exact`: the quote appears character-for-character in the document. `normalised`: " +
        "it appears once case, whitespace and punctuation are normalised. `unverified`: it " +
        "does not appear — treat the field as ungrounded.",
    },
    paragraphId: {
      type: "string",
      description: "ARAG retrieval paragraph containing the quote (`<rid>/<type>/<field>/<start>-<end>`)",
    },
    start: { type: "integer", description: "Offset into the extracted text (exact matches only)" },
    end: { type: "integer" },
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
    "evidence",
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
    evidence: { type: "array", items: { $ref: "#/components/schemas/Evidence" } },
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
        groundingScore: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            "Share of extracted fields backed by a verified quote. Absent when nothing was " +
            "extracted. The headline signal for whether this record can be trusted unreviewed.",
        },
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
    sources: { type: "array", items: { type: "string" }, description: "Titles of the resources retrieved" },
    citations: {
      type: "array",
      description:
        "The retrieval paragraphs behind the answer, so a caller can show where it came from " +
        "rather than only which file it came from. Empty when retrieval returned nothing.",
      items: {
        type: "object",
        required: ["paragraphId", "text"],
        properties: {
          paragraphId: { type: "string" },
          text: { type: "string" },
          start: { type: "integer" },
          end: { type: "integer" },
        },
      },
    },
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
    documentCount: {
      type: "integer",
      description: "Documents in this workspace extracted with this configuration",
    },
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

/** Ids a bulk action applies to. Capped so one request cannot become an unbounded job. */
const BulkIds = {
  type: "array",
  minItems: 1,
  maxItems: 200,
  items: { type: "string", maxLength: 128 },
};

const BulkDeleteRequest = {
  type: "object",
  required: ["ids"],
  properties: { ids: BulkIds },
  additionalProperties: false,
};

const BulkDeleteResult = {
  type: "object",
  description:
    "Per-id outcome. A bulk delete is best-effort: ids that could not be deleted are " +
    "reported rather than failing the whole request.",
  required: ["deleted", "failed"],
  properties: {
    deleted: { type: "array", items: { type: "string" } },
    failed: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "error"],
        properties: { id: { type: "string" }, error: { type: "string" } },
      },
    },
  },
};

const BulkExportRequest = {
  type: "object",
  required: ["ids"],
  properties: {
    ids: BulkIds,
    format: { type: "string", enum: ["json", "xml", "csv"], default: "json" },
  },
  additionalProperties: false,
};

const Stats = {
  type: "object",
  description: "Workspace counters for the documents overview — no credentials required.",
  required: ["documents", "byDocType", "jobs"],
  properties: {
    documents: {
      type: "object",
      description: "Counts by lifecycle status plus `total` and `degraded`.",
      additionalProperties: { type: "number" },
    },
    byDocType: { type: "object", additionalProperties: { type: "number" } },
    groundingScore: {
      type: ["number", "null"],
      description: "Mean grounding score across stored records; null when none has one.",
    },
    fields: { type: "integer", description: "Total extracted fields across every record" },
    issues: { type: "integer", description: "Total open validation issues across every record" },
    lastProcessedAt: { type: ["string", "null"], format: "date-time" },
    jobs: { type: "object", additionalProperties: { type: "number" } },
  },
};

const Settings = {
  type: "object",
  description:
    "Effective, non-secret runtime settings for the signed-in workspace: what this " +
    "deployment is connected to, how it extracts, and what it accepts. Everything here is " +
    "already visible to a user of the product; secrets stay behind ADMIN_TOKEN.",
  required: ["product", "connection", "extraction", "uploads", "branding"],
  properties: {
    product: {
      type: "object",
      required: ["name", "version"],
      properties: {
        name: { type: "string" },
        version: { type: "string" },
        docsUrl: { type: "string" },
        openapiUrl: { type: "string" },
      },
    },
    connection: {
      type: "object",
      required: ["ok", "mock"],
      properties: {
        ok: { type: "boolean" },
        mock: { type: "boolean", description: "True when running against the in-process mock ARAG" },
        kbId: { type: "string" },
        region: { type: "string" },
        baseUrl: { type: "string" },
        resources: { type: ["integer", "null"] },
        ms: { type: ["number", "null"], description: "Round-trip of the last health check" },
        error: { type: "string" },
        checkedAt: { type: "string", format: "date-time" },
      },
      additionalProperties: true,
    },
    extraction: {
      type: "object",
      required: ["visualExtraction", "generativeModel", "stages"],
      properties: {
        visualExtraction: {
          type: "boolean",
          description:
            "Whether an ingestion-time visual-LLM extract strategy is configured. The strategy " +
            "id itself stays behind ADMIN_TOKEN.",
        },
        generativeModel: { type: "string" },
        reranker: { type: ["string", "null"] },
        stages: { type: "array", items: { type: "string" } },
        configs: { type: "integer", description: "Extraction configurations available" },
      },
    },
    uploads: {
      type: "object",
      required: ["maxBytes", "acceptedTypes"],
      properties: {
        maxBytes: { type: "integer" },
        acceptedTypes: { type: "array", items: { type: "string" } },
        acceptedExtensions: { type: "array", items: { type: "string" } },
      },
    },
    branding: { $ref: "#/components/schemas/Branding" },
    security: {
      type: "object",
      properties: {
        apiKeysEnforced: { type: "boolean" },
        adminEnabled: { type: "boolean" },
      },
    },
  },
};

const DocumentText = {
  type: "object",
  description:
    "The document's own extracted text — the exact text every extraction stage read, and " +
    "the text `Evidence.start`/`Evidence.end` are offsets into.",
  required: ["text", "chars", "truncated"],
  properties: {
    text: { type: "string" },
    chars: { type: "integer", description: "Length of the full extracted text, before truncation" },
    truncated: { type: "boolean" },
  },
};

const Facets = {
  type: "object",
  description:
    "Counts across the whole collection (not the current page), for filter chips and the overview strip.",
  required: ["status", "docType", "degraded", "needsReview", "total"],
  properties: {
    total: { type: "integer" },
    status: { type: "object", additionalProperties: { type: "integer" } },
    docType: { type: "object", additionalProperties: { type: "integer" } },
    degraded: { type: "integer" },
    needsReview: {
      type: "integer",
      description: "Records carrying a warning/error issue, or a grounding score below 0.5",
    },
  },
};

const SampleRequest = {
  type: "object",
  required: ["sampleId"],
  properties: {
    sampleId: { type: "string", maxLength: 80 },
    config: { type: "string", maxLength: 80, description: "auto | agent | <extraction config id>" },
  },
  additionalProperties: false,
};

const SecurityPosture = {
  type: "object",
  description: "What is protecting this deployment. Values only — never a key or a token.",
  required: ["apiKeys", "adminTokenSet", "rateLimit", "maxUploadBytes", "writesRequireCredential"],
  properties: {
    apiKeys: {
      type: "object",
      required: ["count", "hints"],
      properties: {
        count: { type: "integer" },
        hints: {
          type: "array",
          items: { type: "string" },
          description: "Last four characters of each configured key, so an operator can tell them apart",
        },
      },
    },
    adminTokenSet: { type: "boolean" },
    sessionTtlSec: { type: "integer" },
    cors: { type: "array", items: { type: "string" } },
    rateLimit: {
      type: "object",
      properties: { rps: { type: "number" }, burst: { type: "number" } },
    },
    maxUploadBytes: { type: "integer" },
    maxBodyBytes: { type: "integer" },
    trustProxy: { type: "string" },
    headers: { type: "object", additionalProperties: { type: "boolean" } },
    writesRequireCredential: { type: "boolean" },
    retention: { type: "object", properties: { defaultOlderThanDays: { type: "integer" } } },
  },
};

const Sample = {
  type: "object",
  description: "A bundled sample document the first-run flow can process in one click.",
  required: ["id", "title", "filename", "contentType", "url"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    filename: { type: "string" },
    contentType: { type: "string" },
    url: { type: "string", description: "Static path to fetch the sample's bytes from" },
    kind: { type: "string", enum: ["text", "image"] },
    expectedDocType: { type: "string", enum: [...DOC_TYPES] },
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
    Evidence,
    ValidationIssue,
    Document,
    // The platform's page shape plus `facets`: the list screen's filter counts and stat
    // strip are answers about the whole collection, and a page cannot carry them.
    DocumentPage: (() => {
      const base = pageSchema("#/components/schemas/Document");
      const props = base.properties as Record<string, unknown>;
      props.facets = { $ref: "#/components/schemas/Facets" };
      return base;
    })(),
    DocumentAccepted,
    BulkDeleteRequest,
    BulkDeleteResult,
    BulkExportRequest,
    Stats,
    Settings,
    Sample,
    SampleRequest,
    DocumentText,
    Facets,
    SecurityPosture,
    AskRequest,
    AskResponse,
    ConfigField,
    ExtractionConfig,
    ExtractionConfigCreate,
    Schema,
    ProvisionResult,
    Branding: BrandingSchema,
  },
  paths: {
    "/api/v1/documents": {
      get: {
        operationId: "listDocuments",
        tags: ["documents"],
        summary: "List documents (newest first) with search, filters and sorting",
        description:
          "Every parameter is optional and they combine with AND. `q` is a case-insensitive " +
          "substring match across the filename, the summary, the tags and the extracted field " +
          "labels and values — so a user can find a document by the supplier on it, not only by " +
          "the name it was uploaded under.",
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
          {
            name: "doc_type",
            in: "query",
            description:
              "Document type. Repeat the parameter to select several (`?doc_type=invoice&doc_type=receipt`).",
            explode: true,
            schema: { type: "array", items: { type: "string", enum: [...DOC_TYPES] } },
          },
          {
            name: "q",
            in: "query",
            description: "Free-text search over filename, summary, tags and extracted field values",
            schema: { type: "string", maxLength: 200 },
          },
          {
            name: "sort",
            in: "query",
            description: "Field to order by (default `created_at`)",
            schema: {
              type: "string",
              enum: ["created_at", "filename", "doc_type", "status", "fields", "grounding"],
              default: "created_at",
            },
          },
          {
            name: "order",
            in: "query",
            schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
          },
          {
            name: "date_from",
            in: "query",
            description: "Only documents created at or after this instant (ISO 8601 or YYYY-MM-DD)",
            schema: { type: "string", maxLength: 40 },
          },
          {
            name: "date_to",
            in: "query",
            description: "Only documents created at or before this instant (ISO 8601 or YYYY-MM-DD)",
            schema: { type: "string", maxLength: 40 },
          },
          {
            name: "config",
            in: "query",
            description: "Only documents extracted with this extraction configuration id",
            schema: { type: "string", maxLength: 80 },
          },
          {
            name: "degraded",
            in: "query",
            description:
              "`true` returns only records that finished with a failed stage (`meta.stageErrors`); " +
              "`false` excludes them.",
            schema: { type: "boolean" },
          },
          {
            name: "has_issues",
            in: "query",
            description: "`true` returns only records carrying at least one validation issue",
            schema: { type: "boolean" },
          },
          {
            name: "min_grounding",
            in: "query",
            description:
              "Only records whose `meta.groundingScore` is at least this. Records with no score " +
              "are excluded — an unmeasured record is not a well-grounded one.",
            schema: { type: "number", minimum: 0, maximum: 1 },
          },
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
        description:
          "Answers from this document's own text. Every call is a generative model call " +
          "against the Knowledge Box, so this route has its own, tighter rate-limit bucket " +
          "than the shared public one — an anonymous caller can still try the product " +
          "without a credential, but cannot use it as an unbounded model proxy.",
        requestBody: jsonBody({ $ref: "#/components/schemas/AskRequest" }),
        responses: { 200: jsonResponse({ $ref: "#/components/schemas/AskResponse" }), ...standardResponses },
        security: apiSecurity,
      },
    },
    "/api/v1/documents/{id}/text": {
      parameters: [idParam],
      get: {
        operationId: "getDocumentText",
        tags: ["documents"],
        summary: "The document's own extracted text",
        description:
          "The text Progress Agentic RAG read from the file at ingestion — what every " +
          "extraction stage saw, and what `Evidence.start`/`Evidence.end` index into. Without " +
          "it a client can show an evidence quote but cannot show it *in the document*.",
        parameters: [
          {
            name: "max_chars",
            in: "query",
            schema: { type: "integer", minimum: 1000, maximum: 2000000, default: 200000 },
          },
        ],
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/DocumentText" }),
          ...standardResponses,
        },
        security: apiSecurity,
      },
    },
    "/api/v1/documents/{id}/source": {
      parameters: [idParam],
      get: {
        operationId: "getDocumentSource",
        tags: ["documents"],
        summary: "The original uploaded file",
        description:
          "Streams the bytes back from the ARAG resource, `Content-Disposition: inline`, so a " +
          "reviewer can see the page the values came from. Answers 404 when the resource no " +
          "longer holds the file; a client should then fall back to the extracted text.",
        responses: {
          200: {
            description: "The original file",
            content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
          },
          ...standardResponses,
        },
        security: apiSecurity,
      },
    },
    "/api/v1/documents/sample": {
      post: {
        operationId: "createSampleDocument",
        tags: ["documents"],
        summary: "Process one of the bundled sample documents",
        description:
          "Reads the sample from disk server-side and runs it through the ordinary upload path, " +
          "so the first-run flow is one call rather than a fetch followed by an upload. The " +
          "sample ids come from `GET /api/v1/samples`.",
        requestBody: jsonBody({ $ref: "#/components/schemas/SampleRequest" }),
        responses: {
          202: jsonResponse({ $ref: "#/components/schemas/DocumentAccepted" }, "Accepted"),
          ...standardResponses,
        },
        security: apiSecurity,
      },
    },
    "/api/v1/documents/{id}/reprocess": {
      parameters: [idParam],
      post: {
        operationId: "reprocessDocument",
        tags: ["documents"],
        summary: "Re-run the pipeline over a document already in the Knowledge Box",
        description:
          "The recovery action for a failed or degraded record: the resource is already " +
          "uploaded, so this queues a fresh job over it rather than asking the user to upload " +
          "the file again. Returns 202 with the reset record and the new job to watch. " +
          "Requires a credential even when `API_KEYS` is unset (it spends model calls): an API " +
          "key, the admin token, or a same-origin session cookie from `POST /api/v1/session`.",
        parameters: [
          {
            name: "config",
            in: "query",
            description: "Extraction configuration to use for the re-run (default: the original one)",
            schema: { type: "string", maxLength: 80 },
          },
        ],
        responses: {
          202: jsonResponse({ $ref: "#/components/schemas/DocumentAccepted" }, "Accepted"),
          409: {
            description: "The document is already queued or processing",
            content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
          },
          ...standardResponses,
        },
        security: apiSecurity,
      },
    },
    "/api/v1/documents/bulk-delete": {
      post: {
        operationId: "bulkDeleteDocuments",
        tags: ["documents"],
        summary: "Delete several documents and their ARAG resources",
        description:
          "Best-effort: each id is attempted and reported separately, so one missing document " +
          "does not abandon the rest of the selection. Requires the same credential as a single " +
          "delete.",
        requestBody: jsonBody({ $ref: "#/components/schemas/BulkDeleteRequest" }),
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/BulkDeleteResult" }),
          ...standardResponses,
        },
        security: apiSecurity,
      },
    },
    "/api/v1/documents/bulk-export": {
      post: {
        operationId: "bulkExportDocuments",
        tags: ["documents"],
        summary: "Download several records as one JSON, XML or CSV file",
        description:
          "JSON returns an array of records; XML wraps them in a `<documents>` root; CSV emits " +
          "one header and one row per extracted field across every selected record, so a " +
          "spreadsheet can reconcile a whole batch in one pass. Ids that do not exist are " +
          "skipped and named in the `X-Skipped-Ids` response header.",
        requestBody: jsonBody({ $ref: "#/components/schemas/BulkExportRequest" }),
        responses: {
          200: {
            description: "Standardised export of the selected records",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Document" } },
              },
              "application/xml": { schema: { type: "string" } },
              "text/csv": { schema: { type: "string" } },
            },
          },
          ...standardResponses,
        },
        security: apiSecurity,
      },
    },
    "/api/v1/stats": {
      get: {
        operationId: "getStats",
        tags: ["documents"],
        summary: "Workspace counters: documents by status and type, grounding, jobs",
        description:
          "What the documents overview strip shows. Cheap and credential-free, so a list screen " +
          "can poll it while a pipeline runs without an admin token.",
        responses: { 200: jsonResponse({ $ref: "#/components/schemas/Stats" }), ...standardResponses },
        security: apiSecurity,
      },
    },
    "/api/v1/settings": {
      get: {
        operationId: "getSettings",
        tags: ["system"],
        summary: "Effective, non-secret runtime settings for the workspace",
        description:
          "Connection state, extraction configuration, upload limits and branding — everything " +
          "the Settings screen shows a signed-in user. Secrets (the extract-strategy id, tokens, " +
          "keys) stay behind `ADMIN_TOKEN` on `/api/v1/admin/config`.",
        responses: { 200: jsonResponse({ $ref: "#/components/schemas/Settings" }), ...standardResponses },
        security: apiSecurity,
      },
    },
    "/api/v1/samples": {
      get: {
        operationId: "listSamples",
        tags: ["system"],
        summary: "Bundled sample documents for the first-run flow",
        description:
          "The catalogue behind “Try with a sample”: each entry names a file served from " +
          "`/samples/`, which the client uploads to `POST /api/v1/documents` like any other " +
          "document. Nothing here is special-cased in the pipeline.",
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items"],
            properties: { items: { type: "array", items: { $ref: "#/components/schemas/Sample" } } },
          }),
          ...standardResponses,
        },
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
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          {
            name: "page_size",
            in: "query",
            description: "Preferred over `limit`, which stays for compatibility",
            schema: { type: "integer", minimum: 1, maximum: 200 },
          },
          {
            name: "sort",
            in: "query",
            schema: {
              type: "string",
              enum: ["created_at", "duration", "status"],
              default: "created_at",
            },
          },
          { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
          {
            name: "q",
            in: "query",
            description: "Match the job id, its kind, or the document id it refers to",
            schema: { type: "string", maxLength: 200 },
          },
        ],
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items", "page", "page_size", "total"],
            properties: {
              items: { type: "array", items: { $ref: "#/components/schemas/Job" } },
              page: { type: "integer" },
              page_size: { type: "integer" },
              total: { type: "integer" },
              next_page: { type: "boolean" },
            },
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
        summary: "Cancel a queued or running job",
        description:
          "Requires a credential even when `API_KEYS` is unset: an API key, the admin token, or a " +
          "same-origin session cookie from `POST /api/v1/session`. A job that has already finished " +
          "cannot be cancelled and answers 409.",
        responses: {
          204: { description: "Cancelled" },
          409: {
            description: "The job already finished (succeeded, failed or cancelled)",
            content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
          },
          ...standardResponses,
        },
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
      put: {
        operationId: "updateExtractionConfig",
        tags: ["extraction-configs"],
        summary: "Replace a custom extraction configuration",
        description:
          "Replaces the name, description and fields, and re-provisions the stored ARAG search " +
          "configuration. The id is kept, so `meta.config` on every document already processed " +
          "with this configuration stays meaningful — which delete-and-recreate would break. " +
          "Built-in configurations answer 409. Requires a writer credential.",
        requestBody: jsonBody({ $ref: "#/components/schemas/ExtractionConfigCreate" }),
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/ExtractionConfig" }),
          409: {
            description: "Built-in configuration cannot be edited",
            content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
          },
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
    "/api/v1/extraction-configs/{id}/provision": {
      parameters: [idParam],
      post: {
        operationId: "provisionExtractionConfig",
        tags: ["extraction-configs"],
        summary: "Re-provision one configuration's stored ARAG search configuration",
        description:
          "Idempotent. `POST /api/v1/admin/provision` re-provisions all of them and needs the " +
          "admin token; this is the granularity an operator needs to fix the one config that " +
          "did not take. Requires a writer credential.",
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/ProvisionResult" }),
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
    "/api/v1/branding": {
      get: {
        operationId: "getBranding",
        tags: ["system"],
        summary: "Effective white-label branding for this deployment",
        description:
          "Public and secret-free — it contains only what a visitor already sees. Both UIs " +
          "fetch it before they paint; a partner's own front end can too. Configured with " +
          "`BRAND_*` environment variables; assets live in `DATA_DIR/branding/` and are served " +
          "from `/branding/`. See `docs/developer/white-label.md`.",
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/Branding" }),
          ...standardResponses,
        },
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
              groundingScore: {
                type: ["number", "null"],
                description: "Mean grounding score across stored records; null when none has one.",
              },
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
    "/api/v1/admin/security": {
      get: {
        operationId: "adminSecurity",
        tags: ["admin"],
        summary: "What is protecting this deployment",
        description:
          "Credentials in force, rate limits, CORS, upload ceiling and retention default, in " +
          "one shape. Key values are never returned — only how many there are and the last four " +
          "characters of each, which is what an operator needs to tell two keys apart.",
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/SecurityPosture" }),
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
        description:
          "With `dryRun: true` nothing is deleted: the response reports how many documents " +
          "would go and the date range they span, so a confirmation dialog can state the blast " +
          "radius instead of guessing at it.",
        requestBody: jsonBody({
          type: "object",
          properties: {
            olderThanDays: { type: "number", minimum: 0, maximum: 3650, default: 30 },
            dryRun: { type: "boolean", default: false },
          },
          additionalProperties: false,
        }),
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["deleted", "failed"],
            properties: {
              olderThanDays: { type: "number" },
              dryRun: { type: "boolean" },
              wouldDelete: { type: "integer" },
              oldest: { type: ["string", "null"], format: "date-time" },
              newest: { type: ["string", "null"], format: "date-time" },
              ids: { type: "array", items: { type: "string" } },
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
