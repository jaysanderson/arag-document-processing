/** Operator surface. Everything here requires ADMIN_TOKEN (bearer or the arag_admin cookie). */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type App,
  type AragClient,
  badRequest,
  constantTimeEqual,
  describeEnv,
  forbidden,
  HttpError,
  type JobManager,
  type Logger,
  operationSchemas,
  type PlatformEnv,
  parseMultipart,
  payloadTooLarge,
  type Store,
  unauthorized,
  unsupportedMediaType,
} from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import type { Usage } from "../server.ts";
import type { ApiKeysService } from "../services/apikeys.ts";
import { type AuditService, type CursorDirection, pageLogRing } from "../services/audit.ts";
import type { ConfigsService } from "../services/configs.ts";
import type { DocumentsService } from "../services/documents.ts";
import type { SettingsService } from "../services/settings.ts";

export interface AdminDeps {
  arag: AragClient;
  env: PlatformEnv;
  log: Logger;
  usage: Usage;
  store: Store;
  jobs: JobManager;
  documents: DocumentsService;
  configs: ConfigsService;
  settings: SettingsService;
  apikeys: ApiKeysService;
  audit: AuditService;
  version: string;
  /** What the running process is actually using right now, read from the live objects. */
  applied: () => Record<string, unknown>;
}

