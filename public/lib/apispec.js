/**
 * OpenAPI → API explorer model.
 *
 * Pure functions only: no DOM, no fetch, no product knowledge. Given the OpenAPI document
 * the server already publishes at `/api/v1/openapi.json`, this builds the list of
 * operations the explorer renders, the parameter model each "try it" form is generated
 * from, the request a filled form produces, and the copyable curl for it.
 *
 * It is deliberately separable from this product: the explorer is a **kit candidate** for
 * `arag-platform` v0.3.0 (`apiExplorer()` + `.arag-apiexplorer`). Keeping the whole model
 * in one dependency-free module with unit tests is what makes lifting it a move rather
 * than a rewrite — see `design/NEW-SCREENS.md`.
 */

/** Methods an OpenAPI path item can carry, in the order an explorer should list them. */
export const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

/** Methods that change server state — the explorer confirms before sending these. */
const MUTATING = new Set(["post", "put", "patch", "delete"]);

/** Resolve a local `$ref` (`#/components/schemas/Foo`) against the document. */
export function resolveRef(doc, node, seen = new Set()) {
  if (!node || typeof node !== "object") return node;
  const ref = node.$ref;
  if (typeof ref !== "string") return node;
  if (!ref.startsWith("#/") || seen.has(ref)) return {};
  seen.add(ref);
  let cur = doc;
  for (const part of ref.slice(2).split("/")) {
    cur = cur?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (cur === undefined) return {};
  }
  return resolveRef(doc, cur, seen);
}

/** Deep-resolve every `$ref` in a schema so a form generator never meets one. */
export function deref(doc, schema, depth = 0) {
  if (!schema || typeof schema !== "object" || depth > 12) return schema ?? {};
  const node = resolveRef(doc, schema);
  if (Array.isArray(node)) return node.map((n) => deref(doc, n, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = v && typeof v === "object" ? deref(doc, v, depth + 1) : v;
  }
  return out;
}

/**
 * Every operation in the document, flattened and normalised.
 *
 * Path-level parameters are merged into each operation (an operation-level parameter of
 * the same name+in wins, per the specification), so a form generator never has to look
 * back up at the path item.
 */
export function operations(doc) {
  const out = [];
  for (const [path, item] of Object.entries(doc?.paths ?? {})) {
    if (!item || typeof item !== "object") continue;
    const shared = (item.parameters ?? []).map((p) => resolveRef(doc, p));
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op || typeof op !== "object") continue;
      const own = (op.parameters ?? []).map((p) => resolveRef(doc, p));
      const merged = [...shared.filter((s) => !own.some((o) => o.name === s.name && o.in === s.in)), ...own];
      out.push({
        id: op.operationId || `${method}:${path}`,
        method,
        path,
        summary: op.summary ?? "",
        description: op.description ?? "",
        tags: op.tags?.length ? op.tags : ["Other"],
        deprecated: Boolean(op.deprecated),
        mutating: MUTATING.has(method),
        parameters: merged.map((p) => ({
          name: p.name,
          in: p.in,
          required: Boolean(p.required) || p.in === "path",
          description: p.description ?? "",
          schema: deref(doc, p.schema ?? {}),
        })),
        requestBody: op.requestBody ? normaliseBody(doc, op.requestBody) : null,
        responses: Object.entries(op.responses ?? {}).map(([status, r]) => {
          const res = resolveRef(doc, r);
          return {
            status,
            description: res.description ?? "",
            contentTypes: Object.keys(res.content ?? {}),
          };
        }),
        security: op.security ?? doc?.security ?? [],
      });
    }
  }
  return out;
}

/** The request body reduced to what a form needs: one chosen media type and its schema. */
function normaliseBody(doc, body) {
  const b = resolveRef(doc, body);
  const content = b.content ?? {};
  // Prefer JSON when the operation offers it; otherwise take the first declared type, which
  // is how an upload endpoint ends up on multipart/form-data or application/octet-stream.
  const contentType =
    Object.keys(content).find((t) => t.includes("json")) ?? Object.keys(content)[0] ?? "application/json";
  return {
    required: Boolean(b.required),
    description: b.description ?? "",
    contentType,
    contentTypes: Object.keys(content),
    schema: deref(doc, content[contentType]?.schema ?? {}),
    example: content[contentType]?.example ?? null,
  };
}

/** Operations grouped by their first tag, in the document's own `tags` order. */
export function byTag(doc, ops = operations(doc)) {
  const order = (doc?.tags ?? []).map((t) => t.name);
  const groups = new Map();
  for (const op of ops) {
    const tag = op.tags[0];
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag).push(op);
  }
  const described = new Map((doc?.tags ?? []).map((t) => [t.name, t.description ?? ""]));
  return [...groups.entries()]
    .sort((a, b) => {
      const ai = order.indexOf(a[0]);
      const bi = order.indexOf(b[0]);
      if (ai !== bi) return (ai === -1 ? 1e6 : ai) - (bi === -1 ? 1e6 : bi);
      return a[0].localeCompare(b[0]);
    })
    .map(([tag, items]) => ({
      tag,
      description: described.get(tag) ?? "",
      operations: items.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
    }));
}

/** Case-insensitive substring match over the fields a reader would search by. */
export function searchOperations(ops, q) {
  const needle = String(q ?? "")
    .trim()
    .toLowerCase();
  if (!needle) return ops;
  return ops.filter((op) =>
    `${op.method} ${op.path} ${op.id} ${op.summary} ${op.description} ${op.tags.join(" ")}`
      .toLowerCase()
      .includes(needle),
  );
}

