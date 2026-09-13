import assert from "node:assert/strict";
import { test } from "node:test";
import { mappingToJsonSchema, toGeneratorTaskBody } from "../src/services/da-agents.ts";
import {
  KV_NAME_PATTERN,
  KvService,
  KvValidationError,
  kvAnd,
  kvErrorFrom,
  kvFilter,
  kvNot,
  kvOr,
  MAX_KV_FIELDS_PER_SCHEMA,
  MAX_KV_SCHEMAS_PER_KB,
  schemaToKvSchema,
  toKvData,
  toKvFieldKey,
  toRange,
  toRfc3339,
} from "../src/services/kv.ts";
import type { ExtractionSchema, JsonProp } from "../src/services/schemas.ts";
import { SCHEMAS } from "../src/services/schemas.ts";
import { AragError } from "../vendor/arag-platform/src/index.ts";

// ─── helpers ──────────────────────────────────────────────────────────────────

const noopLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Parameters<typeof makeService>[0];

function makeService(_log?: unknown): KvService {
  return new KvService({
    // Never used in mock mode — the service short-circuits before touching the client.
    arag: {} as never,
    log: noopLog as never,
    mock: true,
  });
}

function schema(properties: Record<string, JsonProp>, required: string[] = []): ExtractionSchema {
  return {
    name: "test_schema",
    docType: "generic",
    description: "A test schema.",
    properties,
    required,
    labels: Object.fromEntries(Object.keys(properties).map((k) => [k, k])),
  };
}

// ─── mapper: every type ───────────────────────────────────────────────────────

test("schemaToKvSchema maps every JSON-schema type to its kv type", () => {
  const { schema: kv } = schemaToKvSchema(
    schema({
      a_string: { type: "string", description: "text field" },
      an_integer: { type: "integer" } as unknown as JsonProp,
      a_number: { type: "number" },
      a_boolean: { type: "boolean" },
      a_date: { type: "string", format: "date" } as unknown as JsonProp,
      a_datetime: { type: "string", format: "date-time" } as unknown as JsonProp,
      an_array: { type: "array", items: { type: "string" } },
    }),
  );
  const byKey = Object.fromEntries(kv.fields.map((f) => [f.key, f]));
  assert.equal(byKey.a_string!.type, "text");
  assert.equal(byKey.an_integer!.type, "integer");
  assert.equal(byKey.a_number!.type, "float");
  assert.equal(byKey.a_boolean!.type, "boolean");
  assert.equal(byKey.a_date!.type, "date");
  assert.equal(byKey.a_datetime!.type, "date");
  assert.equal(byKey.an_array!.type, "text");
  assert.equal(byKey.an_array!.repeated, true);
});

test("schemaToKvSchema carries descriptions over — they steer the generator agent", () => {
  const { schema: kv } = schemaToKvSchema(
    schema({ vendor_name: { type: "string", description: "Name of the supplier issuing the invoice" } }),
  );
  assert.equal(kv.fields[0]!.description, "Name of the supplier issuing the invoice");
  assert.equal(kv.description, "A test schema.");
});

test("schemaToKvSchema honours required", () => {
  const { schema: kv } = schemaToKvSchema(schema({ a: { type: "string" }, b: { type: "string" } }, ["a"]));
  const byKey = Object.fromEntries(kv.fields.map((f) => [f.key, f]));
  assert.equal(byKey.a!.required, true);
  assert.equal(byKey.b!.required, false);
});

test("schemaToKvSchema maps minimum/maximum onto range, but only for rangeable types", () => {
  const { schema: kv } = schemaToKvSchema(
    schema({
      bounded_int: { type: "integer", minimum: 1, maximum: 10 } as unknown as JsonProp,
      bounded_num: { type: "number", minimum: 0 } as unknown as JsonProp,
      // text is not a rangeable type on the live platform — must NOT be marked range
      bounded_text: { type: "string", minimum: 1 } as unknown as JsonProp,
      plain_int: { type: "integer" } as unknown as JsonProp,
    }),
  );
  const byKey = Object.fromEntries(kv.fields.map((f) => [f.key, f]));
  assert.equal(byKey.bounded_int!.range, true);
  assert.equal(byKey.bounded_num!.range, true);
  assert.equal(byKey.bounded_text!.range, undefined);
  assert.equal(byKey.plain_int!.range, undefined);
});

test("schemaToKvSchema never marks a non-text field repeated (live rejects it)", () => {
  const { schema: kv } = schemaToKvSchema(schema({ numbers: { type: "array", items: { type: "number" } } }));
  // an array of numbers cannot be repeated on ARAG, so it degrades to repeated text
  assert.equal(kv.fields[0]!.type, "text");
  assert.equal(kv.fields[0]!.repeated, true);
});

