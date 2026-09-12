/**
 * App wiring for Document Processing. Everything HTTP lives here and in `routes/`;
 * domain logic lives in `services/`. Exported as a factory so tests (and `make smoke`)
 * can boot the whole product in-process against the mock ARAG server.
 */
import { resolve } from "node:path";
import {
  App,
  AragClient,
  cors,
  log as defaultLog,
  healthRoutes,
  JobManager,
  type Logger,
  type MockAragServer,
  type PlatformEnv,
  Store,
  securityHeaders,
  startMockArag,
} from "../vendor/arag-platform/src/index.ts";
import { openapi, VERSION } from "./openapi.ts";
import { registerAdminRoutes } from "./routes/admin.ts";
import { registerConfigRoutes } from "./routes/configs.ts";
import { registerDocumentRoutes } from "./routes/documents.ts";
import { registerJobRoutes } from "./routes/jobs.ts";
import { Agents } from "./services/agents.ts";
import { ConfigsService } from "./services/configs.ts";
import { DocumentsService } from "./services/documents.ts";

export interface Usage {
  startedAt: number;
  requests: number;
  aragCalls: number;
  aragErrors: number;
  aragMs: number;
}

export interface Product {
  name: string;
  version: string;
  app: App;
  arag: AragClient;
  store: Store;
  jobs: JobManager;
  agents: Agents;
  configs: ConfigsService;
  documents: DocumentsService;
  usage: Usage;
  /** The in-process mock ARAG server when ARAG_MOCK=1 (tests seed it); null when live. */
  mock: MockAragServer | null;
  /** Provision every extraction config as an ARAG search configuration. */
  provision(): Promise<unknown>;
  close(): Promise<void>;
}

export interface CreateOptions {
  log?: Logger;
  /** Persist stores to DATA_DIR (default true; tests pass false for a clean slate). */
  persist?: boolean;
  /** Provision the ARAG search configurations at boot (default true). */
  provisionAtBoot?: boolean;
  /** Options handed to the in-process mock ARAG when ARAG_MOCK=1 (tests use answerHook). */
  mock?: Parameters<typeof startMockArag>[0];
}

const HERE = resolve(import.meta.dirname ?? ".", "..");

/** Product-specific env (prefixed per STANDARDS §6, with the legacy names honoured). */
export function readProductEnv(src: NodeJS.ProcessEnv = process.env): {
  extractStrategy: string;
  maxUploadBytes: number;
  generativeModel: string;
} {
  return {
    extractStrategy: src.DIP_EXTRACT_STRATEGY || src.ARAG_EXTRACT_STRATEGY || "",
    maxUploadBytes: Number(src.DIP_MAX_UPLOAD_BYTES || src.MAX_UPLOAD_BYTES || 26_214_400),
    generativeModel: src.ARAG_GENERATIVE_MODEL || "",
  };
}

export async function createProduct(env: PlatformEnv, opts: CreateOptions = {}): Promise<Product> {
  const log = opts.log ?? defaultLog;
  const usage: Usage = { startedAt: Date.now(), requests: 0, aragCalls: 0, aragErrors: 0, aragMs: 0 };
  const product = readProductEnv();

  // ARAG: live client, or the in-process mock when ARAG_MOCK=1 (no credentials needed).
  let mock: Awaited<ReturnType<typeof startMockArag>> | null = null;
  let aragOpts = {
    kbId: env.arag.kbId,
    apiKey: env.arag.apiKey,
    baseUrl: env.arag.baseUrl || undefined,
    region: env.arag.region,
  };
  if (env.arag.mock) {
    mock = await startMockArag({ log, ...opts.mock });
    aragOpts = { kbId: mock.kbId, apiKey: mock.apiKey, baseUrl: mock.url, region: env.arag.region };
    log.warn("arag.mock", { url: mock.url });
  }
  const arag = new AragClient({
    ...aragOpts,
    timeoutMs: env.arag.timeoutMs,
    onRequest: (i) => {
      usage.aragCalls++;
      usage.aragMs += i.ms;
      if (i.error || (i.status ?? 0) >= 400) usage.aragErrors++;
      log.debug("arag.request", {
        method: i.method,
        path: i.path,
        status: i.status,
        ms: Math.round(i.ms),
        error: i.error,
      });
    },
  });

  const store = new Store(env.dataDir, { persist: opts.persist ?? true });
  const jobs = new JobManager(store, log, { concurrency: 2 });
  const agents = new Agents({
    arag,
    log,
    generativeModel: product.generativeModel,
    reranker: env.arag.reranker,
  });
  const configs = new ConfigsService({ store, agents, log });
  const documents = new DocumentsService({
    arag,
    store,
    jobs,
    configs,
    agents,
    env,
    log,
    extractStrategy: product.extractStrategy,
    maxUploadBytes: product.maxUploadBytes,
    generativeModel: product.generativeModel,
  });

  const app = new App({ env, log });
  // The demo previews an uploaded PDF from a blob: URL in an <iframe>; the default CSP
  // allows only `frame-src 'self'` (and `object-src 'none'`, which rules out <embed>).
  app.use(securityHeaders({ frameSrc: ["blob:"] }), cors());
  app.use(async (_ctx, next) => {
    usage.requests++;
    await next();
  });
  healthRoutes(app, async () => ({
    version: VERSION,
    arag: { ...(await arag.health()), mock: env.arag.mock },
    // Whether an ingestion-time visual-LLM extract strategy is configured — a boolean, not
    // the strategy id (that stays behind the admin token).
    visualExtraction: Boolean(product.extractStrategy),
  }));
  app.docs("/api/v1", openapi, { title: "Document Processing" });

  registerDocumentRoutes(app, { documents });
  registerJobRoutes(app, { jobs });
  registerConfigRoutes(app, { configs });
  registerAdminRoutes(app, {
    arag,
    env,
    log,
    usage,
    store,
    jobs,
    documents,
    configs,
    version: VERSION,
    extractStrategy: product.extractStrategy,
    generativeModel: product.generativeModel,
  });

  // Session for the demo UI when API keys are enforced (rate-limited like any public route).
  app.post(
    "/api/v1/session",
    (ctx) => {
      ctx.setCookie("arag_session", app.issueSession(12 * 3600), { maxAge: 12 * 3600 });
      return { ok: true, expiresInSec: 12 * 3600 };
    },
    { operationId: "createSession" },
  );

  // Static surfaces: UI kit, admin panel, demo app. Both UIs consume only /api/v1.
  app.static("/ui", resolve(HERE, "vendor/arag-platform/ui"), { cache: "public, max-age=300" });
  app.static("/admin", resolve(HERE, "admin"));
  app.static("/", resolve(HERE, "public"));

  const provision = () => configs.provisionAll();
  if (opts.provisionAtBoot ?? true) {
    // Non-blocking: the server accepts requests immediately and `extractFields`
    // lazily provisions anything that is not ready yet.
    provision().catch((err) => log.warn("provision.boot.fail", { message: (err as Error).message }));
  }

  return {
    name: "arag-doc-processing",
    version: VERSION,
    app,
    arag,
    store,
    jobs,
    agents,
    configs,
    documents,
    usage,
    mock,
    provision,
    async close() {
      store.flushAll();
      try {
        await app.close();
      } finally {
        await mock?.close();
      }
    },
  };
}
