/**
 * Runtime settings: environment variables are *defaults*, the product's JSON store is the
 * override, and the effective view is live — an edit takes effect on the next request, with
 * no restart (FULL-IMPLEMENTATION-BRIEF bar #1).
 *
 * Three layers, in precedence order:
 *
 *   1. `store`   — an operator edited it in the product (`PATCH /api/v1/admin/settings`).
 *   2. `env`     — the deployment set the field's environment variable.
 *   3. `default` — the platform's or the product's built-in value.
 *
 * Every field reports which layer it came from, so the UI can render "overridden from the
 * environment default" and offer a reset. Secrets are write-only: they are accepted, applied
 * to behaviour (the ARAG client, the admin token) and then reported as
 * `{ set: true, hint: "…abcd" }` — never returned, never logged, never audited in the clear.
 *
 * Nothing here reaches into HTTP. `routes/admin.ts` is the only caller that writes.
 */
import { randomBytes } from "node:crypto";
import {
  type Branding,
  isSafeColor,
  type Logger,
  type LogLevel,
  type PlatformEnv,
  readBranding,
  type Store,
  type StoredDoc,
  validationError,
} from "../../vendor/arag-platform/src/index.ts";

/** Which layer an effective value came from. */
export type SettingSource = "store" | "env" | "default";

export type SettingGroupId = "branding" | "connection" | "limits" | "security" | "retention" | "operations";

export type SettingValue = string | number | boolean | string[];

export interface SettingDef {
  /** Dotted key, e.g. `branding.productName`. Also the patch path. */
  key: string;
  group: SettingGroupId;
  label: string;
  description: string;
  type: "string" | "number" | "boolean" | "color" | "uuid" | "enum" | "url" | "list";
  /** Environment variable that supplies the default. */
  envVar: string;
  /** Write-only: never returned by any GET. */
  secret?: boolean;
  /**
   * Value stays behind ADMIN_TOKEN and never appears on `GET /api/v1/settings` (DP-40 keeps
   * the extract-strategy id out of the viewer-facing payload).
   */
  adminOnly?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  values?: readonly string[];
  /** Free-text note rendered next to the field (units, consequences). */
  hint?: string;
}

export interface SettingGroupDef {
  id: SettingGroupId;
  label: string;
  description: string;
}

export const SETTING_GROUPS: readonly SettingGroupDef[] = [
  {
    id: "branding",
    label: "Branding",
    description:
      "White-label presentation only. Branding never recolours status, verification, grounding " +
      "or validation (DP-35), and never changes the API contract (DP-30).",
  },
  {
    id: "connection",
    label: "Connection",
    description: "Which Knowledge Box this deployment talks to, and how it extracts.",
  },
  { id: "limits", label: "Limits", description: "Upload ceiling, body ceiling and rate limits." },
  {
    id: "security",
    label: "Security",
    description: "Credentials in force, CORS and the proxy header the client IP is read from.",
  },
  { id: "retention", label: "Retention", description: "How long documents are kept, and automatic purge." },
  { id: "operations", label: "Operations", description: "Log verbosity and other operational levers." },
] as const;

