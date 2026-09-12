/**
 * Progress Agentic RAG (ARAG / Nuclia) client.
 *
 * One place for all HTTP to the Knowledge Box. Everything is derived from
 * `config.aragKbUrl` (…/api/v1/kb/<id>) and authenticated with the service-account
 * JWT via the `X-NUCLIA-SERVICEACCOUNT: Bearer <token>` header.
 *
 * Capabilities used by the demo:
 *   - upload()          push a document into the KB (triggers OCR/visual/layout processing)
 *   - waitProcessed()   poll until the resource finishes processing
 *   - extractedText()   pull the processed plain text back out
 *   - ask()             NDJSON /ask — grounded generation, with optional answer_json_schema
 *                       for structured extraction (lands in `answer_json`)
 *   - deleteResource()  clean-up
 */

import { config } from "./config.ts";
import { log } from "./logger.ts";

export class AragError extends Error {
  constructor(
    message: string,
    public readonly kind: "timeout" | "http" | "network",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AragError";
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "X-NUCLIA-SERVICEACCOUNT": `Bearer ${config.aragToken}`, ...extra };
}

/** Base64 a string the way Nuclia's X-FILENAME header expects. */
function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

export interface UploadResult {
  resourceId: string;
  fieldId: string;
}

/**
 * Upload raw bytes as a new resource. Uses the simple (non-resumable) `/upload`
 * endpoint, which is plenty for demo-sized files. Nuclia starts processing
 * (extraction, OCR for images/PDF, layout, embeddings) asynchronously.
 */
export async function upload(
  bytes: Uint8Array,
  filename: string,
  contentType: string,
): Promise<UploadResult> {
  // Attach the ingestion-time visual-LLM extract strategy for documents where it adds
  // value (images and PDFs). Text/office files use ARAG's default processing.
  const useStrategy =
    !!config.extractStrategy && (contentType.startsWith("image/") || contentType === "application/pdf");
  const url = useStrategy
    ? `${config.aragKbUrl}/upload?extract_strategy=${encodeURIComponent(config.extractStrategy)}`
    : `${config.aragKbUrl}/upload`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders({
        "Content-Type": contentType || "application/octet-stream",
        "X-FILENAME": b64(filename),
      }),
      body: bytes,
      signal: AbortSignal.timeout(config.aragTimeoutMs),
    });
  } catch (err) {
    throw new AragError(`upload network error: ${(err as Error).message}`, "network");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AragError(`upload failed HTTP ${res.status}: ${detail.slice(0, 300)}`, "http", res.status);
  }
  const json = (await res.json()) as { uuid?: string; field_id?: string };
  if (!json.uuid) throw new AragError("upload returned no resource uuid", "http", res.status);
  log.info("arag.upload.ok", { resourceId: json.uuid, filename, contentType, extractStrategy: useStrategy ? config.extractStrategy : null });
  return { resourceId: json.uuid, fieldId: json.field_id ?? "" };
}

type FieldEntry = { extracted?: { text?: { text?: string } } };
interface ResourceShow {
  metadata?: { status?: string };
  // Field categories: files, texts, links, conversations, … plus `generics` (title etc.).
  data?: Record<string, Record<string, FieldEntry> | undefined>;
}

