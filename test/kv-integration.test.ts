/**
 * Service tests for the key-value integration: the config → kv-schema lifecycle, the
 * pipeline's write-back (including the paths where a value is skipped or the Knowledge Box
 * refuses it), the correction write-back, and the `kv=` filter parameter's validation.
 *
 * These run against `KvService` in mock mode — the in-memory registry mirrors the live
 * shapes and reproduces the same validation errors — so every path here is the one that
 * runs against the real Knowledge Box, not a stand-in for it.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ConfigsService, kvSchemaIdFor } from "../src/services/configs.ts";
import { DaAgents } from "../src/services/da-agents.ts";
import {
  KvService,
  KvValidationError,
  MAX_KV_FIELDS_PER_SCHEMA,
  parseKvFilterParam,
  schemaToKvSchema,
  toKvData,
  toKvLeafFilter,
} from "../src/services/kv.ts";
import { makeKvWriteback, writeRecordKv } from "../src/services/pipeline.ts";
import { buildCustomSchema, type ExtractionSchema, SCHEMAS } from "../src/services/schemas.ts";
import type { DocumentRecord } from "../src/types.ts";
import { AragError, Logger, Store } from "../vendor/arag-platform/src/index.ts";

const log = new Logger({ level: "error", write: () => undefined });

/** A `ConfigsService` backed by a throwaway store and a mock-mode kv registry. */
function configsService(): { configs: ConfigsService; kv: KvService } {
  const store = new Store(mkdtempSync(join(tmpdir(), "dip-kv-")), { persist: false });
  const kv = new KvService({ arag: {} as never, log, mock: true });
  // The ARAG search-configuration half is not what these tests are about; a stub keeps them
  // from needing a Knowledge Box while `provisionAll()` still drives the kv half for real.
  const agents = {
    resetProvisionCache: () => undefined,
    provision: (schemas: ExtractionSchema[]) =>
      Promise.resolve(schemas.map((s) => ({ schema: s.name, aragConfig: `dip_${s.name}`, ok: true }))),
    deleteSearchConfiguration: () => Promise.resolve(),
  };
  return { configs: new ConfigsService({ store, agents: agents as never, kv, log }), kv };
}

function record(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: "doc-1",
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
    resourceId: "res-1",
    filename: "invoice.pdf",
    contentType: "application/pdf",
    bytes: 10,
    status: "ready",
    docType: "invoice",
    fields: [
      { key: "vendor_name", label: "Vendor", value: "Northwind Traders" },
      { key: "invoice_number", label: "Invoice #", value: "INV-2026-0142" },
      { key: "total", label: "Total", value: 12480 },
      { key: "invoice_date", label: "Invoice Date", value: "2026-06-15" },
      { key: "line_items", label: "Line Items", value: ["widgets", "flanges"] },
    ],
    entities: [],
    tags: [],
    issues: [],
    evidence: [],
    meta: {
      processedAt: "2026-09-13T00:00:00.000Z",
      schema: "invoice_extraction",
      model: "test",
      durationsMs: {},
      config: "invoice",
    },
    ...overrides,
  } as DocumentRecord;
}

// ── the per-field Knowledge Box type override ───────────────────────────────────────

test("a money field is a string on the record and a float in the Knowledge Box", () => {
  const { schema } = schemaToKvSchema(SCHEMAS.invoice, { id: "dip_invoice_extraction" });
  const byKey = Object.fromEntries(schema.fields.map((f) => [f.key, f]));
  // The JSON-Schema type is `string` so the original formatting survives on the record…
  assert.equal(SCHEMAS.invoice.properties.total!.type, "string");
  // …but nobody could filter "invoices over $10k" against a text field.
  assert.equal(byKey.total!.type, "float");
  assert.equal(byKey.subtotal!.type, "float");
  assert.equal(byKey.invoice_date!.type, "date");
  // A field with no override still follows the heuristic.
  assert.equal(byKey.vendor_name!.type, "text");
  assert.equal(byKey.line_items!.type, "text");
  assert.equal(byKey.line_items!.repeated, true);
});