/** Brand assets are small by definition; a 2 MB ceiling keeps a stray PSD out of the volume. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_MIME: Record<string, string> = {
  "image/svg+xml": ".svg",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export function registerAdminRoutes(app: App, deps: AdminDeps): void {
  app.post(
    "/api/v1/admin/login",
    (ctx) => {
      const { token } = ctx.body as { token: string };
      // STANDARDS §4: "admin disabled" is a 403 with an explanation, not a 401 that
      // implies the caller merely typed the wrong token.
      if (!deps.env.adminToken)
        throw forbidden("Admin access is disabled: set ADMIN_TOKEN to enable the admin panel.");
      if (!constantTimeEqual(token, deps.env.adminToken)) throw unauthorized("Invalid admin token");
      ctx.setCookie("arag_admin", token, { maxAge: 12 * 3600 });
      return { ok: true };
    },
    { validate: operationSchemas(openapi, "/api/v1/admin/login", "post"), operationId: "adminLogin" },
  );

  app.post(
    "/api/v1/admin/logout",
    (ctx) => {
      // No guard and no 401: an operator signing out of a shared machine must always
      // succeed, and answering differently for a caller who had no session would leak
      // whether one existed. `maxAge: 0` is what actually removes the cookie.
      ctx.setCookie("arag_admin", "", { maxAge: 0 });
      return { ok: true };
    },
    { operationId: "adminLogout" },
  );

  app.get(
    "/api/v1/admin/health",
    async () => {
      const arag = await deps.arag.health();
      const eff = deps.settings.effective();
      return {
        ok: arag.ok,
        version: deps.version,
        uptimeSec: Math.round((Date.now() - deps.usage.startedAt) / 1000),
        arag: { ...arag, mock: deps.env.arag.mock },
        extractStrategy: eff.connection.extractStrategy || null,
        generativeModel: eff.connection.generativeModel || arag.generativeModel || "KB default",
        documents: deps.documents.stats(),
        groundingScore: deps.documents.averageGroundingScore(),
      };
    },
    { auth: "admin", operationId: "adminHealth" },
  );

  app.get(
    "/api/v1/admin/config",
    () => {
      const eff = deps.settings.effective();
      return {
        env: describeEnv(deps.env),
        branding: {
          effective: eff.branding,
          howToChange:
            "Edit it in the product: Settings → Branding, or PATCH /api/v1/admin/settings. Stored " +
            "values override the environment defaults (BRAND_PRODUCT_NAME, BRAND_TAGLINE, " +
            "BRAND_LOGO_URL, BRAND_PRIMARY_COLOR, BRAND_ACCENT_COLOR, BRAND_POWERED_BY, " +
            "BRAND_FOOTER_TEXT, BRAND_DOCS_URL, BRAND_SUPPORT_URL), take effect without a restart " +
            "and are audited; POST /api/v1/admin/settings/reset returns a field to its environment " +
            "default. Logos upload to DATA_DIR/branding/ (POST /api/v1/admin/branding/logo) and are " +
            "served from /branding/. See docs/developer/white-label.md.",
        },
        product: {
          version: deps.version,
          extractStrategy: eff.connection.extractStrategy || null,
          generativeModel: eff.connection.generativeModel || "KB default",
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
      };
    },
    { auth: "admin", operationId: "adminConfig" },
  );

  app.get(
    "/api/v1/admin/usage",
    () => ({
      ...deps.usage,
      uptimeSec: Math.round((Date.now() - deps.usage.startedAt) / 1000),
      documents: deps.documents.stats(),
      groundingScore: deps.documents.averageGroundingScore(),
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

  // Paged on a stable sequence number rather than a tail: an operator reading back through
  // an incident must not have rows shuffle under them as new ones arrive.
  app.get(
    "/api/v1/admin/logs",
    (ctx) =>
      pageLogRing(deps.log.ring, {
        level: ctx.queryObj.level as string | undefined,
        contains: ctx.queryObj.contains as string | undefined,
        limit: (ctx.queryObj.limit as number | undefined) ?? 200,
        cursor: ctx.queryObj.cursor as string | undefined,
        direction: ctx.queryObj.direction as CursorDirection | undefined,
      }),
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/logs", "get"),
      operationId: "adminLogs",
    },
  );

  // Read-only window onto what the extraction agents actually run against. Without this
  // the only way to inspect a provisioned configuration is the ARAG dashboard or a script.
  app.get(
    "/api/v1/admin/search-configurations",
    async () => {
      const all = await deps.arag.listSearchConfigurations();
      const items: Array<{ name: string; kind: string; config: unknown }> = [];
      const other: string[] = [];
      for (const [name, cfg] of Object.entries(all)) {
        if (name.startsWith("dip_")) items.push({ name, kind: cfg.kind, config: cfg.config });
        else other.push(name);
      }
      items.sort((a, b) => a.name.localeCompare(b.name));
      return { items, other: other.sort() };
    },
    { auth: "admin", operationId: "adminSearchConfigurations" },
  );

  // What is protecting this deployment, in one shape. Key *values* never leave the process:
  // the count and the last four characters are what an operator needs to tell keys apart.
  app.get(
    "/api/v1/admin/security",
    () => {
      const eff = deps.settings.effective();
      const stored = deps.apikeys.list().filter((k) => !k.revoked);
      return {
        apiKeys: {
          count: deps.settings.seedApiKeys.length + stored.length,
          hints: [
            ...deps.settings.seedApiKeys.map((k) => `…${k.slice(-4)}`),
            ...stored.map((k) => `${k.prefix}…`),
          ],
          stored: stored.length,
          seeded: deps.settings.seedApiKeys.length,
        },
        adminTokenSet: Boolean(deps.env.adminToken),
        sessionTtlSec: 12 * 3600,
        cors: deps.env.allowedOrigins,
        rateLimit: { rps: deps.env.rateLimitRps, burst: deps.env.rateLimitBurst },
        maxUploadBytes: eff.limits.maxUploadBytes,
        maxBodyBytes: deps.env.maxBodyBytes,
        trustProxy: deps.env.trustProxy,
        headers: { csp: true, hsts: true, nosniff: true },
        // DP-12: deletes and config creation always need a credential, whatever API_KEYS says.
        writesRequireCredential: true,
        retention: {
          defaultOlderThanDays: eff.retention.days,
          autoPurgeEnabled: eff.retention.autoPurgeEnabled,
          purgeIntervalHours: eff.retention.purgeIntervalHours,
        },
      };
    },
    { auth: "admin", operationId: "adminSecurity" },
  );

  // Idempotent by design (STANDARDS §2): safe to re-run after a KB reset or a model change.
  app.post(
    "/api/v1/admin/provision",
    async () => {
      const items = await deps.configs.provisionAll();
      const ok = items.filter((i) => i.ok).length;
      const failed = items.filter((i) => !i.ok).length;
      deps.audit.record({ action: "config.provisionAll", target: "*", after: { ok, failed } });
      return { items, ok, failed };
    },
    { auth: "admin", operationId: "adminProvision" },
  );

  // Data retention: uploads otherwise live in the KB forever (AUDIT finding). The default
  // threshold is the editable retention setting, not a constant.
  app.post(
    "/api/v1/admin/purge",
    async (ctx) => {
      const body = (ctx.body ?? {}) as { olderThanDays?: number; dryRun?: boolean };
      const olderThanDays = body.olderThanDays ?? deps.settings.effective().retention.days;
      const dryRun = body.dryRun === true;
      const out = await deps.documents.purge(olderThanDays, dryRun);
      return { olderThanDays, dryRun, ...out };
    },
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/purge", "post"),
      operationId: "adminPurge",
    },
  );

  // ─── settings, API keys and audit ───────────────────────────────────────────
  // The full-implementation pass: every setting the product reads is editable here, takes
  // effect without a restart, and is audited. Secrets are write-only.

  const settingsPayload = () => ({ ...deps.settings.describe(), applied: deps.applied() });

  app.get("/api/v1/admin/settings", () => settingsPayload(), {
    auth: "admin",
    operationId: "adminGetSettings",
  });

  app.patch(
    "/api/v1/admin/settings",
    (ctx) => {
      const changed = deps.settings.patch((ctx.body ?? {}) as Record<string, unknown>);
      for (const c of changed) {
        deps.audit.record({
          action: "settings.update",
          target: c.key,
          before: c.secret ? "***" : c.before,
          after: c.secret ? "***" : c.after,
          detail: c.secret ? "secret rotated" : undefined,
        });
      }
      return { changed, settings: settingsPayload() };
    },
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/settings", "patch"),
      operationId: "adminUpdateSettings",
    },
  );

  app.post(
    "/api/v1/admin/settings/reset",
    (ctx) => {
      const { keys } = ctx.body as { keys: string[] };
      const changed = deps.settings.reset(keys);
      for (const c of changed) {
        deps.audit.record({
          action: "settings.reset",
          target: c.key,
          before: c.secret ? "***" : c.before,
          after: c.secret ? "***" : c.after,
          detail: "reset to the environment default",
        });
      }
      return { changed, settings: settingsPayload() };
    },
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/settings/reset", "post"),
      operationId: "adminResetSettings",
    },
  );

  app.post(
    "/api/v1/admin/branding/logo",
    (ctx) => {
      const contentType = ctx.header("content-type") ?? "";
      let file: { filename: string; contentType: string; data: Buffer } | undefined;
      if (contentType.toLowerCase().startsWith("multipart/form-data")) {
        try {
          const parsed = parseMultipart(ctx.rawBody ?? Buffer.alloc(0), contentType);
          file = parsed.files.find((f) => f.field === "file") ?? parsed.files[0];
        } catch (err) {
          if (err instanceof HttpError) throw err;
          throw badRequest(`Could not parse the multipart body: ${(err as Error).message}`);
        }
      } else if (ctx.rawBody?.length) {
        // `curl --data-binary @logo.svg -H 'X-Filename: logo.svg'` works too.
        file = {
          filename: ctx.header("x-filename") ?? "logo",
          contentType: contentType.split(";")[0]!.trim(),
          data: ctx.rawBody,
        };
      }
      if (!file || file.data.length === 0)
        throw badRequest("Send a multipart/form-data body with a `file` part, or raw bytes with X-Filename.");
      if (file.data.length > MAX_LOGO_BYTES) throw payloadTooLarge(MAX_LOGO_BYTES);
      const ext = LOGO_MIME[file.contentType.toLowerCase()];
      if (!ext)
        throw unsupportedMediaType(
          `A brand logo must be one of ${Object.keys(LOGO_MIME).join(", ")}; got ${file.contentType || "nothing"}.`,
        );
      // The name is ours, not the caller's: a logo is a singleton, and a caller-supplied
      // name is a path-traversal question we do not need to answer.
      const filename = `logo${ext}`;
      const dir = resolve(deps.env.dataDir, "branding");
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, filename), file.data);
      const url = `/branding/${filename}`;
      const changed = deps.settings.patch({ "branding.logoUrl": url });
      deps.audit.record({
        action: "branding.logo",
        target: filename,
        before: changed[0]?.before ?? null,
        after: url,
        detail: `${file.data.length} bytes, ${file.contentType}`,
      });
      ctx.json(
        201,
        {
          url,
          filename,
          bytes: file.data.length,
          contentType: file.contentType,
          settings: settingsPayload(),
        },
        { Location: url },
      );
    },
    {
      auth: "admin",
      body: "raw",
      bodyLimit: MAX_LOGO_BYTES + 4096,
      operationId: "adminUploadBrandingLogo",
    },
  );

  app.get(
    "/api/v1/admin/api-keys",
    () => ({
      items: deps.apikeys.list(),
      enforced: deps.env.apiKeys.length > 0,
      seeded: deps.settings.seedApiKeys.length,
    }),
    { auth: "admin", operationId: "adminListApiKeys" },
  );

  app.post(
    "/api/v1/admin/api-keys",
    (ctx) => {
      const { name } = ctx.body as { name: string };
      const created = deps.apikeys.create({ name, createdBy: describeActor(ctx.auth.via) });
      deps.audit.record({
        action: "apikey.create",
        target: created.record.id,
        before: null,
        // The key itself is never audited — only that one was created, and which one.
        after: { id: created.record.id, name: created.record.name, prefix: created.record.prefix },
      });
      ctx.json(
        201,
        { key: created.key, apiKey: created.record },
        {
          Location: `/api/v1/admin/api-keys/${created.record.id}`,
        },
      );
    },
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/api-keys", "post"),
      operationId: "adminCreateApiKey",
    },
  );

  app.delete(
    "/api/v1/admin/api-keys/:id",
    (ctx) => {
      const before = deps.apikeys.get(ctx.params.id!);
      const revoked = deps.apikeys.revoke(ctx.params.id!);
      if (!revoked) throw new HttpError(404, "Not found", "API key not found");
      deps.audit.record({
        action: "apikey.revoke",
        target: revoked.id,
        before: { revoked: before?.revoked ?? false },
        after: { revoked: true, name: revoked.name, prefix: revoked.prefix },
      });
      return revoked;
    },
    { auth: "admin", operationId: "adminRevokeApiKey" },
  );

  app.get(
    "/api/v1/admin/audit",
    (ctx) => ({
      ...deps.audit.page({
        limit: (ctx.queryObj.limit as number | undefined) ?? 50,
        cursor: ctx.queryObj.cursor as string | undefined,
        direction: ctx.queryObj.direction as CursorDirection | undefined,
        action: ctx.queryObj.action as string | undefined,
        actor: ctx.queryObj.actor as string | undefined,
        target: ctx.queryObj.target as string | undefined,
      }),
      actions: deps.audit.actions(),
    }),
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/audit", "get"),
      operationId: "adminAuditLog",
    },
  );
}

function describeActor(via: string): string {
  return via === "admin-token" ? "admin token" : via === "api-key" ? "API key" : via;
}
