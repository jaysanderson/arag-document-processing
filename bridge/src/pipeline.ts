/**
 * Pipeline orchestrator.
 *
 * Drives one document from a freshly-uploaded ARAG resource to a finished canonical
 * `DocRecord`, emitting a `StageEvent` at the start and end of every stage so the UI
 * can render live progress (the server forwards these over SSE).
 *
 *   process → classify → extract → (entities ∥ summary) → validate → standardize
 *
 * Each stage is wrapped so a failure degrades gracefully: the run continues with the
 * best record it has rather than dying, and the failure is surfaced as a stage error.
 */

import { waitProcessed, waitSearchable, extractedText, readPersistedFields } from "./arag.ts";
import {
  classify,
  extractFields,
  enrichEntities,
  summarize,
  validateNormalize,
  emptyRecord,
  buildQuerySeed,
  fieldsFromObject,
} from "./agents.ts";
import { schemaFor, type ExtractionSchema } from "./schemas.ts";
import { log } from "./logger.ts";
import type { DocRecord, StageEvent } from "./types.ts";

export type Emit = (e: StageEvent) => void;

interface PipelineInput {
  resourceId: string;
  filename: string;
  contentType: string;
  /** When set, auto-classification is skipped and this extraction config is used. */
  forcedSchema?: ExtractionSchema;
  /** Human label for the forced config (shown in the UI). */
  configLabel?: string;
  /**
   * Read fields a Data Augmentation agent persisted on the resource instead of running
   * /ask extraction. Falls back to auto extraction if no agent output is present.
   */
  useAgentFields?: boolean;
}

/** Run a single async stage, timing it and emitting start/ok|error events. */
async function stage<T>(
  emit: Emit,
  name: StageEvent["stage"],
  message: string,
  fn: () => Promise<T>,
  durations: Record<string, number>,
): Promise<T | undefined> {
  emit({ stage: name, status: "start", message });
  const t0 = performance.now();
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - t0);
    durations[name] = ms;
    emit({ stage: name, status: "ok", ms, data: result });
    return result;
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    durations[name] = ms;
    log.error("pipeline.stage.error", { stage: name, message: (err as Error).message });
    emit({ stage: name, status: "error", ms, message: (err as Error).message });
    return undefined;
  }
}

