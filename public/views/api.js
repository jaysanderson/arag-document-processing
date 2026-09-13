/**
 * API explorer — every operation in the product's OpenAPI document, exercisable in place.
 *
 * The brief's bar: "for each `/api/v1` path there is a screen or control that uses it, or
 * an in-product API explorer". This is that explorer, and it is generated entirely from
 * `/api/v1/openapi.json` — there is no hand-written list of operations to drift. Adding an
 * operation to the spec adds it here.
 *
 * All of the model (grouping, parameter shapes, request building, curl) lives in
 * `../lib/apispec.js`, which is pure and unit-tested. This file is the DOM around it, and
 * is deliberately thin for the same reason: the explorer is a kit candidate for
 * arag-platform v0.3.0 (see `design/NEW-SCREENS.md`).
 */

import {
  announce,
  confirmDialog,
  emptyState,
  errorState,
  highlightJson,
  icon,
  skeletonRows,
  snippet,
  toast,
  wireCopy,
} from "/ui/arag-ui.js";
import {
  buildRequest,
  byTag,
  operationRisk,
  operations,
  sampleBody,
  searchOperations,
  toCurl,
} from "../lib/apispec.js";
import { $, $$, buildHash, esc, navigate, onLeave, parseHash } from "../lib/core.js";
import { listRemembered, rememberedKey } from "../lib/keyring.js";

/** Cached across navigations: the spec does not change while the tab is open. */
let specPromise = null;
const loadSpec = () => {
  specPromise ??= fetch("/api/v1/openapi.json", { headers: { Accept: "application/json" } }).then((r) => {
    if (!r.ok) throw new Error(`Could not load the API document (HTTP ${r.status}).`);
    return r.json();
  });
  return specPromise;
};

/** The credential the "try it" form sends. Kept in memory only — never persisted. */
const credential = { mode: "session", apiKey: "", adminToken: "" };

const METHOD_TONE = {
  get: "info",
  head: "info",
  options: "info",
  post: "ok",
  put: "warn",
  patch: "warn",
  delete: "danger",
};

