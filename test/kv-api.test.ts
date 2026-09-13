/**
 * Contract tests for the second half of the full-implementation pass: human review (field
 * corrections and the cross-document ask), key-value filtering on the documents list, and
 * the generator-agent endpoints with their comparison payload.
 *
 * Like `test/api.test.ts` these boot the whole product in-process against the mock ARAG and
 * check every response against the OpenAPI document, so the spec and the server cannot drift.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { openapi } from "../src/openapi.ts";
import { createProduct, type Product } from "../src/server.ts";
import type { DocumentRecord } from "../src/types.ts";
import { Logger, readEnv, testing } from "../vendor/arag-platform/src/index.ts";

const ADMIN = "kv-admin-token";
const INVOICE = readFileSync(new URL("../public/samples/invoice.txt", import.meta.url));

let product: Product;
let c: testing.TestClient;
let writer: Record<string, string>;
/** A processed invoice, uploaded once and reused by the read-only tests. */
let invoiceId: string;

before(async () => {
  const env = readEnv({
    ARAG_MOCK: "1",
    ADMIN_TOKEN: ADMIN,
    DATA_DIR: mkdtempSync(join(tmpdir(), "dip-kv-api-")),
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
  // Boot provisioning is fire-and-forget; the key-value write-back needs it to have landed.
  await product.provision();
  invoiceId = (await upload(INVOICE, "invoice.txt")).id;
});

after(async () => {
  await c.close();
  await product.close();
});

async function upload(body: Buffer, filename: string, config = "invoice"): Promise<{ id: string }> {
  const res = await c.request("POST", `/api/v1/documents?config=${encodeURIComponent(config)}`, {
    body: body as unknown as BodyInit,
    headers: { "Content-Type": "text/plain", "X-Filename": filename },
  });
  assert.equal(res.status, 202, res.text);
  const { document, job } = res.json as { document: { id: string }; job: { id: string } };
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const j = product.jobs.get(job.id);
    if (j && ["succeeded", "failed", "cancelled"].includes(j.status)) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  return { id: document.id };
}

function doc(id: string): DocumentRecord {
  return product.documents.require(id);
}

// ─── the spec itself ──────────────────────────────────────────────────────────

test("every new route is in the OpenAPI document, and the document is lint-clean", () => {
  assert.deepEqual(testing.lintSpec(openapi), []);
  assert.deepEqual(testing.missingFromSpec(product.app, openapi), []);
  const ops = (openapi as { paths: Record<string, Record<string, { operationId?: string }>> }).paths;
  const ids = new Set(
    Object.values(ops).flatMap((item) =>
      Object.entries(item)
        .filter(([m]) => m !== "parameters")
        .map(([, op]) => op.operationId),
    ),
  );
  for (const id of [
    "correctDocumentField",
    "revertDocumentField",
    "listDocumentCorrections",
    "askCorpus",
    "startConfigGenerator",
    "getConfigGenerator",
    "stopConfigGenerator",
    "deleteConfigGenerator",
    "runDocumentGenerator",
    "compareDocumentGenerator",
  ]) {
    assert.ok(ids.has(id), `${id} is missing from the OpenAPI document`);
  }
});

// ─── the pipeline's key-value write-back ──────────────────────────────────────

test("processing a document writes its fields into the resource's key-value field", async () => {
  const rec = doc(invoiceId);
  assert.equal(rec.meta.kv?.written, true, JSON.stringify(rec.meta.kv));
  assert.equal(rec.meta.kv?.schemaId, "dip_invoice_extraction");
  assert.equal(rec.meta.kv?.writes, 1);
  assert.equal(rec.meta.kv?.filterIndexStale, undefined);
  assert.ok((rec.meta.kv?.fields ?? 0) > 0);
  // Both halves are on the record, which is what the JSON tab renders.
  assert.ok(rec.meta.kv?.keys?.invoice_number);
  assert.equal(rec.meta.kv?.values?.invoice_number, "INV-2026-0042");
  // Money is a string on the record and a float in the Knowledge Box.
  assert.equal(typeof rec.meta.kv?.values?.total, "number");
  // The write really reached the Knowledge Box, not just the record's own metadata.
  const stored = await product.kv.readResourceKeyValues(rec.resourceId);
  assert.equal(stored.dip_invoice_extraction?.invoice_number, "INV-2026-0042");
  // A successful write leaves no stage error behind.
  assert.equal(
    (rec.meta.stageErrors ?? []).some((e) => /key-value/.test(e)),
    false,
  );
});

test("the record payload validates against the spec with its key-value block", async () => {
  const res = await c.get(`/api/v1/documents/${invoiceId}`);
  assert.equal(res.status, 200);
  assert.deepEqual(
    testing.checkResponse(openapi, "/api/v1/documents/{id}", "get", 200, res.json),
    [],
    JSON.stringify((res.json as { meta: unknown }).meta),
  );
});

test("each extraction config reports its key-value schema and its provisioning state", async () => {
  const res = await c.get("/api/v1/extraction-configs");
  assert.equal(res.status, 200);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/extraction-configs", "get", 200, res.json), []);
  const items = (res.json as { items: Array<Record<string, unknown>> }).items;
  const invoice = items.find((i) => i.id === "invoice")!;
  assert.equal(invoice.kvSchemaId, "dip_invoice_extraction");
  assert.equal((invoice.provisioning as { state: string }).state, "provisioned");
  assert.equal(
    (invoice.provisioning as { keyValueSchema: { state: string } }).keyValueSchema.state,
    "provisioned",
  );
  assert.equal((invoice.kvFields as Record<string, string>).total, "total");
  // The money override reaches the field list the Configs screen renders.
  const total = (invoice.fields as Array<Record<string, unknown>>).find((f) => f.key === "total")!;
  assert.equal(total.kvType, "float");
});

// ─── key-value filtering on the documents list ────────────────────────────────

test("a kv filter narrows the list through the Knowledge Box, and says so", async () => {
  const res = await c.get(`/api/v1/documents?kv=${encodeURIComponent("dip_invoice_extraction:total:gte:1")}`);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/documents", "get", 200, res.json), []);
  const page = res.json as {
    items: Array<{ id: string }>;
    filters: {
      knowledgeBox: { applied: unknown[]; requested: unknown[]; matchedResources: number };
      local: string[];
    };
  };
  assert.ok(page.items.some((i) => i.id === invoiceId));
  assert.deepEqual(page.filters.knowledgeBox.applied, [
    { schemaId: "dip_invoice_extraction", key: "total", op: "gte", value: "1" },
  ]);
  assert.deepEqual(page.filters.knowledgeBox.applied, page.filters.knowledgeBox.requested);
  assert.ok(page.filters.knowledgeBox.matchedResources >= 1);
  assert.deepEqual(page.filters.local, [], "nothing else was asked for");
});

test("a kv filter that matches nothing returns an empty page, not the whole list", async () => {
  const res = await c.get(
    `/api/v1/documents?kv=${encodeURIComponent("dip_invoice_extraction:vendor_name:eq:Nobody Ltd")}`,
  );
  assert.equal(res.status, 200);
  assert.equal((res.json as { items: unknown[] }).items.length, 0);
});

test("kv filters combine with local ones, and the page says which ran where", async () => {
  const res = await c.get(
    `/api/v1/documents?status=ready&q=invoice&kv=${encodeURIComponent("dip_invoice_extraction:total:gte:1")}`,
  );
  assert.equal(res.status, 200);
  const page = res.json as { filters: { knowledgeBox: { applied: unknown[] }; local: string[] } };
  assert.equal(page.filters.knowledgeBox.applied.length, 1);
  assert.deepEqual(page.filters.local.sort(), ["q", "status"]);
});

test("a kv filter the Knowledge Box would 412 is a 400 that names the legal operators", async () => {
  const bad = async (spec: string) => {
    const res = await c.get(`/api/v1/documents?kv=${encodeURIComponent(spec)}`);
    assert.equal(res.status, 400, `${spec} → ${res.status} ${res.text}`);
    return (res.json as { detail?: string; title?: string }).detail ?? res.text;
  };
  assert.match(await bad("dip_invoice_extraction:vendor_name:gte:a"), /text field, which supports eq/);
  assert.match(await bad("dip_invoice_extraction:line_items:eq:widgets"), /repeated text field/);
  assert.match(await bad("dip_invoice_extraction:total:gte:lots"), /needs a number; got "lots"/);
  assert.match(await bad("dip_invoice_extraction:nope:eq:x"), /has no field "nope"/);
  assert.match(await bad("not_a_schema:total:eq:1"), /unknown key-value schema "not_a_schema"/);
  assert.match(await bad("dip_invoice_extraction:total:like:1"), /supported operators are/);
  assert.match(await bad("garbage"), /is malformed/);
});

test("a repeated field is filtered with contains, and a date with a range", async () => {
  const member = await c.get(
    `/api/v1/documents?kv=${encodeURIComponent("dip_invoice_extraction:line_items:contains:" + (doc(invoiceId).meta.kv?.values?.line_items as string[])[0])}`,
  );
  assert.equal(member.status, 200);
  assert.ok((member.json as { items: Array<{ id: string }> }).items.some((i) => i.id === invoiceId));

  const dated = await c.get(
    `/api/v1/documents?kv=${encodeURIComponent("dip_invoice_extraction:invoice_date:gte:2020-01-01")}` +
      `&kv=${encodeURIComponent("dip_invoice_extraction:invoice_date:lte:2030-01-01")}`,
  );
  assert.equal(dated.status, 200);
  assert.ok((dated.json as { items: Array<{ id: string }> }).items.some((i) => i.id === invoiceId));
});

// ─── human review ─────────────────────────────────────────────────────────────

test("correcting a field records the change, re-verifies it and writes the whole record back", async () => {
  const { id } = await upload(INVOICE, "correct-me.txt");
  const before = doc(id);
  const beforeKeys = Object.keys(before.meta.kv?.values ?? {});
  assert.ok(beforeKeys.length > 1);

  const res = await c.request("PUT", `/api/v1/documents/${id}/fields/vendor_name`, {
    json: { value: "Northwind Traders Pty Ltd", reason: "Legal entity name on the letterhead" },
    headers: writer,
  });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(
    testing.checkResponse(openapi, "/api/v1/documents/{id}/fields/{key}", "put", 200, res.json),
    [],
  );
  const { document, correction } = res.json as {
    document: DocumentRecord;
    correction: {
      previousValue: string;
      value: string;
      verified: string;
      actor: string;
      reason: string;
      kv: { written: boolean; fieldId: string; filterIndexStale?: boolean };
    };
  };
  assert.equal(correction.value, "Northwind Traders Pty Ltd");
  assert.equal(correction.previousValue, before.fields.find((f) => f.key === "vendor_name")!.value);
  assert.equal(correction.reason, "Legal entity name on the letterhead");
  assert.equal(correction.actor, "session");
  // The model's confidence does not survive a value the model did not produce.
  assert.equal(document.fields.find((f) => f.key === "vendor_name")!.confidence, undefined);

  // The write-back sent the WHOLE record: a key-value write is a full replace, so sending
  // only the corrected key would have dropped every other value from the Knowledge Box.
  assert.equal(correction.kv.written, true);
  assert.equal(correction.kv.fieldId, "vendor_name");
  const stored = await product.kv.readResourceKeyValues(before.resourceId);
  assert.deepEqual(Object.keys(stored.dip_invoice_extraction!).sort(), beforeKeys.sort());
  assert.equal(stored.dip_invoice_extraction!.vendor_name, "Northwind Traders Pty Ltd");

  // The overwrite trap, surfaced rather than hidden.
  assert.equal(correction.kv.filterIndexStale, true);
  const after = doc(id);
  assert.equal(after.meta.kv?.filterIndexStale, true);
  assert.deepEqual(after.meta.kv?.superseded, [
    { field: "vendor_name", value: before.meta.kv!.values!.vendor_name },
  ]);
  // …and the resource really does still match a filter on the superseded value.
  const stale = await c.get(
    `/api/v1/documents?kv=${encodeURIComponent(`dip_invoice_extraction:vendor_name:eq:${before.meta.kv!.values!.vendor_name}`)}`,
  );
  assert.ok(
    (stale.json as { items: Array<{ id: string }> }).items.some((i) => i.id === id),
    "the KB filter index keeps every value ever written — which is exactly what we report",
  );
});

test("a corrected field stays in the grounding score, and the corrected count is reported alongside", async () => {
  const { id } = await upload(INVOICE, "grounding.txt");
  const before = doc(id);
  assert.equal(before.meta.groundingScore, 1);
  assert.equal(before.meta.correctedFields, undefined);

  // A value that is NOT in the document loses its quote, so the score falls — the ruling is
  // that a correction never silently removes the field from the denominator.
  await c.request("PUT", `/api/v1/documents/${id}/fields/vendor_name`, {
    json: { value: "A Vendor Not Printed Anywhere" },
    headers: writer,
  });
  const after = doc(id);
  assert.ok(after.meta.groundingScore! < 1, "an unverifiable correction lowers the score");
  assert.equal(after.meta.correctedFields, 1);

  // A correction that IS in the document earns a quote and counts in the numerator again.
  await c.request("PUT", `/api/v1/documents/${id}/fields/vendor_name`, {
    json: { value: before.fields.find((f) => f.key === "vendor_name")!.value },
    headers: writer,
  });
  const restored = doc(id);
  assert.equal(restored.meta.groundingScore, 1);
  assert.equal(restored.meta.correctedFields, 1, "still one corrected field, not two");
});

test("a correction is audited and listed, newest first", async () => {
  const { id } = await upload(INVOICE, "audited.txt");
  await c.request("PUT", `/api/v1/documents/${id}/fields/invoice_number`, {
    json: { value: "INV-2026-9999" },
    headers: writer,
  });
  const res = await c.get(`/api/v1/documents/${id}/corrections`, writer);
  assert.equal(res.status, 200);
  assert.deepEqual(
    testing.checkResponse(openapi, "/api/v1/documents/{id}/corrections", "get", 200, res.json),
    [],
  );
  assert.equal((res.json as { items: unknown[] }).items.length, 1);

  const audit = await c.get("/api/v1/admin/audit?action=document.field.correct", {
    authorization: `Bearer ${ADMIN}`,
  });
  assert.equal(audit.status, 200);
  const entries = (audit.json as { items: Array<{ target: string }> }).items;
  assert.ok(entries.some((e) => e.target === `${id}#invoice_number`));
});

test("reverting restores the previous value as a new, attributable correction", async () => {
  const { id } = await upload(INVOICE, "revert-me.txt");
  const original = doc(id).fields.find((f) => f.key === "invoice_number")!.value;
  await c.request("PUT", `/api/v1/documents/${id}/fields/invoice_number`, {
    json: { value: "INV-WRONG" },
    headers: writer,
  });
  const res = await c.request("DELETE", `/api/v1/documents/${id}/fields/invoice_number`, {
    headers: writer,
  });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(
    testing.checkResponse(openapi, "/api/v1/documents/{id}/fields/{key}", "delete", 200, res.json),
    [],
  );
  assert.equal(doc(id).fields.find((f) => f.key === "invoice_number")!.value, original);
  assert.equal(doc(id).corrections?.length, 2, "the history is append-only");
  assert.match((res.json as { correction: { reason: string } }).correction.reason, /Reverted the correction/);
});

test("correcting rejects an unknown field, an absent value and an anonymous caller", async () => {
  const unknown = await c.request("PUT", `/api/v1/documents/${invoiceId}/fields/not_a_field`, {
    json: { value: "x" },
    headers: writer,
  });
  assert.equal(unknown.status, 400);
  assert.match(unknown.text, /unknown field/);

  const empty = await c.request("PUT", `/api/v1/documents/${invoiceId}/fields/vendor_name`, {
    json: {},
    headers: writer,
  });
  assert.equal(empty.status, 400);

  const anon = await c.request("PUT", `/api/v1/documents/${invoiceId}/fields/vendor_name`, {
    json: { value: "x" },
  });
  assert.equal(anon.status, 401, "a write against shared state always needs a credential");

  const never = await c.request("DELETE", `/api/v1/documents/${invoiceId}/fields/currency`, {
    headers: writer,
  });
  assert.equal(never.status, 400);
  assert.match(never.text, /no correction to revert/);
});

test("the corpus ask answers over a filtered set and cites this product's document ids", async () => {
  const res = await c.request("POST", "/api/v1/ask", {
    json: { question: "Which vendors have we been invoiced by?", filters: { doc_type: ["invoice"] } },
  });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(testing.checkResponse(openapi, "/api/v1/ask", "post", 200, res.json), []);
  const out = res.json as {
    answer: string;
    scope: { documents: number };
    citations: Array<{ documentId: string }>;
    documents: Array<{ id: string }>;
  };
  assert.ok(out.answer.length > 0);
  assert.ok(out.scope.documents > 0);
  const known = new Set(product.documents.list({ page: 1, pageSize: 200 }).items.map((d) => d.id));
  assert.ok(out.citations.every((c2) => known.has(c2.documentId)));
});

test("the corpus ask rejects an empty question and reports an empty scope honestly", async () => {
  const blank = await c.request("POST", "/api/v1/ask", { json: { question: "   " } });
  assert.equal(blank.status, 400);

  const none = await c.request("POST", "/api/v1/ask", {
    json: { question: "Anything?", filters: { config: "no-such-config" } },
  });
  assert.equal(none.status, 200);
  const out = none.json as { answer: string; scope: { documents: number }; citations: unknown[] };
  assert.equal(out.scope.documents, 0);
  assert.equal(out.answer, "");
  assert.deepEqual(out.citations, []);
});

// ─── the generator agent ──────────────────────────────────────────────────────

test("a generator agent is provisioned, inspected, stopped and deleted", async () => {
  const start = await c.request("POST", "/api/v1/extraction-configs/invoice/generator", {
    json: {},
    headers: writer,
  });
  assert.equal(start.status, 202, start.text);
  assert.deepEqual(
    testing.checkResponse(openapi, "/api/v1/extraction-configs/{id}/generator", "post", 202, start.json),
    [],
  );
  const agent = start.json as { taskId: string; kvSchemaId: string; state: string };
  // Its OWN schema, never the pipeline's: a kv write is a full replace, so one shared schema
  // would mean a sweep silently erasing the values this product wrote.
  assert.equal(agent.kvSchemaId, "dip_invoice_extraction_gen");
  assert.ok(agent.taskId);

  const status = await c.get("/api/v1/extraction-configs/invoice/generator");
  assert.equal(status.status, 200);
  assert.deepEqual(
    testing.checkResponse(openapi, "/api/v1/extraction-configs/{id}/generator", "get", 200, status.json),
    [],
  );
  assert.equal((status.json as { agent: { taskId: string } }).agent.taskId, agent.taskId);

  // Stop before delete: ARAG refuses to delete a running task.
  const stopped = await c.request("POST", "/api/v1/extraction-configs/invoice/generator/stop", {
    headers: writer,
  });
  assert.equal(stopped.status, 200);
  assert.equal((stopped.json as { state: string }).state, "stopped");

  const gone = await c.request("DELETE", "/api/v1/extraction-configs/invoice/generator", {
    headers: writer,
  });
  assert.equal(gone.status, 204);
  const after = await c.get("/api/v1/extraction-configs/invoice/generator");
  assert.equal((after.json as { agent: unknown }).agent, null, "no agent left");
});

test("the generator lifecycle needs a credential, and an unknown config is a 404", async () => {
  const anon = await c.request("POST", "/api/v1/extraction-configs/invoice/generator", { json: {} });
  assert.equal(anon.status, 401);
  const missing = await c.request("POST", "/api/v1/extraction-configs/nope/generator", {
    json: {},
    headers: writer,
  });
  assert.equal(missing.status, 404);
  const noAgent = await c.request("DELETE", "/api/v1/extraction-configs/receipt/generator", {
    headers: writer,
  });
  assert.equal(noAgent.status, 404);
});

test("running the generator for one document scopes the task to that resource", async () => {
  const res = await c.request("POST", `/api/v1/documents/${invoiceId}/generator-run`, {
    json: {},
    headers: writer,
  });
  assert.equal(res.status, 202, res.text);
  assert.deepEqual(
    testing.checkResponse(openapi, "/api/v1/documents/{id}/generator-run", "post", 202, res.json),
    [],
  );
  assert.equal((res.json as { resourceId: string }).resourceId, doc(invoiceId).resourceId);
});

test("the comparison says plainly that only the product's values carry evidence", async () => {
  const res = await c.get(`/api/v1/documents/${invoiceId}/generator-comparison`);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(
    testing.checkResponse(openapi, "/api/v1/documents/{id}/generator-comparison", "get", 200, res.json),
    [],
  );
  const out = res.json as {
    kvSchemaId: string;
    fields: Array<{
      field: string;
      pipeline: { present: boolean; evidence: unknown };
      generator: { present: boolean; evidence: null };
      agreement: string;
    }>;
    summary: Record<string, number>;
    evidenceContract: { pipeline: string; generator: string };
    observed: { endToEndLatency: boolean; note: string };
  };
  assert.equal(out.kvSchemaId, "dip_invoice_extraction");
  assert.ok(out.fields.length > 0);
  // The asymmetry is stated on every row and in the payload's own contract block.
  assert.ok(out.fields.every((f) => f.generator.evidence === null));
  assert.ok(out.fields.some((f) => f.pipeline.present && f.pipeline.evidence !== null));
  assert.match(out.evidenceContract.generator, /No evidence/);
  assert.match(out.evidenceContract.generator, /NOT grounded to the same standard/);
  assert.match(out.evidenceContract.pipeline, /checked against the document's own extracted text/);
  // …and so is what this product has not observed.
  assert.equal(out.observed.endToEndLatency, false);
  assert.match(out.observed.note, /still `scheduled` after 20 minutes/);
  // Values this product wrote itself are never counted as the agent's.
  assert.equal(out.summary["generator-only"], 0);
  assert.ok(out.summary["pipeline-only"]! > 0);
});

test("once the agent has written, the comparison marks agreement and disagreement per field", async () => {
  const { id } = await upload(INVOICE, "compare-me.txt");
  const rec = doc(id);
  // What a generator run really leaves behind: values under the agent's OWN schema, with the
  // pipeline's values untouched beside them. No manufactured record state — this is the
  // production shape, which is the point of giving the two paths separate schemas.
  await product.kv.ensureKvSchema({
    id: "dip_invoice_extraction_gen",
    fields: [
      { key: "invoice_number", type: "text" },
      { key: "vendor_name", type: "text" },
    ],
  });
  await product.kv.writeResourceKeyValues(rec.resourceId, {
    dip_invoice_extraction_gen: {
      invoice_number: String(rec.meta.kv!.values!.invoice_number),
      vendor_name: "A Different Vendor Entirely",
    },
  });

  const res = await c.get(`/api/v1/documents/${id}/generator-comparison`);
  assert.equal(res.status, 200);
  const out = res.json as {
    generatorHasWritten: boolean;
    kvSchemaId: string;
    generatorKvSchemaId: string;
    fields: Array<{ field: string; agreement: string; generator: { value: unknown } }>;
    summary: Record<string, number>;
  };
  assert.equal(out.generatorHasWritten, true);
  assert.equal(out.kvSchemaId, "dip_invoice_extraction");
  assert.equal(out.generatorKvSchemaId, "dip_invoice_extraction_gen");
  // The pipeline's own values are still there, untouched by the agent's write.
  const stored = await product.kv.readResourceKeyValues(rec.resourceId);
  assert.equal(stored.dip_invoice_extraction?.invoice_number, rec.meta.kv!.values!.invoice_number);
  const by = Object.fromEntries(out.fields.map((f) => [f.field, f]));
  assert.equal(by.invoice_number!.agreement, "agree");
  assert.equal(by.vendor_name!.agreement, "differ");
  assert.equal(by.vendor_name!.generator.value, "A Different Vendor Entirely");
  assert.equal(by.currency!.agreement, "pipeline-only");
  assert.equal(out.summary.agree, 1);
  assert.equal(out.summary.differ, 1);
});

// ─── failure surfaces ─────────────────────────────────────────────────────────

test("a key-value validation failure is a 400 naming the field, never an undeclared 500", async () => {
  // A config whose fields cannot be represented: the kv schema id would be fine, but a
  // repeated float is a modifier ARAG refuses, so provisioning throws `KvValidationError`
  // from inside a route that does not catch it. Without an error mapper the platform's
  // default turns any non-HttpError into a 500 — an undeclared status, and a stack where a
  // sentence belongs.
  const created = await c.request("POST", "/api/v1/extraction-configs", {
    json: {
      name: "Repeated Float",
      fields: [{ label: "Amounts", type: "array", kvType: "float", kvRepeated: true }],
    },
    headers: writer,
  });
  assert.equal(created.status, 201, created.text);
  const cfg = created.json as { id: string; provisioning: { keyValueSchema: { state: string } } };
  assert.equal(cfg.provisioning.keyValueSchema.state, "failed", "provisioning records the refusal");

  // Starting a generator for it re-enters the same validation, this time uncaught by the route.
  const started = await c.request("POST", `/api/v1/extraction-configs/${cfg.id}/generator`, {
    json: {},
    headers: writer,
  });
  assert.equal(started.status, 400, `expected a 400, got ${started.status}: ${started.text}`);
  assert.match(started.text, /repeated is only allowed on text, not float|is failed/);
  assert.doesNotMatch(started.text, /Internal/i);

  await c.request("DELETE", `/api/v1/extraction-configs/${cfg.id}`, { headers: writer });
});

test("a Knowledge Box that cannot answer a kv filter degrades to the local list, and says so", async () => {
  const original = product.kv.findResourceIdsByKv.bind(product.kv);
  (product.kv as unknown as { findResourceIdsByKv: unknown }).findResourceIdsByKv = () =>
    Promise.reject(new Error("ARAG POST /find network error: connect ECONNREFUSED"));
  try {
    const res = await c.get(
      `/api/v1/documents?kv=${encodeURIComponent("dip_invoice_extraction:total:gte:1")}`,
    );
    assert.equal(res.status, 200, "a Knowledge Box outage is not a client error");
    assert.deepEqual(testing.checkResponse(openapi, "/api/v1/documents", "get", 200, res.json), []);
    const page = res.json as {
      items: unknown[];
      filters: { knowledgeBox: { applied: unknown[]; requested: unknown[]; error?: string } };
    };
    // The documents still come back — an outage must not read as "nothing matched"…
    assert.ok(page.items.length > 0, "the local list is still served");
    // …and the page says the filter was NOT applied, so a UI cannot render a filter chip
    // over a result set that was never filtered.
    assert.equal(page.filters.knowledgeBox.applied.length, 0, "no filter was applied");
    assert.equal(page.filters.knowledgeBox.requested.length, 1, "what was asked for is still reported");
    assert.match(page.filters.knowledgeBox.error ?? "", /ECONNREFUSED/);
  } finally {
    (product.kv as unknown as { findResourceIdsByKv: unknown }).findResourceIdsByKv = original;
  }
});