test("an explicit override travels from a custom config's field into the kv schema", () => {
  const custom = buildCustomSchema({
    name: "Claim",
    fields: [
      { label: "Claim Amount", type: "string", kvType: "float" },
      { label: "Received", type: "string", kvType: "date" },
      { label: "Codes", type: "array", kvType: "text", kvRepeated: true },
    ],
  });
  const { schema } = schemaToKvSchema(custom, { id: "dip_custom_claim" });
  const byKey = Object.fromEntries(schema.fields.map((f) => [f.key, f]));
  assert.equal(byKey.claim_amount!.type, "float");
  assert.equal(byKey.received!.type, "date");
  assert.equal(byKey.codes!.repeated, true);
});

test("an override ARAG would refuse is refused here, naming the field and the rule", () => {
  const bad = buildCustomSchema({
    name: "Bad",
    fields: [{ label: "Amounts", type: "array", kvType: "float", kvRepeated: true }],
  });
  assert.throws(
    () => schemaToKvSchema(bad, { id: "dip_bad" }),
    (err: unknown) => {
      assert.ok(err instanceof KvValidationError);
      assert.equal(err.kind, "invalid_modifier");
      assert.match(err.message, /repeated is only allowed on text, not float/);
      return true;
    },
  );
  const alsoBad = buildCustomSchema({
    name: "Bad2",
    fields: [{ label: "Notes", type: "string", kvRange: true }],
  });
  assert.throws(() => schemaToKvSchema(alsoBad, { id: "dip_bad2" }), /range is only allowed on/);
});

test("a value that cannot be coerced to the declared type is skipped, and says which value", () => {
  const mapping = schemaToKvSchema(SCHEMAS.invoice, { id: "dip_invoice_extraction" });
  const { data, skipped } = toKvData(
    {
      vendor_name: "Acme",
      invoice_number: "INV-1",
      total: "not a number at all",
      invoice_date: "some time last spring",
    },
    mapping,
  );
  assert.equal(data.total, undefined);
  assert.equal(data.invoice_date, undefined);
  assert.ok(
    skipped.some((s) => s.field === "total" && /"not a number at all" is not a float/.test(s.reason)),
    JSON.stringify(skipped),
  );
  assert.ok(skipped.some((s) => s.field === "invoice_date" && /is not a date/.test(s.reason)));
  // A formatted amount is not a failure — that is exactly what the override exists for.
  const ok = toKvData({ total: "$12,480.00 AUD" }, mapping);
  assert.equal(ok.data.total, 12480);
});

test("a bare date is widened to the full RFC 3339 instant ARAG requires", () => {
  const mapping = schemaToKvSchema(SCHEMAS.invoice, { id: "dip_invoice_extraction" });
  const { data } = toKvData({ invoice_date: "2026-06-15" }, mapping);
  assert.equal(data.invoice_date, "2026-06-15T00:00:00Z");
});

// ── config → kv-schema lifecycle ────────────────────────────────────────────────────

test("provisionAll gives every config a kv schema, and reports the state per config", async () => {
  const { configs, kv } = configsService();
  const results = await configs.provisionAll();
  assert.ok(results.length >= 11);
  assert.ok(results.every((r) => r.keyValueSchema.state === "provisioned"));

  const invoice = configs.get("invoice")!;
  assert.equal(invoice.kvSchemaId, "dip_invoice_extraction");
  assert.equal(invoice.provisioning.state, "provisioned");
  assert.equal(invoice.provisioning.keyValueSchema.state, "provisioned");
  assert.equal(invoice.provisioning.keyValueSchema.fields, Object.keys(SCHEMAS.invoice.properties).length);
  // The mapping is exposed so a caller can map a record onto the kv field.
  assert.equal(invoice.kvFields.total, "total");

  const stored = await kv.getKvSchema("dip_invoice_extraction");
  assert.ok(stored, "the kv schema really exists in the Knowledge Box");
  // Descriptions are carried across verbatim — they are the generator agent's instructions.
  const total = stored.fields.find((f) => f.key === "total")!;
  assert.match(total.description ?? "", /Grand total/);
});

