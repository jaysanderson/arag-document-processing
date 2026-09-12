/**
 * Integration + contract tests: boot the whole product in-process against the mock ARAG.
 * Every assertion that touches a response also checks it against the OpenAPI schema.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { openapi } from "../src/openapi.ts";
import { createProduct, type Product } from "../src/server.ts";
import { DOC_TYPE_VALUES, STAGES } from "../src/types.ts";
import { Logger, readEnv, testing } from "../vendor/arag-platform/src/index.ts";

const ADMIN = "test-admin-token";
const INVOICE = readFileSync(new URL("../public/samples/invoice.txt", import.meta.url));

let product: Product;
let c: testing.TestClient;
/** Session cookie from POST /api/v1/session — destructive verbs require a credential. */
let writer: Record<string, string>;

before(async () => {
  const env = readEnv({
    ARAG_MOCK: "1",
    ADMIN_TOKEN: ADMIN,
    DATA_DIR: mkdtempSync(join(tmpdir(), "dip-")),
    RATE_LIMIT_RPS: "0",
    NODE_ENV: "test",
  });
  product = await createProduct(env, {
    log: new Logger({ level: "error", write: () => undefined }),
    persist: false,
  });
  c = await testing.startTestServer(product.app);
  const session = await c.post("/api/v1/session");
  writer = { cookie: session.headers.get("set-cookie")!.split(";")[0]! };
});

after(async () => {
  await c.close();
  await product.close();
});

/** Upload a document and wait for its job to finish. */
async function upload(
  body: Buffer | string,
  filename: string,
  contentType: string,
  config = "auto",
): Promise<{ id: string; jobId: string }> {
  const res = await c.request("POST", `/api/v1/documents?config=${encodeURIComponent(config)}`, {
    body: body as unknown as BodyInit,
    headers: { "Content-Type": contentType, "X-Filename": filename },
  });
  assert.equal(res.status, 202, res.text);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/documents", "post", 202, res.json), []);
  const { document, job } = res.json as { document: { id: string }; job: { id: string } };
  await waitForJob(job.id);
  return { id: document.id, jobId: job.id };
}

