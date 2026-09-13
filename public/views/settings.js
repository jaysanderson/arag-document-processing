/**
 * Settings — every value this deployment reads from configuration, editable in the product.
 *
 * The old screen was read-only and said so in words: *"branding is environment configuration,
 * so a form that appeared to save would be a lie."* That was true of the old architecture and
 * is now false — settings live in the product's JSON store, environment variables are their
 * defaults, and an edit takes effect on the next request with no restart. The apology goes.
 *
 * Every control is generated from the API's own field metadata by `lib/settings-form.js`,
 * which the operator console uses for the same groups. A viewer reads the effective values;
 * editing needs the operator token, which is taken in a drawer without leaving the page.
 */
import {
  $,
  $$,
  announce,
  api,
  buildHash,
  confirmDialog,
  errorState,
  esc,
  fmtBytes,
  icon,
  label,
  navigate,
  onLeave,
  parseHash,
  skeletonRows,
  toast,
  wireTabs,
} from "../lib/core.js";
import {
  brandPreviewHead,
  loadSettings,
  markOperator,
  mountGroup,
  mountLockedGroup,
  mountPurge,
  operatorSignIn,
} from "../lib/settings-form.js";
import { renderKeys } from "./keys.js";

const TABS = [
  ["connection", "Connection"],
  ["branding", "Branding"],
  ["limits", "Limits"],
  ["security", "Security"],
  ["retention", "Retention"],
  ["operations", "Operations"],
  ["keys", "API keys"],
  ["api", "API"],
];

/** Groups that are a straight render of one settings group plus some context of their own. */
const GROUP_TABS = new Set(["connection", "branding", "limits", "security", "retention", "operations"]);

