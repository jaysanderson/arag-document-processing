/**
 * The audited-change log: who, what, when — and the cursor that makes it readable while it
 * is still being written to.
 *
 * Paging is the part that is easy to get wrong, so it is tested the way it fails in
 * practice: read a page, let more entries arrive, walk forward, walk back, and check that
 * nothing was duplicated and nothing was skipped. The same cursor contract is applied to
 * the runtime log ring (`/api/v1/admin/logs`), which is the other half of the deferred
 * "admin-log cursor" item.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { openapi } from "../src/openapi.ts";
import { createProduct, type Product } from "../src/server.ts";
import { redactDeep } from "../src/services/audit.ts";
import { Logger, readEnv, testing } from "../vendor/arag-platform/src/index.ts";

const ADMIN = "audit-admin-token";
const admin = { authorization: `Bearer ${ADMIN}` };

let product: Product;
let c: testing.TestClient;
/** Session cookie: destructive verbs need a credential (DP-12). */
let writer: Record<string, string>;

interface Entry {
  id: string;
  seq: number;
  ts: string;
  actor: { type: string; name: string };
  action: string;
  target: string;
  before: unknown;
  after: unknown;
  requestId: string | null;
  detail?: string;
}
interface Page {
  items: Entry[];
  actions: string[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
  hasPrev: boolean;
  total: number;
}

before(async () => {
  const env = readEnv({
    ARAG_MOCK: "1",
    ADMIN_TOKEN: ADMIN,
    DATA_DIR: mkdtempSync(join(tmpdir(), "dip-audit-")),
    RATE_LIMIT_RPS: "0",
    NODE_ENV: "test",
  });
  product = await createProduct(env, {
    log: new Logger({ level: "error", write: () => undefined }),
    persist: false,
    provisionAtBoot: false,
  });
  c = await testing.startTestServer(product.app);
  const session = await c.post("/api/v1/session");
  writer = { cookie: session.headers.get("set-cookie")!.split(";")[0]! };
});

after(async () => {
  await c.close();
  await product.close();
});

async function audit(query = ""): Promise<Page> {
  const res = await c.get(`/api/v1/admin/audit${query}`, admin);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/admin/audit", "get", 200, res.json), []);
  return res.json as Page;
}

async function setSetting(key: string, value: unknown): Promise<void> {
  const res = await c.request("PATCH", "/api/v1/admin/settings", { json: { [key]: value }, headers: admin });
  assert.equal(res.status, 200, res.text);
}

test("a settings change is audited with the actor, the field and before → after", async () => {
  await setSetting("branding.footerText", "© Audited Ltd");
  const page = await audit("?action=settings.update");
  const entry = page.items[0]!;
  assert.equal(entry.action, "settings.update");
  assert.equal(entry.target, "branding.footerText");
  assert.equal(entry.after, "© Audited Ltd");
  assert.deepEqual(entry.actor, { type: "admin", name: "admin token" });
  assert.ok(entry.requestId, "the entry correlates with the request log");
  assert.ok(Date.now() - Date.parse(entry.ts) < 60_000);

  // before → after, not just after.
  await setSetting("branding.footerText", "© Audited Ltd 2");
  const next = (await audit("?action=settings.update")).items[0]!;
  assert.equal(next.before, "© Audited Ltd");
  assert.equal(next.after, "© Audited Ltd 2");

  // A reset is audited as its own action.
  await c.post("/api/v1/admin/settings/reset", { keys: ["branding.footerText"] }, admin);
  const resetEntry = (await audit("?action=settings.reset")).items[0]!;
  assert.equal(resetEntry.target, "branding.footerText");
  assert.match(String(resetEntry.detail), /environment default/);
});

test("secrets are audited as having changed, never as what they changed to", async () => {
  const secret = "super-secret-service-account-key";
  await setSetting("connection.apiKey", secret);
  const entry = (await audit("?target=connection.apiKey")).items[0]!;
  assert.equal(entry.action, "settings.update");
  assert.equal(entry.before, "***");
  assert.equal(entry.after, "***");
  assert.match(String(entry.detail), /secret rotated/);
  const whole = await c.get("/api/v1/admin/audit?limit=500", admin);
  assert.ok(!whole.text.includes(secret), "the audit log never carries a secret value");
  assert.ok(!whole.text.includes(ADMIN), "nor the admin token");
  await c.post("/api/v1/admin/settings/reset", { keys: ["connection.apiKey"] }, admin);
});

test("API-key creation and revocation are audited without the key", async () => {
  const created = await c.post("/api/v1/admin/api-keys", { name: "audited-key" }, admin);
  assert.equal(created.status, 201);
  const key = created.json as { key: string; apiKey: { id: string } };
  const createEntry = (await audit("?action=apikey.create")).items[0]!;
  assert.equal(createEntry.target, key.apiKey.id);
  assert.equal((createEntry.after as { name: string }).name, "audited-key");
  assert.ok(!JSON.stringify(createEntry).includes(key.key), "the key itself is never audited");

  await c.request("DELETE", `/api/v1/admin/api-keys/${key.apiKey.id}`, { headers: admin });
  const revokeEntry = (await audit("?action=apikey.revoke")).items[0]!;
  assert.equal(revokeEntry.target, key.apiKey.id);
  assert.deepEqual(revokeEntry.before, { revoked: false });
  assert.equal((revokeEntry.after as { revoked: boolean }).revoked, true);
});

test("extraction-config writes are audited with the config's before and after", async () => {
  const created = await c.post(
    "/api/v1/extraction-configs",
    { name: "Audited Config", fields: [{ label: "Policy Number" }] },
    writer,
  );
  assert.equal(created.status, 201, created.text);
  const cfg = created.json as { id: string; name: string };
  const createEntry = (await audit("?action=config.create")).items[0]!;
  assert.equal(createEntry.target, cfg.id);
  assert.equal((createEntry.after as { name: string }).name, "Audited Config");
  assert.equal(createEntry.actor.type, "session", "the session that made the write is the actor");

  await c.request("PUT", `/api/v1/extraction-configs/${cfg.id}`, {
    json: { name: "Audited Config v2", fields: [{ label: "Policy Number" }] },
    headers: writer,
  });
  const updateEntry = (await audit("?action=config.update")).items[0]!;
  assert.equal((updateEntry.before as { name: string }).name, "Audited Config");
  assert.equal((updateEntry.after as { name: string }).name, "Audited Config v2");

  await c.post(`/api/v1/extraction-configs/${cfg.id}/provision`, undefined, writer);
  assert.equal((await audit("?action=config.provision")).items[0]!.target, cfg.id);

  await c.request("DELETE", `/api/v1/extraction-configs/${cfg.id}`, { headers: writer });
  const deleteEntry = (await audit("?action=config.delete")).items[0]!;
  assert.equal(deleteEntry.target, cfg.id);
  assert.equal((deleteEntry.before as { name: string }).name, "Audited Config v2");

  // A rejected write is not an audited change.
  const rejected = await c.request("DELETE", "/api/v1/extraction-configs/invoice", { headers: writer });
  assert.equal(rejected.status, 409);
  assert.equal(
    (await audit("?action=config.delete")).items[0]!.target,
    cfg.id,
    "the refused delete of a built-in wrote no entry",
  );
});

test("document deletes and purges are audited; a dry run is not a change", async () => {
  const upload = await c.request("POST", "/api/v1/documents", {
    body: "INVOICE\nInvoice Number: INV-AUDIT-1\n",
    headers: { "Content-Type": "text/plain", "X-Filename": "audit-me.txt" },
  });
  assert.equal(upload.status, 202, upload.text);
  const { document, job } = upload.json as { document: { id: string }; job: { id: string } };
  const id = document.id;
  // Let the pipeline finish first: deleting mid-run leaves a job talking to a torn-down mock.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const j = product.jobs.get(job.id);
    if (j && ["succeeded", "failed", "cancelled"].includes(j.status)) break;
    await new Promise((r) => setTimeout(r, 25));
  }

  await c.request("DELETE", `/api/v1/documents/${id}`, { headers: writer });
  const del = (await audit("?action=document.delete")).items[0]!;
  assert.equal(del.target, id);
  assert.equal((del.before as { filename: string }).filename, "audit-me.txt");
  assert.equal((del.after as { deleted: boolean }).deleted, true);

  const before = (await audit("?action=documents.purge")).total;
  await c.post("/api/v1/admin/purge", { olderThanDays: 0, dryRun: true }, admin);
  assert.equal((await audit("?action=documents.purge")).total, before, "a dry run changes nothing");
  await c.post("/api/v1/admin/purge", { olderThanDays: 0 }, admin);
  const purge = (await audit("?action=documents.purge")).items[0]!;
  assert.equal(purge.target, "*");
  assert.equal((purge.before as { olderThanDays: number }).olderThanDays, 0);
  assert.equal(typeof (purge.after as { deleted: number }).deleted, "number");
});

