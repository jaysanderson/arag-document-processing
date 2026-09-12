/**
 * Document domain logic: upload → job → canonical record → export / ask / delete.
 * No HTTP types here; routes are thin wrappers over this service.
 */
import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import {
  type AragClient,
  badRequest,
  type Collection,
  type Job,
  type JobManager,
  type Logger,
  notFound,
  type PlatformEnv,
  payloadTooLarge,
  type Store,
  unsupportedMediaType,
} from "../../vendor/arag-platform/src/index.ts";
import type { DocumentRecord } from "../types.ts";
import type { Agents } from "./agents.ts";
import type { ConfigsService } from "./configs.ts";
import { type Format, MIME, serialize } from "./formats.ts";
import { type ProcessDocumentInput, runPipeline } from "./pipeline.ts";

/** Upload MIME allowlist. Anything else is rejected with 415 before it reaches the KB. */
export const ALLOWED_MIME: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/tiff": [".tif", ".tiff"],
  "text/plain": [".txt", ".text"],
  "text/markdown": [".md", ".markdown"],
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
};

const EXT_TO_MIME: Record<string, string> = Object.entries(ALLOWED_MIME).reduce<Record<string, string>>(
  (acc, [mime, exts]) => {
    for (const e of exts) acc[e] = mime;
    return acc;
  },
  {},
);

/**
 * Strip directory components, control characters and anything outside a conservative
 * allowlist from a client-supplied filename. The prototype forwarded `X-Filename`
 * straight into `Content-Disposition`; this is the fix.
 */
export function sanitiseFilename(input: string | undefined): string {
  const base = basename(String(input ?? "").replace(/\\/g, "/")).trim();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^A-Za-z0-9._ -]/g, "_");
  const safe = cleaned.replace(/^[.\s]+/, "").slice(0, 120);
  return safe || "document";
}

/** Resolve the effective content type: the declared one, else guessed from the extension. */
export function resolveContentType(declared: string | undefined, filename: string): string {
  const ct = (declared ?? "").split(";")[0]!.trim().toLowerCase();
  if (ct && ct !== "application/octet-stream" && ct in ALLOWED_MIME) return ct;
  const guessed = EXT_TO_MIME[extname(filename).toLowerCase()];
  if (guessed) return guessed;
  return ct || "application/octet-stream";
}

export interface DocumentsDeps {
  arag: AragClient;
  store: Store;
  jobs: JobManager;
  configs: ConfigsService;
  agents: Agents;
  env: PlatformEnv;
  log: Logger;
  /** ARAG extract strategy id (DIP_EXTRACT_STRATEGY / ARAG_EXTRACT_STRATEGY). */
  extractStrategy: string;
  /** Max upload size in bytes. */
  maxUploadBytes: number;
  /** Generative model recorded on records. */
  generativeModel: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  next_page: boolean;
}

export class DocumentsService {
  private readonly d: DocumentsDeps;
  private readonly col: Collection<DocumentRecord>;

  constructor(deps: DocumentsDeps) {
    this.d = deps;
    this.col = deps.store.collection<DocumentRecord>("documents");
    deps.jobs.register<ProcessDocumentInput, { documentId: string; fields: number }>(
      "process-document",
      async (ctx) => {
        const stored = this.col.get(ctx.job.input.documentId);
        if (!stored) throw new Error(`document ${ctx.job.input.documentId} not found`);
        // Replace rather than mutate: the object returned by `create()` may still be being
        // serialised into the 202 response, and must keep reporting status "pending".
        const record = this.col.put({ ...stored, status: "processing" });
        try {
          const done = await runPipeline(record, ctx.job.input, ctx, {
            arag: deps.arag,
            agents: deps.agents,
            configs: deps.configs,
            log: deps.log,
          });
          this.col.put(done);
          return { documentId: done.id, fields: done.fields.length };
        } catch (err) {
          this.col.put({ ...record, status: "failed", error: (err as Error).message });
          throw err;
        }
      },
    );
  }

