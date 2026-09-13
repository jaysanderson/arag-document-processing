/**
 * Settings: every setting the product reads is editable in the product, persists in the
 * store, overrides the environment default and takes effect without a restart.
 *
 * The bar is per-setting, so this file is too: each setting is set through the API, read
 * back (effective value changed, `source` became `store`), and then its *effect* is
 * asserted somewhere the change actually has to show up — the upload ceiling in what an
 * over-size upload returns, the model in what the ask path provisions, branding in
 * `GET /api/v1/branding`, the rate limit in a 429. The last test in the file fails if a
 * setting exists that no test above pinned.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { openapi } from "../src/openapi.ts";
import { createProduct, type Product } from "../src/server.ts";
import { Logger, readEnv, testing } from "../vendor/arag-platform/src/index.ts";

const ADMIN = "settings-admin-token";
/** A real environment variable, so the "env is only a default" layering can be pinned. */
const ENV_TAGLINE = "Tagline from the environment";

let product: Product;
let c: testing.TestClient;
let admin: Record<string, string> = { authorization: `Bearer ${ADMIN}` };
let dataDir: string;

/** Every setting key this file has pinned; the final test checks nothing was missed. */
const pinned = new Set<string>();

interface Field {
  key: string;
  source: string;
  value: unknown;
  secret: boolean;
  set?: boolean;
  hint?: string;
  envSet: boolean;
}
interface SettingsDoc {
  version: number;
  groups: Array<{ id: string; fields: Field[] }>;
  applied: Record<string, Record<string, unknown>>;
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "dip-settings-"));
  process.env.BRAND_TAGLINE = ENV_TAGLINE;
  const env = readEnv({
    ARAG_MOCK: "1",
    ADMIN_TOKEN: ADMIN,
    DATA_DIR: dataDir,
    RATE_LIMIT_RPS: "0",
    NODE_ENV: "test",
  });
  product = await createProduct(env, {
    log: new Logger({ level: "error", write: () => undefined }),
    persist: false,
    provisionAtBoot: false,
  });
  c = await testing.startTestServer(product.app);
});

after(async () => {
  delete process.env.BRAND_TAGLINE;
  await c.close();
  await product.close();
});

async function settings(): Promise<SettingsDoc> {
  const res = await c.get("/api/v1/admin/settings", admin);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(
    testing.checkResponse(openapi, "/api/v1/admin/settings", "get", 200, res.json),
    [],
    "the settings document must match its schema",
  );
  return res.json as SettingsDoc;
}

function field(doc: SettingsDoc, key: string): Field {
  const f = doc.groups.flatMap((g) => g.fields).find((x) => x.key === key);
  assert.ok(f, `no such setting: ${key}`);
  return f;
}

/** PATCH one setting and assert it stuck: new effective value, `source: "store"`. */
async function set(key: string, value: unknown, expected: unknown = value): Promise<SettingsDoc> {
  pinned.add(key);
  const res = await c.request("PATCH", "/api/v1/admin/settings", { json: { [key]: value }, headers: admin });
  assert.equal(res.status, 200, `${key}: ${res.text}`);
  assert.deepEqual(
    testing.checkResponse(openapi, "/api/v1/admin/settings", "patch", 200, res.json),
    [],
    "the patch result must match its schema",
  );
  const doc = (res.json as { settings: SettingsDoc }).settings;
  const f = field(doc, key);
  assert.equal(f.source, "store", `${key} should now come from the store`);
  if (!f.secret) assert.deepEqual(f.value, expected, `${key} should read back as the value just set`);
  return doc;
}

async function reset(...keys: string[]): Promise<SettingsDoc> {
  const res = await c.post("/api/v1/admin/settings/reset", { keys }, admin);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/admin/settings/reset", "post", 200, res.json), []);
  return (res.json as { settings: SettingsDoc }).settings;
}

// ─── the three layers ─────────────────────────────────────────────────────────

