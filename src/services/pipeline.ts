/**
 * Pipeline orchestrator.
 *
 * Drives one document from a freshly-uploaded ARAG resource to a finished canonical
 * `DocumentRecord`. It runs inside a platform **job** (kind `process-document`), so every
 * stage is emitted as a `JobEvent` and streamed to clients over
 * `GET /api/v1/jobs/{id}/events` (SSE) — the SSE stream is a *view* of the job, not the
 * work itself, so a disconnecting client no longer kills (or keeps alive) the run.
 *
 *   process → classify → extract → entities → summary → validate → standardize
 *
 * Each stage is wrapped so a failure degrades gracefully: the run continues with the
 * best record it has rather than dying, and the failure is surfaced as a stage error.
 */
import type { AragClient, JobContext, Logger } from "../../vendor/arag-platform/src/index.ts";
import type { DocumentRecord, StageName } from "../types.ts";
import type { Agents } from "./agents.ts";
import { buildQuerySeed, fieldsFromObject, validateNormalize } from "./agents.ts";
import type { ConfigsService } from "./configs.ts";
import { type ExtractionSchema, schemaFor } from "./schemas.ts";

/** Input persisted on the job (so a job can be inspected long after it ran). */
export interface ProcessDocumentInput {
  documentId: string;
  resourceId: string;
  filename: string;
  contentType: string;
  /** `auto` (classify), `agent` (read DA-agent persisted fields), or a config id. */
  config: string;
}

export interface PipelineDeps {
  arag: AragClient;
  agents: Agents;
  configs: ConfigsService;
  log: Logger;
}

/**
 * Run the pipeline for one document, mutating and returning `record`.
 * `ctx` is the platform JobContext: `ctx.stage()` times each step and emits events.
 */
