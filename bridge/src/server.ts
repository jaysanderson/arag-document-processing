/**
 * HTTP server (Node stdlib only — no framework).
 *
 * Serves the single-page web console from ./public and exposes the JSON/SSE API the
 * console drives:
 *
 *   GET  /api/health                         liveness + KB id
 *   POST /api/ingest                         upload raw file bytes → ARAG resource
 *   GET  /api/process?id=&filename=&type=    SSE stream of pipeline StageEvents
 *   GET  /api/record?id=                     fetch the finished canonical record
 *   GET  /api/export?id=&format=json|xml|csv download a standardized export
 *   POST /api/ask                            grounded Q&A over a document (or whole KB)
 *
 * Finished records are held in an in-memory store keyed by resource id — plenty for a
 * single-instance demo. Restarting clears them (the documents remain in the KB).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname, normalize } from "node:path";

import { config, kbId } from "./config.ts";
import { log } from "./logger.ts";
import { upload, ask, AragError } from "./arag.ts";
import { runPipeline } from "./pipeline.ts";
import { ensureExtractionConfig, aragConfigName } from "./agents.ts";
import {
  SCHEMAS,
  builtinConfigs,
  buildCustomSchema,
  schemaToFields,
  type ExtractionSchema,
  type DocType,
} from "./schemas.ts";
import { serialize, MIME, type Format } from "./formats.ts";
import type { DocRecord, StageEvent } from "./types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "..", "public");

/** In-memory store of finished records (resourceId → record). */
const records = new Map<string, DocRecord>();

/** In-memory store of custom extraction configs (id → {schema,label}). */
const customConfigs = new Map<string, { schema: ExtractionSchema; label: string }>();

/** Resolve a `config` param to a forced schema + label, or null for auto-detect. */
function resolveConfig(configParam: string | null): { schema: ExtractionSchema; label: string } | null {
  if (!configParam || configParam === "auto") return null;
  if (configParam in SCHEMAS) {
    const dt = configParam as DocType;
    return { schema: SCHEMAS[dt], label: dt.replace(/_/g, " ") };
  }
  return customConfigs.get(configParam) ?? null;
}

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