export async function runPipeline(input: PipelineInput, emit: Emit): Promise<DocRecord> {
  const record = emptyRecord(input.resourceId, input.filename, input.contentType);
  const durations = record.meta.durationsMs;

  // 1. Wait for ARAG to finish OCR/visual/layout/embedding processing, THEN wait until
  //    the resource is actually searchable (status flips to PROCESSED a few seconds
  //    before retrieval is ready — extracting too early yields empty results).
  await stage(
    emit,
    "process",
    "Progress Agentic RAG is processing the document (OCR, visual layout, embeddings)…",
    async () => {
      await waitProcessed(input.resourceId, {
        onPoll: (status, attempt) =>
          emit({ stage: "process", status: "start", message: `status: ${status} (poll ${attempt})` }),
      });
      const searchable = await waitSearchable(input.resourceId, {
        onPoll: () => emit({ stage: "process", status: "start", message: "indexing — waiting for search readiness…" }),
      });
      return { searchable };
    },
    durations,
  );

  // Seed for all retrieval queries, taken from the document's own extracted text. With
  // the full_resource strategy the model gets the whole document, but retrieval still
  // runs first to locate it — seeding with real vocabulary guarantees that hit.
  const sourceText = await extractedText(input.resourceId).catch(() => "");
  record.meta.sourceChars = sourceText.length;
  const seed = buildQuerySeed(sourceText, input.filename);

  // 2a. Native path: read fields a Data Augmentation agent already persisted on the
  //     resource (configured in the ARAG dashboard). Falls back to live extraction.
  let agentHandled = false;
  if (input.useAgentFields) {
    const persisted = await stage(
      emit,
      "classify",
      "Reading fields written by the ARAG Data Augmentation agent…",
      () => readPersistedFields(input.resourceId),
      durations,
    );
    if (persisted && Object.keys(persisted).length) {
      record.docType = "generic";
      record.meta.config = "ARAG DA agent (persisted)";
      record.meta.forced = true;
      record.meta.schema = "da_agent";
      const f = fieldsFromObject(persisted);
      durations.extract = 0;
      emit({ stage: "extract", status: "ok", ms: 0, message: "Loaded persisted agent fields", data: f });
      record.fields = f;
      agentHandled = true;
    } else {
      emit({ stage: "classify", status: "start", message: "No DA-agent fields on this resource yet — using live extraction." });
    }
  }

  // 2b. Choose the extraction config. If one was forced, skip auto-classification and
  //     use it directly; otherwise an agent classifies the document.
  let schema: ExtractionSchema = schemaFor(record.docType);
  if (agentHandled) {
    // fields already loaded from the DA agent; skip classify/extract below
  } else if (input.forcedSchema) {
    const label = input.configLabel ?? input.forcedSchema.name;
    emit({
      stage: "classify",
      status: "skip",
      message: `Using "${label}" config — auto-classification skipped`,
      data: { docType: input.forcedSchema.docType, forced: true },
    });
    schema = input.forcedSchema;
    record.docType = input.forcedSchema.docType;
    record.meta.config = label;
    record.meta.forced = true;
  } else {
    const cls = await stage(emit, "classify", "Classifying document type…", () => classify(input.resourceId, seed), durations);
    if (cls) {
      record.docType = cls.docType;
      record.docTypeConfidence = cls.confidence;
    }
    schema = schemaFor(record.docType);
    record.meta.config = record.docType;
    record.meta.forced = false;
  }
  if (!agentHandled) record.meta.schema = schema.name;

  // 3. Schema-driven visual-LLM extraction (the core step). Retry once if the first
  //    pass comes back empty — guards against residual indexing lag. Skipped when the
  //    DA-agent path already loaded persisted fields.
  if (!agentHandled) {
    const fields = await stage(
      emit,
      "extract",
      `Extracting ${schema.docType} fields with the visual LLM…`,
      async () => {
        let f = await extractFields(input.resourceId, schema, seed);
        if (f.length === 0) {
          await new Promise((r) => setTimeout(r, 2500));
          f = await extractFields(input.resourceId, schema, seed);
        }
        return f;
      },
      durations,
    );
    record.fields = fields ?? [];
  }

  // 4. Entity enrichment then summarization — run SEQUENTIALLY, not concurrently.
  //    Two simultaneous full_resource generations against the same resource make one
  //    of them return empty; sequencing trades ~2s of latency for reliability.
  const entities = await stage(
    emit,
    "entities",
    "Surfacing named entities…",
    async () => {
      let e = await enrichEntities(input.resourceId, seed);
      if (e.length === 0) {
        await new Promise((r) => setTimeout(r, 1200));
        e = await enrichEntities(input.resourceId, seed);
      }
      return e;
    },
    durations,
  );
  const summ = await stage(emit, "summary", "Summarizing and tagging…", () => summarize(input.resourceId, seed), durations);
  record.entities = entities ?? [];
  if (summ) {
    record.summary = summ.summary;
    record.tags = summ.tags;
  }

  // 5. Deterministic validation + normalization (no model call).
  await stage(
    emit,
    "validate",
    "Normalizing values and validating consistency…",
    async () => {
      // For the DA-agent path the field keys are user-defined, so skip schema-required
      // checks (no fixed schema); still normalize amounts/dates and arithmetic.
      const valSchema = agentHandled ? { ...schema, required: [] } : schema;
      const { fields: normalized, issues } = validateNormalize(record.fields, valSchema);
      record.fields = normalized;
      record.issues = issues;
      return { issues: issues.length };
    },
    durations,
  );

  // 6. Standardize — record is ready for JSON/XML/CSV serialization.
  record.meta.processedAt = new Date().toISOString();
  emit({ stage: "standardize", status: "ok", message: "Canonical record ready (JSON · XML · CSV)", data: { fields: record.fields.length } });
  emit({ stage: "done", status: "ok", data: record });
  log.info("pipeline.done", {
    resourceId: input.resourceId,
    docType: record.docType,
    fields: record.fields.length,
    entities: record.entities.length,
    issues: record.issues.length,
  });
  return record;
}
