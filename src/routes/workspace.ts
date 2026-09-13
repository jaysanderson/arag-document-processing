/**
 * Workspace surface: the settings and sample catalogue a signed-in user of the product
 * needs, without an admin token.
 *
 * The split from `/api/v1/admin/*` is deliberate. Settings here answers "what is this
 * deployment connected to, how does it extract, and what will it accept from me?" —
 * questions a user of the product has to be able to answer for themselves. Anything whose
 * value is a secret or an operational lever (the extract-strategy id, the routes table,
 * tokens, retention) stays behind `ADMIN_TOKEN` on the admin endpoints — and *editing* any
 * of it is an operator's job, which is why every write lives on the admin surface.
 *
 * Every value here is read through `SettingsService` rather than from a boot-time constant,
 * so an operator's edit is visible on the next request without a restart.
 */
import type { App, AragClient, PlatformEnv } from "../../vendor/arag-platform/src/index.ts";
import type { ConfigsService } from "../services/configs.ts";
import { ALLOWED_MIME } from "../services/documents.ts";
import { SAMPLES } from "../services/samples.ts";
import type { SettingsService } from "../services/settings.ts";
import { STAGES } from "../types.ts";

export interface WorkspaceDeps {
  arag: AragClient;
  env: PlatformEnv;
  configs: ConfigsService;
  settings: SettingsService;
  version: string;
}

/** Health is a KB round-trip; the settings screen polls, so reuse a recent answer. */
const HEALTH_TTL_MS = 10_000;

export function registerWorkspaceRoutes(app: App, deps: WorkspaceDeps): void {
  let cache: { at: number; version: number; value: Awaited<ReturnType<AragClient["health"]>> } | null = null;

  app.get(
    "/api/v1/settings",
    async () => {
      const eff = deps.settings.effective();
      // A settings edit rebuilds the ARAG client, so a cached health answer from the old
      // connection would be a lie: the settings version is part of the cache key.
      if (!cache || cache.version !== deps.settings.version || Date.now() - cache.at > HEALTH_TTL_MS) {
        cache = { at: Date.now(), version: deps.settings.version, value: await deps.arag.health() };
      }
      const h = cache.value;
      return {
        product: {
          name: eff.branding.productName,
          version: deps.version,
          docsUrl: "/api/v1/docs",
          openapiUrl: "/api/v1/openapi.json",
        },
        connection: {
          ok: h.ok,
          mock: deps.env.arag.mock,
          kbId: h.kbId,
          region: eff.connection.region,
          baseUrl: h.baseUrl,
          resources: h.resources ?? null,
          ms: h.ms ?? null,
          error: h.error,
          checkedAt: new Date(cache.at).toISOString(),
        },
        extraction: {
          // The boolean, never the strategy id: which visual-LLM strategy a deployment
          // runs is an operator's business (and is quoted in support tickets). DP-40.
          visualExtraction: Boolean(eff.connection.extractStrategy),
          generativeModel: eff.connection.generativeModel || h.generativeModel || "KB default",
          reranker: eff.connection.reranker || null,
          stages: [...STAGES],
          configs: deps.configs.list().length,
        },
        uploads: {
          maxBytes: eff.limits.maxUploadBytes,
          acceptedTypes: Object.keys(ALLOWED_MIME),
          acceptedExtensions: Object.values(ALLOWED_MIME).flat(),
        },
        branding: eff.branding,
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
