/**
 * Human review: correcting an extracted value, and asking a question across the corpus
 * rather than one document.
 *
 * Both were on the deferred list from the previous pass (field correction, cross-document
 * ask). They belong together because they are the two places a person acts on the whole
 * set of records rather than on one field the pipeline produced:
 *
 *   - `correctField` is the honest answer to "the model got this wrong". The correction
 *     never silently overwrites the model's output: the original value, the original
 *     quote and who changed it are all kept, and the corrected value is re-checked against
 *     the document's own text with the same evidence contract the pipeline uses. A human
 *     typing a value does not make it grounded — but if the value they typed *is* in the
 *     document, that is worth knowing and worth showing.
 *
 *   - `askCorpus` is the same grounded ask the record view offers, with the resource
 *     filter widened from one document to a filtered set of them. Citations come back
 *     mapped to this product's document ids, so "show me where" still works across
 *     documents.
 */

import type { AragClient, Logger, PlatformEnv } from "../../vendor/arag-platform/src/index.ts";
import type {
  DocumentRecord,
  Evidence,
  EvidenceVerification,
  FieldCorrection,
  FieldValue,
} from "../types.ts";
import { groundingScore, normaliseQuote } from "./agents.ts";
import type { DocumentsService } from "./documents.ts";

export type { FieldCorrection, FieldValue };

/**
 * A `DocumentRecord` that has been through review.
 *
 * `corrections` now lives on `DocumentRecord` itself (a correction is part of the
 * canonical record, not a side table), so this is a plain alias kept for the call sites
 * and tests that name the reviewed shape explicitly.
 */
export type ReviewedRecord = DocumentRecord;

/** Written back to the Knowledge Box when a correction lands, if a kv schema exists. */
export type KvWriteback = (
  record: DocumentRecord,
  correction: Pick<FieldCorrection, "field" | "value">,
) => Promise<NonNullable<FieldCorrection["kv"]>>;

export interface ReviewDeps {
  arag: AragClient;
  documents: DocumentsService;
  env: PlatformEnv;
  log: Logger;
  generativeModel: string;
  /** Optional: writes the corrected value into the resource's key-value field. */
  kvWriteback?: KvWriteback;
  /** Optional: records the change in the audit log. */
  audit?: (entry: { actor: string; action: string; target: string; before: unknown; after: unknown }) => void;
}

/** Answer to a question asked across more than one document. */
export interface CorpusAnswer {
  answer: string;
  /** How the corpus was narrowed, echoed back so the UI can say what was searched. */
  scope: { documents: number; filters: Record<string, unknown> };
  /**
   * Retrieval paragraphs behind the answer, each carrying the *product* document id so a
   * UI can link straight to `#/documents/{documentId}/source`.
   */
  citations: Array<{
    documentId: string;
    filename: string;
    docType: string;
    paragraphId: string;
    text: string;
    start?: number;
    end?: number;
  }>;
  /** Distinct documents the citations came from, in citation order. */
  documents: Array<{ id: string; filename: string; docType: string; citations: number }>;
  ms: number;
}

/** Paragraphs from an `/ask` retrieval, keeping the resource id each one came from. */
export function paragraphsByResource(
  retrieval: unknown,
): Array<{ resourceId: string; id: string; text?: string; start?: number; end?: number }> {
  const resources = (retrieval as { resources?: Record<string, unknown> } | undefined)?.resources ?? {};
  const out: Array<{ resourceId: string; id: string; text?: string; start?: number; end?: number }> = [];
  for (const [rid, resource] of Object.entries(resources)) {
    const fields = (resource as { fields?: Record<string, unknown> }).fields ?? {};
    for (const field of Object.values(fields)) {
      const paragraphs = (field as { paragraphs?: Record<string, unknown> }).paragraphs ?? {};
      for (const [id, paragraph] of Object.entries(paragraphs)) {
        const p = paragraph as { text?: string; position?: { start?: number; end?: number } };
        out.push({ resourceId: rid, id, text: p.text, start: p.position?.start, end: p.position?.end });
      }
    }
  }
  return out;
}

/**
 * Re-check a corrected value against the document's own extracted text, with exactly the
 * three outcomes `verifyEvidence` uses. A number or boolean is compared as its printed
 * form; an array is verified only if every element is found.
 */
