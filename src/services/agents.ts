/**
 * Data-augmentation agents.
 *
 * Each agent is a focused, grounded call to ARAG that enriches the canonical record:
 *
 *   classify          → pick the document type (drives which extraction schema is used)
 *   extractFields     → schema-driven visual-LLM field extraction (the core step)
 *   enrichEntities    → named-entity surfacing (people, orgs, money, dates, …)
 *   summarize         → one-paragraph abstractive summary + topic tags
 *   validateNormalize → deterministic normalisation + consistency checks (no model call)
 *
 * Extraction/classification use `answer_json_schema` so the model is forced to return
 * structured JSON grounded in the uploaded document (retrieval is constrained to that
 * one resource via `resourceId`). Temperature 0 keeps demos repeatable.
 *
 * All HTTP goes through the shared platform `AragClient`; nothing here knows URLs.
 */
import type {
  AnswerJsonSchema,
  AragClient,
  Logger,
  SearchConfiguration,
} from "../../vendor/arag-platform/src/index.ts";
import type { DocType, Entity, ExtractedField, ValidationIssue } from "../types.ts";
import { normalizeCurrency, parseAmount, parseDateISO } from "./normalize.ts";
import { DOC_TYPES, type ExtractionSchema, SCHEMAS, toAnswerJsonSchema } from "./schemas.ts";

export const GROUNDING =
  "You are a precise document-data extraction engine. Use ONLY the content of the provided document. " +
  "Do not invent values. If a field is not present, omit it or leave it empty. Return values exactly as written in the document unless asked to normalize.";

export interface AgentDeps {
  arag: AragClient;
  log: Logger;
  generativeModel: string;
  reranker: string;
}

// ─── ARAG-side extraction configs ──────────────────────────────────────────────
// Each extraction schema is provisioned as a stored ARAG search_configuration that
// specifies the generative model (the multimodal LLM used for visual processing), the
// full_resource RAG strategy, the reranker, the grounding prompt (rules), and the
// answer_json_schema. Extraction then runs through that stored config via /ask.

/** Deterministic ARAG search_configuration name for a schema. */
export function aragConfigName(schema: ExtractionSchema): string {
  return `dip_${schema.name}`;
}

/** Build the Nuclia search_configuration body (kind:"ask") for a schema. */
export function toSearchConfig(schema: ExtractionSchema, deps: AgentDeps): SearchConfiguration {
  return {
    kind: "ask",
    config: {
      generative_model: deps.generativeModel || undefined,
      reranker: deps.reranker,
      rag_strategies: [{ name: "full_resource" }],
      prompt: { system: GROUNDING },
      answer_json_schema: toAnswerJsonSchema(schema),
    },
  };
}

/** Provisioning result for one schema. */
export interface ProvisionResult {
  schema: string;
  aragConfig: string;
  ok: boolean;
  error?: string;
}

/**
 * Agent runner. Holds the client plus a cache of already-provisioned ARAG search
 * configurations so repeat extractions do not re-POST the same config.
 */
export class Agents {
  private readonly d: AgentDeps;
  private readonly provisioned = new Set<string>();

  constructor(deps: AgentDeps) {
    this.d = deps;
  }

  /** Forget the provisioning cache (used by admin re-provision so it really re-POSTs). */
  resetProvisionCache(): void {
    this.provisioned.clear();
  }

  /** Ensure a schema's search_configuration exists in ARAG (idempotent, cached). */
  async ensureExtractionConfig(schema: ExtractionSchema, opts: { force?: boolean } = {}): Promise<string> {
    const name = aragConfigName(schema);
    if (!opts.force && this.provisioned.has(name)) return name;
    await this.d.arag.putSearchConfiguration(name, toSearchConfig(schema, this.d));
    this.provisioned.add(name);
    this.d.log.info("arag.config.provisioned", { name });
    return name;
  }

  /** Provision a set of extraction configs in ARAG; never throws. */
  async provision(schemas: ExtractionSchema[], opts: { force?: boolean } = {}): Promise<ProvisionResult[]> {
    const out: ProvisionResult[] = [];
    for (const schema of schemas) {
      const aragConfig = aragConfigName(schema);
      try {
        await this.ensureExtractionConfig(schema, opts);
        out.push({ schema: schema.name, aragConfig, ok: true });
      } catch (err) {
        this.d.log.warn("arag.config.provision.fail", {
          schema: schema.name,
          message: (err as Error).message,
        });
        out.push({ schema: schema.name, aragConfig, ok: false, error: (err as Error).message });
      }
    }
    this.d.log.info("arag.config.provision.done", {
      ok: out.filter((r) => r.ok).length,
      failed: out.filter((r) => !r.ok).length,
    });
    return out;
  }

