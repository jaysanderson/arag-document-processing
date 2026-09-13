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

/** The value shapes an extracted field can hold. */
export type FieldValue = ExtractedField["value"];

/**
 * One human correction to one extracted field, kept forever on the record.
 *
 * Declared here rather than in `services/review.ts` because the record type carries it:
 * a correction is part of the canonical record, not a side table. `verified` is the
 * corrected value re-checked against the document's extracted text with the same three
 * outcomes the pipeline's evidence contract uses — a corrected value that cannot be found
 * in the document is `unverified`, which is the truth and is what the record view shows.
 */
export interface FieldCorrection {
  /** `ExtractedField.key` that was corrected. */
  field: string;
  /** Human label at the time of the correction. */
  label: string;
  /** What the pipeline (or an earlier correction) had. */
  previousValue: FieldValue;
  /** What the reviewer set it to. */
  value: FieldValue;
  /** Why, in the reviewer's words. Optional but strongly encouraged by the UI. */
  reason?: string;
  /** Who: an API key name, `session`, or `admin`. Never a credential. */
  actor: string;
  /** ISO instant. */
  at: string;
  /** How the corrected value matched the document's own text. */
  verified: EvidenceVerification;
  /** Whether the corrected value reached the Knowledge Box key-value field. */
  kv?: {
    written: boolean;
    schemaId?: string;
    fieldId?: string;
    error?: string;
    /**
     * True when this write superseded a value already written for this resource. The
     * Knowledge Box's filter index keeps every value ever written to a field, so the
     * resource still matches a filter on the value this correction replaced.
     */
    filterIndexStale?: boolean;
  };
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

/**
 * One value the Knowledge Box refused, normalised out of ARAG's two 422 dialects by
 * `kvErrorFrom()`. This is the product's own "the KB rejected this value" signal: it names
 * the field, what the schema expected and what was supplied, so the record view can say
 * why a field is missing from the Knowledge Box rather than showing an upstream blob.
 */
export interface KvRejection {
  /** Product property name, when the error identifies one. */
  field?: string;
  /** Normalised `KvErrorKind` — `type_mismatch`, `missing_required`, `unknown_key`, … */
  kind: string;
  message: string;
  expected?: string;
  got?: string;
}

/**
 * What the pipeline (or a reviewer's correction) wrote into the resource's key-value field.
 *
 * `values` is the data exactly as it reached the Knowledge Box, keyed by kv field key;
 * `fields` maps the product's property names onto those keys, so the JSON tab can render
 * the kv schema and the written values side by side without a second call.
 *
 * `filterIndexStale` is the honest half. Overwriting a kv value does not remove the old
 * value from the Knowledge Box's filter index — the index accumulates every value ever
 * written to that field on that resource, and there is no purge call. Once a second write
 * has happened, a filter on a superseded value still matches this resource, and the UI is
 * told so rather than being left to imply the index is clean.
 */
export interface KvWriteRecord {
  /** kv schema the values were written under. */
  schemaId: string;
  /** True when ARAG accepted the write. */
  written: boolean;
  /** ISO instant of the last write attempt. */
  at: string;
  /** Number of keys actually written. */
  fields: number;
  /** product property name → kv field key. */
  keys?: Record<string, string>;
  /** kv field key → value, exactly as written. */
  values?: Record<string, unknown>;
  /** Extracted values that could not be represented in the schema, and why. */
  skipped?: Array<{ field: string; reason: string }>;
  /** Values the Knowledge Box refused with a 422. */
  rejected?: KvRejection[];
  /** Why the write did not happen at all (no schema provisioned, transport failure, …). */
  error?: string;
  /** How many times this resource's kv field has been written. */
  writes?: number;
  /** True once `writes > 1`: the KB filter index also matches every superseded value. */
  filterIndexStale?: boolean;
  /** The values this resource still matches a filter on despite having been replaced. */
  superseded?: Array<{ field: string; value: unknown }>;
}

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
   * Name of the ARAG resource file field the original bytes were stored in (`file` for an
   * `/upload`). Kept so `GET /documents/{id}/source` can stream the page a reviewer wants
   * to see rather than guessing at the field name.
   */
  fileField?: string;
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
  /**
   * How many of this record's fields a reviewer has corrected. A corrected field stays in
   * `groundingScore`'s denominator and counts in its numerator only when the corrected
   * value is itself verified against the document — so the headline number never moves
   * because someone edited a field. This count is what lets the record view say
   * "12 of 12 fields carry a verified quote · 1 corrected by a reviewer".
   */
  correctedFields?: number;
  /** What reached the Knowledge Box's key-value field for this resource. */
  kv?: KvWriteRecord;
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
  /** Human corrections to extracted fields, oldest first. Never discarded. */
  corrections?: FieldCorrection[];
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
