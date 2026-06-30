/**
 * Shared types for the Document Intelligence pipeline.
 *
 * The end product of a pipeline run is a `DocRecord`: a canonical, format-agnostic
 * representation of one document. It is what gets serialized to JSON / XML / CSV and
 * what the UI renders. Everything upstream (ingest, classify, extract, augment) just
 * fills in parts of this record.
 */

/** A single extracted field with provenance and a model confidence. */
export interface ExtractedField {
  /** Stable machine key, e.g. "invoice_number". */
  key: string;
  /** Human label, e.g. "Invoice Number". */
  label: string;
  /** Normalized value (string/number/boolean/null) or array of those. */
  value: string | number | boolean | null | Array<string | number | boolean>;
  /** Raw value exactly as the model returned it, before normalization. */
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

/** A validation / normalization note from the validator agent. */
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
  | "form"
  | "report"
  | "generic";

/** The canonical, format-agnostic record produced by a full pipeline run. */
export interface DocRecord {
  /** ARAG resource id. */
  id: string;
  /** Original filename. */
  filename: string;
  /** Detected MIME type. */
  contentType: string;
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
  /** Validation / normalization findings. */
  issues: ValidationIssue[];
  /** Pipeline + source metadata. */
  meta: {
    processedAt: string;
    schema: string; // extraction schema name used
    model: string; // generative model
    sourceChars?: number; // length of extracted source text
    durationsMs: Record<string, number>; // per-stage timings
  };
}

/** Pipeline stages, in order. */
export type StageName =
  | "ingest"
  | "process"
  | "classify"
  | "extract"
  | "entities"
  | "summary"
  | "validate"
  | "standardize"
  | "done";

export interface StageEvent {
  stage: StageName;
  status: "start" | "ok" | "error" | "skip";
  /** Short human message for the UI. */
  message?: string;
  /** Stage duration in ms (on ok/error). */
  ms?: number;
  /** Arbitrary structured payload (partial record, counts, etc.). */
  data?: unknown;
}
