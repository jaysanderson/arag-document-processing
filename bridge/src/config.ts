/**
 * Environment configuration. Secrets live ONLY here (process env / Fly.io secrets),
 * never client-side, never in the repo.
 *
 * Loads bridge/.env (or repo-root .env) in development via a tiny zero-dependency
 * parser so we don't pull in dotenv. In production the env is injected directly.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Minimal .env loader: KEY=VALUE lines, `#` comments, no interpolation. */
function loadDotEnv(): void {
  const candidates = [
    resolve(__dirname, "..", ".env"), // bridge/.env
    resolve(__dirname, "..", "..", ".env"), // repo-root .env
  ];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Real env wins over .env file; first .env found wins over later ones.
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadDotEnv();

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export interface AppConfig {
  port: number;
  logLevel: string;
  /** Full KB base URL, e.g. https://<region>.dp.progress.cloud/api/v1/kb/<id>. */
  aragKbUrl: string;
  /** Nuclia service-account JWT (no "Bearer " prefix). */
  aragToken: string;
  /** Default generative model for extraction/augmentation. */
  generativeModel: string;
  /** Reranker: "predict" | "noop". */
  reranker: string;
  /**
   * Optional ARAG extract_strategy id. When set, image/PDF uploads are processed with
   * this ingestion-time visual-LLM extract strategy (Nuclia "Extract configuration").
   */
  extractStrategy: string;
  aragTimeoutMs: number;
  maxUploadBytes: number;
}

export const config: AppConfig = {
  port: num("PORT", 8080),
  logLevel: str("LOG_LEVEL", "info"),
  aragKbUrl: str("ARAG_KB_URL").replace(/\/+$/, ""),
  aragToken: str("ARAG_TOKEN"),
  generativeModel: str("ARAG_GENERATIVE_MODEL", "chatgpt-azure-4o"),
  reranker: str("ARAG_RERANKER", "predict"),
  extractStrategy: str("ARAG_EXTRACT_STRATEGY"),
  aragTimeoutMs: num("ARAG_TIMEOUT_MS", 60000),
  maxUploadBytes: num("MAX_UPLOAD_BYTES", 26214400),
};

/** Fail fast at startup if required secrets/URLs are missing. */
export function assertConfig(): void {
  const missing: string[] = [];
  if (!config.aragKbUrl) missing.push("ARAG_KB_URL");
  if (!config.aragToken) missing.push("ARAG_TOKEN");
  if (missing.length) {
    throw new Error(
      `Missing required config: ${missing.join(", ")}. Copy .env.example to .env and fill them in.`,
    );
  }
  if (!/\/api\/v1\/kb\/[0-9a-f-]+$/i.test(config.aragKbUrl)) {
    throw new Error(
      `ARAG_KB_URL does not look like a KB base URL (…/api/v1/kb/<uuid>): ${config.aragKbUrl}`,
    );
  }
}

/** The KB id parsed out of the base URL (last path segment). */
export function kbId(): string {
  const m = config.aragKbUrl.match(/kb\/([0-9a-f-]+)$/i);
  return m ? m[1]! : "";
}
