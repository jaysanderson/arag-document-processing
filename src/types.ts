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

/** Supported document classes the classifier can assign. */
export type DocType =
  | "invoice"
  | "receipt"
  | "contract"
  | "resume"
  | "purchase_order"
  | "medical_claim"
  | "preauthorisation"
  | "bank_statement"
  | "form"
  | "report"
  | "generic";

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
  /** Error detail when `status === "failed"`. */
  error?: string;
  /** Pipeline + source metadata. */
  meta: RecordMeta;
}

/** Pipeline stages, in order. `JobEvent.stage` uses these names. */
export type StageName =
  | "ingest"
  | "process"
  | "classify"
  | "extract"
  | "entities"
  | "summary"
  | "validate"
  | "standardize";

export const STAGES: StageName[] = [
  "ingest",
  "process",
  "classify",
  "extract",
  "entities",
  "summary",
  "validate",
  "standardize",
];