async function getResource(resourceId: string, params: string): Promise<ResourceShow> {
  const url = `${config.aragKbUrl}/resource/${resourceId}?${params}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(config.aragTimeoutMs),
    });
  } catch (err) {
    throw new AragError(`resource fetch network error: ${(err as Error).message}`, "network");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AragError(`resource fetch HTTP ${res.status}: ${detail.slice(0, 200)}`, "http", res.status);
  }
  return (await res.json()) as ResourceShow;
}

/**
 * Poll the resource until its processing status is PROCESSED (or ERROR/timeout).
 * Returns the final status string.
 */
export async function waitProcessed(
  resourceId: string,
  opts: { timeoutMs?: number; intervalMs?: number; onPoll?: (status: string, attempt: number) => void } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const intervalMs = opts.intervalMs ?? 2_500;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    const r = await getResource(resourceId, "show=basic");
    const status = r.metadata?.status ?? "UNKNOWN";
    opts.onPoll?.(status, attempt);
    if (status === "PROCESSED") return status;
    if (status === "ERROR") throw new AragError("resource processing ERROR", "http");
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  throw new AragError("resource processing timed out", "timeout");
}

/**
 * Pull the processed plain text out of a resource. Uploaded files land under
 * `data.files.<id>.extracted.text.text`; pasted text under `data.texts.<id>`. We walk
 * every field category and concatenate, skipping `generics` (which just holds the title).
 */
export async function extractedText(resourceId: string): Promise<string> {
  const r = await getResource(resourceId, "show=extracted&extracted=text");
  const data = r.data ?? {};
  const parts: string[] = [];
  for (const [category, fields] of Object.entries(data)) {
    if (category === "generics" || !fields) continue;
    for (const f of Object.values(fields)) {
      const t = f?.extracted?.text?.text;
      if (typeof t === "string" && t.trim()) parts.push(t.trim());
    }
  }
  return parts.join("\n\n");
}

/**
 * Whether a resource is present in retrieval yet. Uses `/find` (retrieval-only, no
 * generation — cheap). A resource's processing status can flip to PROCESSED a few
 * seconds before it becomes searchable, so this is the real "ready to extract" gate.
 */
export async function findPresent(resourceId: string): Promise<boolean> {
  const url = `${config.aragKbUrl}/find`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ query: "document", features: ["keyword"], resource_filters: [resourceId] }),
      signal: AbortSignal.timeout(config.aragTimeoutMs),
    });
  } catch {
    return false;
  }
  if (!res.ok) return false;
  const json = (await res.json().catch(() => ({}))) as { resources?: Record<string, unknown> };
  return Boolean(json.resources && resourceId in json.resources);
}

/** Poll until the resource is retrievable (searchable), or time out. */
export async function waitSearchable(
  resourceId: string,
  opts: { timeoutMs?: number; intervalMs?: number; onPoll?: (attempt: number) => void } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    opts.onPoll?.(attempt);
    if (await findPresent(resourceId)) return true;
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return false;
}

/**
 * Create or replace a stored search configuration in the KB.
 * `body` is the Nuclia shape: { kind: "ask", config: { generative_model, reranker,
 * rag_strategies, prompt, answer_json_schema, … } }.
 */
export async function putSearchConfig(name: string, body: unknown): Promise<void> {
  const url = `${config.aragKbUrl}/search_configurations/${encodeURIComponent(name)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.aragTimeoutMs),
    });
  } catch (err) {
    throw new AragError(`search-config put network error: ${(err as Error).message}`, "network");
  }
  // 201 created / 200 updated; some deployments return 409 if it exists — treat as ok.
  if (!res.ok && res.status !== 409) {
    const detail = await res.text().catch(() => "");
    throw new AragError(`search-config put HTTP ${res.status}: ${detail.slice(0, 300)}`, "http", res.status);
  }
}

export async function deleteSearchConfig(name: string): Promise<void> {
  const url = `${config.aragKbUrl}/search_configurations/${encodeURIComponent(name)}`;
  try {
    await fetch(url, { method: "DELETE", headers: authHeaders(), signal: AbortSignal.timeout(config.aragTimeoutMs) });
  } catch (err) {
    log.warn("arag.search-config.delete.fail", { name, message: (err as Error).message });
  }
}

/**
 * Read structured fields a Data Augmentation "ask" agent persisted onto a resource.
 *
 * Such agents (configured in the dashboard) write their JSON output as either a JSON
 * **text field** (`value.body` / extracted text that parses as a JSON object) or a
 * **key-value field**. We scan every field category except the original `files`/`generics`
 * and return the first JSON object found (preferring a field whose id matches `destination`).
 * Returns null when no agent output is present (so callers can fall back).
 */