export function verifyValue(
  value: FieldValue,
  sourceText: string,
): { verified: EvidenceVerification; quote: string; start?: number; end?: number } {
  const parts = (Array.isArray(value) ? value : [value])
    .map((v) => (v === null || v === undefined ? "" : String(v).trim()))
    .filter(Boolean);
  const quote = parts.join(", ");
  if (!parts.length || !sourceText) return { verified: "unverified", quote };

  // Single value: an exact hit gives offsets a UI can highlight.
  if (parts.length === 1) {
    const at = sourceText.indexOf(parts[0]!);
    if (at !== -1) return { verified: "exact", quote: parts[0]!, start: at, end: at + parts[0]!.length };
    return normaliseQuote(sourceText).includes(normaliseQuote(parts[0]!))
      ? { verified: "normalised", quote: parts[0]! }
      : { verified: "unverified", quote: parts[0]! };
  }

  // Repeated value: every element has to be present for the whole to count as grounded,
  // and there is no single span to highlight, so no offsets are claimed.
  const normalised = normaliseQuote(sourceText);
  const allExact = parts.every((p) => sourceText.includes(p));
  if (allExact) return { verified: "exact", quote };
  const allNormalised = parts.every((p) => normalised.includes(normaliseQuote(p)));
  return { verified: allNormalised ? "normalised" : "unverified", quote };
}

/**
 * Apply a correction to a record, returning the new record and the correction entry.
 * Pure apart from the timestamp, so it is unit-testable without a store or a Knowledge Box.
 */
export function applyCorrection(
  record: ReviewedRecord,
  input: { field: string; value: FieldValue; reason?: string; actor: string },
  opts: { sourceText: string; now?: string },
): { record: ReviewedRecord; correction: FieldCorrection } {
  const idx = record.fields.findIndex((f) => f.key === input.field);
  if (idx === -1) throw new Error(`unknown field: ${input.field}`);
  const field = record.fields[idx]!;
  const check = verifyValue(input.value, opts.sourceText);

  const correction: FieldCorrection = {
    field: field.key,
    label: field.label,
    previousValue: field.value,
    value: input.value,
    actor: input.actor,
    at: opts.now ?? new Date().toISOString(),
    verified: check.verified,
  };
  if (input.reason) correction.reason = input.reason;

  const fields = [...record.fields];
  fields[idx] = {
    ...field,
    value: input.value,
    // A human-set value has no model confidence. Claiming the model's old confidence for
    // a value the model did not produce would be a lie on the most-read number in the UI.
    confidence: undefined,
    raw: undefined,
  };

  // The old quote supported the old value, so it cannot stand. If the corrected value is
  // in the document, the correction earns a new quote; if it is not, the field is honestly
  // left with none and the grounding score drops.
  const evidence: Evidence[] = record.evidence.filter((e) => e.field !== field.key);
  if (check.verified !== "unverified") {
    const item: Evidence = { field: field.key, quote: check.quote, verified: check.verified };
    if (check.start !== undefined) {
      item.start = check.start;
      item.end = check.end;
    }
    evidence.push(item);
  }

  return {
    record: {
      ...record,
      fields,
      evidence,
      corrections: [...(record.corrections ?? []), correction],
    },
    correction,
  };
}

export class ReviewService {
  private readonly d: ReviewDeps;

  constructor(deps: ReviewDeps) {
    this.d = deps;
  }

  /**
   * Correct one extracted field on a record. Re-verifies the new value against the
   * document text, recomputes the grounding score, writes the value back into the
   * Knowledge Box key-value field when a kv schema is provisioned, and audits the change.
   */
  async correctField(
    id: string,
    input: { field: string; value: FieldValue; reason?: string; actor: string },
  ): Promise<{ document: ReviewedRecord; correction: FieldCorrection }> {
    const current = this.d.documents.require(id) as ReviewedRecord;
    // Best effort: a document whose text cannot be fetched still accepts the correction,
    // it just cannot claim the value is grounded.
    const sourceText = await this.d.documents
      .text(id)
      .then((t) => t.text)
      .catch(() => "");

    const { record, correction } = applyCorrection(current, input, { sourceText });
    // Ruling: a corrected field is NOT excluded from the grounding score — that would
    // silently move the number the product quotes. It stays in the denominator and counts
    // in the numerator only when the corrected value is itself verified against the
    // document, which `applyCorrection` has already decided by rebuilding the evidence.
    // `correctedFields` is reported alongside so the record view can say "12 of 12 carry a
    // verified quote · 1 corrected by a reviewer" instead of quietly changing the goalposts.
    record.meta = {
      ...record.meta,
      groundingScore: groundingScore(record.fields, record.evidence),
      correctedFields: new Set((record.corrections ?? []).map((c) => c.field)).size,
    };

    if (this.d.kvWriteback) {
      correction.kv = await this.d
        .kvWriteback(record, { field: correction.field, value: correction.value })
        .catch((err) => ({ written: false, error: (err as Error).message }));
      record.corrections = [...(record.corrections ?? []).slice(0, -1), correction];
    }

    const saved = this.d.documents.replace(record);
    this.d.audit?.({
      actor: input.actor,
      action: "document.field.correct",
      target: `${id}#${input.field}`,
      before: correction.previousValue,
      after: correction.value,
    });
    this.d.log.info("document.field.correct", {
      id,
      field: input.field,
      verified: correction.verified,
      kv: correction.kv?.written ?? null,
    });
    return { document: saved as ReviewedRecord, correction };
  }