test("the log can be filtered by action, actor and target", async () => {
  const all = await audit("?limit=500");
  assert.ok(all.actions.includes("settings.update"), "the distinct actions drive the filter");
  const byActor = await audit("?actor=session&limit=500");
  assert.ok(byActor.items.length > 0);
  assert.ok(byActor.items.every((e) => e.actor.type === "session"));
  const byPrefix = await audit("?action=settings&limit=500");
  assert.ok(byPrefix.items.every((e) => e.action.startsWith("settings.")));
  assert.ok(byPrefix.items.length >= 3, "an action prefix matches update and reset alike");
  assert.equal((await audit("?target=nothing-has-this-target")).items.length, 0);
});

test("paging is stable across inserts: forward, insert, back — no duplicates, no gaps", async () => {
  // A known run of entries to page through.
  for (let i = 0; i < 12; i++) await setSetting("branding.tagline", `tagline ${i}`);
  const snapshot = (await audit("?limit=500")).items.map((e) => e.seq);

  const page1 = await audit("?limit=5");
  assert.equal(page1.items.length, 5);
  assert.deepEqual(
    page1.items.map((e) => e.seq),
    snapshot.slice(0, 5),
    "the first page is the newest five",
  );
  assert.ok(page1.hasMore);
  assert.ok(page1.nextCursor);

  // Entries arrive while the operator is reading.
  for (let i = 0; i < 3; i++) await setSetting("branding.productName", `Inserted ${i}`);

  const page2 = await audit(`?limit=5&cursor=${encodeURIComponent(page1.nextCursor!)}&direction=older`);
  assert.deepEqual(
    page2.items.map((e) => e.seq),
    snapshot.slice(5, 10),
    "paging forward continues exactly where page one ended, despite the three new entries",
  );
  const seen = [...page1.items, ...page2.items].map((e) => e.seq);
  assert.equal(new Set(seen).size, seen.length, "no entry appears twice");
  assert.deepEqual(seen, snapshot.slice(0, 10), "and none was skipped");

  // Walking back returns the page we came from — not the three that arrived since.
  const back = await audit(`?limit=5&cursor=${encodeURIComponent(page2.prevCursor!)}&direction=newer`);
  assert.deepEqual(
    back.items.map((e) => e.seq),
    page1.items.map((e) => e.seq),
  );
  assert.ok(back.hasPrev, "and it knows newer entries now exist above it");

  // The very top now carries the three that arrived.
  const top = await audit("?limit=3");
  assert.equal(top.hasPrev, false, "the newest page has nothing above it");
  assert.ok(top.items.every((e) => e.seq > snapshot[0]!));

  // A cursor that is not one of ours is a 400, not a stack trace.
  const bad = await c.get("/api/v1/admin/audit?cursor=not-a-cursor", admin);
  assert.equal(bad.status, 400);
  assert.match(bad.headers.get("content-type") ?? "", /problem\+json/);
});

