/**
 * Workspace surface: the settings and sample catalogue a signed-in user of the product
 * needs, without an admin token.
 *
 * The split from `/api/v1/admin/*` is deliberate. Settings here answers "what is this
 * deployment connected to, how does it extract, and what will it accept from me?" —
 * questions a user of the product has to be able to answer for themselves. Anything whose
 * value is a secret or an operational lever (the extract-strategy id, the routes table,
 * tokens, retention) stays behind `ADMIN_TOKEN` on the admin endpoints.
 */
import type { App, AragClient, Branding, PlatformEnv } from "../../vendor/arag-platform/src/index.ts";
import type { ConfigsService } from "../services/configs.ts";
import { ALLOWED_MIME } from "../services/documents.ts";
import { SAMPLES } from "../services/samples.ts";
import { STAGES } from "../types.ts";

export interface WorkspaceDeps {
  arag: AragClient;
  env: PlatformEnv;
  branding: Branding;
  configs: ConfigsService;
  version: string;
  productName: string;
  extractStrategy: string;
  generativeModel: string;
  maxUploadBytes: number;
}

/** Health is a KB round-trip; the settings screen polls, so reuse a recent answer. */
const HEALTH_TTL_MS = 10_000;

export function registerWorkspaceRoutes(app: App, deps: WorkspaceDeps): void {
  let cache: { at: number; value: Awaited<ReturnType<AragClient["health"]>> } | null = null;

  app.get(
    "/api/v1/settings",
    async () => {
      if (!cache || Date.now() - cache.at > HEALTH_TTL_MS) {
        cache = { at: Date.now(), value: await deps.arag.health() };
      }
      const h = cache.value;
      return {
        product: {
          name: deps.productName,
          version: deps.version,
          docsUrl: "/api/v1/docs",
          openapiUrl: "/api/v1/openapi.json",
        },
        connection: {
          ok: h.ok,
          mock: deps.env.arag.mock,
          kbId: h.kbId,
          region: deps.env.arag.region,
          baseUrl: h.baseUrl,
          resources: h.resources ?? null,
          ms: h.ms ?? null,
          error: h.error,
          checkedAt: new Date(cache.at).toISOString(),
        },
        extraction: {
          // The boolean, never the strategy id: which visual-LLM strategy a deployment
          // runs is an operator's business (and is quoted in support tickets).
          visualExtraction: Boolean(deps.extractStrategy),
          generativeModel: deps.generativeModel || h.generativeModel || "KB default",
          reranker: deps.env.arag.reranker || null,
          stages: [...STAGES],
          configs: deps.configs.list().length,
        },
        uploads: {
          maxBytes: deps.maxUploadBytes,
          acceptedTypes: Object.keys(ALLOWED_MIME),
          acceptedExtensions: Object.values(ALLOWED_MIME).flat(),
        },
        branding: deps.branding,
        security: {
          apiKeysEnforced: deps.env.apiKeys.length > 0,
          adminEnabled: Boolean(deps.env.adminToken),
        },
      };
    },
    { auth: "api", operationId: "getSettings" },
  );

  app.get("/api/v1/samples", () => ({ items: [...SAMPLES] }), {
    auth: "api",
    operationId: "listSamples",
  });
}