export async function renderApi(main, ctx) {
  const query = ctx?.query ?? parseHash().query;
  main.innerHTML = `
    <div class="arag-pagehead">
      <div class="row">
        <div>
          <h1>API</h1>
          <p class="sub">Every operation this deployment serves, with its parameters, a live
            request against your own session, and the curl to reproduce it.</p>
        </div>
        <div class="actions">
          <a class="arag-btn ghost" href="/api/v1/docs" target="_blank" rel="noopener">Reference docs</a>
          <a class="arag-btn ghost" href="/api/v1/openapi.json" target="_blank" rel="noopener">openapi.json</a>
        </div>
      </div>
    </div>
    <div id="apiBody">${skeletonRows(8)}</div>`;

  let doc;
  try {
    doc = await loadSpec();
  } catch (err) {
    $("#apiBody", main).innerHTML = errorState(err, { retry: "" });
    return;
  }

  const all = operations(doc);
  const body = $("#apiBody", main);
  body.innerHTML = `
    <div class="arag-filterbar" role="search">
      <label class="arag-search">
        ${icon("search", { size: 16 })}
        <input id="apiSearch" type="search" placeholder="Search operations, paths and descriptions"
               aria-label="Search operations" value="${esc(query.q ?? "")}" />
      </label>
      <span class="spacer"></span>
      <span class="arag-help" id="apiCount"></span>
    </div>
    <div class="arag-split dip-apisplit">
      <nav class="dip-oplist" id="apiList" aria-label="API operations"></nav>
      <section id="apiDetail" aria-live="polite"></section>
    </div>`;

  const listEl = $("#apiList", body);
  const detailEl = $("#apiDetail", body);
  const searchEl = $("#apiSearch", body);

  const state = { q: query.q ?? "", selected: query.op ?? null };

  function paintList() {
    const matched = searchOperations(all, state.q);
    $("#apiCount", body).textContent =
      matched.length === all.length
        ? `${all.length} operations`
        : `${matched.length} of ${all.length} operations`;
    if (!matched.length) {
      listEl.innerHTML = emptyState({
        iconName: "search",
        title: "No operation matches that",
        body: "Try part of a path, a tag, or an operation id.",
      });
      return;
    }
    listEl.innerHTML = byTag(doc, matched)
      .map(
        (group) => `
        <div class="dip-opgroup">
          <h2 class="dip-opgroup__head">${esc(group.tag)}</h2>
          ${group.description ? `<p class="dip-opgroup__sub">${esc(group.description)}</p>` : ""}
          <ul>
            ${group.operations
              .map(
                (op) => `<li>
                  <a href="${buildHash("/api", { op: op.id, q: state.q || undefined })}"
                     data-op="${esc(op.id)}"
                     ${op.id === state.selected ? 'aria-current="true"' : ""}>
                    <span class="dip-method ${esc(METHOD_TONE[op.method] ?? "info")}">${op.method.toUpperCase()}</span>
                    <span class="dip-oppath">${esc(op.path.replace("/api/v1", ""))}</span>
                    <span class="dip-opsum">${esc(op.summary || op.id)}</span>
                  </a>
                </li>`,
              )
              .join("")}
          </ul>
        </div>`,
      )
      .join("");
    // Keep a selection that is still in the filtered list; otherwise fall to the first.
    if (!matched.some((o) => o.id === state.selected)) select(matched[0].id, { push: false });
  }

  function select(id, { push = true } = {}) {
    state.selected = id;
    for (const a of $$("[data-op]", listEl)) {
      if (a.dataset.op === id) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
    paintDetail(all.find((o) => o.id === id));
    if (push) navigate("/api", { op: id, q: state.q || undefined }, { replace: true });
  }

  function paintDetail(op) {
    if (!op) {
      detailEl.innerHTML = emptyState({
        iconName: "code",
        title: "Pick an operation",
        body: "Every operation lists its parameters and can be called against this deployment.",
      });
      return;
    }
    const risk = operationRisk(op);
    detailEl.innerHTML = `
      <article class="arag-card dip-opdetail">
        <header>
          <div class="dip-opdetail__title">
            <span class="dip-method ${esc(METHOD_TONE[op.method] ?? "info")}">${op.method.toUpperCase()}</span>
            <code>${esc(op.path)}</code>
            <span class="arag-chip ${risk.destructive ? "danger" : risk.writes ? "warn" : ""}">${esc(risk.label)}</span>
          </div>
          <p class="dip-opdetail__id"><code>${esc(op.id)}</code></p>
          ${op.summary ? `<p class="dip-opdetail__summary">${esc(op.summary)}</p>` : ""}
          ${op.description ? `<div class="arag-prose">${esc(op.description)}</div>` : ""}
          ${
            risk.needsCredential
              ? `<div class="arag-alert info">This operation changes data, so it needs a credential:
                   the workspace session you already have, an API key, or the operator token.</div>`
              : ""
          }
        </header>

        <form id="tryForm" novalidate>
          ${paramFields(op)}
          ${bodyField(op)}
          ${credentialField()}
          <div class="dip-opdetail__actions">
            <button class="arag-btn" type="submit">Send request</button>
            <button class="arag-btn ghost" type="button" id="resetForm">Reset</button>
          </div>
        </form>

        <section class="dip-opdetail__curl">
          <h3>curl</h3>
          <div id="curlOut"></div>
        </section>

        <section id="responseOut" class="dip-opdetail__response"></section>

        <section class="dip-opdetail__responses">
          <h3>Documented responses</h3>
          <table class="arag-table">
            <thead><tr><th>Status</th><th>Meaning</th><th>Content type</th></tr></thead>
            <tbody>
              ${op.responses
                .map(
                  (r) =>
                    `<tr><td><code>${esc(r.status)}</code></td><td>${esc(r.description)}</td>
                     <td>${esc(r.contentTypes.join(", ") || "—")}</td></tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </section>
      </article>`;

    const form = $("#tryForm", detailEl);
    const refresh = () => paintCurl(op, form);
    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);
    $("#resetForm", detailEl).addEventListener("click", () => {
      form.reset();
      prefill(op, form);
      refresh();
    });
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      void send(op, form);
    });
    prefill(op, form);
    refresh();
  }

  function paramFields(op) {
    if (!op.parameters.length) return "";
    const groups = ["path", "query", "header"].filter((where) => op.parameters.some((p) => p.in === where));
    return groups
      .map(
        (where) => `
        <fieldset class="dip-opfields">
          <legend>${where === "path" ? "Path" : where === "query" ? "Query" : "Header"} parameters</legend>
          ${op.parameters
            .filter((p) => p.in === where)
            .map((p) => field(p))
            .join("")}
        </fieldset>`,
      )
      .join("");
  }

  function field(p) {
    const id = `p-${p.in}-${p.name}`;
    const s = p.schema ?? {};
    const hint = [
      s.type === "array" ? "repeatable — separate values with a comma" : s.type,
      s.format,
      s.minimum !== undefined ? `min ${s.minimum}` : null,
      s.maximum !== undefined ? `max ${s.maximum}` : null,
      s.default !== undefined ? `default ${s.default}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const control = Array.isArray(s.enum)
      ? `<select class="arag-select" id="${esc(id)}" name="${esc(`${p.in}:${p.name}`)}">
           ${p.required ? "" : '<option value="">—</option>'}
           ${s.enum.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}
         </select>`
      : s.type === "boolean"
        ? `<select class="arag-select" id="${esc(id)}" name="${esc(`${p.in}:${p.name}`)}">
             <option value="">—</option><option value="true">true</option><option value="false">false</option>
           </select>`
        : `<input class="arag-input" id="${esc(id)}" name="${esc(`${p.in}:${p.name}`)}"
                  type="${s.type === "integer" || s.type === "number" ? "number" : "text"}"
                  ${p.required ? "required" : ""} />`;
    return `<div class="arag-field">
      <label for="${esc(id)}">${esc(p.name)}${p.required ? ' <span class="dip-req" aria-label="required">*</span>' : ""}</label>
      ${control}
      ${p.description || hint ? `<p class="arag-help">${esc(p.description)}${p.description && hint ? " · " : ""}${esc(hint)}</p>` : ""}
    </div>`;
  }

  function bodyField(op) {
    if (!op.requestBody) return "";
    const json = op.requestBody.contentType.includes("json");
    return `<fieldset class="dip-opfields">
      <legend>Request body <span class="arag-help">${esc(op.requestBody.contentType)}</span></legend>
      ${op.requestBody.description ? `<p class="arag-help">${esc(op.requestBody.description)}</p>` : ""}
      ${
        json
          ? `<textarea class="arag-textarea" name="body" rows="8" spellcheck="false"
                       aria-label="JSON request body"></textarea>`
          : `<input class="arag-input" type="file" name="file" aria-label="File to upload" />
             <p class="arag-help">The file is sent as the raw request body with an
               <code>X-Filename</code> header, exactly as the dropzone does.</p>`
      }
    </fieldset>`;
  }

  function credentialField() {
    return `<fieldset class="dip-opfields">
      <legend>Credential</legend>
      <div class="arag-field">
        <label for="credMode">Send as</label>
        <select class="arag-select" id="credMode" name="credMode">
          <option value="session"${credential.mode === "session" ? " selected" : ""}>This workspace session</option>
          <option value="apiKey"${credential.mode === "apiKey" ? " selected" : ""}>An API key</option>
          <option value="admin"${credential.mode === "admin" ? " selected" : ""}>The operator token</option>
          <option value="none"${credential.mode === "none" ? " selected" : ""}>No credential (anonymous)</option>
        </select>
        <p class="arag-help">Nothing you type here is stored. The copied curl shows
          <code>$API_KEY</code> rather than the value.</p>
      </div>
      <div class="arag-field" id="credKeyField" hidden>
        <label for="credKey">Key</label>
        <select class="arag-select" id="credKey" name="credKey">
          ${listRemembered()
            .map((k) => `<option value="${esc(k.id)}">${esc(k.name)} · ${esc(k.prefix)}…</option>`)
            .join("")}
          <option value="">Paste a key instead…</option>
        </select>
        <p class="arag-help">Keys created in Settings → API keys while this tab has been open, by name.
          A key is shown once by the API and held in this tab only — a reload forgets it.</p>
      </div>
      <div class="arag-field" id="credValueField" hidden>
        <label for="credValue">Value</label>
        <input class="arag-input" id="credValue" name="credValue" type="password" autocomplete="off" />
      </div>
    </fieldset>`;
  }

  function prefill(op, form) {
    for (const p of op.parameters) {
      const el = form.elements.namedItem(`${p.in}:${p.name}`);
      if (!el) continue;
      if (p.schema?.default !== undefined && el.value === "") el.value = String(p.schema.default);
    }
    const bodyEl = form.elements.namedItem("body");
    if (bodyEl && !bodyEl.value) {
      const sample = sampleBody(op.requestBody.schema);
      bodyEl.value = sample === null ? "{}" : JSON.stringify(sample, null, 2);
    }
    syncCredential(form);
  }

  function syncCredential(form) {
    const mode = form.elements.namedItem("credMode")?.value ?? "session";
    credential.mode = mode;
    // A key minted in this tab can be chosen by name; otherwise, and always for the operator
    // token, the value is pasted. Either way it lives in memory and never in the curl.
    const stored = listRemembered();
    const keyWrap = $("#credKeyField", form);
    const keyEl = form.elements.namedItem("credKey");
    const picked = mode === "apiKey" && stored.length ? (keyEl?.value ?? "") : "";
    if (keyWrap) keyWrap.hidden = mode !== "apiKey" || stored.length === 0;
    const wrap = $("#credValueField", form);
    if (wrap) wrap.hidden = (mode !== "apiKey" && mode !== "admin") || Boolean(picked);
    const valueEl = form.elements.namedItem("credValue");
    if (valueEl) {
      valueEl.placeholder = mode === "admin" ? "Operator token" : "API key";
      if (mode === "apiKey") credential.apiKey = picked ? rememberedKey(picked) : valueEl.value;
      if (mode === "admin") credential.adminToken = valueEl.value;
    }
  }

  function collect(op, form) {
    syncCredential(form);
    const values = {};
    for (const p of op.parameters) {
      const el = form.elements.namedItem(`${p.in}:${p.name}`);
      if (el && el.value !== "") values[`${p.in}:${p.name}`] = el.value;
    }
    const bodyEl = form.elements.namedItem("body");
    if (bodyEl) values.body = bodyEl.value;
    const fileEl = form.elements.namedItem("file");
    if (fileEl?.files?.length) values.file = fileEl.files[0];
    const opts = {};
    if (credential.mode === "apiKey" && credential.apiKey) opts.apiKey = credential.apiKey;
    if (credential.mode === "admin" && credential.adminToken) opts.adminToken = credential.adminToken;
    const req = buildRequest(op, values, opts);
    if (credential.mode === "none") req.credentials = "omit";
    if (values.file) {
      req.headers["X-Filename"] = values.file.name;
      req.headers["Content-Type"] = values.file.type || "application/octet-stream";
    }
    return { req, file: values.file };
  }

  function paintCurl(op, form) {
    const { req } = collect(op, form);
    $("#curlOut", detailEl).innerHTML = snippet(toCurl(req, { origin: location.origin }), { lang: "bash" });
    wireCopy(detailEl);
  }

  async function send(op, form) {
    const { req, file } = collect(op, form);
    if (req.missing.length) {
      toast(`Fill in: ${req.missing.join(", ")}`, "error");
      $(`[name$=":${req.missing[0]}"]`, form)?.focus();
      return;
    }
    const risk = operationRisk(op);
    if (risk.destructive) {
      const ok = await confirmDialog({
        title: `Send ${op.method.toUpperCase()} ${op.path}?`,
        body: `<p>This calls the live deployment and <strong>deletes data that cannot be recovered</strong>.
               It is the same call the product's own screens make.</p>
               <p><code>${esc(req.url)}</code></p>`,
        confirmLabel: "Send it",
        danger: true,
      });
      if (!ok) return;
    }

    const out = $("#responseOut", detailEl);
    out.innerHTML = `<h3>Response</h3><div class="arag-help">Sending…</div>`;
    const started = performance.now();
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: file ?? req.body,
        credentials: req.credentials,
      });
      const ms = Math.round(performance.now() - started);
      const ct = res.headers.get("content-type") ?? "";
      let rendered;
      if (ct.includes("json")) {
        const json = await res.json();
        rendered = `<pre class="arag-json">${highlightJson(json)}</pre>`;
      } else if (ct.startsWith("text/") || ct.includes("xml") || ct.includes("csv")) {
        rendered = snippet((await res.text()).slice(0, 20_000));
      } else {
        const blob = await res.blob();
        // A binary response is not something to print; offer it as the file it is.
        const url = URL.createObjectURL(blob);
        onLeave(() => URL.revokeObjectURL(url));
        rendered = `<p class="arag-help">${esc(ct || "binary")} · ${blob.size} bytes —
          <a href="${url}" download>download the response</a></p>`;
      }
      out.innerHTML = `
        <h3>Response</h3>
        <p class="dip-respmeta">
          <span class="arag-chip ${res.ok ? "ok" : res.status >= 500 ? "danger" : "warn"}">${res.status} ${esc(res.statusText)}</span>
          <span class="arag-help">${ms} ms · ${esc(ct || "no content type")}</span>
        </p>
        ${rendered}`;
      wireCopy(out);
      announce(`${op.method.toUpperCase()} ${op.path} responded ${res.status} in ${ms} milliseconds`);
    } catch (err) {
      out.innerHTML = `<h3>Response</h3>${errorState(err)}`;
      announce(`${op.method.toUpperCase()} ${op.path} failed: ${err.message}`);
    }
  }

  listEl.addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-op]");
    if (!a) return;
    ev.preventDefault();
    select(a.dataset.op);
  });

  let debounce;
  searchEl.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = searchEl.value;
      paintList();
      navigate("/api", { op: state.selected ?? undefined, q: state.q || undefined }, { replace: true });
    }, 150);
  });
  onLeave(() => clearTimeout(debounce));

  paintList();
  if (state.selected) select(state.selected, { push: false });
}