// ─── limits ───────────────────────────────────────────────────────────────────

test("schemaToKvSchema rejects more than 50 fields", () => {
  const props: Record<string, JsonProp> = {};
  for (let i = 0; i < MAX_KV_FIELDS_PER_SCHEMA + 1; i++) props[`f${i}`] = { type: "string" };
  assert.throws(
    () => schemaToKvSchema(schema(props)),
    (err: unknown) => {
      assert.ok(err instanceof KvValidationError);
      assert.equal(err.kind, "too_many_fields");
      assert.match(err.message, /51 fields/);
      return true;
    },
  );
});

test("exactly 50 fields is accepted", () => {
  const props: Record<string, JsonProp> = {};
  for (let i = 0; i < MAX_KV_FIELDS_PER_SCHEMA; i++) props[`f${i}`] = { type: "string" };
  const { schema: kv } = schemaToKvSchema(schema(props));
  assert.equal(kv.fields.length, MAX_KV_FIELDS_PER_SCHEMA);
});

test("KvService rejects the 21st schema in mock mode", async () => {
  const svc = makeService();
  for (let i = 0; i < MAX_KV_SCHEMAS_PER_KB; i++) {
    await svc.createKvSchema({ id: `s${i}`, fields: [{ key: "a", type: "text" }] });
  }
  await assert.rejects(
    () => svc.createKvSchema({ id: "one_too_many", fields: [{ key: "a", type: "text" }] }),
    (err: unknown) => {
      assert.ok(err instanceof KvValidationError);
      assert.equal(err.kind, "too_many_schemas");
      return true;
    },
  );
});

test("assertSchemaValid rejects modifiers the live platform refuses", () => {
  const svc = makeService();
  assert.throws(
    () => svc.assertSchemaValid({ id: "s", fields: [{ key: "a", type: "integer", repeated: true }] }),
    (err: unknown) => {
      assert.ok(err instanceof KvValidationError);
      assert.equal(err.kind, "invalid_modifier");
      assert.equal(err.got, "integer");
      return true;
    },
  );
  assert.throws(
    () => svc.assertSchemaValid({ id: "s", fields: [{ key: "a", type: "text", range: true }] }),
    (err: unknown) => (err as KvValidationError).kind === "invalid_modifier",
  );
  assert.throws(
    () =>
      svc.assertSchemaValid({
        id: "s",
        fields: [
          { key: "dup", type: "text" },
          { key: "dup", type: "text" },
        ],
      }),
    (err: unknown) => (err as KvValidationError).kind === "duplicate_key",
  );
});

// ─── field-name normalisation round-trip ──────────────────────────────────────

test("toKvFieldKey only strips what the live pattern forbids", () => {
  // The live rule is ^[^/.]{1,64}$ — spaces, capitals and hyphens are all legal.
  assert.equal(toKvFieldKey("Vendor Name"), "Vendor Name");
  assert.equal(toKvFieldKey("invoice-number"), "invoice-number");
  assert.equal(toKvFieldKey("UPPER_CASE"), "UPPER_CASE");
  assert.equal(toKvFieldKey("unicodé_ê"), "unicodé_ê");
  // and these two are the only characters it must replace
  assert.equal(toKvFieldKey("total.amount"), "total_amount");
  assert.equal(toKvFieldKey("with/slash"), "with_slash");
  for (const name of ["Vendor Name", "total.amount", "with/slash", "x".repeat(80)]) {
    assert.match(toKvFieldKey(name), KV_NAME_PATTERN, `${name} must normalise to a legal key`);
  }
});

test("field names round-trip through the mapping", () => {
  const mapping = schemaToKvSchema(
    schema({ "total.amount": { type: "number" }, "Vendor Name": { type: "string" } }),
  );
  assert.equal(mapping.fieldIds["total.amount"], "total_amount");
  assert.equal(mapping.names.total_amount, "total.amount");
  assert.equal(mapping.fieldIds["Vendor Name"], "Vendor Name");
  // every id maps back to the name it came from
  for (const [name, key] of Object.entries(mapping.fieldIds)) {
    assert.equal(mapping.names[key], name);
  }
});

test("a collision after normalisation is an error, not a silent overwrite", () => {
  assert.throws(
    () => schemaToKvSchema(schema({ "a.b": { type: "string" }, "a/b": { type: "string" } })),
    (err: unknown) => {
      assert.ok(err instanceof KvValidationError);
      assert.equal(err.kind, "duplicate_key");
      return true;
    },
  );
});

