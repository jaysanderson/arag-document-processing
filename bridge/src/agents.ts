/**
 * Data-augmentation agents.
 *
 * Each agent is a focused, grounded call to ARAG that enriches the canonical record:
 *
 *   classify        → pick the document type (drives which extraction schema is used)
 *   extractFields   → schema-driven visual-LLM field extraction (the core step)
 *   enrichEntities  → named-entity surfacing (people, orgs, money, dates, …)
 *   summarize       → one-paragraph abstractive summary + topic tags
 *   validateNormalize → deterministic normalization + consistency checks (no model call)
 *
 * Extraction/classification use `answer_json_schema` so the model is forced to return
 * structured JSON grounded in the uploaded document (retrieval is constrained to that
 * one resource via `resourceId`). Temperature 0 keeps demos repeatable.
 */

import { ask } from "./arag.ts";
import { config } from "./config.ts";
import { log } from "./logger.ts";
import {
  type ExtractionSchema,
  toAnswerJsonSchema,
  DOC_TYPES,
} from "./schemas.ts";
import { parseAmount, parseDateISO, normalizeCurrency } from "./normalize.ts";
import type { DocRecord, DocType, Entity, ExtractedField, ValidationIssue } from "./types.ts";

const GROUNDING =
  "You are a precise document-data extraction engine. Use ONLY the content of the provided document. " +
  "Do not invent values. If a field is not present, omit it or leave it empty. Return values exactly as written in the document unless asked to normalize.";

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
const SENTINELS = new Set(["not specified", "n/a", "na", "none", "unknown", "not provided", "not available", "-"]);
function isSentinel(v: string): boolean {
  return SENTINELS.has(v.trim().toLowerCase());
}

// ─── classify ─────────────────────────────────────────────────────────────────

export async function classify(
  resourceId: string,
  querySeed: string,
): Promise<{ docType: DocType; confidence: number }> {
  const schema = {
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
        confidence: {
          type: "number",
          description: "Confidence between 0 and 1.",
        },
      },
      required: ["doc_type", "confidence"],
    },
  };
  const res = await ask({
    query: querySeed,
    resourceId,
    fullResource: true,
    prompt: { system: GROUNDING },
    answerJsonSchema: schema,
    temperature: 0,
    maxTokens: 60,
  });
  const o = obj(res.answerJson);
  const docType = (DOC_TYPES as string[]).includes(String(o.doc_type))
    ? (o.doc_type as DocType)
    : "generic";
  const confidence = typeof o.confidence === "number" ? clamp01(o.confidence) : 0.5;
  log.info("agent.classify", { resourceId, docType, confidence, ms: Math.round(res.ms) });
  return { docType, confidence };
}

// ─── extractFields ──────────────────────────────────────────────────────────

export async function extractFields(
  resourceId: string,
  schema: ExtractionSchema,
  querySeed: string,
): Promise<ExtractedField[]> {
  const res = await ask({
    query: querySeed,
    resourceId,
    fullResource: true,
    prompt: { system: GROUNDING },
    answerJsonSchema: toAnswerJsonSchema(schema),
    temperature: 0,
    maxTokens: 1500,
  });
  const o = obj(res.answerJson);
  const fields: ExtractedField[] = [];
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!(key in o)) continue;
    let value = o[key] as ExtractedField["value"];
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    if (typeof value === "string" && isSentinel(value)) continue; // "Not specified" / "N/A" / …
    // coerce numbers declared as number
    if (prop.type === "number" && typeof value === "string") {
      const n = parseAmount(value);
      if (n !== null) value = n;
    }
    const required = schema.required.includes(key);
    fields.push({
      key,
      label: schema.labels[key] ?? key,
      value,
      confidence: required ? 0.95 : 0.85,
    });
  }
  log.info("agent.extract", { resourceId, schema: schema.name, fields: fields.length, ms: Math.round(res.ms) });
  return fields;
}

// ─── enrichEntities ───────────────────────────────────────────────────────────

export async function enrichEntities(resourceId: string, querySeed: string): Promise<Entity[]> {
  const schema = {
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
  const res = await ask({
    query: querySeed,
    resourceId,
    fullResource: true,
    prompt: { system: GROUNDING },
    answerJsonSchema: schema,
    temperature: 0,
    // Generous cap: a truncated structured response yields invalid JSON and thus NO
    // answer_json at all (not a partial), so under-budgeting here drops every entity.
    maxTokens: 1500,
  });
  const o = obj(res.answerJson);
  const raw = Array.isArray(o.entities) ? o.entities : [];
  const seen = new Set<string>();
  const entities: Entity[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const text = String((e as Record<string, unknown>).text ?? "").trim();
    const type = String((e as Record<string, unknown>).type ?? "OTHER").trim().toUpperCase();
    if (!text) continue;
    const dedupe = `${type}:${text.toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    entities.push({ text, type });
  }
  log.info("agent.entities", { resourceId, count: entities.length, ms: Math.round(res.ms) });
  return entities;
}

// ─── summarize ────────────────────────────────────────────────────────────────

export async function summarize(
  resourceId: string,
  querySeed: string,
): Promise<{ summary: string; tags: string[] }> {
  const schema = {
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
  const res = await ask({
    query: querySeed,
    resourceId,
    fullResource: true,
    prompt: { system: GROUNDING },
    answerJsonSchema: schema,
    temperature: 0,
    maxTokens: 220,
  });
  const o = obj(res.answerJson);
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  const tags = Array.isArray(o.tags)
    ? o.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 6)
    : [];
  log.info("agent.summary", { resourceId, tags: tags.length, ms: Math.round(res.ms) });
  return { summary, tags };
}

// ─── validateNormalize (deterministic, no model) ────────────────────────────────

/** Keys whose values are monetary amounts (normalized to numbers). */
const AMOUNT_KEYS = new Set(["subtotal", "tax", "total", "total_value"]);

/**
 * Normalize known field types in place and emit validation issues:
 *   - amounts → numbers
 *   - *_date / date keys → ISO 8601 (records a warning if not parseable)
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
        issues.push({ field: f.key, severity: "info", message: `Date "${f.value}" left as-is (not ISO-parseable)` });
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

/** Build a fresh canonical record skeleton. */
export function emptyRecord(id: string, filename: string, contentType: string): DocRecord {
  return {
    id,
    filename,
    contentType,
    docType: "generic",
    fields: [],
    entities: [],
    tags: [],
    issues: [],
    meta: {
      processedAt: new Date().toISOString(),
      schema: "generic_extraction",
      model: config.generativeModel,
      durationsMs: {},
    },
  };
}
