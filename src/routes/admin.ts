/** Operator surface. Everything here requires ADMIN_TOKEN (bearer or the arag_admin cookie). */
import {
  type App,
  type AragClient,
  constantTimeEqual,
  describeEnv,
  type JobManager,
  type Logger,
  operationSchemas,
  type PlatformEnv,
  type Store,
  unauthorized,
} from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import type { Usage } from "../server.ts";
import type { ConfigsService } from "../services/configs.ts";
import type { DocumentsService } from "../services/documents.ts";

export interface AdminDeps {
  arag: AragClient;
  env: PlatformEnv;
  log: Logger;
  usage: Usage;
  store: Store;
  jobs: JobManager;
  documents: DocumentsService;
  configs: ConfigsService;
  version: string;
  extractStrategy: string;
  generativeModel: string;
}

export function registerAdminRoutes(app: App, deps: AdminDeps): void {
  app.post(
    "/api/v1/admin/login",
    (ctx) => {
      const { token } = ctx.body as { token: string };
      if (!deps.env.adminToken || !constantTimeEqual(token, deps.env.adminToken))
        throw unauthorized("Invalid admin token");
      ctx.setCookie("arag_admin", token, { maxAge: 12 * 3600 });
      return { ok: true };
    },
    { validate: operationSchemas(openapi, "/api/v1/admin/login", "post"), operationId: "adminLogin" },
  );

  app.get(
    "/api/v1/admin/health",
    async () => {
      const arag = await deps.arag.health();
      return {
        ok: arag.ok,
        version: deps.version,
        uptimeSec: Math.round((Date.now() - deps.usage.startedAt) / 1000),
        arag: { ...arag, mock: deps.env.arag.mock },
        extractStrategy: deps.extractStrategy || null,
        generativeModel: deps.generativeModel || arag.generativeModel || "KB default",
        documents: deps.documents.stats(),
      };
    },
    { auth: "admin", operationId: "adminHealth" },
  );

  app.get(
    "/api/v1/admin/config",
    () => ({
      env: describeEnv(deps.env),
      product: {
        version: deps.version,
        extractStrategy: deps.extractStrategy || null,
        generativeModel: deps.generativeModel || "KB default",
      },
      stores: deps.store.stats(),
      extractionConfigs: deps.configs.list().map((c) => ({
        id: c.id,
        name: c.name,
        builtin: c.builtin,
        aragConfig: c.aragConfig,
        provisioned: c.provisioned,
        fields: c.fields.length,
      })),
      routes: app.listRoutes(),
    }),
    { auth: "admin", operationId: "adminConfig" },
  );

  app.get(
    "/api/v1/admin/usage",
    () => ({
      ...deps.usage,
      uptimeSec: Math.round((Date.now() - deps.usage.startedAt) / 1000),
      documents: deps.documents.stats(),
      jobs: {
        queued: deps.jobs.count({ status: "queued" }),
        running: deps.jobs.count({ status: "running" }),
        succeeded: deps.jobs.count({ status: "succeeded" }),
        failed: deps.jobs.count({ status: "failed" }),
        cancelled: deps.jobs.count({ status: "cancelled" }),
      },
    }),
    { auth: "admin", operationId: "adminUsage" },
  );

  app.get(
    "/api/v1/admin/logs",
    (ctx) => ({
      items: deps.log.recent({
        level: ctx.queryObj.level as never,
        contains: ctx.queryObj.contains as string | undefined,
        limit: ctx.queryObj.limit as number | undefined,
      }),
    }),
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/logs", "get"),
      operationId: "adminLogs",
    },
  );

  // Idempotent by design (STANDARDS §2): safe to re-run after a KB reset or a model change.
  app.post(
    "/api/v1/admin/provision",
    async () => {
      const items = await deps.configs.provisionAll();
      return { items, ok: items.filter((i) => i.ok).length, failed: items.filter((i) => !i.ok).length };
    },
    { auth: "admin", operationId: "adminProvision" },
  );

  // Data retention: uploads otherwise live in the KB forever (AUDIT finding).
  app.post(
    "/api/v1/admin/purge",
    async (ctx) => {
      const body = (ctx.body ?? {}) as { olderThanDays?: number };
      const olderThanDays = body.olderThanDays ?? 30;
      const out = await deps.documents.purge(olderThanDays);
      return { olderThanDays, ...out };
    },
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/purge", "post"),
      operationId: "adminPurge",
    },
  );
}