  /**
   * Upload bytes into the Knowledge Box and queue the processing job.
   * Throws HttpErrors (415/413/400) for invalid input before anything reaches ARAG.
   */
  async create(input: {
    bytes: Buffer;
    filename: string | undefined;
    contentType: string | undefined;
    config?: string;
  }): Promise<{ document: DocumentRecord; job: Job }> {
    const filename = sanitiseFilename(input.filename);
    const contentType = resolveContentType(input.contentType, filename);
    if (!input.bytes || input.bytes.length === 0) throw badRequest("Empty upload body");
    if (input.bytes.length > this.d.maxUploadBytes) throw payloadTooLarge(this.d.maxUploadBytes);
    if (!(contentType in ALLOWED_MIME)) {
      throw unsupportedMediaType(
        `Content type "${contentType}" is not accepted. Allowed: ${Object.keys(ALLOWED_MIME).join(", ")}`,
      );
    }
    const config = (input.config ?? "auto").trim() || "auto";
    if (config !== "auto" && config !== "agent" && !this.d.configs.resolve(config)) {
      throw badRequest(`Unknown extraction config "${config}"`);
    }

    // Images and PDFs get the ingestion-time visual-LLM extract strategy when one is
    // configured; text/office files use ARAG's default processing.
    const useStrategy =
      !!this.d.extractStrategy && (contentType.startsWith("image/") || contentType === "application/pdf");
    const { uuid } = await this.d.arag.upload(input.bytes, filename, contentType, {
      extractStrategy: useStrategy ? this.d.extractStrategy : undefined,
    });

    // Allocate the job id up front so the stored record references its job from the
    // first write (the job may start on the next microtask).
    const jobId = randomUUID();
    const record = this.col.put({
      id: uuid,
      resourceId: uuid,
      jobId,
      filename,
      contentType,
      bytes: input.bytes.length,
      status: "pending",
      docType: "generic",
      fields: [],
      entities: [],
      tags: [],
      issues: [],
      meta: {
        processedAt: new Date().toISOString(),
        schema: "generic_extraction",
        model: this.d.generativeModel || "KB default",
        durationsMs: {},
        extractStrategy: useStrategy ? this.d.extractStrategy : undefined,
      },
    });
    const jobInput: ProcessDocumentInput = {
      documentId: record.id,
      resourceId: uuid,
      filename,
      contentType,
      config,
    };
    const job = this.d.jobs.submit("process-document", jobInput, { ref: record.id, id: jobId });
    this.d.log.info("document.created", {
      documentId: record.id,
      jobId,
      contentType,
      bytes: input.bytes.length,
      config,
    });
    return { document: record, job: job as Job };
  }

  list(opts: { page: number; pageSize: number; status?: string; docType?: string }): Page<DocumentRecord> {
    const filter = (d: DocumentRecord) =>
      (!opts.status || d.status === opts.status) && (!opts.docType || d.docType === opts.docType);
    const total = this.col.list({ filter }).length;
    const items = this.col.list({ filter, offset: (opts.page - 1) * opts.pageSize, limit: opts.pageSize });
    return {
      items,
      page: opts.page,
      page_size: opts.pageSize,
      total,
      next_page: opts.page * opts.pageSize < total,
    };
  }

  get(id: string): DocumentRecord | undefined {
    return this.col.get(id);
  }

  /** The record or a 404 problem. */
  require(id: string): DocumentRecord {
    const rec = this.col.get(id);
    if (!rec) throw notFound("Document");
    return rec;
  }

  /** Serialised export plus the headers a download needs. */
  export(id: string, format: Format): { body: string; contentType: string; filename: string } {
    const rec = this.require(id);
    const base = sanitiseFilename(rec.filename).replace(/\.[^.]+$/, "") || "document";
    return { body: serialize(rec, format), contentType: MIME[format], filename: `${base}.${format}` };
  }

  /** Grounded Q&A scoped to one document. */
  async ask(
    id: string,
    question: string,
    signal?: AbortSignal,
  ): Promise<{ answer: string; sources: string[]; ms: number }> {
    const rec = this.require(id);
    const res = await this.d.arag.ask(
      {
        query: question,
        citations: true,
        // `/ask` + resource_filters, never `/resource/{id}/ask`: the per-resource endpoint
        // rejects `full_resource` upstream (HTTP 500/503). See services/agents.ts.
        resource_filters: [rec.resourceId],
        rag_strategies: [{ name: "full_resource" }],
        prompt: {
          system:
            "Answer using only the provided document content. If the answer is not in the document, say you don't have that information.",
        },
        temperature: 0,
        max_tokens: 400,
        generative_model: this.d.generativeModel || undefined,
        reranker: this.d.env.arag.reranker,
      },
      { signal },
    );
    return {
      answer: res.answerText,
      sources: res.sourceTitles,
      ms: res.timings.totalMs,
    };
  }

  /** Delete the record and the backing KB resource. */
  async delete(id: string): Promise<boolean> {
    const rec = this.col.get(id);
    if (!rec) return false;
    await this.d.arag
      .deleteResource(rec.resourceId)
      .catch((err) => this.d.log.warn("document.delete.arag", { id, message: (err as Error).message }));
    return this.col.delete(id);
  }

  /** Delete every document older than `olderThanDays` from the store and the KB. */
  async purge(
    olderThanDays: number,
  ): Promise<{ deleted: string[]; failed: Array<{ id: string; error: string }> }> {
    const cutoff = Date.now() - olderThanDays * 86_400_000;
    const stale = this.col.list({ filter: (d) => Date.parse(d.createdAt) < cutoff });
    const deleted: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const doc of stale) {
      try {
        await this.d.arag.deleteResource(doc.resourceId);
        this.col.delete(doc.id);
        deleted.push(doc.id);
      } catch (err) {
        failed.push({ id: doc.id, error: (err as Error).message });
      }
    }
    this.d.log.info("document.purge", { olderThanDays, deleted: deleted.length, failed: failed.length });
    return { deleted, failed };
  }

  /** Counts for the admin usage endpoint. */
  stats(): Record<string, number> {
    const all = this.col.list();
    const byStatus: Record<string, number> = { pending: 0, processing: 0, ready: 0, failed: 0 };
    for (const d of all) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    return { total: all.length, ...byStatus };
  }
}