test("a name longer than 64 chars is truncated to a legal key", () => {
  const long = "x".repeat(100);
  const mapping = schemaToKvSchema(schema({ [long]: { type: "string" } }));
  const key = mapping.fieldIds[long]!;
  assert.equal(key.length, 64);
  assert.equal(mapping.names[key], long);
});

// ─── toKvData coercion ────────────────────────────────────────────────────────

test("toKvData coerces values to the declared kv types", () => {
  const mapping = schemaToKvSchema(
    schema({
      name: { type: "string" },
      count: { type: "integer" } as unknown as JsonProp,
      amount: { type: "number" },
      paid: { type: "boolean" },
      when: { type: "string", format: "date" } as unknown as JsonProp,
      tags: { type: "array", items: { type: "string" } },
    }),
  );
  const { data } = toKvData(
    { name: "Acme", count: "42", amount: "$1,234.56", paid: "yes", when: "2026-01-15", tags: "solo" },
    mapping,
  );
  assert.equal(data.name, "Acme");
  assert.equal(data.count, 42);
  assert.equal(data.amount, 1234.56);
  assert.equal(data.paid, true);
  // ARAG rejects a bare date — it must be widened to a full RFC 3339 date-time
  assert.equal(data.when, "2026-01-15T00:00:00Z");
  assert.deepEqual(data.tags, ["solo"]);
});

test("toKvData drops unrepresentable values and reports required gaps", () => {
  const mapping = schemaToKvSchema(
    schema({ count: { type: "integer" } as unknown as JsonProp, name: { type: "string" } }, ["name"]),
  );
  const { data, skipped } = toKvData({ count: "not a number" }, mapping);
  assert.equal("count" in data, false);
  assert.ok(skipped.some((s) => s.field === "count"));
  assert.ok(skipped.some((s) => s.field === "name" && /required/.test(s.reason)));
});

test("toRfc3339 and toRange enforce the live constraints", () => {
  assert.equal(toRfc3339("2026-01-15"), "2026-01-15T00:00:00Z");
  assert.equal(toRfc3339("nonsense"), undefined);
  assert.deepEqual(toRange({ lower: 1, upper: 5 }), { lower: 1, upper: 5 });
  // live: "lower endpoint (50) must be < than its upper endpoint (5)"
  assert.equal(toRange({ lower: 50, upper: 5 }), undefined);
  assert.equal(toRange({ lower: 5, upper: 5 }), undefined);
  assert.equal(toRange(42), undefined);
});

// ─── filter expression builder ────────────────────────────────────────────────

test("kvFilter builds the verified filter_expression envelope", () => {
  assert.deepEqual(kvFilter({ schema_id: "invoice", key: "vendor", eq: "Acme" }), {
    key_value: { schema_id: "invoice", key: "vendor", eq: "Acme" },
  });
});

test("kvFilter supports every verified operator", () => {
  assert.deepEqual(kvFilter({ schema_id: "s", key: "n", gte: 10, lte: 20 }).key_value, {
    schema_id: "s",
    key: "n",
    gte: 10,
    lte: 20,
  });
  assert.deepEqual(kvFilter({ schema_id: "s", key: "tags", contains: "sale" }).key_value, {
    schema_id: "s",
    key: "tags",
    contains: "sale",
  });
  assert.deepEqual(kvFilter({ schema_id: "s", key: "b", eq: true }).key_value, {
    schema_id: "s",
    key: "b",
    eq: true,
  });
});

test("kvFilter collapses a single-element array and wraps several in `and`", () => {
  const one = kvFilter([{ schema_id: "s", key: "a", eq: 1 }]);
  assert.deepEqual(one.key_value, { schema_id: "s", key: "a", eq: 1 });
  const many = kvFilter([
    { schema_id: "s", key: "a", eq: 1 },
    { schema_id: "s", key: "b", eq: 2 },
  ]);
  assert.deepEqual(many.key_value, {
    and: [
      { schema_id: "s", key: "a", eq: 1 },
      { schema_id: "s", key: "b", eq: 2 },
    ],
  });
});

test("kvAnd / kvOr / kvNot compose, and operator is only set when asked", () => {
  const expr = kvAnd(
    { schema_id: "s", key: "a", eq: 1 },
    kvOr({ schema_id: "s", key: "b", eq: 2 }, kvNot({ schema_id: "s", key: "c", eq: 3 })),
  );
  assert.deepEqual(kvFilter(expr, { operator: "and" }), { key_value: expr, operator: "and" });
  assert.equal("operator" in kvFilter(expr), false);
});