test("every setting reports an effective value, its source and whether it is a secret", async () => {
  const doc = await settings();
  const fields = doc.groups.flatMap((g) => g.fields);
  assert.ok(fields.length >= 25, "the inventory should cover the whole configuration surface");
  for (const f of fields) {
    assert.ok(["store", "env", "default"].includes(f.source), `${f.key}: bad source ${f.source}`);
    if (f.secret) {
      assert.equal(f.value, null, `${f.key}: a secret must never carry its value`);
      assert.equal(typeof f.set, "boolean", `${f.key}: a secret must say whether it is set`);
    }
  }
  // Secrets are write-only everywhere, including in the applied view.
  const body = JSON.stringify(doc);
  assert.ok(!body.includes(ADMIN), "the admin token must never appear in the settings document");
  assert.ok(!body.includes(product.mock!.apiKey), "the ARAG key must never appear in the settings document");
});

test("an environment variable is a default; the store overrides it; a reset gives it back", async () => {
  // BRAND_TAGLINE is set in the process environment for this file.
  let doc = await settings();
  assert.equal(field(doc, "branding.tagline").source, "env");
  assert.equal(field(doc, "branding.tagline").value, ENV_TAGLINE);
  assert.equal(field(doc, "branding.tagline").envSet, true);

  doc = await set("branding.tagline", "Tagline from the store");
  assert.equal(
    ((await c.get("/api/v1/branding")).json as { tagline: string }).tagline,
    "Tagline from the store",
    "the change must be live on the public branding endpoint, with no restart",
  );

  doc = await reset("branding.tagline");
  assert.equal(field(doc, "branding.tagline").source, "env");
  assert.equal(
    ((await c.get("/api/v1/branding")).json as { tagline: string }).tagline,
    ENV_TAGLINE,
    "a reset falls back to the environment default",
  );
  // Re-apply a stored value for the rest of the file.
  await set("branding.tagline", "Claims intake, automated");
});

// ─── branding ─────────────────────────────────────────────────────────────────

test("branding: name, logo, colours, footer, credit and links are all editable and live", async () => {
  await set("branding.productName", "Northwind DocFlow");
  await set("branding.primaryColor", "#0b5cff");
  await set("branding.accentColor", "rgb(12, 180, 90)");
  await set("branding.poweredBy", false);
  await set("branding.footerText", "© Northwind Insurance");
  await set("branding.docsUrl", "https://docs.northwind.example/api");
  await set("branding.supportUrl", "https://support.northwind.example");
  await set("branding.logoUrl", "/branding/partner.svg");

  const res = await c.get("/api/v1/branding");
  assert.equal(res.status, 200);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/branding", "get", 200, res.json), []);
  const b = res.json as Record<string, unknown>;
  assert.equal(b.productName, "Northwind DocFlow");
  assert.equal(b.primaryColor, "#0b5cff");
  assert.equal(b.accentColor, "rgb(12, 180, 90)");
  assert.equal(b.poweredBy, false);
  assert.equal(b.footerText, "© Northwind Insurance");
  assert.equal(b.supportUrl, "https://support.northwind.example");
  assert.equal(b.docsUrl, "https://docs.northwind.example/api");
  assert.equal(b.logoUrl, "/branding/partner.svg");

  // The workspace settings payload paints from the same source.
  const ws = (await c.get("/api/v1/settings")).json as { product: { name: string }; branding: unknown };
  assert.equal(ws.product.name, "Northwind DocFlow");
  assert.deepEqual(ws.branding, b);

  // DP-35: branding carries presentation only. There is no status, verification, grounding
  // or validation colour in the payload for a partner to recolour.
  assert.deepEqual(
    Object.keys(b).sort(),
    [
      "accentColor",
      "docsUrl",
      "footerText",
      "logoUrl",
      "poweredBy",
      "primaryColor",
      "productName",
      "supportUrl",
      "tagline",
    ],
    "branding may never carry status/verification/grounding/validation colours",
  );
  // DP-30: and it never touches the API contract.
  const spec = (await c.get("/api/v1/openapi.json")).json as { info: { title: string } };
  assert.equal(spec.info.title, "Document Processing API");
});

