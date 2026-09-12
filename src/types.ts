/**
 * Shared types for Document Processing.
 *
 * The end product of a pipeline run is a `DocumentRecord`: a canonical,
 * format-agnostic representation of one document. It is what gets serialised to
 * JSON / XML / CSV, what `GET /api/v1/documents/{id}` returns, and what the demo UI
 * renders. Everything upstream (upload, classify, extract, augment) just fills in
 * parts of this record.
 */
import type { StoredDoc } from "../vendor/arag-platform/src/index.ts";

/** A single extracted field with provenance and a model confidence. */
export interface ExtractedField {
  /** Stable machine key, e.g. "invoice_number". */
  key: string;
  /** Human label, e.g. "Invoice Number". */
  label: string;
  /** Normalised value (string/number/boolean/null) or array of those. */
  value: string | number | boolean | null | Array<string | number | boolean>;
  /** Raw value exactly as the model returned it, before normalisation. */
  raw?: string;
  /** 0..1 confidence the extractor assigned (heuristic when the model gives none). */
  confidence?: number;
  /** Optional page index (0-based) the value was found on. */
  page?: number;
}

/** How a quote was matched against the document's own extracted text. */
export type EvidenceVerification = "exact" | "normalised" | "unverified";

/**
 * A verbatim quote from the document that supports one extracted field's value, checked
 * against the extracted text rather than taken on trust. `verified` says how it matched;
 * `paragraphId`/`start`/`end` locate it so a UI can highlight the source.
 */
export interface Evidence {
  /** The `ExtractedField.key` this quote supports. */
  field: string;
  /** The quote exactly as the model returned it. */
  quote: string;
  verified: EvidenceVerification;
  /** Retrieval paragraph the quote falls in, when it could be located. */
  paragraphId?: string;
  /** Character offsets into the document's extracted text (exact matches only). */
  start?: number;
  end?: number;
}

/** A named entity surfaced by the entity-enrichment agent. */
export interface Entity {
  text: string;
  type: string; // PERSON | ORG | DATE | MONEY | LOCATION | EMAIL | …
  salience?: number;
}

/** A validation / normalisation note from the validator agent. */
export interface ValidationIssue {
  field: string;
  severity: "info" | "warning" | "error";
  message: string;
}

/**
 * Supported document classes the classifier can assign — the single source of truth.
 * `SCHEMAS` (services/schemas.ts) is typed `Record<DocType, ExtractionSchema>`, so a new
 * entry here fails to compile until its schema exists; `openapi.ts` builds its enums from
 * this same list, so the spec can never drift from the code.
 */
export const DOC_TYPE_VALUES = [
  "invoice",
  "receipt",
  "contract",
  "resume",
  "purchase_order",
  "medical_claim",
  "preauthorisation",
  "bank_statement",
  "form",
  "report",
  "generic",
] as const;

export type DocType = (typeof DOC_TYPE_VALUES)[number];

/** Lifecycle of a document in this service (not the ARAG resource status). */
export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

/** Metadata about how the record was produced. */
export interface RecordMeta {
  processedAt: string;
  /** Extraction schema name used (e.g. `invoice_extraction`). */
  schema: string;
  /** Generative model that produced the extraction. */
  model: string;
  /** Length of the extracted source text. */
  sourceChars?: number;
  /** Per-stage timings in ms. */
  durationsMs: Record<string, number>;
  /** Human label of the extraction config used (e.g. "invoice" or "Insurance Card"). */
  config?: string;
  /** True when the config was forced (auto-classification skipped). */
  forced?: boolean;
  /** ARAG stored search configuration that backed the extraction, when one was used. */
  searchConfiguration?: string;
  /** ARAG extract strategy applied at ingestion (images/PDFs only). */
  extractStrategy?: string;
  /**
   * Share of extracted fields that carry a quote verified against the document text
   * (0..1). `undefined` when nothing was extracted. This is the headline "can I trust
   * this record?" number.
   */
  groundingScore?: number;
  /**
   * Stages that failed during the run, as `"<stage>: <message>"`. Present only when at
   * least one stage failed: the pipeline degrades gracefully, so a `ready` record can
   * still be missing the output of a stage that errored.
   */
  stageErrors?: string[];
}

/** The canonical, format-agnostic record produced by a full pipeline run. */
export interface DocumentRecord extends StoredDoc {
  /** Document id — the same opaque string as the ARAG resource id. */
  id: string;
  /** ARAG resource id (surfaced explicitly per STANDARDS §2). */
  resourceId: string;
  /** Original (sanitised) filename. */
  filename: string;
  /** Detected MIME type. */
  contentType: string;
  /** Upload size in bytes. */
  bytes: number;
  /** Lifecycle status of the processing pipeline. */
  status: DocumentStatus;
  /** Job that produced (or is producing) this record. */
  jobId?: string;
  /** Classifier output. */
  docType: DocType;
  /** Classifier confidence 0..1. */
  docTypeConfidence?: number;
  /** Schema-driven extracted fields. */
  fields: ExtractedField[];
  /** Enriched named entities. */
  entities: Entity[];
  /** One-paragraph abstractive summary. */
  summary?: string;
  /** Short topic tags. */
  tags: string[];
  /** Validation / normalisation findings. */
  issues: ValidationIssue[];
  /** Verbatim quotes supporting the extracted fields, each checked against the document. */
  evidence: Evidence[];
  /** Error detail when `status === "failed"`. */
  error?: string;
  /** Pipeline + source metadata. */
  meta: RecordMeta;
}

/**
 * Pipeline stages, in order — these are the values `JobEvent.stage` can take.
 * Upload is not a stage: it happens synchronously in `POST /api/v1/documents` before the
 * job exists, so a caller that gets a 202 already knows the document reached the KB.
 */
export type StageName =
  | "process"
  | "classify"
  | "extract"
  | "entities"
  | "summary"
  | "validate"
  | "standardize";

export const STAGES: readonly StageName[] = [
  "process",
  "classify",
  "extract",
  "entities",
  "summary",
  "validate",
  "standardize",
] as const;