async function waitForJob(id: string, timeoutMs = 20_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = product.jobs.get(id);
    if (job && ["succeeded", "failed", "cancelled"].includes(job.status))
      return job as unknown as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${id} did not finish in ${timeoutMs} ms`);
}

// ─── contract ─────────────────────────────────────────────────────────────────

test("the OpenAPI document is lint-clean and every /api/v1 route is documented", () => {
  assert.deepEqual(testing.lintSpec(openapi), []);
  assert.deepEqual(testing.missingFromSpec(product.app, openapi), []);
});

test("docs, health and static surfaces are served", async () => {
  assert.equal((await c.get("/api/v1/openapi.json")).status, 200);
  assert.match((await c.get("/api/v1/docs")).text, /redoc/i);
  assert.match((await c.get("/api/v1/swagger")).text, /swagger/i);
  assert.equal((await c.get("/healthz")).status, 200);
  const ready = await c.get("/readyz");
  assert.equal((ready.json as { arag: { ok: boolean } }).arag.ok, true);
  // Readiness is cached briefly (every open tab polls it every 15 s, and each uncached
  // check costs a catalog + configuration call): an immediate second call is byte-identical.
  const again = await c.get("/readyz");
  assert.equal(again.text, ready.text, "/readyz should be served from the cache");
  assert.match((await c.get("/")).text, /arag-shell/);
  assert.match((await c.get("/admin/")).text, /Admin sign-in/);
  assert.match((await c.get("/ui/arag-ui.css")).headers.get("content-type") ?? "", /text\/css/);
});

// ─── pipeline ─────────────────────────────────────────────────────────────────

test("upload → job → canonical record with extracted fields, entities, summary", async () => {
  const { id, jobId } = await upload(INVOICE, "invoice.txt", "text/plain");

  const job = product.jobs.get(jobId)!;
  assert.equal(job.status, "succeeded");
  assert.equal(job.kind, "process-document");
  // The job emits exactly the documented stage names, in order.
  const stages = [...new Set(job.events.map((e) => e.stage))];
  assert.deepEqual(stages, [...STAGES]);

  const got = await c.get(`/api/v1/documents/${id}`);
  assert.equal(got.status, 200);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/documents/{id}", "get", 200, got.json), []);
  const rec = got.json as {
    status: string;
    docType: string;
    fields: Array<{ key: string; value: unknown }>;
    entities: unknown[];
    summary?: string;
    meta: {
      schema: string;
      searchConfiguration?: string;
      sourceChars?: number;
      durationsMs: Record<string, number>;
    };
  };
  assert.equal(rec.status, "ready");
  assert.equal(rec.docType, "invoice");
  assert.equal(rec.meta.schema, "invoice_extraction");
  assert.equal(rec.meta.searchConfiguration, "dip_invoice_extraction");
  assert.ok((rec.meta.sourceChars ?? 0) > 100);
  // The record carries the per-stage timings, not just the job (the demo and the API
  // both report `meta.durationsMs`).
  assert.deepEqual(Object.keys(rec.meta.durationsMs).sort(), [...STAGES].sort());
  const byKey = Object.fromEntries(rec.fields.map((f) => [f.key, f.value]));
  assert.equal(byKey.invoice_number, "INV-2026-0042");
  // Amounts are captured as STRINGS by the schema then normalised to numbers here.
  assert.equal(typeof byKey.total, "number");
  assert.equal(byKey.invoice_date, "2026-06-15"); // 15/06/2026 → ISO
  assert.ok(rec.entities.length > 0);
  assert.ok((rec.summary ?? "").length > 0);
});

test("SSE job events replay the pipeline for a finished job", async () => {
  const jobs = product.jobs.list({ kind: "process-document", limit: 1 });
  const jobId = jobs[0]!.id;
  const ev = await c.get(`/api/v1/jobs/${jobId}/events`);
  assert.equal(ev.status, 200);
  assert.match(ev.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.match(ev.text, /event: event/);
  assert.match(ev.text, /event: job/);
  assert.match(ev.text, /standardize/);
});

test("a forced extraction config skips classification", async () => {
  const { id, jobId } = await upload(INVOICE, "forced-invoice.txt", "text/plain", "purchase_order");
  const job = product.jobs.get(jobId)!;
  const classify = job.events.find((e) => e.stage === "classify");
  assert.equal(classify?.status, "skip");
  const rec = (await c.get(`/api/v1/documents/${id}`)).json as {
    docType: string;
    meta: { forced: boolean; config: string };
  };
  assert.equal(rec.docType, "purchase_order");
  assert.equal(rec.meta.forced, true);
  assert.equal(rec.meta.config, "purchase order");
});

test("listing is paged and filterable", async () => {
  const list = await c.get("/api/v1/documents?page=1&page_size=10&status=ready");
  assert.equal(list.status, 200);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/documents", "get", 200, list.json), []);
  const page = list.json as { items: unknown[]; total: number; page_size: number };
  assert.ok(page.total >= 2);
  assert.equal(page.page_size, 10);
  assert.equal((await c.get("/api/v1/documents?page=0")).status, 400);
  assert.equal((await c.get("/api/v1/documents?doc_type=not-a-type")).status, 400);
});

// ─── exports ──────────────────────────────────────────────────────────────────

test("exports serialise the record as JSON, XML and CSV with a download filename", async () => {
  const { id } = await upload(INVOICE, "export-me.txt", "text/plain");

  const json = await c.get(`/api/v1/documents/${id}/export?format=json`);
  assert.equal(json.status, 200);
  assert.match(json.headers.get("content-disposition") ?? "", /filename="export-me\.json"/);
  assert.equal((JSON.parse(json.text) as { id: string }).id, id);

  const xml = await c.get(`/api/v1/documents/${id}/export?format=xml`);
  assert.match(xml.headers.get("content-type") ?? "", /application\/xml/);
  assert.match(xml.text, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml.text, /<document id="/);
  assert.match(xml.text, /<fields>/);

  const csv = await c.get(`/api/v1/documents/${id}/export?format=csv`);
  assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(csv.text.split("\n")[0]!, /^document_id,filename,doc_type,field_key/);
  assert.ok(csv.text.split("\n").length > 2);

  assert.equal((await c.get(`/api/v1/documents/${id}/export?format=yaml`)).status, 400);
});

// ─── ask ──────────────────────────────────────────────────────────────────────

test("ask answers a question grounded in one document", async () => {
  const { id } = await upload(INVOICE, "ask-me.txt", "text/plain");
  const res = await c.post(`/api/v1/documents/${id}/ask`, { question: "What is the total due?" });
  assert.equal(res.status, 200);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/documents/{id}/ask", "post", 200, res.json), []);
  const ans = res.json as { answer: string; sources: string[] };
  assert.ok(ans.answer.length > 0);
  assert.ok(Array.isArray(ans.sources));
  assert.equal((await c.post(`/api/v1/documents/${id}/ask`, { question: "" })).status, 400);
  assert.equal((await c.post("/api/v1/documents/missing/ask", { question: "hi" })).status, 404);
});

// ─── upload validation ────────────────────────────────────────────────────────

test("uploads are validated: MIME allowlist, empty body, unknown config", async () => {
  const bad = await c.request("POST", "/api/v1/documents", {
    body: "MZ binary" as unknown as BodyInit,
    headers: { "Content-Type": "application/x-msdownload", "X-Filename": "virus.exe" },
  });
  assert.equal(bad.status, 415);
  assert.equal((bad.json as { title: string }).title, "Unsupported media type");

  const empty = await c.request("POST", "/api/v1/documents", {
    body: "" as unknown as BodyInit,
    headers: { "Content-Type": "text/plain", "X-Filename": "empty.txt" },
  });
  assert.equal(empty.status, 400);

  const unknown = await c.request("POST", "/api/v1/documents?config=nope", {
    body: "hello" as unknown as BodyInit,
    headers: { "Content-Type": "text/plain", "X-Filename": "a.txt" },
  });
  assert.equal(unknown.status, 400);
});

test("filenames are sanitised before they reach the KB or Content-Disposition", async () => {
  const res = await c.request("POST", "/api/v1/documents", {
    body: INVOICE as unknown as BodyInit,
    headers: { "Content-Type": "text/plain", "X-Filename": '../../etc/pa"sswd.txt' },
  });
  assert.equal(res.status, 202);
  const { document } = res.json as { document: { filename: string; id: string } };
  assert.equal(document.filename, "pa_sswd.txt");
  await waitForJob((res.json as { job: { id: string } }).job.id);
  const exp = await c.get(`/api/v1/documents/${document.id}/export?format=csv`);
  assert.match(exp.headers.get("content-disposition") ?? "", /filename="pa_sswd\.csv"/);
});

test("multipart uploads work and carry the config field", async () => {
  // Mixed case on purpose: browsers send `----WebKitFormBoundaryAbC…` and the boundary
  // must survive verbatim (a lowercased Content-Type finds no parts at all).
  const boundary = "----DipTestBoundaryAbC123";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="config"\r\n\r\ncontract\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="contract.txt"\r\n` +
        `Content-Type: text/plain\r\n\r\n`,
    ),
    readFileSync(new URL("../public/samples/contract.txt", import.meta.url)),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await c.request("POST", "/api/v1/documents", {
    body: body as unknown as BodyInit,
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
  });
  assert.equal(res.status, 202, res.text);
  const { document, job } = res.json as { document: { filename: string; id: string }; job: { id: string } };
  assert.equal(document.filename, "contract.txt");
  await waitForJob(job.id);
  const rec = (await c.get(`/api/v1/documents/${document.id}`)).json as { docType: string };
  assert.equal(rec.docType, "contract");
});