// ─── 422 error mapping ────────────────────────────────────────────────────────

function http422(detail: unknown): AragError {
  return new AragError("boom", "http", "PUT /key_value", 422, JSON.stringify({ detail }));
}

test("kvErrorFrom maps ARAG's sentence-form 422s", () => {
  const mismatch = kvErrorFrom(
    http422("Key 'v_int' in schema 'dip_verify_all' expects type 'integer', got str"),
  );
  assert.equal(mismatch?.kind, "type_mismatch");
  assert.equal(mismatch?.field, "v_int");
  assert.equal(mismatch?.schemaId, "dip_verify_all");
  assert.equal(mismatch?.expected, "integer");
  assert.equal(mismatch?.got, "str");

  const missing = kvErrorFrom(http422("Missing required keys for schema 'dip_verify_all': ['v_text']"));
  assert.equal(missing?.kind, "missing_required");
  assert.equal(missing?.field, "v_text");

  const unknown = kvErrorFrom(http422("Unknown keys for schema 'dip_verify_all': ['nope_unknown']"));
  assert.equal(unknown?.kind, "unknown_key");
  assert.equal(unknown?.field, "nope_unknown");
});

test("kvErrorFrom maps ARAG's FastAPI list-form 422s", () => {
  const tooLong = kvErrorFrom(
    http422([
      {
        type: "too_long",
        loc: ["body", "fields"],
        msg: "List should have at most 50 items after validation, not 51",
      },
    ]),
  );
  assert.equal(tooLong?.kind, "too_many_fields");

  const badName = kvErrorFrom(
    http422([
      {
        type: "string_pattern_mismatch",
        loc: ["body", "fields", 2, "key"],
        msg: "String should match pattern '^[^/.]{1,64}$'",
      },
    ]),
  );
  assert.equal(badName?.kind, "invalid_name");
  assert.equal(badName?.field, "fields[2]");

  // the real range error arrives last in a union-error list; it must still win
  const range = kvErrorFrom(
    http422([
      { type: "string_type", loc: ["body", "data", "v_range", "str"], msg: "Input should be a valid string" },
      { type: "int_type", loc: ["body", "data", "v_range", "int"], msg: "Input should be a valid integer" },
      {
        type: "value_error",
        loc: ["body", "data", "v_range", "function-after[check_bounds(), Range]"],
        msg: "Value error, lower endpoint (50) must be < than its upper endpoint (5)",
      },
    ]),
  );
  assert.equal(range?.kind, "range_bounds");

  const modifier = kvErrorFrom(
    http422([
      {
        type: "value_error",
        loc: ["body", "fields", 0],
        msg: "Value error, KVFieldType.INTEGER is not an allowed repeated type",
      },
    ]),
  );
  assert.equal(modifier?.kind, "invalid_modifier");
});

test("kvErrorFrom ignores non-422 and non-ARAG errors", () => {
  assert.equal(kvErrorFrom(new Error("nope")), undefined);
  assert.equal(kvErrorFrom(new AragError("x", "http", "op", 404, "{}")), undefined);
  assert.equal(kvErrorFrom(new AragError("x", "timeout", "op")), undefined);
});

test("KvValidationError serialises the detail a UI needs", () => {
  const err = kvErrorFrom(http422("Key 'total' in schema 'invoice' expects type 'float', got str"));
  assert.deepEqual(err?.toJSON(), {
    name: "KvValidationError",
    message: "Key 'total' in schema 'invoice' expects type 'float', got str",
    kind: "type_mismatch",
    field: "total",
    schemaId: "invoice",
    expected: "float",
    got: "str",
    status: 422,
  });
});

// ─── mock-mode service behaviour ──────────────────────────────────────────────

test("mock kv service round-trips schemas and values like the live API", async () => {
  const svc = makeService();
  assert.deepEqual(await svc.listKvSchemas(), {});

  const mapping = schemaToKvSchema(SCHEMAS.invoice, { id: "invoice" });
  await svc.createKvSchema(mapping.schema);

  const stored = await svc.getKvSchema("invoice");
  assert.ok(stored);
  // live fills the modifier defaults in on read
  assert.equal(stored.fields[0]!.range, false);
  assert.equal(stored.fields[0]!.repeated, false);

  const { data } = toKvData({ vendor_name: "Acme", invoice_number: "INV-1", total: "$10.50" }, mapping);
  await svc.putResourceKeyValue("rid1", "invoice", data);
  const read = await svc.readResourceKeyValues("rid1");
  assert.equal(read.invoice!.vendor_name, "Acme");

  const mapped = await svc.readMapped("rid1", mapping);
  assert.equal(mapped.invoice_number, "INV-1");

  await svc.deleteKvSchema("invoice");
  assert.equal(await svc.getKvSchema("invoice"), undefined);
});