function sendText(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new Error(`payload exceeds ${limit} bytes`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

// ─── static ─────────────────────────────────────────────────────────────────

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  // prevent path traversal
  const filePath = resolve(PUBLIC_DIR, "." + normalize(pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    const data = await readFile(filePath);
    const type = STATIC_TYPES[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Content-Length": data.length });
    res.end(data);
  } catch {
    sendText(res, 404, "not found");
  }
}

// ─── handlers ─────────────────────────────────────────────────────────────────

async function handleIngest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const filename = (req.headers["x-filename"] as string) || "document";
  const contentType = (req.headers["content-type"] as string) || "application/octet-stream";
  let bytes: Buffer;
  try {
    bytes = await readBody(req, config.maxUploadBytes);
  } catch (err) {
    return sendJson(res, 413, { error: (err as Error).message });
  }
  if (bytes.length === 0) return sendJson(res, 400, { error: "empty upload" });
  try {
    const { resourceId } = await upload(bytes, filename, contentType);
    sendJson(res, 201, { resourceId, filename, contentType, bytes: bytes.length });
  } catch (err) {
    const status = err instanceof AragError && err.status ? err.status : 502;
    sendJson(res, status, { error: (err as Error).message });
  }
}

function handleProcess(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const id = url.searchParams.get("id");
  const filename = url.searchParams.get("filename") ?? "document";
  const contentType = url.searchParams.get("type") ?? "application/octet-stream";
  if (!id) return sendJson(res, 400, { error: "missing id" });
  const configParam = url.searchParams.get("config");
  const useAgentFields = configParam === "agent";
  const forced = useAgentFields ? null : resolveConfig(configParam);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // Initial comment to open the stream promptly.
  res.write(": connected\n\n");

  let closed = false;
  req.on("close", () => {
    closed = true;
  });

  const emit = (e: StageEvent) => {
    if (closed) return;
    res.write(`event: ${e.stage}\n`);
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };

  runPipeline(
    { resourceId: id, filename, contentType, forcedSchema: forced?.schema, configLabel: forced?.label, useAgentFields },
    emit,
  )
    .then((record) => {
      records.set(record.id, record);
      if (!closed) {
        res.write(`event: complete\n`);
        res.write(`data: ${JSON.stringify({ ok: true, id: record.id })}\n\n`);
        res.end();
      }
    })
    .catch((err) => {
      log.error("process.fatal", { id, message: (err as Error).message });
      if (!closed) {
        res.write(`event: fatal\n`);
        res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
        res.end();
      }
    });
}

function handleRecord(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const id = url.searchParams.get("id");
  if (!id) return sendJson(res, 400, { error: "missing id" });
  const rec = records.get(id);
  if (!rec) return sendJson(res, 404, { error: "record not found (not processed yet?)" });
  sendJson(res, 200, rec);
}

function handleExport(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const id = url.searchParams.get("id");
  const format = (url.searchParams.get("format") ?? "json") as Format;
  if (!id) return sendJson(res, 400, { error: "missing id" });
  if (!["json", "xml", "csv"].includes(format)) return sendJson(res, 400, { error: "bad format" });
  const rec = records.get(id);
  if (!rec) return sendJson(res, 404, { error: "record not found" });
  const body = serialize(rec, format);
  const base = (rec.filename || "document").replace(/\.[^.]+$/, "") || "document";
  res.writeHead(200, {
    "Content-Type": MIME[format],
    "Content-Disposition": `attachment; filename="${base}.${format}"`,
  });
  res.end(body);
}

/** List all extraction configs (built-in + registered custom) for the UI. */
function handleConfigs(_req: IncomingMessage, res: ServerResponse): void {
  const custom = [...customConfigs.entries()].map(([id, { schema, label }]) => ({
    id,
    name: label,
    docType: schema.docType,
    description: schema.description,
    builtin: false,
    aragConfig: aragConfigName(schema),
    fields: schemaToFields(schema),
  }));
  sendJson(res, 200, { configs: [...builtinConfigs(), ...custom] });
}

/** Register a custom extraction config; returns an id usable as ?config=<id>. */
async function handleCreateConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: { name?: string; description?: string; fields?: Array<Record<string, unknown>> };
  try {
    body = JSON.parse((await readBody(req, 200_000)).toString("utf8") || "{}");
  } catch {
    return sendJson(res, 400, { error: "invalid JSON body" });
  }
  const name = (body.name ?? "").trim();
  const fields = Array.isArray(body.fields) ? body.fields : [];
  if (!name) return sendJson(res, 400, { error: "config name is required" });
  const cleanFields = fields
    .map((f) => ({
      label: String(f.label ?? "").trim(),
      type: (["string", "number", "array"].includes(String(f.type)) ? f.type : "string") as "string" | "number" | "array",
      description: f.description ? String(f.description) : undefined,
      required: Boolean(f.required),
    }))
    .filter((f) => f.label);
  if (cleanFields.length === 0) return sendJson(res, 400, { error: "at least one field with a label is required" });

  const schema = buildCustomSchema({ name, description: body.description, fields: cleanFields });
  const id = `cfg_${randomUUID().slice(0, 8)}`;
  customConfigs.set(id, { schema, label: name });
  // Provision the config in ARAG as a stored search_configuration (the LLM + rules
  // live server-side in the Knowledge Box, not just in the bridge).
  let aragConfig = aragConfigName(schema);
  try {
    aragConfig = await ensureExtractionConfig(schema);
  } catch (err) {
    log.warn("config.create.provision.fail", { id, message: (err as Error).message });
  }
  log.info("config.create", { id, name, fields: cleanFields.length, aragConfig });
  sendJson(res, 201, { id, name, aragConfig, fields: schemaToFields(schema) });
}

async function handleAsk(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: { question?: string; resourceId?: string };
  try {
    const raw = await readBody(req, 1_000_000);
    body = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    return sendJson(res, 400, { error: "invalid JSON body" });
  }
  const question = (body.question ?? "").trim();
  if (!question) return sendJson(res, 400, { error: "missing question" });
  try {
    const result = await ask({
      query: question,
      resourceId: body.resourceId,
      prompt: {
        system:
          "Answer using only the provided document content. If the answer is not in the document, say you don't have that information.",
      },
      temperature: 0,
      maxTokens: 300,
    });
    sendJson(res, 200, { answer: result.answerText, sources: result.sources, ms: Math.round(result.ms) });
  } catch (err) {
    const status = err instanceof AragError && err.status ? err.status : 502;
    sendJson(res, status, { error: (err as Error).message });
  }
}

// ─── router ─────────────────────────────────────────────────────────────────

export function buildServer() {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const { pathname } = url;
    const method = req.method ?? "GET";

    const route = `${method} ${pathname}`;
    log.debug("http", { route });

    if (pathname === "/api/health" && method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        kb: kbId(),
        model: config.generativeModel,
        extractStrategy: config.extractStrategy || null,
        records: records.size,
      });
    }
    if (pathname === "/api/configs" && method === "GET") return handleConfigs(req, res);
    if (pathname === "/api/extract-config" && method === "POST") return void handleCreateConfig(req, res);
    if (pathname === "/api/ingest" && method === "POST") return void handleIngest(req, res);
    if (pathname === "/api/process" && method === "GET") return handleProcess(req, res);
    if (pathname === "/api/record" && method === "GET") return handleRecord(req, res);
    if (pathname === "/api/export" && method === "GET") return handleExport(req, res);
    if (pathname === "/api/ask" && method === "POST") return void handleAsk(req, res);

    if (pathname.startsWith("/api/")) return sendJson(res, 404, { error: "no such endpoint" });

    // everything else → static
    return void serveStatic(req, res);
  });
}