// ─── extraction configs ───────────────────────────────────────────────────────

test("extraction configs: built-ins listed, custom created + provisioned + deletable", async () => {
  const list = await c.get("/api/v1/extraction-configs");
  assert.equal(list.status, 200);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/extraction-configs", "get", 200, list.json), []);
  const builtins = (list.json as { items: Array<{ builtin: boolean; id: string; aragConfig: string }> })
    .items;
  assert.equal(builtins.filter((c2) => c2.builtin).length, DOC_TYPE_VALUES.length);
  assert.ok(builtins.some((c2) => c2.id === "medical_claim"));
  assert.ok(builtins.some((c2) => c2.id === "preauthorisation"));
  assert.ok(builtins.some((c2) => c2.id === "bank_statement"));
  assert.ok(builtins.every((c2) => c2.aragConfig.startsWith("dip_")));

  const created = await c.post(
    "/api/v1/extraction-configs",
    {
      name: "Insurance Card",
      fields: [
        { label: "Policy Number", required: true },
        { label: "Insurer" },
        { label: "Benefits", type: "array" },
      ],
    },
    writer,
  );
  assert.equal(created.status, 201, created.text);
  assert.deepEqual(
    testing.checkResponse(openapi, "/api/v1/extraction-configs", "post", 201, created.json),
    [],
  );
  const cfg = created.json as { id: string; aragConfig: string; provisioned: boolean; fields: unknown[] };
  assert.match(cfg.id, /^cfg_/);
  assert.equal(cfg.aragConfig, "dip_custom_insurance_card");
  assert.equal(cfg.provisioned, true);
  assert.equal(cfg.fields.length, 3);

  // The stored ARAG search configuration really exists in the (mock) KB.
  const stored = await product.arag.getSearchConfiguration("dip_custom_insurance_card");
  assert.equal(stored.kind, "ask");
  const storedConfig = stored.config as { rag_strategies: Array<{ name: string }>; prompt: unknown };
  assert.equal(storedConfig.rag_strategies[0]!.name, "full_resource");

  const one = await c.get(`/api/v1/extraction-configs/${cfg.id}`);
  assert.equal(one.status, 200);
  assert.deepEqual(
    testing.checkResponse(openapi, "/api/v1/extraction-configs/{id}", "get", 200, one.json),
    [],
  );

  // The custom config is usable as the upload `config` parameter.
  const { id: docId } = await upload(INVOICE, "custom-cfg.txt", "text/plain", cfg.id);
  const rec = (await c.get(`/api/v1/documents/${docId}`)).json as { meta: { config: string } };
  assert.equal(rec.meta.config, "Insurance Card");

  assert.equal(
    (await c.request("DELETE", "/api/v1/extraction-configs/invoice", { headers: writer })).status,
    409,
  );
  assert.equal(
    (await c.request("DELETE", `/api/v1/extraction-configs/${cfg.id}`, { headers: writer })).status,
    204,
  );
  assert.equal((await c.get(`/api/v1/extraction-configs/${cfg.id}`)).status, 404);

  const badCfg = await c.post("/api/v1/extraction-configs", { name: "", fields: [] }, writer);
  assert.equal(badCfg.status, 400);
});