export async function readPersistedFields(
  resourceId: string,
  destination?: string,
): Promise<Record<string, unknown> | null> {
  const r = (await getResource(resourceId, "show=values&show=extracted&extracted=text")) as unknown as {
    data?: Record<string, Record<string, Record<string, unknown>> | undefined>;
  };
  const data = r.data ?? {};
  const candidates: Array<[string, Record<string, unknown>]> = [];
  for (const [cat, fields] of Object.entries(data)) {
    if (cat === "files" || cat === "generics" || !fields) continue;
    for (const [fid, f] of Object.entries(fields)) {
      // Key-value field: value.keyvalues = [{key,value}, …]
      const value = (f as Record<string, unknown>).value as Record<string, unknown> | undefined;
      const kvs = value?.keyvalues;
      if (Array.isArray(kvs) && kvs.length) {
        const obj: Record<string, unknown> = {};
        for (const kv of kvs as Array<Record<string, unknown>>) {
          if (kv && typeof kv.key === "string") obj[kv.key] = kv.value;
        }
        if (Object.keys(obj).length) candidates.push([fid, obj]);
        continue;
      }
      // JSON text field: value.body or extracted text that parses to an object.
      const extracted = (f as Record<string, unknown>).extracted as Record<string, unknown> | undefined;
      const text =
        (typeof value?.body === "string" && value.body) ||
        (typeof (extracted?.text as Record<string, unknown>)?.text === "string" &&
          ((extracted!.text as Record<string, unknown>).text as string)) ||
        "";
      if (text) {
        try {
          const o = JSON.parse(text);
          if (o && typeof o === "object" && !Array.isArray(o)) candidates.push([fid, o]);
        } catch {
          /* not JSON — ignore */
        }
      }
    }
  }
  if (candidates.length === 0) return null;
  if (destination) {
    const match = candidates.find(([fid]) => fid === destination);
    if (match) return match[1];
  }
  return candidates[0]![1];
}

export async function deleteResource(resourceId: string): Promise<void> {
  const url = `${config.aragKbUrl}/resource/${resourceId}`;
  try {
    await fetch(url, { method: "DELETE", headers: authHeaders(), signal: AbortSignal.timeout(config.aragTimeoutMs) });
  } catch (err) {
    log.warn("arag.delete.fail", { resourceId, message: (err as Error).message });
  }
}

export interface AskParams {
  query: string;
  /** Restrict retrieval to one resource (its full text), for per-document extraction. */
  resourceId?: string;
  prompt?: { system: string; user?: string };
  /** OpenAI-function-style schema { name, description, parameters } → structured answer_json. */
  answerJsonSchema?: unknown;
  reranker?: string;
  maxTokens?: number;
  temperature?: number;
  generativeModel?: string;
  /**
   * Put the ENTIRE resource into the model's context (Nuclia `full_resource` RAG
   * strategy) instead of only the paragraphs matching the query. Essential for
   * extraction/summarization, where a value (e.g. the invoice total) may live in a
   * paragraph the sub-query wouldn't retrieve. Requires `resourceId`.
   */
  fullResource?: boolean;
  /**
   * Name of a stored ARAG search_configuration. When set it OWNS the model, RAG
   * strategy, reranker, prompt, and answer_json_schema — the inline equivalents are
   * not sent. Per-request `resourceId`, `query`, and `maxTokens` still apply.
   */
  searchConfiguration?: string;
  timeoutMs?: number;
}

export interface AskResult {
  answerText: string;
  answerJson?: unknown;
  /** Source resource titles seen in retrieval (for citation chips). */
  sources: string[];
  ms: number;
}

