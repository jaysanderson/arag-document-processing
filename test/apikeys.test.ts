/**
 * The API-key store that replaces the `API_KEYS` placeholder (DP-32…DP-43 deferred item).
 *
 * What has to be true: the plaintext exists exactly once, in the create response; a stored
 * key authenticates exactly like an environment key — including as the writer credential
 * DP-12 requires; using it records the use; revoking it stops it on the next request; and
 * nothing that lists keys ever leaks the key, its digest or its salt.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { openapi } from "../src/openapi.ts";
import { createProduct, type Product } from "../src/server.ts";
import { Logger, readEnv, testing } from "../vendor/arag-platform/src/index.ts";

const ADMIN = "apikeys-admin-token";
const admin = { authorization: `Bearer ${ADMIN}` };

let product: Product;
let c: testing.TestClient;

interface KeyView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revoked: boolean;
}

before(async () => {
  const env = readEnv({
    ARAG_MOCK: "1",
    ADMIN_TOKEN: ADMIN,
    DATA_DIR: mkdtempSync(join(tmpdir(), "dip-keys-")),
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
  await c.close();
  await product.close();
});

async function createKey(name: string): Promise<{ key: string; apiKey: KeyView }> {
  const res = await c.post("/api/v1/admin/api-keys", { name }, admin);
  assert.equal(res.status, 201, res.text);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/admin/api-keys", "post", 201, res.json), []);
  return res.json as { key: string; apiKey: KeyView };
}

async function listKeys(): Promise<{ items: KeyView[]; enforced: boolean; seeded: number }> {
  const res = await c.get("/api/v1/admin/api-keys", admin);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/admin/api-keys", "get", 200, res.json), []);
  return res.json as { items: KeyView[]; enforced: boolean; seeded: number };
}

test("a key is returned once at creation and never again", async () => {
  const created = await createKey("ingest-worker");
  assert.match(created.key, /^dip_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/, "the key carries its own record id");
  assert.equal(created.apiKey.name, "ingest-worker");
  assert.equal(created.apiKey.prefix, created.key.split("_").slice(0, 2).join("_"));
  assert.equal(created.apiKey.createdBy, "admin token");
  assert.equal(created.apiKey.lastUsedAt, null);
  assert.equal(created.apiKey.revoked, false);
  assert.ok(!JSON.stringify(created.apiKey).includes(created.key.split("_")[2]!), "no secret in the record");

  const list = await listKeys();
  const found = list.items.find((k) => k.id === created.apiKey.id)!;
  assert.ok(found, "the key is listed");
  const text = JSON.stringify(list);
  assert.ok(!text.includes(created.key), "the plaintext is never listed");
  assert.ok(!text.includes(created.key.split("_")[2]!), "not even the secret half of it");
  assert.ok(!/"hash"|"salt"/.test(text), "the digest and salt never leave the process");

  // Neither does any other admin surface echo it.
  for (const path of ["/api/v1/admin/security", "/api/v1/admin/config", "/api/v1/admin/settings"]) {
    const res = await c.get(path, admin);
    assert.ok(!res.text.includes(created.key), `${path} leaked the key`);
  }
});

test("a key needs a name", async () => {
  const res = await c.post("/api/v1/admin/api-keys", { name: "" }, admin);
  assert.equal(res.status, 400);
  assert.equal((await c.post("/api/v1/admin/api-keys", { name: "x" })).status, 401, "admin only");
});

test("a stored key authenticates like an environment key, and records the use", async () => {
  const { key, apiKey } = await createKey("reader");
  // Close the public API so authentication is actually being tested.
  await c.request("PATCH", "/api/v1/admin/settings", {
    json: { "security.requireApiKey": true },
    headers: admin,
  });
  assert.equal((await c.get("/api/v1/samples")).status, 401, "anonymous is refused while keys are enforced");
  assert.equal((await c.get("/api/v1/samples", { "x-api-key": key })).status, 200, "X-API-Key works");
  assert.equal(
    (await c.get("/api/v1/samples", { authorization: `Bearer ${key}` })).status,
    200,
    "and so does the bearer form",
  );
  assert.equal(
    (await c.get("/api/v1/samples", { "x-api-key": `${key}x` })).status,
    401,
    "a tampered key is not",
  );
  assert.equal(
    (await c.get("/api/v1/samples", { "x-api-key": "dip_00000000_nope" })).status,
    401,
    "nor is an unknown id",
  );

  const after = (await listKeys()).items.find((k) => k.id === apiKey.id)!;
  assert.ok(after.lastUsedAt, "a successful authentication records when the key was last used");
  assert.ok(Date.now() - Date.parse(after.lastUsedAt) < 60_000);

  await c.post("/api/v1/admin/settings/reset", { keys: ["security.requireApiKey"] }, admin);
  assert.equal((await c.get("/api/v1/samples")).status, 200);
});

test("a stored key is a writer credential (DP-12), exactly like an environment key", async () => {
  const { key } = await createKey("deleter");
  // The public API is open here, so this is purely about the write guard.
  const anon = await c.request("DELETE", "/api/v1/documents/does-not-exist");
  assert.equal(anon.status, 401);
  const withKey = await c.request("DELETE", "/api/v1/documents/does-not-exist", {
    headers: { "x-api-key": key },
  });
  assert.equal(withKey.status, 404, "the key satisfies the guard; the id simply does not exist");
});

test("revoking a key stops it on the next request, and keeps the record", async () => {
  const { key, apiKey } = await createKey("short-lived");
  assert.equal(
    (await c.request("DELETE", "/api/v1/documents/does-not-exist", { headers: { "x-api-key": key } })).status,
    404,
  );

  const revoked = await c.request("DELETE", `/api/v1/admin/api-keys/${apiKey.id}`, { headers: admin });
  assert.equal(revoked.status, 200);
  assert.deepEqual(
    testing.checkResponse(openapi, "/api/v1/admin/api-keys/{id}", "delete", 200, revoked.json),
    [],
  );
  const view = revoked.json as KeyView;
  assert.equal(view.revoked, true);
  assert.ok(view.revokedAt);

  assert.equal(
    (await c.request("DELETE", "/api/v1/documents/does-not-exist", { headers: { "x-api-key": key } })).status,
    401,
    "a revoked key authenticates nothing",
  );
  const listed = (await listKeys()).items.find((k) => k.id === apiKey.id)!;
  assert.equal(listed.revoked, true, "the record stays, so the audit trail still explains what it did");

  // Idempotent, and unknown ids are a 404 rather than a silent success.
  assert.equal(
    (await c.request("DELETE", `/api/v1/admin/api-keys/${apiKey.id}`, { headers: admin })).status,
    200,
  );
  assert.equal(
    (await c.request("DELETE", "/api/v1/admin/api-keys/ffffffff", { headers: admin })).status,
    404,
  );
});

test("the security posture counts stored keys without naming them", async () => {
  const res = await c.get("/api/v1/admin/security", admin);
  assert.equal(res.status, 200);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/admin/security", "get", 200, res.json), []);
  const sec = res.json as {
    apiKeys: { count: number; hints: string[]; stored: number; seeded: number };
  };
  assert.ok(sec.apiKeys.stored >= 3, "the created keys are counted");
  assert.equal(sec.apiKeys.seeded, 0, "this deployment seeds none from API_KEYS");
  assert.ok(sec.apiKeys.hints.every((h) => h.startsWith("dip_") || h.startsWith("…")));
});