  /** Remove a stored ARAG search configuration (used when a custom config is deleted). */
  async deleteSearchConfiguration(name: string): Promise<void> {
    await this.d.arag.deleteSearchConfiguration(name);
    this.provisioned.delete(name);
  }

  /** Provision all built-in extraction configs (called at boot and by admin). */
  provisionBuiltins(opts: { force?: boolean } = {}): Promise<ProvisionResult[]> {
    return this.provision(
      DOC_TYPES.map((dt) => SCHEMAS[dt]),
      opts,
    );
  }

  // ─── classify ───────────────────────────────────────────────────────────────

  async classify(
    resourceId: string,
    querySeed: string,
    signal?: AbortSignal,
  ): Promise<{ docType: DocType; confidence: number }> {
    const schema: AnswerJsonSchema = {
      name: "classify_document",
      description: "Classify the document into one of the supported types.",
      parameters: {
        type: "object",
        properties: {
          doc_type: {
            type: "string",
            enum: DOC_TYPES,
            description: "The single best-fitting document type.",
          },
          confidence: { type: "number", description: "Confidence between 0 and 1." },
        },
        required: ["doc_type", "confidence"],
      },
    };
    const res = await this.d.arag.ask(
      {
        query: querySeed,
        rag_strategies: [{ name: "full_resource" }],
        prompt: { system: GROUNDING },
        answer_json_schema: schema,
        temperature: 0,
        // Generous cap: a truncated structured response is invalid JSON and yields NO
        // answer_json at all, which silently demotes every document to "generic".
        max_tokens: 300,
        generative_model: this.d.generativeModel || undefined,
        reranker: this.d.reranker,
      },
      { resourceId, signal },
    );
    const o = obj(res.answerJson);
    const docType = (DOC_TYPES as string[]).includes(String(o.doc_type))
      ? (o.doc_type as DocType)
      : "generic";
    const confidence = typeof o.confidence === "number" ? clamp01(o.confidence) : 0.5;
    this.d.log.info("agent.classify", { resourceId, docType, confidence, ms: res.timings.totalMs });
    return { docType, confidence };
  }

  // ─── extractFields ──────────────────────────────────────────────────────────

  async extractFields(
    resourceId: string,
    schema: ExtractionSchema,
    querySeed: string,
    signal?: AbortSignal,
  ): Promise<ExtractedField[]> {
    // Extraction runs through the schema's STORED ARAG search configuration, which
    // owns the model (visual LLM), full_resource RAG strategy, reranker, prompt, and
    // answer_json_schema. Provision it on first use (idempotent).
    const configName = await this.ensureExtractionConfig(schema);
    const res = await this.d.arag.ask(
      { query: querySeed, search_configuration: configName, temperature: 0, max_tokens: 1500 },
      { resourceId, signal },
    );
    const fields = fieldsFromSchema(obj(res.answerJson), schema);
    this.d.log.info("agent.extract", {
      resourceId,
      schema: schema.name,
      fields: fields.length,
      ms: res.timings.totalMs,
    });
    return fields;
  }

  // ─── enrichEntities ─────────────────────────────────────────────────────────

