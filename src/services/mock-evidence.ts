/**
 * Mock-only: make the mock ARAG honour the evidence contract.
 *
 * The mock synthesises structured extraction from fixture text, but it has no notion of
 * our `evidence` property — it would fill it with arbitrary lines, which is worse than
 * nothing because the verifier would then mark real fields "unverified" and the demo would
 * show a grounding score of 0 for a document it extracted perfectly.
 *
 * This is supplied as an `answerHook` (the platform's documented seam) rather than by
 * editing vendored files: it reuses the mock's own `synthesizeJson` for the fields, then
 * appends evidence by finding, for each extracted value, the line of the document that
 * actually contains it. Those quotes are real substrings of the fixture text, so they
 * verify as `exact` — exactly as a well-behaved model's would.
 */
import { mockFixtures } from "../../vendor/arag-platform/src/index.ts";

interface HookRequest {
  query?: string;
  search_configuration?: string;
  answer_json_schema?: {
    name?: string;
    parameters?: { properties?: Record<string, unknown>; required?: string[] };
  };
}

interface HookContext {
  text: string;
  resources: Array<{ title: string }>;
}

/** Longest line of `text` that contains `value`, trimmed — the natural supporting quote. */
export function quoteFor(text: string, value: string): string | undefined {
  const needle = value.trim();
  if (needle.length < 3) return undefined;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.includes(needle)) return trimmed;
  }
  return undefined;
}

/**
 * Build `evidence` for an already-synthesised answer: one entry per scalar field whose
 * value can be found verbatim in the document.
 */
export function evidenceFor(
  answer: Record<string, unknown>,
  schemaProperties: Record<string, unknown>,
  text: string,
): Array<{ field: string; quote: string }> {
  const out: Array<{ field: string; quote: string }> = [];
  for (const [field, value] of Object.entries(answer)) {
    if (field === "evidence" || !(field in schemaProperties)) continue;
    const scalar = Array.isArray(value) ? value[0] : value;
    if (typeof scalar !== "string" && typeof scalar !== "number") continue;
    const quote = quoteFor(text, String(scalar));
    if (quote) out.push({ field, quote });
  }
  return out;
}

/**
 * The hook itself. Returns null for anything that is not a schema-driven extraction, so
 * classification, entities, summaries and plain asks keep the mock's default behaviour.
 */
export function mockEvidenceHook(req: HookRequest, ctx: HookContext): { answerJson?: unknown } | null {
  const schema = req.answer_json_schema;
  const properties = schema?.parameters?.properties;
  if (!properties || !("evidence" in properties)) return null;
  const answer = mockFixtures.synthesizeJson(
    schema as Parameters<typeof mockFixtures.synthesizeJson>[0],
    ctx.text,
    ctx.resources[0]?.title ?? "document",
    req.query ?? "",
  );
  delete answer.evidence; // the generic synthesiser fills it with unrelated lines
  answer.evidence = evidenceFor(answer, properties, ctx.text);
  return { answerJson: answer };
}