test("mock kv service raises the same error kinds as live", async () => {
  const svc = makeService();
  await svc.createKvSchema({
    id: "s",
    fields: [
      { key: "req", type: "text", required: true },
      { key: "num", type: "integer" },
    ],
  });
  await assert.rejects(
    () => svc.putResourceKeyValue("r", "s", { req: "ok", num: "nope" as never }),
    (e: unknown) => (e as KvValidationError).kind === "type_mismatch",
  );
  await assert.rejects(
    () => svc.putResourceKeyValue("r", "s", { num: 1 }),
    (e: unknown) => (e as KvValidationError).kind === "missing_required",
  );
  await assert.rejects(
    () => svc.putResourceKeyValue("r", "s", { req: "ok", nope: "x" }),
    (e: unknown) => (e as KvValidationError).kind === "unknown_key",
  );
});

test("writeResourceKeyValues merges without disturbing other schemas", async () => {
  const svc = makeService();
  await svc.createKvSchema({ id: "a", fields: [{ key: "x", type: "text" }] });
  await svc.createKvSchema({ id: "b", fields: [{ key: "y", type: "text" }] });
  await svc.writeResourceKeyValues("r", { a: { x: "1" } });
  await svc.writeResourceKeyValues("r", { b: { y: "2" } });
  const all = await svc.readResourceKeyValues("r");
  assert.deepEqual(all, { a: { x: "1" }, b: { y: "2" } });
  assert.deepEqual(svc.inlineKeyValues({ a: { x: "1" } }), { a: { data: { x: "1" } } });
});

// ─── generator task body ──────────────────────────────────────────────────────

test("toGeneratorTaskBody produces the verified task/start shape", () => {
  const mapping = schemaToKvSchema(SCHEMAS.invoice, { id: "invoice" });
  const body = toGeneratorTaskBody(
    {
      name: "dip_invoice_generator",
      kvSchemaId: "invoice",
      jsonSchema: mappingToJsonSchema(mapping),
      filter: { rids: ["abc"], field_types: ["text"] },
    },
    { model: "chatgpt-azure-4o" },
  ) as {
    name: string;
    parameters: {
      on: number;
      filter: Record<string, unknown>;
      operations: Array<{ ask: Record<string, unknown> }>;
      llm: { model: string };
    };
  };
  assert.equal(body.name, "ask");
  assert.equal(body.parameters.on, 1, "ask agents only support ApplyTo.FIELD");
  assert.deepEqual(body.parameters.filter.rids, ["abc"]);
  const ask = body.parameters.operations[0]!.ask;
  assert.equal(ask.json, true);
  assert.equal(ask.store_as_key_value, true);
  assert.equal(ask.kv_schema_id, "invoice");
  assert.equal(ask.destination, "invoice");
  assert.equal(body.parameters.llm.model, "chatgpt-azure-4o");
  // live requires `question` to BE the JSON schema, serialised
  const parsed = JSON.parse(ask.question as string) as {
    parameters: { properties: Record<string, unknown> };
  };
  assert.ok("vendor_name" in parsed.parameters.properties);
});

test("mappingToJsonSchema keeps descriptions and required, and types arrays", () => {
  const mapping = schemaToKvSchema(SCHEMAS.invoice, { id: "invoice" });
  const js = mappingToJsonSchema(mapping) as {
    parameters: { properties: Record<string, { type: string; description?: string }>; required: string[] };
  };
  assert.equal(js.parameters.properties.vendor_name!.type, "string");
  assert.ok(js.parameters.properties.vendor_name!.description);
  assert.equal(js.parameters.properties.line_items!.type, "array");
  assert.deepEqual(js.parameters.required, SCHEMAS.invoice.required);
});

// ─── every built-in config must be representable ──────────────────────────────

test("every built-in extraction config maps to a legal kv schema", () => {
  const svc = makeService();
  for (const [docType, extraction] of Object.entries(SCHEMAS)) {
    const mapping = schemaToKvSchema(extraction, { id: `dip_${docType}` });
    assert.ok(mapping.schema.fields.length <= MAX_KV_FIELDS_PER_SCHEMA, docType);
    // would the live platform accept it?
    svc.assertSchemaValid(mapping.schema);
    for (const field of mapping.schema.fields) {
      assert.match(field.key, KV_NAME_PATTERN, `${docType}.${field.key}`);
      assert.equal(mapping.names[field.key] !== undefined, true);
    }
  }
});