  async enrichEntities(resourceId: string, querySeed: string, signal?: AbortSignal): Promise<Entity[]> {
    const schema: AnswerJsonSchema = {
      name: "extract_entities",
      description: "Surface the salient named entities in the document.",
      parameters: {
        type: "object",
        properties: {
          entities: {
            type: "array",
            description: "Named entities found in the document.",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                type: {
                  type: "string",
                  description: "PERSON | ORG | DATE | MONEY | LOCATION | EMAIL | PHONE | ID | OTHER",
                },
              },
              required: ["text", "type"],
            },
          },
        },
        required: ["entities"],
      },
    };
    const res = await this.d.arag.ask(
      {
        query: querySeed,
        rag_strategies: [{ name: "full_resource" }],
        prompt: { system: GROUNDING },
        answer_json_schema: schema,
        temperature: 0,
        // Generous cap: a truncated structured response yields invalid JSON and thus NO
        // answer_json at all (not a partial), so under-budgeting here drops every entity.
        max_tokens: 1500,
        generative_model: this.d.generativeModel || undefined,
        reranker: this.d.reranker,
      },
      { resourceId, signal },
    );
    const entities = entitiesFrom(obj(res.answerJson));
    this.d.log.info("agent.entities", { resourceId, count: entities.length, ms: res.timings.totalMs });
    return entities;
  }

  // ─── summarize ──────────────────────────────────────────────────────────────

  async summarize(
    resourceId: string,
    querySeed: string,
    signal?: AbortSignal,
  ): Promise<{ summary: string; tags: string[] }> {
    const schema: AnswerJsonSchema = {
      name: "summarize_document",
      description: "Summarize the document and assign topic tags.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "A single, factual paragraph (<= 60 words)." },
          tags: { type: "array", items: { type: "string" }, description: "3-6 short topic tags." },
        },
        required: ["summary"],
      },
    };
    const res = await this.d.arag.ask(
      {
        query: querySeed,
        rag_strategies: [{ name: "full_resource" }],
        prompt: { system: GROUNDING },
        answer_json_schema: schema,
        temperature: 0,
        max_tokens: 400,
        generative_model: this.d.generativeModel || undefined,
        reranker: this.d.reranker,
      },
      { resourceId, signal },
    );
    const o = obj(res.answerJson);
    const summary = typeof o.summary === "string" ? o.summary.trim() : "";
    const tags = Array.isArray(o.tags)
      ? o.tags
          .map((t) => String(t).trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    this.d.log.info("agent.summary", { resourceId, tags: tags.length, ms: res.timings.totalMs });
    return { summary, tags };
  }

  /**
   * Read fields a Data Augmentation "ask" agent persisted on the resource (a JSON text
   * field or a key-value field written by the agent in the ARAG dashboard) instead of
   * running a live extraction. Returns null when the resource carries no agent output.
   */
  async readPersistedFields(
    resourceId: string,
    opts: { destination?: string; signal?: AbortSignal } = {},
  ): Promise<Record<string, unknown> | null> {
    const r = await this.d.arag.getResource(resourceId, {
      show: ["values", "extracted"],
      extracted: ["text"],
      signal: opts.signal,
    });
    const candidates: Array<[string, Record<string, unknown>]> = [];
    for (const [category, fields] of Object.entries(r.data ?? {})) {
      if (category === "files" || category === "generics" || !fields) continue;
      for (const [fid, f] of Object.entries(fields)) {
        // Key-value field: value.keyvalues = [{key,value}, …]
        const value = f?.value as Record<string, unknown> | undefined;
        const kvs = value?.keyvalues;
        if (Array.isArray(kvs) && kvs.length) {
          const o: Record<string, unknown> = {};
          for (const kv of kvs as Array<Record<string, unknown>>) {
            if (kv && typeof kv.key === "string") o[kv.key] = kv.value;
          }
          if (Object.keys(o).length) candidates.push([fid, o]);
          continue;
        }
        // JSON text field: value.body or extracted text that parses to an object.
        const body = typeof value?.body === "string" ? value.body : "";
        const extractedText = typeof f?.extracted?.text?.text === "string" ? f.extracted.text.text : "";
        const text = body || extractedText;
        if (!text) continue;
        try {
          const o = JSON.parse(text) as unknown;
          if (o && typeof o === "object" && !Array.isArray(o))
            candidates.push([fid, o as Record<string, unknown>]);
        } catch {
          /* not JSON — ignore */
        }
      }
    }
    if (candidates.length === 0) return null;
    if (opts.destination) {
      const match = candidates.find(([fid]) => fid === opts.destination);
      if (match) return match[1];
    }
    return candidates[0]![1];
  }
}

// ─── pure helpers (unit-tested) ────────────────────────────────────────────────

/**
 * Build a retrieval query "seed" from the document's own extracted text.
 *
 * With the `full_resource` RAG strategy the model gets the whole document — BUT
 * retrieval still runs first to locate the resource, and an instruction-style query
 * ("list the entities") shares no vocabulary with many documents, returning zero
 * results (`no_retrieval_data`). Seeding the query with the document's actual opening
 * text guarantees a retrieval hit, after which full_resource supplies full context.
 */
export function buildQuerySeed(text: string, filename: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length >= 12) return cleaned.slice(0, 280);
  return `${filename} document contents details name date total amount party`;
}

function obj(answerJson: unknown): Record<string, unknown> {
  return answerJson && typeof answerJson === "object" ? (answerJson as Record<string, unknown>) : {};
}

/** Values models emit to mean "absent" — treat as not-extracted. */
const SENTINELS = new Set([
  "not specified",
  "n/a",
  "na",
  "none",
  "unknown",
  "not provided",
  "not available",
  "-",
]);
export function isSentinel(v: string): boolean {
  return SENTINELS.has(v.trim().toLowerCase());
}

/** Project a model's structured answer onto a schema's declared fields. */
export function fieldsFromSchema(
  answer: Record<string, unknown>,
  schema: ExtractionSchema,
): ExtractedField[] {
  const fields: ExtractedField[] = [];
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!(key in answer)) continue;
    let value = answer[key] as ExtractedField["value"];
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    if (typeof value === "string" && isSentinel(value)) continue; // "Not specified" / "N/A" / …
    if (prop.type === "number" && typeof value === "string") {
      const parsed = parseAmount(value);
      if (parsed !== null) value = parsed;
    }
    const required = schema.required.includes(key);
    fields.push({
      key,
      label: schema.labels[key] ?? key,
      value,
      confidence: required ? 0.95 : 0.85,
    });
  }
  return fields;
}