test("a config's state is 'not provisioned' until it is, and says so per object", () => {
  const { configs } = configsService();
  const invoice = configs.get("invoice")!;
  assert.equal(invoice.provisioning.state, "not provisioned");
  assert.equal(invoice.provisioning.searchConfiguration.state, "not provisioned");
  assert.equal(invoice.provisioning.keyValueSchema.state, "not provisioned");
});

test("creating a custom config provisions its kv schema; editing its fields updates it", async () => {
  const { configs, kv } = configsService();
  const created = await configs.create({
    name: "Insurance Card",
    fields: [{ label: "Member ID", required: true }, { label: "Plan Name" }],
  });
  const schemaId = created.kvSchemaId;
  assert.equal(schemaId, "dip_custom_insurance_card");
  assert.equal(created.provisioning.keyValueSchema.state, "provisioned");
  const before = await kv.getKvSchema(schemaId);
  assert.deepEqual(
    before!.fields.map((f) => f.key),
    ["member_id", "plan_name"],
  );

  await configs.update(created.id, {
    name: "Insurance Card",
    fields: [{ label: "Member ID", required: true }, { label: "Plan Name" }, { label: "Group Number" }],
  });
  const after = await kv.getKvSchema(schemaId);
  assert.deepEqual(
    after!.fields.map((f) => f.key),
    ["member_id", "plan_name", "group_number"],
    "a field added to the config is added to the kv schema",
  );
});

test("renaming a custom config moves its kv schema rather than orphaning the old one", async () => {
  const { configs, kv } = configsService();
  const created = await configs.create({ name: "Before", fields: [{ label: "Thing" }] });
  assert.ok(await kv.getKvSchema(created.kvSchemaId));
  const updated = await configs.update(created.id, { name: "After", fields: [{ label: "Thing" }] });
  assert.notEqual((updated as { kvSchemaId: string }).kvSchemaId, created.kvSchemaId);
  assert.equal(await kv.getKvSchema(created.kvSchemaId), undefined, "the old schema is gone");
  assert.ok(await kv.getKvSchema((updated as { kvSchemaId: string }).kvSchemaId));
});

test("deleting a custom config deletes its kv schema — the 20-per-KB ceiling is finite", async () => {
  const { configs, kv } = configsService();
  const created = await configs.create({ name: "Temp", fields: [{ label: "Thing" }] });
  assert.ok(await kv.getKvSchema(created.kvSchemaId));
  assert.equal(await configs.delete(created.id), "deleted");
  assert.equal(await kv.getKvSchema(created.kvSchemaId), undefined);
});

test("the 20-schemas-per-Knowledge-Box ceiling fails with a sentence, not an upstream 422", async () => {
  const { configs, kv } = configsService();
  // Fill the Knowledge Box with schemas this product did not create.
  for (let i = 0; i < 20; i++) {
    await kv.createKvSchema({ id: `squatter_${i}`, fields: [{ key: "a", type: "text" }] });
  }
  const results = await configs.provisionAll();
  const failed = results.filter((r) => r.keyValueSchema.state === "failed");
  assert.ok(failed.length > 0);
  assert.match(
    failed[0]!.keyValueSchema.error ?? "",
    /already holds 20 key-value schemas and the limit is 20/,
  );
  assert.match(failed[0]!.keyValueSchema.error ?? "", /Delete an unused extraction configuration/);
  // …and the config reports it rather than claiming to be ready.
  assert.equal(configs.get("invoice")!.provisioning.state, "failed");
});

test("the 50-fields-per-schema ceiling fails with a sentence naming the count", async () => {
  const { configs } = configsService();
  const fields = Array.from({ length: MAX_KV_FIELDS_PER_SCHEMA + 1 }, (_, i) => ({ label: `Field ${i}` }));
  const created = await configs.create({ name: "Too Wide", fields });
  assert.equal(created.provisioning.keyValueSchema.state, "failed");
  assert.match(created.provisioning.keyValueSchema.error ?? "", /has 51 fields; ARAG allows at most 50/);
});

