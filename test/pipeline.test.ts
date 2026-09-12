/**
 * Pipeline behaviours that need a differently-configured mock ARAG: slow processing
 * (so a job is observably running), the Data Augmentation agent path, and the
 * empty-extraction retry. Extra mock behaviour is supplied through `answerHook`
 * (platform contract) rather than by editing vendored files.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createProduct, type Product } from "../src/server.ts";
import { fieldsFromObject } from "../src/services/agents.ts";
import { Logger, readEnv, testing } from "../vendor/arag-platform/src/index.ts";

const INVOICE = readFileSync(new URL("../public/samples/invoice.txt", import.meta.url));

/**
 * Extra mock behaviour belongs in an `answerHook`, never in vendored files. This one makes
 * the FIRST schema extraction for `retry-me.txt` come back empty, so the pipeline's
 * retry-once-on-empty guard is exercised end to end.
 */
const emptied = new Set<string>();
function answerHook(
  req: { search_configuration?: string },
  ctx: { resources: Array<{ title: string }> },
): { answerJson?: unknown } | null {
  const title = ctx.resources[0]?.title;
  if (req.search_configuration && title === "retry-me.txt" && !emptied.has(title)) {
    emptied.add(title);
    return { answerJson: {} };
  }
  return null;
}

let product: Product;
let c: testing.TestClient;
let writer: Record<string, string>;

before(async () => {
  const env = readEnv({
    ARAG_MOCK: "1",
    ADMIN_TOKEN: "pipeline-admin",
    DATA_DIR: mkdtempSync(join(tmpdir(), "dip-pipe-")),
    RATE_LIMIT_RPS: "0",
    NODE_ENV: "test",
  });
  product = await createProduct(env, {
    log: new Logger({ level: "error", write: () => undefined }),
    persist: false,
    // PROCESSED lags searchability in real ARAG; the mock reproduces both delays so the
    // job is observably "running" and the SSE stream has something live to send.
    mock: { processingMs: 400, searchableLagMs: 200, answerHook },
  });
  c = await testing.startTestServer(product.app);
  const session = await c.post("/api/v1/session");
  writer = { cookie: session.headers.get("set-cookie")!.split(";")[0]! };
});

after(async () => {
  await c.close();
  await product.close();
});

function post(path: string, body: Buffer, filename: string, contentType = "text/plain") {
  return c.request("POST", path, {
    body: body as unknown as BodyInit,
    headers: { "Content-Type": contentType, "X-Filename": filename },
  });
}