test("the runtime log pages with the same cursor contract", async () => {
  // The ring is only as interesting as the level allows; the level is itself a setting.
  await setSetting("operations.logLevel", "info");
  for (let i = 0; i < 12; i++) await c.get("/api/v1/samples");
  const tail = await c.get("/api/v1/admin/logs?limit=5", admin);
  assert.equal(tail.status, 200);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/admin/logs", "get", 200, tail.json), []);
  const page1 = tail.json as { items: Array<{ msg: string }>; prevCursor: string; hasPrev: boolean };
  assert.equal(page1.items.length, 5);
  assert.ok(page1.prevCursor, "there is a way back into the buffer");

  const older = await c.get(
    `/api/v1/admin/logs?limit=5&cursor=${encodeURIComponent(page1.prevCursor)}&direction=older`,
    admin,
  );
  const page2 = older.json as { items: Array<{ msg: string; ts: string }>; nextCursor: string };
  assert.equal(page2.items.length, 5);
  assert.ok(
    page2.items.every((r) => !page1.items.includes(r as never)),
    "the older page does not repeat the tail",
  );
  // Reading back the other way lands on the page we started from.
  const backAgain = await c.get(
    `/api/v1/admin/logs?limit=5&cursor=${encodeURIComponent(page2.nextCursor)}&direction=newer`,
    admin,
  );
  assert.deepEqual(
    (backAgain.json as { items: Array<{ ts: string }> }).items.map((r) => r.ts),
    (page1.items as unknown as Array<{ ts: string }>).map((r) => r.ts),
  );
  // Filters still apply on top of the cursor.
  const errorsOnly = await c.get("/api/v1/admin/logs?level=error&limit=5", admin);
  assert.ok((errorsOnly.json as { items: Array<{ level: string }> }).items.every((r) => r.level === "error"));
});