// ── the pipeline's write-back ───────────────────────────────────────────────────────

test("a finished record is written into the resource's key-value field", async () => {
  const { configs, kv } = configsService();
  await configs.provisionAll();
  const rec = record();
  const written = await writeRecordKv(rec, SCHEMAS.invoice, { kv, configs, log });

  assert.equal(written.written, true);
  assert.equal(written.schemaId, "dip_invoice_extraction");
  assert.equal(written.writes, 1);
  assert.equal(written.filterIndexStale, undefined, "a first write supersedes nothing");
  assert.equal(written.fields, 5);
  // The values reached the Knowledge Box coerced to their declared types.
  const stored = await kv.readResourceKeyValues("res-1");
  assert.deepEqual(stored.dip_invoice_extraction, {
    vendor_name: "Northwind Traders",
    invoice_number: "INV-2026-0142",
    total: 12480,
    invoice_date: "2026-06-15T00:00:00Z",
    line_items: ["widgets", "flanges"],
  });
  // …and the record carries both the schema mapping and the written values, for the JSON tab.
  assert.equal(written.keys?.total, "total");
  assert.equal(written.values?.total, 12480);
});

test("a value the schema cannot represent is skipped with a reason, and the rest still land", async () => {
  const { configs, kv } = configsService();
  await configs.provisionAll();
  const rec = record();
  rec.fields = [
    ...rec.fields.filter((f) => f.key !== "total"),
    { key: "total", label: "Total", value: "no digits here" },
  ];
  const written = await writeRecordKv(rec, SCHEMAS.invoice, { kv, configs, log });
  assert.equal(written.written, true, "one bad field must not cost the whole record");
  assert.ok(
    written.skipped?.some((s) => s.field === "total" && /"no digits here" is not a float/.test(s.reason)),
  );
  const stored = await kv.readResourceKeyValues("res-1");
  assert.equal(stored.dip_invoice_extraction!.total, undefined);
  assert.equal(stored.dip_invoice_extraction!.vendor_name, "Northwind Traders");
});

test("a config's required fields are NOT required in the Knowledge Box — a partial record still lands", async () => {
  const { configs, kv } = configsService();
  await configs.provisionAll();
  // A faded scan the model could not read a total from. ARAG refuses a whole key-value
  // write when a `required` key is missing, and the write is a full replace — so requiring
  // them there would cost this resource the two fields that *were* extracted.
  const rec = record({
    fields: [
      { key: "vendor_name", label: "Vendor", value: "Acme" },
      { key: "invoice_number", label: "Invoice #", value: "INV-1" },
    ],
  });
  const written = await writeRecordKv(rec, SCHEMAS.invoice, { kv, configs, log });
  assert.equal(written.written, true);
  assert.deepEqual(await kv.readResourceKeyValues("res-1"), {
    dip_invoice_extraction: { vendor_name: "Acme", invoice_number: "INV-1" },
  });
  // The gap is still reported — it is just not enforced upstream.
  assert.ok(
    written.skipped?.some((s) => s.field === "total" && /required by the extraction config/.test(s.reason)),
    JSON.stringify(written.skipped),
  );
  // Nothing in the provisioned schema is required…
  assert.equal(
    configs.kvFor("invoice")!.mapping.schema.fields.some((f) => f.required),
    false,
  );
  // …while the extraction schema still asks the visual LLM for them.
  assert.deepEqual(SCHEMAS.invoice.required, ["vendor_name", "invoice_number", "total"]);
});