/** The settings inventory. Every entry is editable in the product; nothing here is read-only. */
export const SETTING_DEFS: readonly SettingDef[] = [
  // ── branding ───────────────────────────────────────────────────────────────
  {
    key: "branding.productName",
    group: "branding",
    label: "Product name",
    description: "Shown in the header, the page title and the docs link. The OpenAPI title is unaffected.",
    type: "string",
    envVar: "BRAND_PRODUCT_NAME",
    maxLength: 80,
  },
  {
    key: "branding.tagline",
    group: "branding",
    label: "Tagline",
    description: "One line under the product name.",
    type: "string",
    envVar: "BRAND_TAGLINE",
    maxLength: 160,
  },
  {
    key: "branding.logoUrl",
    group: "branding",
    label: "Logo URL",
    description:
      "Absolute URL or a path this deployment serves. Uploading a logo file sets it to " +
      "`/branding/<file>` automatically.",
    type: "url",
    envVar: "BRAND_LOGO_URL",
    maxLength: 300,
  },
  {
    key: "branding.primaryColor",
    group: "branding",
    label: "Primary colour",
    description:
      "Brand colour. Must match the platform's strict colour grammar (hex, rgb(), hsl(), keyword).",
    type: "color",
    envVar: "BRAND_PRIMARY_COLOR",
    hint: "Never applied to status, verification, grounding or validation colours (DP-35).",
  },
  {
    key: "branding.accentColor",
    group: "branding",
    label: "Accent colour",
    description: "Secondary brand colour, same grammar as the primary colour.",
    type: "color",
    envVar: "BRAND_ACCENT_COLOR",
    hint: "Never applied to status, verification, grounding or validation colours (DP-35).",
  },
  {
    key: "branding.poweredBy",
    group: "branding",
    label: "Show the Progress Agentic RAG credit",
    description: "Partners may hide the credit band; attribution stays in LICENSE and NOTICE.",
    type: "boolean",
    envVar: "BRAND_POWERED_BY",
  },
  {
    key: "branding.footerText",
    group: "branding",
    label: "Footer text",
    description: "Copyright or legal line in the footer.",
    type: "string",
    envVar: "BRAND_FOOTER_TEXT",
    maxLength: 200,
  },
  {
    key: "branding.docsUrl",
    group: "branding",
    label: "Docs link",
    description: "Where the header's documentation link points. Defaults to this product's own API docs.",
    type: "url",
    envVar: "BRAND_DOCS_URL",
    maxLength: 300,
  },
  {
    key: "branding.supportUrl",
    group: "branding",
    label: "Support link",
    description: "Where the support link points. Empty hides the link.",
    type: "url",
    envVar: "BRAND_SUPPORT_URL",
    maxLength: 300,
  },

  // ── connection ─────────────────────────────────────────────────────────────
  {
    key: "connection.kbId",
    group: "connection",
    label: "Knowledge Box id",
    description: "The KB every document is written to and every agent reads from. Must be a UUID.",
    type: "uuid",
    envVar: "ARAG_KB_ID",
  },
  {
    key: "connection.region",
    group: "connection",
    label: "Region",
    description: "Zone slug used to build the base URL when no explicit base URL is set.",
    type: "string",
    envVar: "ARAG_REGION",
    maxLength: 60,
  },
  {
    key: "connection.baseUrl",
    group: "connection",
    label: "Base URL",
    description: "Full API base URL override (…/api/v1). Takes precedence over the region.",
    type: "url",
    envVar: "ARAG_BASE_URL",
    maxLength: 300,
  },
  {
    key: "connection.apiKey",
    group: "connection",
    label: "Service-account key",
    description:
      "ARAG service-account token. Write-only: set it once, then rotate it. It is never returned " +
      "by any endpoint and never written to the audit log or the request log.",
    type: "string",
    envVar: "ARAG_API_KEY",
    secret: true,
    adminOnly: true,
    maxLength: 500,
  },
  {
    key: "connection.generativeModel",
    group: "connection",
    label: "Generative model",
    description:
      "Model the extraction, summary and ask agents run on. Empty means the Knowledge Box default. " +
      "Re-provision after changing it so the stored search configurations carry the new model.",
    type: "string",
    envVar: "ARAG_GENERATIVE_MODEL",
    maxLength: 120,
  },
  {
    key: "connection.reranker",
    group: "connection",
    label: "Reranker",
    description: "Reranker used by the stored search configurations.",
    type: "enum",
    envVar: "ARAG_RERANKER",
    values: ["predict", "noop"],
  },
  {
    key: "connection.timeoutMs",
    group: "connection",
    label: "Request timeout (ms)",
    description: "Per-request timeout for every call to ARAG.",
    type: "number",
    envVar: "ARAG_TIMEOUT_MS",
    min: 1000,
    max: 600_000,
  },
  {
    key: "connection.extractStrategy",
    group: "connection",
    label: "Extract strategy id",
    description:
      "Ingestion-time visual-LLM extract strategy applied to PDFs and images. Empty disables " +
      "visual extraction. The id stays behind ADMIN_TOKEN; `GET /api/v1/settings` publishes only " +
      "the boolean (DP-40).",
    type: "string",
    envVar: "DIP_EXTRACT_STRATEGY",
    adminOnly: true,
    maxLength: 120,
  },

  // ── limits ─────────────────────────────────────────────────────────────────
  {
    key: "limits.maxUploadBytes",
    group: "limits",
    label: "Max upload size (bytes)",
    description: "Uploads above this are rejected with 413 before anything reaches the Knowledge Box.",
    type: "number",
    envVar: "DIP_MAX_UPLOAD_BYTES",
    min: 1024,
    max: 1_073_741_824,
  },
  {
    key: "limits.maxBodyBytes",
    group: "limits",
    label: "Max request body (bytes)",
    description: "Transport ceiling for any request body. Keep it at or above the upload ceiling.",
    type: "number",
    envVar: "MAX_BODY_BYTES",
    min: 1024,
    max: 1_073_741_824,
  },
  {
    key: "limits.rateLimitRps",
    group: "limits",
    label: "Rate limit (requests/second)",
    description: "Sustained request rate per API key or client IP. 0 disables rate limiting.",
    type: "number",
    envVar: "RATE_LIMIT_RPS",
    min: 0,
    max: 1000,
  },
  {
    key: "limits.rateLimitBurst",
    group: "limits",
    label: "Rate limit burst",
    description: "Bucket size: how many requests may arrive at once before the rate applies.",
    type: "number",
    envVar: "RATE_LIMIT_BURST",
    min: 1,
    max: 10_000,
  },

  // ── security ───────────────────────────────────────────────────────────────
  {
    key: "security.adminToken",
    group: "security",
    label: "Admin token",
    description:
      "Bearer token that protects /admin and /api/v1/admin. Write-only: set once, then rotate. " +
      "Rotating it signs every open admin cookie out immediately.",
    type: "string",
    envVar: "ADMIN_TOKEN",
    secret: true,
    adminOnly: true,
    maxLength: 400,
  },
  {
    key: "security.requireApiKey",
    group: "security",
    label: "Require an API key",
    description:
      "When on, every `/api/v1` read needs an API key, the admin token or a same-origin session. " +
      "Writes to shared state always need a credential either way (DP-12).",
    type: "boolean",
    envVar: "API_KEYS",
  },
  {
    key: "security.allowedOrigins",
    group: "security",
    label: "Allowed CORS origins",
    description: "Origins allowed to call the API from a browser. `*` allows any origin.",
    type: "list",
    envVar: "ALLOWED_ORIGINS",
  },
  {
    key: "security.trustProxy",
    group: "security",
    label: "Trusted proxy header",
    description:
      "Which header the client IP is read from for rate limiting and logs: `fly` (Fly-Client-IP), " +
      "`xff` (X-Forwarded-For) or `none` (the socket address).",
    type: "enum",
    envVar: "TRUST_PROXY",
    values: ["fly", "xff", "none"],
  },

  // ── retention ──────────────────────────────────────────────────────────────
  {
    key: "retention.days",
    group: "retention",
    label: "Retention (days)",
    description:
      "Documents older than this are the ones `POST /api/v1/admin/purge` deletes when the request " +
      "does not name its own threshold. Also the default the purge dialog previews.",
    type: "number",
    envVar: "DIP_RETENTION_DAYS",
    min: 0,
    max: 3650,
  },
  {
    key: "retention.autoPurgeEnabled",
    group: "retention",
    label: "Purge automatically",
    description:
      "Run the purge on a schedule instead of waiting for an operator. Every automatic run is " +
      "audited exactly like a manual one.",
    type: "boolean",
    envVar: "DIP_AUTO_PURGE",
  },
  {
    key: "retention.purgeIntervalHours",
    group: "retention",
    label: "Purge interval (hours)",
    description: "How often the automatic purge runs when it is enabled.",
    type: "number",
    envVar: "DIP_PURGE_INTERVAL_HOURS",
    min: 1,
    max: 8760,
  },

  // ── operations ─────────────────────────────────────────────────────────────
  {
    key: "operations.logLevel",
    group: "operations",
    label: "Log level",
    description: "Verbosity of the structured log and of the ring buffer `/api/v1/admin/logs` reads.",
    type: "enum",
    envVar: "LOG_LEVEL",
    values: ["debug", "info", "warn", "error"],
  },
] as const;