/** Interpret one NDJSON line into the bits we care about. Tolerant of schema drift. */
function interpretLine(obj: unknown): { chunk?: string; json?: unknown; sources: string[] } {
  const sources: string[] = [];
  if (typeof obj !== "object" || obj === null) return { sources };
  const o = obj as Record<string, unknown>;
  const node = (o.item && typeof o.item === "object" ? o.item : o) as Record<string, unknown>;
  const type = typeof node.type === "string" ? node.type.toLowerCase() : undefined;

  let json: unknown;
  const aj =
    o.answer_json ?? node.answer_json ?? (type === "answer_json" ? (node.object ?? node.json) : undefined);
  if (aj && typeof aj === "object") json = aj;

  let chunk: string | undefined;
  if (type === "answer" || type === "generative") {
    const t = node.text ?? node.answer ?? node.content;
    if (typeof t === "string") chunk = t;
  } else if (typeof o.answer === "string") {
    chunk = o.answer;
  }

  // Source titles from retrieval results.resources / citations maps.
  const maps: Record<string, unknown>[] = [];
  const results = node.results as Record<string, unknown> | undefined;
  if (results?.resources && typeof results.resources === "object")
    maps.push(results.resources as Record<string, unknown>);
  if (node.citations && typeof node.citations === "object" && !Array.isArray(node.citations))
    maps.push(node.citations as Record<string, unknown>);
  for (const map of maps) {
    for (const r of Object.values(map)) {
      const title = (r as Record<string, unknown>)?.title;
      if (typeof title === "string" && title.trim()) sources.push(title.trim());
    }
  }
  return { chunk, json, sources };
}

/**
 * Call ARAG `/ask` and assemble the streamed NDJSON response.
 *
 * When `answerJsonSchema` is set, ARAG returns a structured object in `answer_json`
 * (and `answerText` stays empty). When `resourceId` is set, retrieval is constrained
 * to that one document via the `resource_filters` field so extraction is grounded in
 * exactly the uploaded file.
 */
export async function ask(params: AskParams, signal?: AbortSignal): Promise<AskResult> {
  const url = `${config.aragKbUrl}/ask`;
  const body: Record<string, unknown> = {
    query: params.query,
    features: ["keyword", "semantic"],
  };
  if (params.searchConfiguration) {
    // A stored ARAG search configuration owns the model, RAG strategy, reranker,
    // grounding prompt, and answer_json_schema. We send only the per-request bits.
    body.search_configuration = params.searchConfiguration;
    if (params.resourceId) body.resource_filters = [params.resourceId];
    if (typeof params.maxTokens === "number") body.max_tokens = params.maxTokens;
    body.temperature = typeof params.temperature === "number" ? params.temperature : 0;
  } else {
    // citations + answer_json_schema together are rejected (422); only request citations
    // when not doing structured extraction.
    if (!params.answerJsonSchema) body.citations = true;
    if (params.prompt) body.prompt = params.prompt;
    if (params.answerJsonSchema) body.answer_json_schema = params.answerJsonSchema;
    body.reranker = params.reranker ?? config.reranker;
    if (typeof params.maxTokens === "number") body.max_tokens = params.maxTokens;
    body.temperature = typeof params.temperature === "number" ? params.temperature : 0;
    body.generative_model = params.generativeModel ?? config.generativeModel;
    if (params.resourceId) body.resource_filters = [params.resourceId];
    if (params.fullResource) body.rag_strategies = [{ name: "full_resource" }];
  }

  const timeout = AbortSignal.timeout(params.timeoutMs ?? config.aragTimeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const start = performance.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json", Accept: "application/x-ndjson" }),
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (err) {
    if (timeout.aborted) throw new AragError("ask timed out", "timeout");
    throw new AragError(`ask network error: ${(err as Error).message}`, "network");
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new AragError(`ask HTTP ${res.status}: ${detail.slice(0, 400)}`, "http", res.status);
  }

  let answerText = "";
  let answerJson: unknown;
  const sources = new Set<string>();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handle = (line: string) => {
    if (!line) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      log.warn("arag.ndjson.skip", { line: line.slice(0, 120) });
      return;
    }
    const { chunk, json, sources: s } = interpretLine(parsed);
    if (json !== undefined) answerJson = json;
    if (chunk) answerText += chunk;
    for (const t of s) sources.add(t);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        handle(buffer.slice(0, nl).trim());
        buffer = buffer.slice(nl + 1);
      }
    }
  } catch (err) {
    if (timeout.aborted) throw new AragError("ask stream timed out", "timeout");
    throw new AragError(`ask stream error: ${(err as Error).message}`, "network");
  }
  handle(buffer.trim());

  return { answerText: answerText.trim(), answerJson, sources: [...sources], ms: performance.now() - start };
}