test("a 422 from the Knowledge Box is recorded as a typed, per-field message", async () => {
  const { configs, kv } = configsService();
  await configs.provisionAll();
  // The live failure mode once required is relaxed: the stored schema has drifted from the
  // config (edited in the ARAG dashboard, or a config edited without re-provisioning), so a
  // key the product still sends is no longer declared.
  await kv.updateKvSchema("dip_invoice_extraction", {
    fields: configs
      .kvFor("invoice")!
      .mapping.schema.fields.filter((f) => f.key !== "total")
      .map((f) => ({ ...f, required: false })),
  });
  const written = await writeRecordKv(record(), SCHEMAS.invoice, { kv, configs, log });

  assert.equal(written.written, false);
  assert.equal(written.rejected?.length, 1);
  assert.equal(written.rejected![0]!.kind, "unknown_key");
  assert.equal(written.rejected![0]!.field, "total");
  assert.match(written.rejected![0]!.message, /Unknown keys for schema 'dip_invoice_extraction'/);
  assert.ok(written.error, "the reason also reaches the pipeline's stageErrors");
});

test("an unprovisioned kv schema degrades the write instead of failing the document", async () => {
  const { configs, kv } = configsService(); // deliberately not provisioned
  const written = await writeRecordKv(record(), SCHEMAS.invoice, { kv, configs, log });
  assert.equal(written.written, false);
  assert.match(written.error ?? "", /is not provisioned/);
  assert.deepEqual(await kv.readResourceKeyValues("res-1"), {});
});

test("with no kv service configured the write is a no-op that says so", async () => {
  const { configs } = configsService();
  const written = await writeRecordKv(record(), SCHEMAS.invoice, { configs, log });
  assert.equal(written.written, false);
  assert.match(written.error ?? "", /not configured/);
});

// ── the overwrite trap ──────────────────────────────────────────────────────────────

test("a second write sends the WHOLE record, and reports the filter index as stale", async () => {
  const { configs, kv } = configsService();
  await configs.provisionAll();
  const rec = record();
  rec.meta.kv = await writeRecordKv(rec, SCHEMAS.invoice, { kv, configs, log });

  // A reviewer corrects the vendor. The write-back is handed the corrected record.
  const writeback = makeKvWriteback({ kv, configs, log, schemaOf: () => SCHEMAS.invoice });
  rec.fields = rec.fields.map((f) =>
    f.key === "vendor_name" ? { ...f, value: "Northwind Traders Pty Ltd" } : f,
  );
  const out = await writeback(rec, { field: "vendor_name", value: "Northwind Traders Pty Ltd" });

  assert.equal(out.written, true);
  assert.equal(out.fieldId, "vendor_name");
  assert.equal(out.filterIndexStale, true, "the KB filter index still matches the old value");

  // The whole record went, not just the corrected field: a kv write is a full replace, so
  // sending one key would have dropped every other value (and failed on the required ones).
  const stored = await kv.readResourceKeyValues("res-1");
  assert.equal(Object.keys(stored.dip_invoice_extraction!).length, 5);
  assert.equal(stored.dip_invoice_extraction!.vendor_name, "Northwind Traders Pty Ltd");
  assert.equal(stored.dip_invoice_extraction!.total, 12480);

  // …and the record says which superseded value the Knowledge Box still matches.
  assert.equal(rec.meta.kv?.writes, 2);
  assert.equal(rec.meta.kv?.filterIndexStale, true);
  assert.deepEqual(rec.meta.kv?.superseded, [{ field: "vendor_name", value: "Northwind Traders" }]);
});

test("staleness accumulates across corrections rather than forgetting the earlier value", async () => {
  const { configs, kv } = configsService();
  await configs.provisionAll();
  const rec = record();
  const writeback = makeKvWriteback({ kv, configs, log, schemaOf: () => SCHEMAS.invoice });
  rec.meta.kv = await writeRecordKv(rec, SCHEMAS.invoice, { kv, configs, log });

  for (const value of ["Second", "Third"]) {
    rec.fields = rec.fields.map((f) => (f.key === "vendor_name" ? { ...f, value } : f));
    await writeback(rec, { field: "vendor_name", value });
  }
  assert.equal(rec.meta.kv?.writes, 3);
  assert.deepEqual(
    rec.meta.kv?.superseded?.map((s) => s.value),
    ["Northwind Traders", "Second"],
    "every value the index still matches is listed, not only the most recent one",
  );
});