export async function renderSettings(main, { params, stale }) {
  const tab = params.tab && TABS.some(([t]) => t === params.tab) ? params.tab : "connection";
  main.innerHTML = `
    <header class="arag-pagehead">
      <div class="row">
        <h1>Settings</h1>
        <div class="actions" id="settingsActions"></div>
      </div>
      <p class="sub">Environment variables are the defaults; a value set here overrides one and takes
        effect on the next request. Nothing in this product needs a restart.</p>
    </header>
    <div class="arag-tabs" role="tablist">
      ${TABS.map(
        ([slug, text]) =>
          `<a role="tab" href="${buildHash(`/settings/${slug}`)}" aria-selected="${slug === tab}" tabindex="${
            slug === tab ? 0 : -1
          }">${esc(text)}</a>`,
      ).join("")}
    </div>
    <div id="panel" role="tabpanel" tabindex="0">${skeletonRows(4)}</div>`;

  const panel = $("#panel", main);
  wireTabs($(".arag-tabs", main), panel);

  const dirty = new Map();
  installLeaveGuard(dirty);

  const paint = async () => {
    let publicSettings = null;
    let loaded;
    try {
      [publicSettings, loaded] = await Promise.all([
        api("/api/v1/settings").catch(() => null),
        loadSettings(),
      ]);
    } catch (err) {
      if (!stale()) panel.innerHTML = errorState(err);
      return;
    }
    if (stale()) return;
    dirty.clear();
    markOperator(loaded.editable);
    $("#settingsActions", main).innerHTML = loaded.editable
      ? '<span class="arag-status" data-state="ok"><span class="dot"></span><span>Signed in as operator</span></span>'
      : '<button class="arag-btn secondary" type="button" id="signInTop">Sign in as operator</button>';
    $("#signInTop", main)?.addEventListener("click", async () => {
      if (await operatorSignIn()) await paint();
    });

    const ctx = {
      data: loaded.data,
      editable: loaded.editable,
      reload: paint,
      setDirty: (group, count) => dirty.set(group, count),
    };
    const group = (id) => ctx.data?.groups?.find((g) => g.id === id);

    if (tab === "keys") {
      await renderKeys(panel, { editable: loaded.editable, onSignedIn: paint });
      return;
    }
    if (tab === "api") {
      apiTab(panel, publicSettings);
      return;
    }
    if (!GROUP_TABS.has(tab)) return;

    panel.innerHTML = '<div class="arag-stack" id="stack"></div>';
    const stack = $("#stack", panel);
    const host = document.createElement("div");
    stack.appendChild(host);

    if (!loaded.editable) {
      mountLockedGroup(host, tab, publicSettings, { onSignedIn: paint });
    } else {
      mountGroup(host, group(tab), ctx, { onSaved: () => undefined });
    }

    // Each tab carries the context that makes its group legible — the live connection, the
    // pipeline it feeds, the posture it protects, the purge it authorises.
    if (tab === "connection") connectionExtras(stack, publicSettings);
    if (tab === "branding") brandingExtras(stack, host, ctx, publicSettings);
    if (tab === "limits") limitsExtras(stack, publicSettings);
    if (tab === "security") await securityExtras(stack, ctx);
    if (tab === "retention") retentionExtras(stack, ctx);
    if (tab === "operations") operationsExtras(stack);
  };

  await paint();
}

// ── connection ───────────────────────────────────────────────────────────────

function connectionExtras(stack, s) {
  const c = s?.connection;
  const card = document.createElement("div");
  card.className = "arag-card";
  card.innerHTML = `
    <div class="head"><h3>Knowledge Box</h3>
      <button class="arag-btn ghost sm" type="button" id="testConn">Test connection</button>
    </div>
    <div class="body">
      ${
        c?.mock
          ? `<div class="arag-alert warn" style="margin-bottom:12px">This deployment is running the
              <strong>mock Knowledge Box</strong>. Extraction comes from deterministic fixtures keyed by
              filename, not from a model reading the page. Set the Knowledge Box id and service-account
              key above for live extraction.</div>`
          : ""
      }
      <div id="connState">${connStateHtml(c)}</div>
      <p class="muted small" style="margin-top:12px">The test calls the Knowledge Box with the
        <em>saved</em> connection, so a new service-account key is tested by rotating it and testing
        again — nothing is persisted by the test itself.</p>
    </div>`;
  stack.prepend(card);
  $("#testConn", card).addEventListener("click", async () => {
    const btn = $("#testConn", card);
    btn.disabled = true;
    btn.textContent = "Testing…";
    try {
      const fresh = await api("/api/v1/settings");
      $("#connState", card).innerHTML = connStateHtml(fresh.connection);
      announce(
        fresh.connection.ok
          ? `Connected in ${Math.round(fresh.connection.ms ?? 0)} milliseconds.`
          : "The Knowledge Box did not respond.",
      );
      if (!fresh.connection.ok)
        toast(`Could not connect — ${fresh.connection.error ?? "no response"}`, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Test connection";
    }
  });
}

const connStateHtml = (c) =>
  !c
    ? '<p class="muted">The connection could not be read.</p>'
    : `<span class="arag-status" data-state="${c.ok ? "ok" : "error"}"><span class="dot"></span>
        <span>${
          c.ok
            ? `Connected · ${Math.round(c.ms ?? 0)} ms · ${c.resources ?? "—"} resources`
            : `Could not connect — ${esc(c.error ?? "no response")}`
        }</span></span>
      <dl class="arag-kv" style="margin-top:12px">
        <dt>Region</dt><dd>${esc(c.region || "—")}</dd>
        <dt>Mode</dt><dd>${c.mock ? "Mock" : "Live"}</dd>
        <dt>Last checked</dt><dd>${esc(new Date(c.checkedAt).toLocaleTimeString())}</dd>
      </dl>`;

// ── branding ─────────────────────────────────────────────────────────────────

function brandPreviewHtml(b, dirty) {
  return `
    <div class="head"><h3>Preview</h3>${
      dirty ? '<span class="arag-chip warn">Not saved yet</span>' : ""
    }</div>
    <div class="body" id="brandPreviewBody">
      ${brandPreviewHead(b)}
      <div class="arag-row" style="margin:12px 0">
        <button class="arag-btn" type="button" style="${
          b.primaryColor ? `background:${esc(b.primaryColor)};border-color:${esc(b.primaryColor)}` : ""
        }">Primary</button>
        <button class="arag-btn secondary" type="button">Secondary</button>
      </div>
      <div class="arag-chips">
        <span class="arag-chip ok">Ready</span><span class="arag-chip warn">Degraded</span>
        <span class="arag-chip danger">Failed</span><span class="arag-chip info">Processing</span>
      </div>
      <p class="muted small" style="margin-top:12px">Status, verification, grounding and validation
        colours are <strong>never branded</strong>: a partner may recolour their product, but not the
        evidence.</p>
      <p class="muted small">The footer reads “${esc(b.footerText || "Built on Progress Agentic RAG")}”.</p>
    </div>`;
}

function brandingExtras(stack, groupHost, ctx, publicSettings) {
  const card = document.createElement("div");
  card.className = "arag-card dip-brandpreview";
  const read = () => {
    const out = { ...(publicSettings?.branding ?? {}) };
    for (const row of $$(".dip-setting[data-key]", groupHost)) {
      const el = $("[data-control]", row);
      if (!el) continue;
      const key = row.dataset.key.split(".")[1];
      out[key] = row.dataset.type === "boolean" ? el.checked : el.value;
    }
    return out;
  };
  const repaint = () => {
    card.innerHTML = brandPreviewHtml(read(), Boolean($("[data-savebar]:not([hidden])", groupHost)));
  };
  repaint();
  stack.appendChild(card);
  for (const el of $$("[data-control]", groupHost)) {
    el.addEventListener("input", repaint);
    el.addEventListener("change", repaint);
  }

  if (!ctx.editable) return;

  const upload = document.createElement("div");
  upload.className = "arag-card";
  upload.innerHTML = `
    <div class="head"><h3>Logo file</h3></div>
    <div class="body">
      <label class="arag-dropzone" for="logoFile">
        <span class="icon">${icon("upload", { size: 20 })}</span>
        <strong>Upload a logo</strong>
        <span class="small">SVG, PNG, WebP, JPEG or GIF, up to 2 MB. It is written to
          <span class="mono">DATA_DIR/branding</span> and served from <span class="mono">/branding/</span>.</span>
        <input type="file" id="logoFile" accept="image/svg+xml,image/png,image/webp,image/jpeg,image/gif" hidden />
      </label>
      <div id="logoResult" style="margin-top:12px"></div>
    </div>`;
  stack.appendChild(upload);
  $("#logoFile", upload).addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = $("#logoResult", upload);
    // The object URL previews the file before it is saved; a broken image hides itself so a
    // partner never sees a torn icon where their mark should be.
    const objectUrl = URL.createObjectURL(file);
    result.innerHTML = `<div class="arag-row"><img class="dip-logopreview" src="${objectUrl}" alt="" onerror="this.hidden=true" />
        <span class="muted small">${esc(file.name)} · ${esc(fmtBytes(file.size))} — uploading…</span></div>`;
    try {
      const res = await fetch("/api/v1/admin/branding/logo", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": file.name },
        body: file,
        credentials: "same-origin",
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.detail ?? `${res.status} ${res.statusText}`);
      toast("Logo uploaded");
      announce(`Logo uploaded. The rail shows it now, from ${out.url}.`);
      await ctx.reload();
    } catch (err) {
      result.innerHTML = `<div class="arag-alert error" role="alert">${esc(err.message)}</div>`;
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    }
  });
}

// ── limits ───────────────────────────────────────────────────────────────────

function limitsExtras(stack, s) {
  if (!s) return;
  const card = document.createElement("div");
  card.className = "arag-card";
  card.innerHTML = `
    <div class="head"><h3>What this deployment accepts</h3></div>
    <div class="body">
      <dl class="arag-kv">
        <dt>File types</dt><dd>${esc(
          s.uploads.acceptedExtensions.map((e) => e.replace(".", "").toUpperCase()).join(" · "),
        )}</dd>
        <dt>Maximum size</dt><dd>${esc(fmtBytes(s.uploads.maxBytes))} per file</dd>
        <dt>Extraction configs</dt><dd>${s.extraction.configs} · <a href="${buildHash("/configs")}">Configs ›</a></dd>
      </dl>
      <h4 style="margin:16px 0 8px">The pipeline</h4>
      <ol class="arag-steps">
        ${s.extraction.stages
          .map(
            (st) =>
              `<li class="ok"><span class="ic"></span><span>${esc(st)}</span><span class="meta"></span></li>`,
          )
          .join("")}
      </ol>
      <p class="muted small" style="margin-top:12px">Every stage is soft: if one fails the run continues
        with the best record it has, and the failure is reported on the record rather than hidden.
        The accepted types are the API's, not this page's — the upload drawer reads the same list.</p>
    </div>`;
  stack.appendChild(card);
}

// ── security ─────────────────────────────────────────────────────────────────

async function securityExtras(stack, ctx) {
  if (!ctx.editable) return;
  const s = await api("/api/v1/admin/security").catch(() => null);
  if (!s) return;
  const card = document.createElement("div");
  card.className = "arag-card";
  card.innerHTML = `
    <div class="head"><h3>Posture</h3></div>
    <div class="body">
      <dl class="arag-kv">
        <dt>API keys</dt><dd>${
          s.apiKeys.count
            ? `${s.apiKeys.count} in force · ${s.apiKeys.stored} in the key store, ${s.apiKeys.seeded} seeded from the environment`
            : "None — the public API is open for reads and uploads"
        } · <a href="${buildHash("/settings/keys")}">API keys ›</a></dd>
        <dt>Session cookie</dt><dd>${Math.round(s.sessionTtlSec / 3600)} h, SameSite=Lax, HttpOnly, from
          <span class="mono">POST /api/v1/session</span></dd>
        <dt>Writes</dt><dd>${
          s.writesRequireCredential
            ? "Always require a credential — deletes, config creation and corrections, even when API keys are not enforced (DP-12)"
            : "Open"
        }</dd>
        <dt>Rate limit</dt><dd>${
          s.rateLimit.rps > 0
            ? `${s.rateLimit.rps} req/s, burst ${s.rateLimit.burst}`
            : "Disabled — 0 means no limit"
        }</dd>
        <dt>Headers</dt><dd>${Object.entries(s.headers)
          .filter(([, v]) => v)
          .map(([k]) => k.toUpperCase())
          .join(", ")} on</dd>
      </dl>
      <p class="muted small" style="margin-top:12px">The admin token is the credential that authorises
        editing here. It is write-only, like the service-account key: set it once, then rotate it.</p>
    </div>`;
  stack.appendChild(card);
}

// ── retention ────────────────────────────────────────────────────────────────

function retentionExtras(stack, ctx) {
  const host = document.createElement("div");
  stack.appendChild(host);
  mountPurge(host, {
    editable: ctx.editable,
    defaultDays: ctx.data?.applied?.retention?.days ?? 0,
  });
}

// ── operations ───────────────────────────────────────────────────────────────

function operationsExtras(stack) {
  const card = document.createElement("div");
  card.className = "arag-card";
  card.innerHTML = `
    <div class="head"><h3>Where the record of all this lives</h3></div>
    <div class="body">
      <p class="arag-prose muted">Every settings change, key creation, revocation, provision and purge
        is written to the audit log with who, what, when and the before → after values — secrets
        redacted to <span class="mono">***</span>. The runtime log is the same ring buffer the
        <span class="mono">/api/v1/admin/logs</span> endpoint pages through.</p>
      <div class="arag-row">
        <a class="arag-btn secondary" href="/admin/#/audit">Audit log ›</a>
        <a class="arag-btn ghost" href="/admin/#/logs">Runtime log ›</a>
      </div>
    </div>`;
  stack.appendChild(card);
}

// ── API tab ──────────────────────────────────────────────────────────────────

function apiTab(panel, s) {
  panel.innerHTML = `
    <div class="arag-stack">
      <div class="arag-card">
        <div class="head"><h3>API explorer</h3></div>
        <div class="body">
          <p class="muted arag-prose">Every operation this deployment publishes, with a form that calls
            it and a curl you can copy. There is no UI-only capability: every screen in this product is
            one of these calls.</p>
          <a class="arag-btn" href="${buildHash("/api")}">Open the API explorer</a>
        </div>
      </div>
      <div class="arag-card">
        <div class="head"><h3>API reference</h3></div>
        <div class="body">
          <p class="muted arag-prose">The same <span class="mono">/api/v1</span> surface behind an
            OpenAPI 3.1 contract.</p>
          <div class="arag-row">
            <a class="arag-btn secondary" href="/api/v1/docs" data-docs-link>${icon("external-link")} Redoc</a>
            <a class="arag-btn ghost" href="/api/v1/swagger">Swagger</a>
            <a class="arag-btn ghost" href="/api/v1/openapi.json">openapi.json</a>
          </div>
        </div>
      </div>
      <div class="arag-card">
        <div class="head"><h3>Credentials</h3></div>
        <div class="body">
          <dl class="arag-kv">
            <dt>API keys</dt><dd>${
              s?.security.apiKeysEnforced
                ? "Enforced — send <span class='mono'>X-API-Key</span> or a bearer token"
                : "Not enforced — reads and uploads are open"
            } · <a href="${buildHash("/settings/keys")}">Create and revoke keys ›</a></dd>
            <dt>Session cookie</dt><dd>12 h, SameSite=Lax, HttpOnly, from <span class="mono">POST /api/v1/session</span></dd>
            <dt>Writes</dt><dd>Deletes, config creation and field corrections always require a credential,
              even when API keys are not enforced</dd>
            <dt>Admin</dt><dd>${
              s?.security.adminEnabled
                ? '<a href="/admin/">Operator console ›</a>'
                : "Disabled — set ADMIN_TOKEN to enable it"
            }</dd>
          </dl>
        </div>
      </div>
      <div class="arag-card">
        <div class="head"><h3>Guided sample</h3></div>
        <div class="body">
          <p class="muted">Walk the product with a supplier invoice whose totals deliberately do not
            reconcile, so the validation and evidence surfaces have something real to show.</p>
          <a class="arag-btn secondary" href="${buildHash("/welcome")}">Run the guided sample again</a>
        </div>
      </div>
      <div class="arag-card">
        <div class="head"><h3>Keyboard shortcuts</h3></div>
        <div class="body">
          <dl class="arag-kv">
            <dt class="mono">/</dt><dd>Focus the search box</dd>
            <dt class="mono">u</dt><dd>Open the upload drawer</dd>
            <dt class="mono">Esc</dt><dd>Close any overlay</dd>
            <dt class="mono">g then d/c/a/j/i/s</dt><dd>Jump to ${esc(
              label("documents"),
            )}, Configs, Ask, Jobs, the API explorer or Settings</dd>
          </dl>
        </div>
      </div>
    </div>`;
}

// ── the dirty guard ──────────────────────────────────────────────────────────

/**
 * A half-typed configuration change must not vanish because someone clicked another tab.
 *
 * The router cannot cancel a hash change once it has happened — `onLeave` runs teardown, not
 * a veto — so the guard sits one step earlier, on the click that would cause it. Every route
 * in both apps is a real anchor (DP-32), so one delegated capture-phase listener covers the
 * tabs, the rail and every in-page link.
 */
function installLeaveGuard(dirty) {
  const total = () => [...dirty.values()].reduce((a, b) => a + b, 0);
  const onClick = (e) => {
    const count = total();
    if (!count || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    const a = e.target.closest?.('a[href^="#"]');
    if (!a || a.getAttribute("href") === location.hash) return;
    e.preventDefault();
    e.stopPropagation();
    const target = a.getAttribute("href");
    confirmDialog({
      title: "Leave without saving?",
      body: `<p>${count === 1 ? "One change" : `${count} changes`} to these settings will be lost.</p>`,
      confirmLabel: "Leave",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      dirty.clear();
      const { path, query } = parseHash(target);
      navigate(path, query);
    });
  };
  const onUnload = (e) => {
    if (!total()) return;
    e.preventDefault();
    e.returnValue = "";
  };
  document.addEventListener("click", onClick, true);
  window.addEventListener("beforeunload", onUnload);
  onLeave(() => {
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("beforeunload", onUnload);
  });
}