export async function runPipeline(
  record: DocumentRecord,
  input: ProcessDocumentInput,
  ctx: JobContext<ProcessDocumentInput>,
  deps: PipelineDeps,
): Promise<DocumentRecord> {
  const { resourceId } = input;
  const durations = record.meta.durationsMs;
  const useAgentFields = input.config === "agent";
  const forced = deps.configs.resolve(input.config);
  const stageErrors: string[] = [];
  /**
   * Wrapper around `ctx.stage` that does three things the pipeline needs:
   *   - records the stage duration on the *record* (`ctx.stage` only times the job);
   *   - collects failures so they can be surfaced on the record rather than only in the
   *     job's event log (a `soft` failure otherwise looks like "no fields in this
   *     document" to an API caller);
   *   - implements `soft` here rather than in `ctx.stage`, so the error still reaches
   *     this catch block. The emitted job events are identical either way.
   */
  const stage = async <T>(
    name: StageName,
    message: string,
    fn: () => Promise<T>,
    opts: { soft?: boolean; progress?: number } = {},
  ): Promise<T | undefined> => {
    const t0 = performance.now();
    try {
      return (await ctx.stage(name, message, fn, { progress: opts.progress })) as T | undefined;
    } catch (err) {
      stageErrors.push(`${name}: ${(err as Error).message}`);
      if (opts.soft) return undefined;
      throw err;
    } finally {
      durations[name] = Math.round(performance.now() - t0);
    }
  };

  // 1. Wait for ARAG to finish OCR/visual/layout/embedding processing, THEN wait until
  //    the resource is actually searchable. A resource's status flips to PROCESSED a few
  //    seconds BEFORE retrieval is ready — extracting too early yields empty results, so
  //    the pipeline gates on a cheap /find poll (`waitSearchable`) as well.
  //
  //    The extracted text is fetched in between: it is available as soon as the resource is
  //    PROCESSED, it is the query seed every later stage uses, and probing searchability
  //    with the document's own words hits far sooner than a generic probe query does.
  let sourceText = "";
  let seed = buildQuerySeed("", input.filename);
  await stage(
    "process",
    "Progress Agentic RAG is processing the document (OCR, visual layout, embeddings)…",
    async () => {
      await deps.arag.waitProcessed(resourceId, {
        intervalMs: 1500,
        signal: ctx.signal,
        onPoll: (status, attempt) =>
          ctx.emit("process", "progress", { message: `status: ${status} (poll ${attempt})` }),
      });
      sourceText = await deps.arag.extractedText(resourceId, { signal: ctx.signal }).catch(() => "");
      record.meta.sourceChars = sourceText.length;
      seed = buildQuerySeed(sourceText, input.filename);
      const searchable = await deps.arag.waitSearchable(resourceId, {
        query: seed,
        intervalMs: 1200,
        signal: ctx.signal,
        onPoll: () =>
          ctx.emit("process", "progress", { message: "indexing — waiting for search readiness…" }),
      });
      return { searchable, sourceChars: sourceText.length };
    },
    { soft: true, progress: 0.2 },
  );

  // 2a. Native path: read fields a Data Augmentation agent already persisted on the
  //     resource (configured in the ARAG dashboard). Falls back to live extraction.
  let agentHandled = false;
  if (useAgentFields) {
    const persisted = await stage(
      "classify",
      "Reading fields written by the ARAG Data Augmentation agent…",
      () => deps.agents.readPersistedFields(resourceId, { signal: ctx.signal }),
      { soft: true, progress: 0.35 },
    );
    if (persisted && Object.keys(persisted).length) {
      record.docType = "generic";
      record.meta.config = "ARAG DA agent (persisted)";
      record.meta.forced = true;
      record.meta.schema = "da_agent";
      const fields = fieldsFromObject(persisted);
      durations.extract = 0;
      ctx.emit("extract", "ok", { ms: 0, message: "Loaded persisted agent fields", progress: 0.6 });
      record.fields = fields;
      agentHandled = true;
    } else {
      ctx.emit("classify", "skip", {
        message: "No DA-agent fields on this resource yet — using live extraction.",
      });
    }
  }

  // 2b. Choose the extraction config. If one was forced, skip auto-classification and
  //     use it directly; otherwise an agent classifies the document.
  let schema: ExtractionSchema = schemaFor(record.docType);
  if (agentHandled) {
    // fields already loaded from the DA agent; classify/extract are skipped below
  } else if (forced) {
    ctx.emit("classify", "skip", {
      message: `Using "${forced.label}" config — auto-classification skipped`,
      data: { docType: forced.schema.docType, forced: true },
      progress: 0.35,
    });
    schema = forced.schema;
    record.docType = forced.schema.docType;
    record.meta.config = forced.label;
    record.meta.forced = true;
  } else {
    const cls = await stage(
      "classify",
      "Classifying document type…",
      () => deps.agents.classify(resourceId, seed, ctx.signal),
      { soft: true, progress: 0.35 },
    );
    if (cls) {
      record.docType = cls.docType;
      record.docTypeConfidence = cls.confidence;
    }
    schema = schemaFor(record.docType);
    record.meta.config = record.docType;
    record.meta.forced = false;
  }
  if (!agentHandled) {
    record.meta.schema = schema.name;
    record.meta.searchConfiguration = `dip_${schema.name}`;
  }

  // 3. Schema-driven visual-LLM extraction (the core step). Retry once if the first
  //    pass comes back empty — guards against residual indexing lag. Skipped when the
  //    DA-agent path already loaded persisted fields.
  if (!agentHandled) {
    const fields = await stage(
      "extract",
      `Extracting ${schema.docType.replace(/_/g, " ")} fields with the visual LLM…`,
      async () => {
        let f = await deps.agents.extractFields(resourceId, schema, seed, ctx.signal);
        if (f.length === 0) {
          await sleep(2500, ctx.signal);
          f = await deps.agents.extractFields(resourceId, schema, seed, ctx.signal);
        }
        return f;
      },
      { soft: true, progress: 0.6 },
    );
    record.fields = fields ?? [];
  }

  // 4. Entity enrichment then summarisation — run SEQUENTIALLY, not concurrently.
  //    Two simultaneous full_resource generations against the same resource make one
  //    of them return empty; sequencing trades ~2 s of latency for reliability.
  const entities = await stage(
    "entities",
    "Surfacing named entities…",
    async () => {
      let e = await deps.agents.enrichEntities(resourceId, seed, ctx.signal);
      if (e.length === 0) {
        await sleep(1200, ctx.signal);
        e = await deps.agents.enrichEntities(resourceId, seed, ctx.signal);
      }
      return e;
    },
    { soft: true, progress: 0.75 },
  );
  record.entities = entities ?? [];

  const summ = await stage(
    "summary",
    "Summarising and tagging…",
    () => deps.agents.summarize(resourceId, seed, ctx.signal),
    { soft: true, progress: 0.85 },
  );
  if (summ) {
    record.summary = summ.summary;
    record.tags = summ.tags;
  }

  // 5. Deterministic validation + normalisation (no model call).
  await stage(
    "validate",
    "Normalising values and validating consistency…",
    async () => {
      // For the DA-agent path the field keys are user-defined, so skip schema-required
      // checks (no fixed schema); still normalise amounts/dates and check arithmetic.
      const valSchema = agentHandled ? { ...schema, required: [] } : schema;
      const { fields: normalized, issues } = validateNormalize(record.fields, valSchema);
      record.fields = normalized;
      record.issues = issues;
      return { issues: issues.length };
    },
    { soft: true, progress: 0.95 },
  );

  // 6. Standardise — the record is ready for JSON/XML/CSV serialisation.
  record.meta.processedAt = new Date().toISOString();
  record.status = "ready";
  // A soft stage failure must not look like "this document simply had no fields":
  // surface it on the record itself so an API caller never has to read job events.
  if (stageErrors.length) {
    record.meta.stageErrors = stageErrors;
    for (const message of stageErrors) {
      const [field] = message.split(":");
      record.issues.push({ field: field ?? "pipeline", severity: "error", message });
    }
  }

  durations.standardize = 0;
  ctx.emit("standardize", "ok", {
    message: "Canonical record ready (JSON · XML · CSV)",
    data: { fields: record.fields.length },
    progress: 1,
  });
  deps.log.info("pipeline.done", {
    documentId: record.id,
    docType: record.docType,
    fields: record.fields.length,
    entities: record.entities.length,
    issues: record.issues.length,
  });
  return record;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("cancelled"));
      },
      { once: true },
    );
  });
}