test("the schema catalogue lists every document type and its fields", async () => {
  const res = await c.get("/api/v1/schemas");
  assert.equal(res.status, 200);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/schemas", "get", 200, res.json), []);
  const items = (res.json as { items: Array<{ docType: string; fields: unknown[] }> }).items;
  assert.equal(items.length, DOC_TYPE_VALUES.length);
  const invoice = items.find((i) => i.docType === "invoice")!;
  assert.ok(invoice.fields.length >= 10);
});

// ─── jobs ─────────────────────────────────────────────────────────────────────

test("jobs are listable, fetchable and cancellable", async () => {
  const list = await c.get("/api/v1/jobs?limit=5");
  assert.equal(list.status, 200);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/jobs", "get", 200, list.json), []);
  const jobs = (list.json as { items: Array<{ id: string }> }).items;
  const one = await c.get(`/api/v1/jobs/${jobs[0]!.id}`);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/jobs/{id}", "get", 200, one.json), []);
  assert.equal((await c.get("/api/v1/jobs/missing")).status, 404);
  assert.equal((await c.request("DELETE", "/api/v1/jobs/missing", { headers: writer })).status, 404);
  // Cancelling a finished job is a no-op that still answers 204.
  assert.equal((await c.request("DELETE", `/api/v1/jobs/${jobs[0]!.id}`, { headers: writer })).status, 204);
});

// ─── admin ────────────────────────────────────────────────────────────────────

test("admin routes require the token; login sets an HttpOnly cookie", async () => {
  assert.equal((await c.get("/api/v1/admin/health")).status, 401);
  const h = await c.get("/api/v1/admin/health", { authorization: `Bearer ${ADMIN}` });
  assert.equal(h.status, 200);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/admin/health", "get", 200, h.json), []);
  const health = h.json as {
    arag: { ok: boolean; mock: boolean };
    generativeModel: string;
    documents: Record<string, number>;
  };
  assert.equal(typeof health.documents.degraded, "number");
  assert.equal(health.arag.ok, true);
  assert.equal(health.arag.mock, true);
  assert.ok(health.generativeModel.length > 0);

  const login = await c.post("/api/v1/admin/login", { token: ADMIN });
  const setCookie = login.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /HttpOnly/);
  const cookie = setCookie.split(";")[0]!;
  assert.equal((await c.get("/api/v1/admin/config", { cookie })).status, 200);
  assert.equal((await c.get("/api/v1/admin/usage", { cookie })).status, 200);
  assert.equal((await c.get("/api/v1/admin/logs?level=info&limit=10", { cookie })).status, 200);
  assert.equal((await c.post("/api/v1/admin/login", { token: "wrong" })).status, 401);
});

test("admin config redacts secrets", async () => {
  const cfg = await c.get("/api/v1/admin/config", { authorization: `Bearer ${ADMIN}` });
  const body = JSON.stringify(cfg.json);
  assert.ok(body.includes("adminToken"));
  assert.ok(!body.includes(ADMIN), "the admin token must never be echoed back");
});