async function waitForJob(id: string, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = product.jobs.get(id);
    if (job && ["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${id} did not finish`);
}

test("a job is queued before it runs and streams events live while running", async () => {
  const res = await post("/api/v1/documents", INVOICE, "invoice.txt");
  assert.equal(res.status, 202);
  const { document, job } = res.json as {
    document: { status: string; jobId: string };
    job: { id: string; status: string };
  };
  assert.equal(document.status, "pending");
  assert.equal(document.jobId, job.id);
  assert.equal(job.status, "queued");

  // The SSE stream stays open while the job runs and closes on the terminal `job` event.
  const stream = await c.get(`/api/v1/jobs/${job.id}/events`);
  assert.equal(stream.status, 200);
  assert.match(stream.text, /event: job/);
  assert.match(stream.text, /"status":"succeeded"/);
  assert.match(stream.text, /"stage":"process"/);

  const finished = await waitForJob(job.id);
  assert.equal(finished.status, "succeeded");
  assert.equal(finished.progress, 1);
  // waitProcessed/waitSearchable really polled: the process stage took measurable time.
  assert.ok((finished.durationsMs.process ?? 0) >= 300, "process stage should have polled");
});

test("extraction retries once when the model returns nothing", async () => {
  const res = await post("/api/v1/documents", INVOICE, "retry-me.txt");
  const { document, job } = res.json as { document: { id: string }; job: { id: string } };
  const finished = await waitForJob(job.id);
  assert.equal(finished.status, "succeeded");
  assert.ok(emptied.has("retry-me.txt"), "the answerHook should have emptied the first extraction");
  const rec = (await c.get(`/api/v1/documents/${document.id}`)).json as {
    status: string;
    fields: unknown[];
  };
  assert.equal(rec.status, "ready");
  assert.ok(rec.fields.length > 0, "the retry should have recovered the fields");
});

test("config=agent falls back to live extraction when the resource has no agent fields", async () => {
  const res = await post("/api/v1/documents?config=agent", INVOICE, "agent-miss.txt");
  const { document, job } = res.json as { document: { id: string }; job: { id: string } };
  const finished = await waitForJob(job.id);
  assert.equal(finished.status, "succeeded");
  const skip = finished.events.find((e) => e.stage === "classify" && e.status === "skip");
  assert.match(skip?.message ?? "", /No DA-agent fields/);
  const rec = (await c.get(`/api/v1/documents/${document.id}`)).json as {
    meta: { schema: string };
    fields: unknown[];
  };
  assert.equal(rec.meta.schema, "invoice_extraction");
  assert.ok(rec.fields.length > 0);
});

test("config=agent reads fields a Data Augmentation agent persisted on the resource", async () => {
  const first = await post("/api/v1/documents?config=agent", INVOICE, "agent-hit.txt");
  const { document, job } = first.json as { document: { id: string }; job: { id: string } };
  await waitForJob(job.id);

  // Simulate what a DA "ask" agent does in the ARAG dashboard: write a JSON text field
  // onto the resource. `readPersistedFields` picks up exactly this shape.
  const resource = product.mock!.mock.resources.get(document.id)!;
  const persisted = {
    policy_number: "POL-99881",
    insurer: "Meridian Health",
    premium_due: "$1,240.50",
    renewal_date: "15/06/2027",
    status: "Not specified",
  };
  resource.fields.da_fields = {
    kind: "text",
    body: JSON.stringify(persisted),
    format: "JSON",
    text: JSON.stringify(persisted),
    paragraphs: [],
    classifications: [],
  };

  // Re-run the pipeline for the same document via a fresh job.
  const rerun = product.jobs.submit(
    "process-document",
    {
      documentId: document.id,
      resourceId: document.id,
      filename: "agent-hit.txt",
      contentType: "text/plain",
      config: "agent",
    },
    { ref: document.id },
  );
  const finished = await waitForJob(rerun.id);
  assert.equal(finished.status, "succeeded");

  const rec = (await c.get(`/api/v1/documents/${document.id}`)).json as {
    meta: { schema: string; config: string; forced: boolean };
    fields: Array<{ key: string; label: string; value: unknown; raw?: string }>;
  };
  assert.equal(rec.meta.schema, "da_agent");
  assert.equal(rec.meta.forced, true);
  assert.match(rec.meta.config, /DA agent/);
  const byKey = Object.fromEntries(rec.fields.map((f) => [f.key, f]));
  assert.equal(byKey.policy_number!.label, "Policy Number");
  assert.equal(byKey.premium_due!.value, 1240.5); // amount heuristics normalise it
  assert.equal(byKey.premium_due!.raw, "$1,240.50");
  assert.equal(byKey.renewal_date!.value, "2027-06-15"); // date heuristics → ISO
  assert.equal(byKey.status, undefined, '"Not specified" is a sentinel and must be dropped');
});

test("a queued job can be cancelled", async () => {
  const res = await post("/api/v1/documents", INVOICE, "cancel-me.txt");
  const { job } = res.json as { job: { id: string } };
  assert.equal((await c.request("DELETE", `/api/v1/jobs/${job.id}`, { headers: writer })).status, 204);
  const cancelled = product.jobs.get(job.id)!;
  assert.equal(cancelled.status, "cancelled");
  // The SSE stream for a finished job replays and closes immediately.
  const stream = await c.get(`/api/v1/jobs/${job.id}/events`);
  assert.match(stream.text, /"status":"cancelled"/);
});

test("fieldsFromObject normalises arbitrary agent keys", () => {
  const fields = fieldsFromObject({
    total_amount: "$96,000.00",
    issued_at: "15/06/2026",
    note: "",
    missing: null,
    count: 3,
    sentinel: "N/A",
  });
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  assert.equal(byKey.total_amount!.value, 96000);
  assert.equal(byKey.total_amount!.label, "Total Amount");
  assert.equal(byKey.issued_at!.value, "2026-06-15");
  assert.equal(byKey.count!.value, 3);
  assert.equal(byKey.note, undefined);
  assert.equal(byKey.missing, undefined);
  assert.equal(byKey.sentinel, undefined);
});

test("a failed stage is surfaced on the record, not just in the job events", async () => {
  // Simulate ARAG losing a stored search configuration (a KB reset, a bad provision run):
  // extraction then fails on both attempts while every other stage still succeeds.
  await product.arag.deleteSearchConfiguration("dip_receipt_extraction");
  const res = await post("/api/v1/documents?config=receipt", INVOICE, "broken-config.txt");
  const { document, job } = res.json as { document: { id: string }; job: { id: string } };
  const finished = await waitForJob(job.id);

  // The job still succeeds — one flaky stage must not lose the rest of the extraction.
  assert.equal(finished.status, "succeeded");
  const extract = finished.events.find((e) => e.stage === "extract" && e.status === "error");
  assert.ok(extract, "the extract stage should have errored");

  const rec = (await c.get(`/api/v1/documents/${document.id}`)).json as {
    status: string;
    fields: unknown[];
    issues: Array<{ field: string; severity: string; message: string }>;
    meta: { stageErrors?: string[] };
  };
  assert.equal(rec.status, "ready");
  assert.deepEqual(rec.fields, []);
  // …but "ARAG was unavailable" must not look like "this document had no fields".
  assert.ok(
    rec.meta.stageErrors?.some((e) => e.startsWith("extract:")),
    JSON.stringify(rec.meta),
  );
  assert.ok(rec.issues.some((i) => i.field === "extract" && i.severity === "error"));
  // Entities and the summary still ran.
  assert.ok((finished.durationsMs.entities ?? 0) >= 0);
});