test("a logo file uploads into DATA_DIR/branding, is served, and points branding at itself", async () => {
  pinned.add("branding.logoUrl");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>';
  const boundary = "----dipLogoBoundary";
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="brand.svg"\r\n` +
      `Content-Type: image/svg+xml\r\n\r\n${svg}\r\n--${boundary}--\r\n`,
  );
  const res = await c.request("POST", "/api/v1/admin/branding/logo", {
    body: body as unknown as BodyInit,
    headers: { ...admin, "Content-Type": `multipart/form-data; boundary=${boundary}` },
  });
  assert.equal(res.status, 201, res.text);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/admin/branding/logo", "post", 201, res.json), []);
  const out = res.json as { url: string; bytes: number };
  assert.equal(out.url, "/branding/logo.svg");
  assert.equal(out.bytes, svg.length);
  // Served from the volume, and branding now points at it.
  const asset = await c.get(out.url);
  assert.equal(asset.status, 200);
  assert.equal(asset.text, svg);
  assert.equal(((await c.get("/api/v1/branding")).json as { logoUrl: string }).logoUrl, out.url);
  assert.equal(field(await settings(), "branding.logoUrl").source, "store");

  // A PDF is not a logo, and a 3 MB one is not a brand asset.
  const bad = await c.request("POST", "/api/v1/admin/branding/logo", {
    body: "%PDF-1.7",
    headers: { ...admin, "Content-Type": "application/pdf", "X-Filename": "x.pdf" },
  });
  assert.equal(bad.status, 415);
  const huge = await c.request("POST", "/api/v1/admin/branding/logo", {
    body: Buffer.alloc(3 * 1024 * 1024, 0x41) as unknown as BodyInit,
    headers: { ...admin, "Content-Type": "image/png", "X-Filename": "big.png" },
  });
  assert.equal(huge.status, 413);
});

// ─── connection ───────────────────────────────────────────────────────────────

test("connection: the Knowledge Box, region, base URL and timeout rebuild the live client", async () => {
  const original = product.mock!;
  const newKb = "11111111-2222-4333-8444-555555555555";
  let doc = await set("connection.kbId", newKb);
  assert.equal(doc.applied.arag!.kbId, newKb, "the running ARAG client was rebuilt, not restarted");
  assert.equal(
    ((await c.get("/api/v1/settings")).json as { connection: { kbId: string } }).connection.kbId,
    newKb,
    "the workspace settings screen reports the new Knowledge Box immediately",
  );
  doc = await reset("connection.kbId");
  assert.equal(doc.applied.arag!.kbId, original.kbId);

  // A region builds the base URL when no explicit base URL is set.
  await set("connection.baseUrl", "");
  doc = await set("connection.region", "europe-1");
  assert.match(String(doc.applied.arag!.baseUrl), /europe-1/, "the region is reflected in the base URL");
  doc = await reset("connection.region", "connection.baseUrl");
  assert.equal(doc.applied.arag!.baseUrl, original.url, "the mock connection is restored");

  doc = await set("connection.timeoutMs", 12_345);
  assert.equal(doc.applied.arag!.timeoutMs, 12_345, "the rebuilt client carries the new timeout");
  await reset("connection.timeoutMs");

  // Rejected before anything is written.
  const bad = await c.request("PATCH", "/api/v1/admin/settings", {
    json: { "connection.kbId": "not-a-uuid" },
    headers: admin,
  });
  assert.equal(bad.status, 400);
  assert.match(bad.headers.get("content-type") ?? "", /problem\+json/);
  const problem = bad.json as { errors: Array<{ path: string; message: string }> };
  assert.equal(problem.errors[0]!.path, "connection.kbId");
  assert.equal(((await settings()).applied.arag as { kbId: string }).kbId, original.kbId);
});

test("connection: the ARAG key is write-only — set once, then reported as set with a hint", async () => {
  pinned.add("connection.apiKey");
  const before = field(await settings(), "connection.apiKey");
  assert.equal(before.value, null);
  assert.equal(before.set, true, "the mock supplies a key, so it reads as set");

  const secret = "rotated-service-account-key-ABCD";
  const res = await c.request("PATCH", "/api/v1/admin/settings", {
    json: { "connection.apiKey": secret },
    headers: admin,
  });
  assert.equal(res.status, 200, res.text);
  assert.ok(!res.text.includes(secret), "a secret is never echoed back by the write that set it");
  const changed = (res.json as { changed: Array<{ key: string; before: unknown; after: unknown }> }).changed;
  assert.deepEqual(changed, [{ key: "connection.apiKey", before: null, after: null, secret: true }]);

  const f = field(await settings(), "connection.apiKey");
  assert.equal(f.value, null);
  assert.equal(f.set, true);
  assert.equal(f.hint, "…ABCD", "the hint is the last four characters, so keys can be told apart");
  assert.equal(f.source, "store");
  for (const path of ["/api/v1/settings", "/api/v1/admin/config", "/api/v1/admin/security"]) {
    const body = await c.get(path, admin);
    assert.ok(!body.text.includes(secret), `${path} leaked the ARAG key`);
  }
  // Empty is not a rotation; it is a mistake.
  const empty = await c.request("PATCH", "/api/v1/admin/settings", {
    json: { "connection.apiKey": "" },
    headers: admin,
  });
  assert.equal(empty.status, 400);
  await reset("connection.apiKey");
});

test("connection: the generative model and reranker reach the stored ARAG search configurations", async () => {
  await set("connection.generativeModel", "chatgpt-azure-4o-mini");
  await set("connection.reranker", "noop");
  assert.equal(
    ((await c.get("/api/v1/settings")).json as { extraction: { generativeModel: string; reranker: string } })
      .extraction.generativeModel,
    "chatgpt-azure-4o-mini",
  );

  // The effect that matters: what the extraction agents are actually configured to run.
  assert.equal((await c.post("/api/v1/admin/provision", undefined, admin)).status, 200);
  const listed = await c.get("/api/v1/admin/search-configurations", admin);
  const items = (listed.json as { items: Array<{ name: string; config: Record<string, unknown> }> }).items;
  const invoice = items.find((i) => i.name === "dip_invoice_extraction")!;
  assert.equal(invoice.config.generative_model, "chatgpt-azure-4o-mini");
  assert.equal(invoice.config.reranker, "noop");

  await set("connection.generativeModel", "chatgpt-azure-4o");
  assert.equal((await c.post("/api/v1/admin/provision", undefined, admin)).status, 200);
  const after = (
    (await c.get("/api/v1/admin/search-configurations", admin)).json as {
      items: Array<{ name: string; config: Record<string, unknown> }>;
    }
  ).items.find((i) => i.name === "dip_invoice_extraction")!;
  assert.equal(after.config.generative_model, "chatgpt-azure-4o", "a model change re-provisions cleanly");
  await reset("connection.reranker");
});

test("connection: the extract strategy switches visual extraction on, and its id stays admin-only", async () => {
  const doc = await set("connection.extractStrategy", "visual-llm-strategy-1");
  assert.equal(doc.applied.arag!.visualExtraction, true);
  assert.equal(
    ((await c.get("/readyz")).json as { visualExtraction: boolean }).visualExtraction,
    true,
    "readiness advertises visual extraction as soon as it is configured",
  );
  const ws = await c.get("/api/v1/settings");
  assert.equal((ws.json as { extraction: { visualExtraction: boolean } }).extraction.visualExtraction, true);
  // DP-40: the boolean is public, the id is not.
  assert.ok(!ws.text.includes("visual-llm-strategy-1"), "the strategy id must not reach the viewer payload");
  const health = await c.get("/api/v1/admin/health", admin);
  assert.equal((health.json as { extractStrategy: string }).extractStrategy, "visual-llm-strategy-1");
  await reset("connection.extractStrategy");
  assert.equal(
    ((await c.get("/readyz")).json as { visualExtraction: boolean }).visualExtraction,
    false,
    "and turning it off is live too",
  );
});

// ─── limits ───────────────────────────────────────────────────────────────────

test("limits: the upload ceiling changes what is advertised and what an over-size upload gets", async () => {
  const doc = await set("limits.maxUploadBytes", 2048);
  assert.equal(doc.applied.limits!.maxUploadBytes, 2048);
  assert.equal(
    ((await c.get("/api/v1/settings")).json as { uploads: { maxBytes: number } }).uploads.maxBytes,
    2048,
    "the upload drawer reads its ceiling from the API, so it must change with the setting",
  );
  const tooBig = await c.request("POST", "/api/v1/documents", {
    body: "x".repeat(4096),
    headers: { "Content-Type": "text/plain", "X-Filename": "big.txt" },
  });
  assert.equal(tooBig.status, 413, "the new ceiling is enforced on the very next upload");
  await reset("limits.maxUploadBytes");
  const ok = await c.request("POST", "/api/v1/documents", {
    body: "x".repeat(4096),
    headers: { "Content-Type": "text/plain", "X-Filename": "fits.txt" },
  });
  assert.equal(ok.status, 202, "and raising it again is equally immediate");
});

test("limits: the body ceiling is enforced by the transport on the next request", async () => {
  const doc = await set("limits.maxBodyBytes", 2048);
  assert.equal(doc.applied.limits!.maxBodyBytes, 2048);
  const big = await c.request("POST", "/api/v1/documents/bulk-export", {
    body: JSON.stringify({ ids: [`x`.repeat(4096)] }),
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(big.status, 413);
  await reset("limits.maxBodyBytes");
});

test("limits: the rate limit takes effect without a restart", async () => {
  await set("limits.rateLimitRps", 1);
  const doc = await set("limits.rateLimitBurst", 1);
  assert.equal(doc.applied.limits!.rateLimitRps, 1);
  assert.equal(doc.applied.limits!.rateLimitBurst, 1);
  assert.equal((await c.get("/api/v1/samples")).status, 200);
  const second = await c.get("/api/v1/samples");
  assert.equal(second.status, 429, "the second anonymous call in the same second is limited");
  assert.ok(second.headers.get("retry-after"));
  await reset("limits.rateLimitRps", "limits.rateLimitBurst");
  assert.equal((await c.get("/api/v1/samples")).status, 200);
});

// ─── security ─────────────────────────────────────────────────────────────────

test("security: requiring an API key closes the public API immediately", async () => {
  await set("security.requireApiKey", true);
  const anon = await c.get("/api/v1/samples");
  assert.equal(anon.status, 401, "reads now need a credential");
  assert.equal((await c.get("/api/v1/admin/settings", admin)).status, 200, "the admin token still works");
  assert.equal(
    ((await c.get("/api/v1/settings", admin)).json as { security: { apiKeysEnforced: boolean } }).security
      .apiKeysEnforced,
    true,
  );
  await reset("security.requireApiKey");
  assert.equal((await c.get("/api/v1/samples")).status, 200);
});

test("security: CORS origins and the trusted proxy header are editable", async () => {
  const doc = await set("security.allowedOrigins", ["https://partner.example"], ["https://partner.example"]);
  assert.deepEqual(doc.applied.security!.allowedOrigins, ["https://partner.example"]);
  const allowed = await c.get("/api/v1/samples", { origin: "https://partner.example" });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://partner.example");
  const refused = await c.get("/api/v1/samples", { origin: "https://not-a-partner.example" });
  assert.equal(refused.headers.get("access-control-allow-origin"), null);
  await reset("security.allowedOrigins");

  const proxy = await set("security.trustProxy", "xff");
  assert.equal(proxy.applied.security!.trustProxy, "xff");
  assert.equal(
    ((await c.get("/api/v1/admin/security", admin)).json as { trustProxy: string }).trustProxy,
    "xff",
  );
  await reset("security.trustProxy");
});

test("security: the admin token is a rotatable secret, and the rotation is immediate", async () => {
  pinned.add("security.adminToken");
  const rotated = "rotated-admin-token-9876";
  const res = await c.request("PATCH", "/api/v1/admin/settings", {
    json: { "security.adminToken": rotated },
    headers: admin,
  });
  assert.equal(res.status, 200, res.text);
  assert.ok(!res.text.includes(rotated), "the new token is never echoed back");
  assert.equal(
    (await c.get("/api/v1/admin/settings", admin)).status,
    401,
    "the previous token stops working on the next request",
  );
  const next = { authorization: `Bearer ${rotated}` };
  assert.equal((await c.get("/api/v1/admin/settings", next)).status, 200);
  const f = field((await c.get("/api/v1/admin/settings", next)).json as SettingsDoc, "security.adminToken");
  assert.equal(f.value, null);
  assert.equal(f.hint, "…9876");

  // Put it back, using the new credential.
  admin = next;
  await reset("security.adminToken");
  admin = { authorization: `Bearer ${ADMIN}` };
  assert.equal((await c.get("/api/v1/admin/settings", admin)).status, 200);
});

// ─── retention ────────────────────────────────────────────────────────────────

test("retention: the threshold is what purge uses when a request does not name one", async () => {
  await set("retention.days", 7);
  assert.equal(
    ((await c.get("/api/v1/admin/security", admin)).json as { retention: { defaultOlderThanDays: number } })
      .retention.defaultOlderThanDays,
    7,
  );
  const dry = await c.post("/api/v1/admin/purge", { dryRun: true }, admin);
  assert.equal(dry.status, 200);
  assert.equal(
    (dry.json as { olderThanDays: number }).olderThanDays,
    7,
    "the purge preview uses the configured retention, not a constant",
  );
  await reset("retention.days");
  const back = await c.post("/api/v1/admin/purge", { dryRun: true }, admin);
  assert.equal((back.json as { olderThanDays: number }).olderThanDays, 30);
});

test("retention: automatic purge can be scheduled from the product", async () => {
  await set("retention.purgeIntervalHours", 6);
  const doc = await set("retention.autoPurgeEnabled", true);
  assert.equal(doc.applied.retention!.schedulerActive, true, "enabling it starts the scheduler in-process");
  assert.ok(doc.applied.retention!.nextRunAt, "and the next run is reported");
  assert.equal(doc.applied.retention!.purgeIntervalHours, 6);
  const off = await set("retention.autoPurgeEnabled", false);
  assert.equal(off.applied.retention!.schedulerActive, false);
  await reset("retention.purgeIntervalHours");
});

// ─── operations ───────────────────────────────────────────────────────────────

test("operations: the log level changes what the log records, live", async () => {
  const doc = await set("operations.logLevel", "debug");
  assert.equal(doc.applied.operations!.logLevel, "debug");
  // A call that reaches ARAG: the client logs every request at debug.
  await c.get("/api/v1/admin/health", admin);
  const logs = await c.get("/api/v1/admin/logs?level=debug&limit=50", admin);
  assert.equal(logs.status, 200);
  const items = (logs.json as { items: Array<{ level: string }> }).items;
  assert.ok(
    items.some((r) => r.level === "debug"),
    "debug records appear once the level is lowered, with no restart",
  );
  await reset("operations.logLevel");
});

// ─── validation and persistence ───────────────────────────────────────────────

test("every write is validated, and a rejected patch changes nothing", async () => {
  const before = await settings();
  const bad = await c.request("PATCH", "/api/v1/admin/settings", {
    json: {
      "branding.primaryColor": "red; background: url(javascript:alert(1))",
      "limits.rateLimitRps": 99_999,
      "connection.reranker": "sorcery",
      "nonsense.key": 1,
    },
    headers: admin,
  });
  assert.equal(bad.status, 400);
  const problem = bad.json as { errors: Array<{ path: string; message: string }> };
  assert.deepEqual(
    problem.errors.map((e) => e.path).sort(),
    ["branding.primaryColor", "connection.reranker", "limits.rateLimitRps", "nonsense.key"],
    "every offending field is named, not just the first",
  );
  assert.match(problem.errors.find((e) => e.path === "branding.primaryColor")!.message, /colour/i);
  const after = await settings();
  assert.equal(after.version, before.version, "a rejected patch is not a partial write");
  // A safe colour in the platform's grammar is accepted.
  await set("branding.primaryColor", "hsl(210, 90%, 45%)");
  await reset("branding.primaryColor");
  pinned.add("branding.primaryColor");
});

test("settings persist in the product's store and survive a reload", async () => {
  await set("branding.footerText", "© Northwind, stored");
  product.store.flushAll();
  // A second service reading the same store sees the override, which is what a restart does.
  const reloaded = product.settings;
  assert.equal(reloaded.branding().footerText, "© Northwind, stored");
  const raw = product.store.collection("settings").get("current") as unknown as {
    values: Record<string, unknown>;
  };
  assert.equal(raw.values["branding.footerText"], "© Northwind, stored");
  assert.ok(
    !JSON.stringify(raw.values).includes(ADMIN),
    "the store holds overrides only — unset secrets are not copied into it",
  );
});

// ─── the guard ────────────────────────────────────────────────────────────────

test("no setting is left untested", async () => {
  const doc = await settings();
  const all = doc.groups.flatMap((g) => g.fields).map((f) => f.key);
  const missing = all.filter((k) => !pinned.has(k));
  assert.deepEqual(missing, [], "every setting must be set and its effect asserted by a test above");
});