const DEFS_BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]));

/** The effective, typed settings the rest of the product reads. */
export interface EffectiveSettings {
  branding: Branding;
  connection: {
    kbId: string;
    region: string;
    baseUrl: string;
    apiKey: string;
    generativeModel: string;
    reranker: string;
    timeoutMs: number;
    extractStrategy: string;
  };
  limits: { maxUploadBytes: number; maxBodyBytes: number; rateLimitRps: number; rateLimitBurst: number };
  security: {
    adminToken: string;
    requireApiKey: boolean;
    allowedOrigins: string[];
    trustProxy: "fly" | "xff" | "none";
  };
  retention: { days: number; autoPurgeEnabled: boolean; purgeIntervalHours: number };
  operations: { logLevel: LogLevel };
}

/** One field as the settings screen renders it. */
export interface DescribedSetting {
  key: string;
  group: SettingGroupId;
  label: string;
  description: string;
  type: SettingDef["type"];
  envVar: string;
  secret: boolean;
  adminOnly: boolean;
  source: SettingSource;
  /** Effective value; always `null` for a secret. */
  value: SettingValue | null;
  /** Secrets only: whether a value is in force. */
  set?: boolean;
  /** Secrets only: the last four characters, so an operator can tell two keys apart. */
  hint?: string;
  /** True when the environment supplies this field's default (so a reset has somewhere to go). */
  envSet: boolean;
  constraints?: { min?: number; max?: number; maxLength?: number; values?: readonly string[] };
  note?: string;
}