  /** Undo the most recent correction to a field, restoring the value it replaced. */
  async revertField(
    id: string,
    field: string,
    actor: string,
  ): Promise<{ document: ReviewedRecord; correction: FieldCorrection }> {
    const current = this.d.documents.require(id) as ReviewedRecord;
    const last = [...(current.corrections ?? [])].reverse().find((c) => c.field === field);
    if (!last) throw new Error(`no correction to revert for field: ${field}`);
    return await this.correctField(id, {
      field,
      value: last.previousValue,
      reason: `Reverted the correction made at ${last.at}`,
      actor,
    });
  }

  /**
   * Ask one grounded question across a filtered set of documents.
   *
   * The filter is the Documents list's own filter, so "ask the 12 invoices from last week"
   * is the list you are already looking at. With no filter it is the whole corpus, capped
   * at `maxResources` so a single ask cannot fan out over an unbounded Knowledge Box.
   */
  async askCorpus(
    question: string,
    opts: {
      filters?: Partial<Parameters<DocumentsService["list"]>[0]>;
      maxResources?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<CorpusAnswer> {
    const maxResources = Math.max(1, Math.min(opts.maxResources ?? 50, 200));
    const page = this.d.documents.list({
      ...(opts.filters ?? {}),
      page: 1,
      pageSize: maxResources,
      status: "ready",
    } as Parameters<DocumentsService["list"]>[0]);
    const records = page.items as DocumentRecord[];
    if (!records.length) {
      return {
        answer: "",
        scope: { documents: 0, filters: (opts.filters ?? {}) as Record<string, unknown> },
        citations: [],
        documents: [],
        ms: 0,
      };
    }

    const byResource = new Map(records.map((r) => [r.resourceId, r]));
    const res = await this.d.arag.ask(
      {
        query: question,
        citations: true,
        resource_filters: records.map((r) => r.resourceId),
        // No `full_resource`: across dozens of documents that is an enormous prompt and a
        // slow, expensive call. Retrieval over the filtered set is what makes this useful.
        prompt: {
          system:
            "Answer using only the provided documents. Cite the documents you used. If the answer is not in them, say you don't have that information.",
        },
        temperature: 0,
        max_tokens: 600,
        generative_model: this.d.generativeModel || undefined,
        reranker: this.d.env.arag.reranker,
      },
      { signal: opts.signal },
    );

    const cited = new Set(Object.keys(res.citations ?? {}));
    const paragraphs = paragraphsByResource(res.retrieval).filter((p) => cited.size === 0 || cited.has(p.id));
    const citations: CorpusAnswer["citations"] = [];
    const seen = new Map<string, { id: string; filename: string; docType: string; citations: number }>();
    for (const p of paragraphs.slice(0, 24)) {
      const rec = byResource.get(p.resourceId);
      if (!rec) continue;
      citations.push({
        documentId: rec.id,
        filename: rec.filename,
        docType: rec.docType,
        paragraphId: p.id,
        text: (p.text ?? "").slice(0, 600),
        start: p.start,
        end: p.end,
      });
      const entry = seen.get(rec.id) ?? {
        id: rec.id,
        filename: rec.filename,
        docType: rec.docType,
        citations: 0,
      };
      entry.citations++;
      seen.set(rec.id, entry);
    }

    return {
      answer: res.answerText,
      scope: { documents: records.length, filters: (opts.filters ?? {}) as Record<string, unknown> },
      citations,
      documents: [...seen.values()],
      ms: res.timings.totalMs,
    };
  }
}