// ── the `kv=` filter parameter ──────────────────────────────────────────────────────

test("parseKvFilterParam splits on the first three colons so a date survives", () => {
  assert.deepEqual(parseKvFilterParam("dip_invoice_extraction:invoice_date:gte:2026-01-15T00:00:00Z"), {
    schemaId: "dip_invoice_extraction",
    key: "invoice_date",
    op: "gte",
    value: "2026-01-15T00:00:00Z",
  });
});

test("parseKvFilterParam rejects a malformed filter and an unsupported operator", () => {
  assert.throws(() => parseKvFilterParam("dip_x:total:gte"), /is malformed/);
  assert.throws(() => parseKvFilterParam("dip_x:total:like:acme"), /supported operators are/);
  assert.throws(() => parseKvFilterParam("::eq:x"), /needs both a schema id and a field key/);
});

test("an operator the field's kind does not accept is refused before ARAG can 412", () => {
  const { schema } = schemaToKvSchema(SCHEMAS.invoice, { id: "dip_invoice_extraction" });
  // `gte` on a text field.
  assert.throws(
    () =>
      toKvLeafFilter(
        { schemaId: "dip_invoice_extraction", key: "vendor_name", op: "gte", value: "a" },
        schema,
      ),
    /is a text field, which supports eq, not "gte"/,
  );
  // `eq` on a repeated field — membership is `contains`.
  assert.throws(
    () =>
      toKvLeafFilter({ schemaId: "dip_invoice_extraction", key: "line_items", op: "eq", value: "a" }, schema),
    /is a repeated text field, which supports contains/,
  );
  // An unknown field lists the ones that exist.
  assert.throws(
    () => toKvLeafFilter({ schemaId: "dip_invoice_extraction", key: "nope", op: "eq", value: "a" }, schema),
    /has no field "nope" \(it has: vendor_name/,
  );
});

test("a filter value is coerced to the field's declared type, or explained", () => {
  const { schema } = schemaToKvSchema(SCHEMAS.invoice, { id: "dip_invoice_extraction" });
  const leaf = toKvLeafFilter(
    { schemaId: "dip_invoice_extraction", key: "total", op: "gte", value: "10000" },
    schema,
  );
  assert.deepEqual(leaf, { schema_id: "dip_invoice_extraction", key: "total", gte: 10000 });
  const dated = toKvLeafFilter(
    { schemaId: "dip_invoice_extraction", key: "invoice_date", op: "lte", value: "2026-12-31" },
    schema,
  );
  assert.equal(dated.lte, "2026-12-31T00:00:00Z");
  assert.throws(
    () =>
      toKvLeafFilter({ schemaId: "dip_invoice_extraction", key: "total", op: "gte", value: "lots" }, schema),
    /needs a number; got "lots"/,
  );
});

test("findResourceIdsByKv ANDs its leaves and matches on the stored values", async () => {
  const { configs, kv } = configsService();
  await configs.provisionAll();
  await writeRecordKv(record(), SCHEMAS.invoice, { kv, configs, log });
  await writeRecordKv(
    record({
      resourceId: "res-2",
      fields: [
        { key: "vendor_name", label: "Vendor", value: "Contoso" },
        { key: "invoice_number", label: "Invoice #", value: "INV-9" },
        { key: "total", label: "Total", value: 40 },
        { key: "line_items", label: "Line Items", value: ["bolts"] },
      ],
    }),
    SCHEMAS.invoice,
    { kv, configs, log },
  );

  const mapping = configs.kvSchemaById("dip_invoice_extraction")!;
  const leaf = (key: string, op: "eq" | "gte" | "lte" | "contains", value: string) =>
    toKvLeafFilter({ schemaId: "dip_invoice_extraction", key, op, value }, mapping.schema);

  assert.deepEqual(await kv.findResourceIdsByKv([leaf("total", "gte", "1000")]), ["res-1"]);
  assert.deepEqual(await kv.findResourceIdsByKv([leaf("vendor_name", "eq", "Contoso")]), ["res-2"]);
  assert.deepEqual(await kv.findResourceIdsByKv([leaf("line_items", "contains", "flanges")]), ["res-1"]);
  // Several filters narrow, they do not widen.
  assert.deepEqual(
    await kv.findResourceIdsByKv([leaf("total", "gte", "1"), leaf("vendor_name", "eq", "Contoso")]),
    ["res-2"],
  );
  assert.deepEqual(
    await kv.findResourceIdsByKv([leaf("total", "gte", "1000"), leaf("vendor_name", "eq", "Contoso")]),
    [],
  );
});

test("kvSchemaIdFor is the same name in both Knowledge Box namespaces, capped at 64 chars", () => {
  assert.equal(kvSchemaIdFor(SCHEMAS.invoice), "dip_invoice_extraction");
  const long = buildCustomSchema({ name: "x".repeat(90), fields: [{ label: "A" }] });
  assert.equal(kvSchemaIdFor(long).length, 64);
});

// ── the generator agent's live lifecycle ────────────────────────────────────────────

/** A stand-in `AragClient` that records calls and replays canned responses. */
function fakeArag(responses: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const arag = {
    calls,
    request(method: string, path: string, opts: { body?: string | null } = {}) {
      calls.push({ method, path, body: opts.body ? JSON.parse(opts.body) : undefined });
      const canned = responses[`${method} ${path}`];
      if (canned instanceof Error) return Promise.reject(canned);
      return Promise.resolve(new Response(JSON.stringify(canned ?? {})));
    },
  };
  return arag;
}

test("a kv generator is started as an `ask` task whose question IS the JSON schema", async () => {
  const arag = fakeArag({ "POST /task/start": { id: "task-1", name: "ask", status: "started" } });
  const kv = new KvService({ arag: arag as never, log, mock: true });
  const da = new DaAgents({ arag: arag as never, kv, log, generativeModel: "chatgpt-azure-4o" });
  const mapping = schemaToKvSchema(SCHEMAS.invoice, { id: "dip_invoice_extraction" });

  const out = await da.provisionGenerator(SCHEMAS.invoice, mapping, { name: "dip_gen" });
  assert.equal(out.taskId, "task-1");
  const body = arag.calls.find((c2) => c2.path === "/task/start")!.body as {
    name: string;
    parameters: {
      on: number;
      operations: Array<{
        ask: { question: string; json: boolean; store_as_key_value: boolean; kv_schema_id: string };
      }>;
    };
  };
  assert.equal(body.name, "ask");
  assert.equal(body.parameters.on, 1, "`ask` agents support ApplyTo.FIELD only");
  const op = body.parameters.operations[0]!.ask;
  assert.equal(op.store_as_key_value, true);
  assert.equal(op.kv_schema_id, "dip_invoice_extraction");
  assert.equal(op.json, true);
  // A plain-English question is a 422 upstream: the question must BE the serialised schema.
  const asSchema = JSON.parse(op.question) as { parameters: { properties: Record<string, unknown> } };
  assert.ok(asSchema.parameters.properties.invoice_number);
});

test("tearing an agent down stops it first — ARAG refuses to delete a running task", async () => {
  const arag = fakeArag();
  const kv = new KvService({ arag: arag as never, log, mock: true });
  const da = new DaAgents({ arag: arag as never, kv, log, generativeModel: "m" });
  await da.stopAndDelete("task-9");
  assert.deepEqual(
    arag.calls.map((c2) => `${c2.method} ${c2.path}`),
    ["POST /task/task-9/stop", "DELETE /task/task-9"],
  );
});

test("stopping a task that is already stopped or gone is not an error", async () => {
  const gone = new AragError("no such task", "http", "POST /task/x/stop", 404);
  const arag = fakeArag({ "POST /task/task-9/stop": gone, "DELETE /task/task-9": gone });
  const kv = new KvService({ arag: arag as never, log, mock: true });
  const da = new DaAgents({ arag: arag as never, kv, log, generativeModel: "m" });
  await assert.doesNotReject(() => da.stopAndDelete("task-9"));
});