/** Normalise the entity agent's structured answer into deduped entities. */
export function entitiesFrom(answer: Record<string, unknown>): Entity[] {
  const raw = Array.isArray(answer.entities) ? answer.entities : [];
  const seen = new Set<string>();
  const entities: Entity[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const text = String((e as Record<string, unknown>).text ?? "").trim();
    const type = String((e as Record<string, unknown>).type ?? "OTHER")
      .trim()
      .toUpperCase();
    if (!text) continue;
    const dedupe = `${type}:${text.toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    entities.push({ text, type });
  }
  return entities;
}

/** Keys whose values are monetary amounts (normalised to numbers). */
const AMOUNT_KEYS = new Set([
  "subtotal",
  "tax",
  "total",
  "total_value",
  "amount_claimed",
  "amount_paid",
  "member_liability",
  "opening_balance",
  "closing_balance",
]);

/**
 * Normalise known field types in place and emit validation issues:
 *   - amounts → numbers (schemas capture them as STRINGS; see schemas.ts `money()`)
 *   - *_date / date keys → ISO 8601 (records a note if not parseable)
 *   - currency → ISO code
 *   - required-field presence (from the schema)
 *   - invoice/receipt arithmetic: subtotal + tax ≈ total
 */
export function validateNormalize(
  fields: ExtractedField[],
  schema: ExtractionSchema,
): { fields: ExtractedField[]; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const out = fields.map((f) => ({ ...f }));
  const byKey = new Map(out.map((f) => [f.key, f]));

  for (const f of out) {
    if (AMOUNT_KEYS.has(f.key) && typeof f.value !== "number") {
      const n = parseAmount(f.value as string);
      if (n !== null) {
        f.raw = String(f.value);
        f.value = n;
      } else {
        issues.push({ field: f.key, severity: "warning", message: `Could not parse amount "${f.value}"` });
      }
    }
    if ((f.key.endsWith("_date") || f.key === "date") && typeof f.value === "string") {
      const iso = parseDateISO(f.value);
      if (iso) {
        if (iso !== f.value) f.raw = f.value;
        f.value = iso;
      } else {
        issues.push({
          field: f.key,
          severity: "info",
          message: `Date "${f.value}" left as-is (not ISO-parseable)`,
        });
      }
    }
    if (f.key === "currency" && typeof f.value === "string") {
      const c = normalizeCurrency(f.value);
      if (c && c !== f.value) {
        f.raw = f.value;
        f.value = c;
      }
    }
  }

  // Required-field presence.
  for (const req of schema.required) {
    if (!byKey.has(req)) {
      issues.push({ field: req, severity: "error", message: `Required field "${req}" was not extracted` });
    }
  }

  // Arithmetic sanity for money documents.
  const sub = numVal(byKey.get("subtotal"));
  const tax = numVal(byKey.get("tax"));
  const total = numVal(byKey.get("total"));
  if (sub !== null && tax !== null && total !== null) {
    if (Math.abs(sub + tax - total) > 0.02 * Math.max(1, total)) {
      issues.push({
        field: "total",
        severity: "warning",
        message: `subtotal (${sub}) + tax (${tax}) ≠ total (${total})`,
      });
    }
  }

  return { fields: out, issues };
}

function numVal(f?: ExtractedField): number | null {
  if (!f) return null;
  return typeof f.value === "number" ? f.value : parseAmount(f.value as string);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Map a JSON object persisted by a Data Augmentation agent into normalised fields.
 * Keys are user-defined (the agent's schema), so labels are derived from the key and
 * values are lightly normalised by key heuristics (amounts → numbers, dates → ISO).
 */
export function fieldsFromObject(source: Record<string, unknown>): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const [key, raw] of Object.entries(source)) {
    if (raw === null || raw === undefined || raw === "") continue;
    if (typeof raw === "string" && isSentinel(raw)) continue;
    const label = key
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
    let value = raw as ExtractedField["value"];
    let rawStr: string | undefined;
    const lower = key.toLowerCase();
    if (typeof value === "string") {
      if (/(amount|total|subtotal|tax|balance|price|value|due)/.test(lower)) {
        const n = parseAmount(value);
        if (n !== null) {
          rawStr = value;
          value = n;
        }
      } else if (/(date|_at$|dob)/.test(lower)) {
        const iso = parseDateISO(value);
        if (iso && iso !== value) {
          rawStr = value;
          value = iso;
        }
      }
    }
    out.push({ key, label, value, raw: rawStr });
  }
  return out;
}
