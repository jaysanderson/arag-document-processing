/** HTTP surface for human review: field corrections and the cross-document ask. */
import { type App, badRequest, type Ctx, operationSchemas } from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import type { DocumentsService, SortKey } from "../services/documents.ts";
import type { FieldValue, ReviewService } from "../services/review.ts";
import { requireWriter } from "./guards.ts";

/**
 * Who made a change, for the record's review history and the audit log. Never a
 * credential: an API key is identified by nothing more than the fact that one was used,
 * because the key store (not this route) owns the mapping from key to name.
 *
 * Defined here rather than in `guards.ts` so the audit service can supply a richer actor
 * later without this route changing shape.
 */
function actorOf(ctx: Ctx): string {
  if (ctx.auth.admin) return "admin";
  if (ctx.auth.apiKey) return "api-key";
  return "session";
}

export function registerReviewRoutes(
  app: App,
  deps: { review: ReviewService; documents: DocumentsService },
): void {
  /**
   * Correct one extracted field.
   *
   * A write against shared state, so it takes the same credential as a delete (DP-12) —
   * and unlike a delete it is attributable, so the actor is recorded on the record and in
   * the audit log rather than only in the request log.
   */
  app.put(
    "/api/v1/documents/:id/fields/:key",
    async (ctx) => {
      requireWriter(ctx);
      const { value, reason } = ctx.body as { value: FieldValue; reason?: string };
      if (value === undefined) throw badRequest("`value` is required (use null to clear the field).");
      const out = await deps.review
        .correctField(ctx.params.id!, {
          field: ctx.params.key!,
          value,
          reason,
          actor: actorOf(ctx),
        })
        .catch((err) => {
          if (/^unknown field: /.test((err as Error).message)) throw badRequest((err as Error).message);
          throw err;
        });
      return out;
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/documents/{id}/fields/{key}", "put"),
      operationId: "correctDocumentField",
    },
  );

  /** Undo the most recent correction to a field, restoring the value it replaced. */
  app.delete(
    "/api/v1/documents/:id/fields/:key",
    async (ctx) => {
      requireWriter(ctx);
      return await deps.review.revertField(ctx.params.id!, ctx.params.key!, actorOf(ctx)).catch((err) => {
        if (/^no correction to revert/.test((err as Error).message)) throw badRequest((err as Error).message);
        throw err;
      });
    },
    { auth: "api", operationId: "revertDocumentField" },
  );

  /** The corrections made to one record, newest first — the record's review history. */
  app.get(
    "/api/v1/documents/:id/corrections",
    (ctx) => {
      const rec = deps.documents.require(ctx.params.id!) as { corrections?: unknown[] };
      return { items: [...(rec.corrections ?? [])].reverse() };
    },
    { auth: "api", operationId: "listDocumentCorrections" },
  );

  /**
   * Ask one question across a filtered set of documents.
   *
   * Same rate-limit bucket reasoning as the per-document ask (DP-41): every ask is a real
   * generative call. This one retrieves over many resources rather than one, so it is
   * slightly more expensive and gets the same tight bucket rather than a looser one.
   */
  app.post(
    "/api/v1/ask",
    async (ctx) => {
      const body = ctx.body as {
        question: string;
        filters?: Record<string, unknown>;
        maxResources?: number;
      };
      const question = String(body.question ?? "").trim();
      if (!question) throw badRequest("`question` is required.");
      const f = body.filters ?? {};
      return await deps.review.askCorpus(question, {
        maxResources: body.maxResources,
        filters: {
          q: f.q as string | undefined,
          config: f.config as string | undefined,
          docTypes: f.doc_type as string[] | undefined,
          dateFrom: f.date_from as string | undefined,
          dateTo: f.date_to as string | undefined,
          hasIssues: f.has_issues as boolean | undefined,
          degraded: f.degraded as boolean | undefined,
          minGrounding: f.min_grounding === undefined ? undefined : Number(f.min_grounding),
          sort: f.sort as SortKey | undefined,
          order: f.order as "asc" | "desc" | undefined,
        },
      });
    },
    {
      auth: "api",
      rateLimit: { rps: 1, burst: 6 },
      validate: operationSchemas(openapi, "/api/v1/ask", "post"),
      operationId: "askCorpus",
    },
  );
}