interface SettingsDoc extends StoredDoc {
  id: "current";
  /** Only the keys an operator has actually set. */
  values: Record<string, SettingValue>;
  version: number;
}

export interface SettingsOptions {
  store: Store;
  /** Mutated in place when a setting changes: the platform reads these live on every request. */
  env: PlatformEnv;
  log: Logger;
  /** Raw environment, used only to decide whether a field's default came from the environment. */
  envSource?: Record<string, string | undefined>;
  /** Product defaults for branding fields the environment does not set. */
  brandingDefaults?: Partial<Branding>;
  /** Values that replace the environment-derived baseline (the mock ARAG owns the connection). */
  baselineOverrides?: Record<string, SettingValue>;
  /** Keys whose environment variable must be ignored when reporting the source. */
  ignoreEnv?: readonly string[];
}

/** A settings change, as handed to listeners and to the audit log. */
export interface SettingsChange {
  key: string;
  /** Null for a secret: the audit log records that it changed, never what it changed to. */
  before: SettingValue | null;
  after: SettingValue | null;
  secret: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Absolute http(s) URL or a root-relative path. Anything else (javascript:, data:) is rejected. */
const URL_RE = /^(https?:\/\/[^\s"'<>]+|\/[^\s"'<>]*)$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function hintFor(secret: string): string {
  return secret ? `…${secret.slice(-4)}` : "";
}

export class SettingsService {
  private readonly o: SettingsOptions;
  private readonly col;
  private readonly baseline: Record<string, SettingValue>;
  private readonly envSet: Set<string>;
  private overrides: Record<string, SettingValue>;
  private cache: EffectiveSettings | null = null;
  private readonly listeners: Array<(changed: string[], eff: EffectiveSettings) => void> = [];
  /**
   * Turns API-key enforcement on when the deployment configured no `API_KEYS`: the platform
   * enforces `auth: "api"` only when `env.apiKeys` is non-empty, so the toggle needs a value in
   * there. It is 64 random hex characters, is never returned by any endpoint, and authenticates
   * nothing an attacker could guess.
   */
  private readonly enforcementSentinel = randomBytes(32).toString("hex");
  /** API keys the environment seeded, kept so they keep working whatever the toggle says. */
  readonly seedApiKeys: readonly string[];
  version = 1;

  constructor(opts: SettingsOptions) {
    this.o = opts;
    this.col = opts.store.collection<SettingsDoc>("settings");
    this.seedApiKeys = [...opts.env.apiKeys];
    const src = opts.envSource ?? process.env;
    const ignore = new Set(opts.ignoreEnv ?? []);
    const branding = readBranding(src, opts.brandingDefaults);
    const env = opts.env;
    this.baseline = {
      "branding.productName": branding.productName,
      "branding.tagline": branding.tagline,
      "branding.logoUrl": branding.logoUrl,
      "branding.primaryColor": branding.primaryColor,
      "branding.accentColor": branding.accentColor,
      "branding.poweredBy": branding.poweredBy,
      "branding.footerText": branding.footerText,
      "branding.docsUrl": branding.docsUrl,
      "branding.supportUrl": branding.supportUrl,
      "connection.kbId": env.arag.kbId,
      "connection.region": env.arag.region,
      "connection.baseUrl": env.arag.baseUrl,
      "connection.apiKey": env.arag.apiKey,
      "connection.generativeModel": env.arag.generativeModel,
      "connection.reranker": env.arag.reranker,
      "connection.timeoutMs": env.arag.timeoutMs,
      "connection.extractStrategy": src.DIP_EXTRACT_STRATEGY || src.ARAG_EXTRACT_STRATEGY || "",
      "limits.maxUploadBytes": Number(src.DIP_MAX_UPLOAD_BYTES || src.MAX_UPLOAD_BYTES || 26_214_400),
      "limits.maxBodyBytes": env.maxBodyBytes,
      "limits.rateLimitRps": env.rateLimitRps,
      "limits.rateLimitBurst": env.rateLimitBurst,
      "security.adminToken": env.adminToken,
      "security.requireApiKey": env.apiKeys.length > 0,
      "security.allowedOrigins": [...env.allowedOrigins],
      "security.trustProxy": env.trustProxy,
      "retention.days": Number(src.DIP_RETENTION_DAYS || 30),
      "retention.autoPurgeEnabled": ["1", "true", "yes", "on"].includes(
        String(src.DIP_AUTO_PURGE ?? "").toLowerCase(),
      ),
      "retention.purgeIntervalHours": Number(src.DIP_PURGE_INTERVAL_HOURS || 24),
      "operations.logLevel": env.logLevel,
      ...(opts.baselineOverrides ?? {}),
    };
    this.envSet = new Set(
      SETTING_DEFS.filter((d) => src[d.envVar] !== undefined && src[d.envVar] !== "").map((d) => d.key),
    );
    // Legacy aliases still count as "set from the environment".
    if (src.ARAG_EXTRACT_STRATEGY) this.envSet.add("connection.extractStrategy");
    if (src.MAX_UPLOAD_BYTES) this.envSet.add("limits.maxUploadBytes");
    for (const key of ignore) this.envSet.delete(key);

    const doc = this.col.get("current");
    this.overrides = { ...(doc?.values ?? {}) };
    this.version = doc?.version ?? 1;
  }

  /** Register a listener fired after every applied change (the ARAG client rebuild hangs off this). */
  onChange(fn: (changed: string[], eff: EffectiveSettings) => void): void {
    this.listeners.push(fn);
  }

  private value(key: string): SettingValue {
    const v = key in this.overrides ? this.overrides[key] : this.baseline[key];
    return v as SettingValue;
  }

  private source(key: string): SettingSource {
    if (key in this.overrides) return "store";
    return this.envSet.has(key) ? "env" : "default";
  }

  /** The live effective settings. Recomputed only when something changed. */
  effective(): EffectiveSettings {
    if (this.cache) return this.cache;
    const s = (k: string) => String(this.value(k) ?? "");
    const n = (k: string) => Number(this.value(k) ?? 0);
    const b = (k: string) => this.value(k) === true;
    this.cache = {
      branding: {
        productName: s("branding.productName"),
        tagline: s("branding.tagline"),
        logoUrl: s("branding.logoUrl"),
        primaryColor: s("branding.primaryColor"),
        accentColor: s("branding.accentColor"),
        poweredBy: b("branding.poweredBy"),
        footerText: s("branding.footerText"),
        docsUrl: s("branding.docsUrl"),
        supportUrl: s("branding.supportUrl"),
      },
      connection: {
        kbId: s("connection.kbId"),
        region: s("connection.region"),
        baseUrl: s("connection.baseUrl"),
        apiKey: s("connection.apiKey"),
        generativeModel: s("connection.generativeModel"),
        reranker: s("connection.reranker"),
        timeoutMs: n("connection.timeoutMs"),
        extractStrategy: s("connection.extractStrategy"),
      },
      limits: {
        maxUploadBytes: n("limits.maxUploadBytes"),
        maxBodyBytes: n("limits.maxBodyBytes"),
        rateLimitRps: n("limits.rateLimitRps"),
        rateLimitBurst: n("limits.rateLimitBurst"),
      },
      security: {
        adminToken: s("security.adminToken"),
        requireApiKey: b("security.requireApiKey"),
        allowedOrigins: (this.value("security.allowedOrigins") as string[]) ?? [],
        trustProxy: s("security.trustProxy") as "fly" | "xff" | "none",
      },
      retention: {
        days: n("retention.days"),
        autoPurgeEnabled: b("retention.autoPurgeEnabled"),
        purgeIntervalHours: n("retention.purgeIntervalHours"),
      },
      operations: { logLevel: s("operations.logLevel") as LogLevel },
    };
    return this.cache;
  }

  /** Effective branding — what `GET /api/v1/branding` and both UIs paint from. */
  branding(): Branding {
    return this.effective().branding;
  }

  /** Every field with its effective value, source and secret state. */
  describe(): {
    version: number;
    updatedAt: string | null;
    groups: Array<SettingGroupDef & { fields: DescribedSetting[] }>;
  } {
    const doc = this.col.get("current");
    const fields = SETTING_DEFS.map((d) => this.describeOne(d));
    return {
      version: this.version,
      updatedAt: doc?.updatedAt ?? null,
      groups: SETTING_GROUPS.map((g) => ({ ...g, fields: fields.filter((f) => f.group === g.id) })),
    };
  }

  private describeOne(d: SettingDef): DescribedSetting {
    const raw = this.value(d.key);
    const out: DescribedSetting = {
      key: d.key,
      group: d.group,
      label: d.label,
      description: d.description,
      type: d.type,
      envVar: d.envVar,
      secret: Boolean(d.secret),
      adminOnly: Boolean(d.adminOnly),
      source: this.source(d.key),
      value: d.secret ? null : (raw ?? null),
      envSet: this.envSet.has(d.key),
    };
    if (d.secret) {
      const str = String(raw ?? "");
      out.set = str.length > 0;
      out.hint = hintFor(str);
    }
    if (d.hint) out.note = d.hint;
    if (d.min !== undefined || d.max !== undefined || d.maxLength !== undefined || d.values) {
      out.constraints = { min: d.min, max: d.max, maxLength: d.maxLength, values: d.values };
    }
    return out;
  }

  /** The definition for one key, or undefined. */
  def(key: string): SettingDef | undefined {
    return DEFS_BY_KEY.get(key);
  }

  /**
   * Validate and apply a patch. Accepts either a flat map of dotted keys or the nested
   * `{ group: { field: value } }` shape the settings screen posts. Returns the changes that
   * were actually applied (unchanged fields are dropped, so an idempotent save audits nothing).
   */
  patch(input: Record<string, unknown>): SettingsChange[] {
    const flat = flatten(input);
    const errors: Array<{ path: string; message: string }> = [];
    const next: Record<string, SettingValue> = {};
    for (const [key, raw] of Object.entries(flat)) {
      const d = DEFS_BY_KEY.get(key);
      if (!d) {
        errors.push({ path: key, message: "Unknown setting" });
        continue;
      }
      const parsed = coerce(d, raw);
      if (typeof parsed === "string") errors.push({ path: key, message: parsed });
      else next[key] = parsed.value;
    }
    if (errors.length) throw validationError(errors, "body");

    const changes: SettingsChange[] = [];
    for (const [key, value] of Object.entries(next)) {
      const d = DEFS_BY_KEY.get(key)!;
      const before = this.value(key);
      if (same(before, value)) continue;
      this.overrides[key] = value;
      changes.push({
        key,
        before: d.secret ? null : (before ?? null),
        after: d.secret ? null : value,
        secret: Boolean(d.secret),
      });
    }
    if (changes.length) this.commit(changes.map((c) => c.key));
    return changes;
  }

  /**
   * Drop store overrides so the fields fall back to their environment (or built-in) default.
   * This is what "reset to the environment default" on the settings screen calls.
   */
  reset(keys: string[]): SettingsChange[] {
    const unknown = keys.filter((k) => !DEFS_BY_KEY.has(k));
    if (unknown.length)
      throw validationError(
        unknown.map((k) => ({ path: k, message: "Unknown setting" })),
        "body",
      );
    const changes: SettingsChange[] = [];
    for (const key of keys) {
      if (!(key in this.overrides)) continue;
      const d = DEFS_BY_KEY.get(key)!;
      const before = this.overrides[key]!;
      delete this.overrides[key];
      const after = this.baseline[key] as SettingValue;
      changes.push({
        key,
        before: d.secret ? null : before,
        after: d.secret ? null : (after ?? null),
        secret: Boolean(d.secret),
      });
    }
    if (changes.length) this.commit(changes.map((c) => c.key));
    return changes;
  }

  private commit(changed: string[]): void {
    this.cache = null;
    this.version += 1;
    this.col.put({ id: "current", values: { ...this.overrides }, version: this.version });
    this.apply();
    const eff = this.effective();
    for (const fn of this.listeners) fn(changed, eff);
    this.o.log.info("settings.changed", { keys: changed, version: this.version });
  }

  /**
   * Push the effective values into the objects the platform reads live: the env record (rate
   * limits, body ceiling, CORS, proxy, admin token, key enforcement) and the logger. Called
   * once at construction too, so a stored override is in force from the first request.
   */
  apply(): void {
    const eff = this.effective();
    const env = this.o.env;
    env.rateLimitRps = eff.limits.rateLimitRps;
    env.rateLimitBurst = eff.limits.rateLimitBurst;
    env.maxBodyBytes = eff.limits.maxBodyBytes;
    env.adminToken = eff.security.adminToken;
    env.trustProxy = eff.security.trustProxy;
    env.allowedOrigins.splice(0, env.allowedOrigins.length, ...eff.security.allowedOrigins);
    const keys = [...this.seedApiKeys];
    if (keys.length === 0) keys.push(this.enforcementSentinel);
    env.apiKeys.splice(0, env.apiKeys.length, ...(eff.security.requireApiKey ? keys : []));
    env.arag.kbId = eff.connection.kbId;
    env.arag.apiKey = eff.connection.apiKey;
    env.arag.baseUrl = eff.connection.baseUrl;
    env.arag.region = eff.connection.region;
    env.arag.generativeModel = eff.connection.generativeModel;
    env.arag.reranker = eff.connection.reranker;
    env.arag.timeoutMs = eff.connection.timeoutMs;
    env.logLevel = eff.operations.logLevel;
    this.o.log.level = eff.operations.logLevel;
  }
}

/** `{ branding: { tagline: "x" } }` and `{ "branding.tagline": "x" }` are the same patch. */
function flatten(input: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !DEFS_BY_KEY.has(key)) {
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    } else out[key] = v;
  }
  return out;
}