/** A JSON body pre-filled from the schema, so "try it" starts from something valid. */
export function sampleBody(schema, depth = 0) {
  if (!schema || typeof schema !== "object" || depth > 6) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  switch (schema.type) {
    case "object": {
      const out = {};
      const required = new Set(schema.required ?? []);
      for (const [k, v] of Object.entries(schema.properties ?? {})) {
        // Required properties always; optional ones only at the top level, so a form starts
        // complete without burying the reader in nested optional structure.
        if (required.has(k) || depth === 0) out[k] = sampleBody(v, depth + 1);
      }
      return out;
    }
    case "array":
      return schema.items ? [sampleBody(schema.items, depth + 1)] : [];
    case "integer":
    case "number":
      return schema.minimum ?? 0;
    case "boolean":
      return false;
    case "string":
      return schema.format === "date-time" ? new Date(0).toISOString() : "";
    default:
      return schema.properties ? sampleBody({ ...schema, type: "object" }, depth) : null;
  }
}

/**
 * Turn a filled form into the request to send.
 *
 * `values` is a flat map keyed `"<in>:<name>"` (`path:id`, `query:page_size`) plus an
 * optional `body`. A query parameter declared as an array accepts an array, or a
 * comma-separated string, and is serialised as a repeated key — the shape `doc_type`
 * needs (DP-42).
 */
export function buildRequest(op, values = {}, opts = {}) {
  const missing = [];
  let path = op.path;
  for (const p of op.parameters.filter((x) => x.in === "path")) {
    const v = values[`path:${p.name}`];
    if (v === undefined || v === "") {
      missing.push(p.name);
      continue;
    }
    path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
  }

  const query = [];
  for (const p of op.parameters.filter((x) => x.in === "query")) {
    const v = values[`query:${p.name}`];
    if (v === undefined || v === "" || v === null) {
      if (p.required) missing.push(p.name);
      continue;
    }
    const repeated = p.schema?.type === "array";
    const items = repeated ? (Array.isArray(v) ? v : String(v).split(",")) : [v];
    for (const item of items) {
      const s = String(item).trim();
      if (s !== "") query.push([p.name, s]);
    }
  }

  const headers = {};
  for (const p of op.parameters.filter((x) => x.in === "header")) {
    const v = values[`header:${p.name}`];
    if (v !== undefined && v !== "") headers[p.name] = String(v);
    else if (p.required) missing.push(p.name);
  }

  let body;
  if (op.requestBody && values.body !== undefined && values.body !== "") {
    if (op.requestBody.contentType.includes("json")) {
      headers["Content-Type"] = "application/json";
      body = typeof values.body === "string" ? values.body : JSON.stringify(values.body, null, 2);
    } else {
      // A raw upload: the caller supplies bytes and the filename header the route wants.
      body = values.body;
      if (!headers["Content-Type"]) headers["Content-Type"] = op.requestBody.contentType;
    }
  } else if (op.requestBody?.required && !values.file) {
    missing.push("body");
  }

  if (opts.apiKey) headers["X-API-Key"] = opts.apiKey;
  if (opts.adminToken) headers.Authorization = `Bearer ${opts.adminToken}`;

  const qs = query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return {
    method: op.method.toUpperCase(),
    url: qs ? `${path}?${qs}` : path,
    headers,
    body,
    missing,
    /** Same-origin session cookie is the default credential (`POST /api/v1/session`). */
    credentials: opts.apiKey || opts.adminToken ? "omit" : "same-origin",
  };
}

/** POSIX-safe single-quoting for a shell argument. */
function shq(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * A copyable curl for a built request. Secrets are placeholders unless `reveal` is set:
 * the explorer's copy button must not put a live API key on the clipboard by default, and
 * the placeholder is what belongs in documentation anyway.
 */
export function toCurl(req, opts = {}) {
  const origin = opts.origin ?? "";
  const parts = [`curl -i -X ${req.method} ${shq(origin + req.url)}`];
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    let shown = v;
    if (!opts.reveal) {
      if (/^x-api-key$/i.test(k)) shown = "$API_KEY";
      else if (/^authorization$/i.test(k)) shown = "Bearer $ADMIN_TOKEN";
    }
    parts.push(`-H ${shq(`${k}: ${shown}`)}`);
  }
  if (req.body !== undefined && req.body !== null && typeof req.body === "string" && req.body !== "") {
    parts.push(`--data ${shq(req.body)}`);
  } else if (req.body) {
    parts.push(`--data-binary @<file>`);
  }
  if (req.credentials === "same-origin") parts.push("--cookie 'arag_session=<session>'");
  return parts.join(" \\\n  ");
}

/**
 * What the explorer must tell the reader before they press Send: whether this operation
 * changes state, and whether it needs a credential the viewer may not have.
 */
export function operationRisk(op) {
  const writes = op.mutating;
  const destructive = op.method === "delete" || /purge|bulk-delete|revoke|reset/i.test(op.path + op.id);
  return {
    writes,
    destructive,
    /** DP-12: writes need the admin token, an API key, or a same-origin session. */
    needsCredential: writes,
    label: destructive ? "Destructive" : writes ? "Changes data" : "Read-only",
  };
}

/**
 * Every `/api/v1` operation in the document paired with whether the explorer covers it —
 * the data behind the API coverage table, and the assertion that keeps the explorer
 * honest: an operation that exists in the spec and is not reachable in the UI is a gap.
 */
export function coverage(doc, { screens = {} } = {}) {
  return operations(doc).map((op) => ({
    id: op.id,
    method: op.method.toUpperCase(),
    path: op.path,
    tag: op.tags[0],
    screen: screens[op.id] ?? null,
    explorer: true,
  }));
}