test("admin provision re-creates every ARAG search configuration", async () => {
  const res = await c.post("/api/v1/admin/provision", undefined, { authorization: `Bearer ${ADMIN}` });
  assert.equal(res.status, 200);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/admin/provision", "post", 200, res.json), []);
  const out = res.json as { ok: number; failed: number; items: Array<{ aragConfig: string; ok: boolean }> };
  assert.equal(out.failed, 0);
  assert.ok(out.ok >= DOC_TYPE_VALUES.length);
  assert.ok(out.items.every((i) => i.aragConfig.startsWith("dip_")));

  // The provisioned configurations are readable back from the Knowledge Box.
  const listed = await c.get("/api/v1/admin/search-configurations", {
    authorization: `Bearer ${ADMIN}`,
  });
  assert.equal(listed.status, 200);
  assert.deepEqual(
    testing.checkResponse(openapi, "/api/v1/admin/search-configurations", "get", 200, listed.json),
    [],
  );
  const configs = listed.json as {
    items: Array<{ name: string; kind: string; config: Record<string, unknown> }>;
  };
  assert.ok(configs.items.length >= DOC_TYPE_VALUES.length);
  const invoiceCfg = configs.items.find((i) => i.name === "dip_invoice_extraction")!;
  assert.equal(invoiceCfg.kind, "ask");
  assert.equal((invoiceCfg.config.rag_strategies as Array<{ name: string }>)[0]!.name, "full_resource");
  assert.ok(invoiceCfg.config.answer_json_schema, "the stored config carries the extraction schema");
  assert.equal((await c.get("/api/v1/admin/search-configurations")).status, 401);
});

test("admin purge deletes old documents from the store and the KB", async () => {
  const before0 = product.documents.stats().total ?? 0;
  assert.ok(before0 > 0);
  const res = await c.post("/api/v1/admin/purge", { olderThanDays: 0 }, { authorization: `Bearer ${ADMIN}` });
  assert.equal(res.status, 200);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/admin/purge", "post", 200, res.json), []);
  const out = res.json as { deleted: string[]; failed: unknown[] };
  assert.equal(out.deleted.length, before0);
  assert.equal(out.failed.length, 0);
  assert.equal(product.documents.stats().total, 0);
});

test("deleting a document also deletes the KB resource", async () => {
  const { id } = await upload(INVOICE, "delete-me.txt", "text/plain");
  assert.equal((await c.request("DELETE", `/api/v1/documents/${id}`, { headers: writer })).status, 204);
  assert.equal((await c.get(`/api/v1/documents/${id}`)).status, 404);
  assert.equal((await c.request("DELETE", `/api/v1/documents/${id}`, { headers: writer })).status, 404);
  await assert.rejects(() => product.arag.getResource(id));
});

test("destructive verbs reject anonymous callers even when API_KEYS is unset", async () => {
  const { id } = await upload(INVOICE, "guard-me.txt", "text/plain");
  // Reads and uploads stay open so the docs and the demo work with no setup…
  assert.equal((await c.get(`/api/v1/documents/${id}`)).status, 200);
  // …but deleting a document also deletes the Knowledge Box resource.
  const anon = await c.request("DELETE", `/api/v1/documents/${id}`);
  assert.equal(anon.status, 401);
  assert.match((anon.json as { detail: string }).detail, /POST \/api\/v1\/session/);
  assert.equal((await c.request("DELETE", "/api/v1/jobs/anything")).status, 401);
  assert.equal((await c.request("DELETE", "/api/v1/extraction-configs/invoice")).status, 401);
  // Creating a config provisions a stored ARAG search configuration — also a shared write.
  const anonCfg = await c.post("/api/v1/extraction-configs", {
    name: "Anon Probe",
    fields: [{ label: "Anything" }],
  });
  assert.equal(anonCfg.status, 401);
  // The admin token is also a writer credential.
  assert.equal(
    (
      await c.request("DELETE", `/api/v1/documents/${id}`, {
        headers: { authorization: `Bearer ${ADMIN}` },
      })
    ).status,
    204,
  );
});

test("a session cookie can be issued for the demo UI", async () => {
  const res = await c.post("/api/v1/session");
  assert.equal(res.status, 200);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/session", "post", 200, res.json), []);
  assert.match(res.headers.get("set-cookie") ?? "", /arag_session=/);
});

test("errors are RFC 9457 problem documents with a request id", async () => {
  const res = await c.get("/api/v1/documents/does-not-exist");
  assert.equal(res.status, 404);
  assert.match(res.headers.get("content-type") ?? "", /application\/problem\+json/);
  const problem = res.json as { type: string; status: number; requestId: string; instance: string };
  assert.equal(problem.type, "https://arag.dev/problems/not-found");
  assert.equal(problem.status, 404);
  assert.ok(problem.requestId.length > 0);
  assert.equal(problem.instance, "/api/v1/documents/does-not-exist");
});