function same(a: SettingValue | undefined, b: SettingValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}

/** Validate one value against its definition. Returns `{ value }`, or the error message. */
function coerce(d: SettingDef, raw: unknown): { value: SettingValue } | string {
  if (raw === null || raw === undefined) return "Value is required; use the reset endpoint to clear it";
  switch (d.type) {
    case "boolean": {
      if (typeof raw !== "boolean") return "Must be true or false";
      return { value: raw };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return "Must be a number";
      if (d.min !== undefined && n < d.min) return `Must be at least ${d.min}`;
      if (d.max !== undefined && n > d.max) return `Must be at most ${d.max}`;
      return { value: n };
    }
    case "enum": {
      const s = String(raw);
      if (!d.values?.includes(s)) return `Must be one of ${d.values?.join(", ")}`;
      return { value: s };
    }
    case "list": {
      const arr = Array.isArray(raw)
        ? raw.map((x) => String(x).trim())
        : String(raw)
            .split(",")
            .map((x) => x.trim());
      const items = arr.filter(Boolean);
      if (items.length > 50) return "At most 50 entries";
      if (items.some((x) => x.length > 200)) return "Each entry must be 200 characters or fewer";
      if (items.some((x) => CONTROL_RE.test(x))) return "Must not contain control characters";
      return { value: items };
    }
    case "uuid": {
      const s = String(raw).trim();
      if (!UUID_RE.test(s)) return "Must be a UUID";
      return { value: s };
    }
    case "color": {
      const s = String(raw).trim();
      if (s === "") return { value: "" };
      if (!isSafeColor(s))
        return "Must be a hex, rgb(), rgba(), hsl(), hsla() or CSS keyword colour (strict grammar)";
      return { value: s };
    }
    case "url": {
      const s = String(raw).trim();
      if (s === "") return { value: "" };
      if (s.length > (d.maxLength ?? 300)) return `Must be ${d.maxLength ?? 300} characters or fewer`;
      if (!URL_RE.test(s)) return "Must be an http(s) URL or a path beginning with /";
      return { value: s };
    }
    default: {
      if (typeof raw === "object") return "Must be a string";
      const s = String(raw);
      if (d.secret && s.trim() === "") return "A secret cannot be set to an empty value";
      if (d.maxLength !== undefined && s.length > d.maxLength)
        return `Must be ${d.maxLength} characters or fewer`;
      // Control characters would break header and CSS interpolation downstream.
      if (CONTROL_RE.test(s)) return "Must not contain control characters";
      return { value: s };
    }
  }
}
