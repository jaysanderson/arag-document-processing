/**
 * Unit tests for the API explorer's model (`public/lib/apispec.js`).
 *
 * The module is plain browser ESM with no DOM or fetch, which is exactly why it can be
 * tested here: the explorer's behaviour — what it lists, what form it generates, what
 * request that form produces and what curl it copies — is all decided by these functions.
 *
 * The last test runs them over this product's real OpenAPI document, so the explorer is
 * pinned to the spec the server actually serves rather than to a fixture.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRequest,
  byTag,
  coverage,
  deref,
  operationRisk,
  operations,
  resolveRef,
  sampleBody,
  searchOperations,
  toCurl,
} from "../public/lib/apispec.js";
import { openapi } from "../src/openapi.ts";

const DOC = {
  openapi: "3.1.0",
  tags: [
    { name: "Documents", description: "Upload and read documents." },
    { name: "Admin", description: "Operator only." },
  ],
  components: {
    schemas: {
      Ask: {
        type: "object",
        required: ["question"],
        properties: { question: { type: "string" }, top_k: { type: "integer", minimum: 3 } },
      },
      Problem: { type: "object", properties: { title: { type: "string" } } },
    },
    parameters: {
      PageSize: { name: "page_size", in: "query", schema: { type: "integer", default: 50 } },
    },
  },
  paths: {
    "/api/v1/documents": {
      parameters: [{ $ref: "#/components/parameters/PageSize" }],
      get: {
        operationId: "listDocuments",
        tags: ["Documents"],
        summary: "List documents",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "doc_type", in: "query", schema: { type: "array", items: { type: "string" } } },
        ],
        responses: { "200": { description: "A page", content: { "application/json": { schema: {} } } } },
      },
    },
    "/api/v1/documents/{id}/ask": {
      post: {
        operationId: "askDocument",
        tags: ["Documents"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Ask" } } },
        },
        responses: { "200": { description: "Answer" } },
      },
    },
    "/api/v1/admin/purge": {
      post: { operationId: "purge", tags: ["Admin"], responses: { "200": { description: "ok" } } },
    },
    "/api/v1/documents/{id}": {
      delete: {
        operationId: "deleteDocument",
        tags: ["Documents"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "204": { description: "Gone" } },
      },
    },
  },
};

const op = (id: string) => operations(DOC).find((o: { id: string }) => o.id === id)!;

// ── $ref resolution ─────────────────────────────────────────────────────────────────

test("resolveRef follows a local ref and returns non-refs unchanged", () => {
  assert.equal(resolveRef(DOC, { $ref: "#/components/schemas/Problem" }).type, "object");
  assert.deepEqual(resolveRef(DOC, { type: "string" }), { type: "string" });
  assert.deepEqual(resolveRef(DOC, { $ref: "#/nope/missing" }), {});
});

test("deref resolves refs nested inside a schema", () => {
  const out = deref(DOC, { type: "array", items: { $ref: "#/components/schemas/Ask" } });
  assert.equal(out.items.properties.question.type, "string");
});

test("resolveRef does not loop on a self-referential ref", () => {
  const looped = { components: { schemas: { A: { $ref: "#/components/schemas/A" } } } };
  assert.deepEqual(resolveRef(looped, { $ref: "#/components/schemas/A" }), {});
});

// ── operation model ─────────────────────────────────────────────────────────────────

test("operations flattens every method and merges path-level parameters", () => {
  const list = operations(DOC);
  assert.equal(list.length, 4);
  const names = op("listDocuments").parameters.map((p) => p.name);
  // page_size comes from the path item, q and doc_type from the operation.
  assert.deepEqual(names.sort(), ["doc_type", "page_size", "q"]);
});

test("operations marks path parameters required even when the spec omits the flag", () => {
  assert.equal(op("askDocument").parameters.find((p) => p.in === "path")!.required, true);
});

test("operations dereferences the request body schema and picks the JSON media type", () => {
  const body = op("askDocument").requestBody!;
  assert.equal(body.contentType, "application/json");
  assert.equal(body.required, true);
  assert.deepEqual(body.schema.required, ["question"]);
});

test("operations records which methods change data", () => {
  assert.equal(op("listDocuments").mutating, false);
  assert.equal(op("askDocument").mutating, true);
});

test("byTag groups in the document's own tag order and sorts inside a group", () => {
  const groups = byTag(DOC);
  assert.deepEqual(
    groups.map((g) => g.tag),
    ["Documents", "Admin"],
  );
  assert.equal(groups[0]!.description, "Upload and read documents.");
  assert.deepEqual(
    groups[0]!.operations.map((o) => o.id),
    ["listDocuments", "deleteDocument", "askDocument"],
  );
});

test("searchOperations matches path, id, summary and tag, and an empty query matches all", () => {
  const all = operations(DOC);
  assert.equal(searchOperations(all, "").length, 4);
  assert.deepEqual(
    searchOperations(all, "purge").map((o) => o.id),
    ["purge"],
  );
  assert.deepEqual(
    searchOperations(all, "ASK").map((o) => o.id),
    ["askDocument"],
  );
  assert.equal(searchOperations(all, "Documents").length, 3);
  assert.equal(searchOperations(all, "zzz").length, 0);
});

// ── form pre-fill ───────────────────────────────────────────────────────────────────

test("sampleBody fills required properties and respects enums, defaults and minimums", () => {
  assert.deepEqual(sampleBody(op("askDocument").requestBody!.schema), { question: "", top_k: 3 });
  assert.equal(sampleBody({ type: "string", enum: ["a", "b"] }), "a");
  assert.equal(sampleBody({ type: "integer", default: 7 }), 7);
  assert.deepEqual(sampleBody({ type: "array", items: { type: "boolean" } }), [false]);
});

test("sampleBody stops at a sensible depth instead of recursing forever", () => {
  const deep: Record<string, unknown> = { type: "object", required: ["next"], properties: {} };
  (deep.properties as Record<string, unknown>).next = deep;
  assert.doesNotThrow(() => sampleBody(deep));
});

// ── request building ────────────────────────────────────────────────────────────────

test("buildRequest substitutes path parameters and URL-encodes them", () => {
  const req = buildRequest(op("askDocument"), { "path:id": "a/b", body: '{"question":"hi"}' });
  assert.equal(req.url, "/api/v1/documents/a%2Fb/ask");
  assert.equal(req.method, "POST");
  assert.equal(req.headers["Content-Type"], "application/json");
  assert.deepEqual(req.missing, []);
});

test("buildRequest reports what the form is still missing rather than sending a broken call", () => {
  const req = buildRequest(op("askDocument"), {});
  assert.deepEqual(req.missing.sort(), ["body", "id"]);
});

test("buildRequest repeats an array query parameter, from an array or a comma-separated string", () => {
  const a = buildRequest(op("listDocuments"), { "query:doc_type": ["invoice", "receipt"] });
  assert.equal(a.url, "/api/v1/documents?doc_type=invoice&doc_type=receipt");
  const b = buildRequest(op("listDocuments"), { "query:doc_type": "invoice, receipt" });
  assert.equal(b.url, a.url);
});

test("buildRequest omits blank optional parameters entirely", () => {
  const req = buildRequest(op("listDocuments"), { "query:q": "", "query:page_size": 25 });
  assert.equal(req.url, "/api/v1/documents?page_size=25");
});

test("buildRequest uses the session cookie by default and drops it for an explicit credential", () => {
  assert.equal(buildRequest(op("listDocuments"), {}).credentials, "same-origin");
  const keyed = buildRequest(op("listDocuments"), {}, { apiKey: "k-123" });
  assert.equal(keyed.credentials, "omit");
  assert.equal(keyed.headers["X-API-Key"], "k-123");
  const admin = buildRequest(op("purge"), {}, { adminToken: "t-1" });
  assert.equal(admin.headers.Authorization, "Bearer t-1");
});

// ── curl ────────────────────────────────────────────────────────────────────────────

test("toCurl writes a runnable command and hides credentials behind placeholders", () => {
  const req = buildRequest(
    op("askDocument"),
    { "path:id": "d1", body: '{"question":"hi"}' },
    { apiKey: "k-secret" },
  );
  const curl = toCurl(req, { origin: "https://example.test" });
  assert.match(curl, /curl -i -X POST 'https:\/\/example\.test\/api\/v1\/documents\/d1\/ask'/);
  assert.match(curl, /-H 'X-API-Key: \$API_KEY'/);
  assert.doesNotMatch(curl, /k-secret/);
  assert.match(curl, /--data '\{"question":"hi"\}'/);
});

test("toCurl reveals the credential only when explicitly asked", () => {
  const req = buildRequest(op("listDocuments"), {}, { apiKey: "k-secret" });
  assert.match(toCurl(req, { reveal: true }), /k-secret/);
});

test("toCurl escapes a single quote in a value rather than breaking the command", () => {
  const req = buildRequest(op("listDocuments"), { "query:q": "o'brien" });
  assert.match(toCurl(req), /o'\\''brien/);
});

// ── risk labelling ──────────────────────────────────────────────────────────────────

test("operationRisk separates read-only, writing and destructive operations", () => {
  assert.deepEqual(operationRisk(op("listDocuments")), {
    writes: false,
    destructive: false,
    needsCredential: false,
    label: "Read-only",
  });
  assert.equal(operationRisk(op("askDocument")).label, "Changes data");
  assert.equal(operationRisk(op("deleteDocument")).destructive, true);
  assert.equal(operationRisk(op("purge")).label, "Destructive");
});

// ── against the real spec ───────────────────────────────────────────────────────────

test("the explorer models every operation in this product's own OpenAPI document", () => {
  const ops = operations(openapi as unknown as Record<string, unknown>);
  assert.ok(ops.length > 20, `expected the real spec to have many operations, got ${ops.length}`);

  for (const o of ops) {
    assert.ok(o.id, `operation ${o.method} ${o.path} has no operationId`);
    assert.ok(o.tags.length, `${o.id} has no tag`);
    // The explorer renders the description under the operation title; a blank one is a
    // hole in bar #2 of the brief, so the spec is held to it here rather than in review.
    assert.ok(
      (o.summary || o.description).trim().length > 0,
      `${o.id} has neither a summary nor a description`,
    );
    // Every path template placeholder must have a declared parameter, or the form cannot
    // build a URL for it.
    for (const m of o.path.matchAll(/\{([^}]+)\}/g)) {
      assert.ok(
        o.parameters.some((p) => p.in === "path" && p.name === m[1]),
        `${o.id}: path placeholder {${m[1]}} has no declared parameter`,
      );
    }
    // A body-bearing operation must resolve to a real schema, not an unresolved $ref.
    if (o.requestBody) {
      assert.ok(
        !JSON.stringify(o.requestBody.schema).includes("$ref"),
        `${o.id}: request body schema still contains an unresolved $ref`,
      );
    }
  }

  // Every operation is reachable from the explorer — the coverage table's floor.
  assert.equal(
    coverage(openapi as unknown as Record<string, unknown>).every((c) => c.explorer),
    true,
  );
});

test("every operation in the real spec builds a request without throwing", () => {
  for (const o of operations(openapi as unknown as Record<string, unknown>)) {
    const values: Record<string, unknown> = {};
    for (const p of o.parameters) if (p.in === "path") values[`path:${p.name}`] = "sample-id";
    if (o.requestBody) values.body = JSON.stringify(sampleBody(o.requestBody.schema) ?? {});
    const req = buildRequest(o, values);
    assert.deepEqual(req.missing, [], `${o.id} still reports missing input: ${req.missing.join(", ")}`);
    assert.doesNotMatch(req.url, /\{|\}/, `${o.id} left an unsubstituted placeholder in ${req.url}`);
    assert.ok(toCurl(req).startsWith("curl -i -X "));
  }
});