test("the redactor hides credentials without hiding the thing being audited", async () => {
  // The bug this pins: the pattern was an unanchored /key/, so a `config.create` entry had
  // every extraction-config field's own `key` and `provisioning.keyValueSchema` replaced
  // with "***". An audit log that redacts the thing it is auditing looks complete and is
  // not, which is worse than not having one.
  const entry = redactDeep({
    action: "config.create",
    after: {
      id: "cfg_abc",
      name: "Insurance Card",
      fields: [
        { key: "policy_number", label: "Policy Number", kvType: "text" },
        { key: "insurer", label: "Insurer" },
      ],
      provisioning: {
        state: "provisioned",
        searchConfiguration: "dip_custom_insurance_card",
        keyValueSchema: "dip_custom_insurance_card",
      },
    },
  }) as {
    after: {
      fields: Array<{ key: string }>;
      provisioning: { keyValueSchema: string; searchConfiguration: string };
    };
  };
  assert.equal(entry.after.fields[0]!.key, "policy_number");
  assert.equal(entry.after.fields[1]!.key, "insurer");
  assert.equal(entry.after.provisioning.keyValueSchema, "dip_custom_insurance_card");
  assert.equal(entry.after.provisioning.searchConfiguration, "dip_custom_insurance_card");

  // Still redacted: anything whose name ends in a credential word, however it is cased.
  const secrets = redactDeep({
    apiKey: "live",
    api_key: "live",
    adminToken: "live",
    clientSecret: "live",
    password: "live",
    authorization: "Bearer live",
    cookie: "arag_admin=live",
  }) as Record<string, string>;
  for (const [k, v] of Object.entries(secrets)) assert.equal(v, "***", `${k} must be redacted`);

  // Still NOT redacted: identifiers, counts and toggles that merely contain the word.
  const safe = redactDeep({
    key: "policy_number",
    keyValueSchema: "dip_invoice_extraction",
    kvSchemaId: "dip_invoice_extraction",
    keyId: "k_1",
    apiKeys: { count: 2 },
    requireApiKey: true,
    monkey: "not a credential",
  }) as Record<string, unknown>;
  assert.deepEqual(safe, {
    key: "policy_number",
    keyValueSchema: "dip_invoice_extraction",
    kvSchemaId: "dip_invoice_extraction",
    keyId: "k_1",
    apiKeys: { count: 2 },
    requireApiKey: true,
    monkey: "not a credential",
  });
});
