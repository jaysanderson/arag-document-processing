/**
 * White-label branding: env parsing, the public endpoint, and the fact that branding
 * changes presentation only — never the API contract.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { openapi } from "../src/openapi.ts";
import { createProduct, type Product } from "../src/server.ts";
import { Logger, parseDotEnv, readBranding, readEnv, testing } from "../vendor/arag-platform/src/index.ts";

const BRAND = {
  BRAND_PRODUCT_NAME: "Northwind DocFlow",
  BRAND_TAGLINE: "Claims intake, automated",
  BRAND_LOGO_URL: "/branding/logo.svg",
  BRAND_PRIMARY_COLOR: "#0b5cff",
  BRAND_POWERED_BY: "0",
  BRAND_FOOTER_TEXT: "© Northwind Insurance",
  BRAND_SUPPORT_URL: "https://support.northwind.example",
};

let product: Product;
let c: testing.TestClient;
let dataDir: string;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "dip-brand-"));
  // A partner drops assets into DATA_DIR/branding; they are served from /branding.
  mkdirSync(join(dataDir, "branding"), { recursive: true });
  writeFileSync(join(dataDir, "branding", "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  for (const [k, v] of Object.entries(BRAND)) process.env[k] = v;
  const env = readEnv({ ARAG_MOCK: "1", ADMIN_TOKEN: "brand-admin", DATA_DIR: dataDir, RATE_LIMIT_RPS: "0" });
  product = await createProduct(env, {
    log: new Logger({ level: "error", write: () => undefined }),
    persist: false,
    provisionAtBoot: false,
  });
  c = await testing.startTestServer(product.app);
});

after(async () => {
  for (const k of Object.keys(BRAND)) delete process.env[k];
  await c.close();
  await product.close();
});

test("readBranding parses the BRAND_* keys and falls back to the product defaults", () => {
  const b = readBranding(BRAND, { productName: "Document Processing", docsUrl: "/api/v1/docs" });
  assert.equal(b.productName, "Northwind DocFlow");
  assert.equal(b.tagline, "Claims intake, automated");
  assert.equal(b.primaryColor, "#0b5cff");
  assert.equal(b.poweredBy, false);
  assert.equal(b.docsUrl, "/api/v1/docs", "unset keys keep the product default");

  const bare = readBranding({}, { productName: "Document Processing" });
  assert.equal(bare.productName, "Document Processing");
  assert.equal(bare.poweredBy, true, "the credit shows unless a partner turns it off");
});

test("an unparseable colour is ignored rather than applied", () => {
  const b = readBranding({ BRAND_PRIMARY_COLOR: "javascript:alert(1)" }, {});
  assert.equal(b.primaryColor, "", "a bad colour must not reach the page");
});

test("GET /api/v1/branding is public and matches the spec", async () => {
  const res = await c.get("/api/v1/branding");
  assert.equal(res.status, 200);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/branding", "get", 200, res.json), []);
  const b = res.json as Record<string, unknown>;
  assert.equal(b.productName, "Northwind DocFlow");
  assert.equal(b.poweredBy, false);
  assert.equal(b.footerText, "© Northwind Insurance");
  // Secret-free: it must never carry anything the visitor cannot already see.
  const body = JSON.stringify(b);
  assert.ok(!body.includes("brand-admin"));
  assert.ok(!/ARAG_API_KEY|apiKey|token/i.test(body));
});

test("brand assets are served from DATA_DIR/branding", async () => {
  const logo = await c.get("/branding/logo.svg");
  assert.equal(logo.status, 200);
  assert.match(logo.headers.get("content-type") ?? "", /image\/svg\+xml/);
  assert.equal((await c.get("/branding/does-not-exist.svg")).status, 404);
  // Path traversal out of the branding directory must not work.
  assert.equal((await c.get("/branding/../../.env")).status, 404);
});

test("branding is presentation only — the API contract is unchanged", async () => {
  // The spec keeps its own title so generated clients do not break on a rebrand.
  assert.equal((openapi.info as { title: string }).title, "Document Processing API");
  const spec = await c.get("/api/v1/openapi.json");
  assert.equal((spec.json as { info: { title: string } }).info.title, "Document Processing API");
  // Routes and schema names are untouched.
  assert.ok((spec.json as { paths: Record<string, unknown> }).paths["/api/v1/documents"]);
});

test("the admin config view reports the effective branding and how to change it", async () => {
  const res = await c.get("/api/v1/admin/config", { authorization: "Bearer brand-admin" });
  assert.equal(res.status, 200);
  const cfg = res.json as { branding: { effective: { productName: string }; howToChange: string } };
  assert.equal(cfg.branding.effective.productName, "Northwind DocFlow");
  assert.match(cfg.branding.howToChange, /BRAND_PRODUCT_NAME/);
  assert.match(cfg.branding.howToChange, /white-label\.md/);
});

test(".env.example is safe to copy to .env verbatim", () => {
  // The parser takes everything after `=` as the value, so a trailing `# comment` becomes
  // part of it — `LOG_LEVEL=info  # a note` then fails validation and the server will not
  // boot. `make dev` copies this file on a fresh clone, so it must parse cleanly.
  const parsed = parseDotEnv(readFileSync(new URL("../.env.example", import.meta.url), "utf8"));
  const withComments = Object.entries(parsed).filter(([, v]) => v.includes("#"));
  assert.deepEqual(withComments, [], "move the comment above the key, not after the value");
  assert.equal(parsed.LOG_LEVEL, "info");
  assert.equal(parsed.ARAG_MOCK, "0");
  // And the values it ships must actually satisfy the env validator.
  const env = readEnv({ ...parsed, ARAG_MOCK: "1" });
  assert.equal(env.logLevel, "info");
  assert.equal(env.rateLimitRps, 5);
  assert.equal(env.trustProxy, "fly");
  // Every branding key is documented.
  for (const key of [
    "BRAND_PRODUCT_NAME",
    "BRAND_TAGLINE",
    "BRAND_LOGO_URL",
    "BRAND_PRIMARY_COLOR",
    "BRAND_ACCENT_COLOR",
    "BRAND_POWERED_BY",
    "BRAND_FOOTER_TEXT",
    "BRAND_DOCS_URL",
    "BRAND_SUPPORT_URL",
  ])
    assert.ok(key in parsed, `${key} is missing from .env.example`);
});
