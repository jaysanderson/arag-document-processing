/**
 * Settings — what this deployment is connected to, what it will accept, what it looks
 * like, and where the API is. All of it without an admin token: these are questions a
 * user of the product has to be able to answer for themselves. Anything whose value is a
 * secret or an operational lever stays behind ADMIN_TOKEN in the admin app.
 */
import {
  $,
  api,
  buildHash,
  errorState,
  esc,
  fmtBytes,
  icon,
  label,
  pct,
  shortId,
  skeletonRows,
  wireTabs,
} from "../lib/core.js";

const TABS = [
  ["connection", "Connection"],
  ["extraction", "Extraction"],
  ["branding", "Branding"],
  ["api", "API"],
];

export async function renderSettings(main, { params, stale }) {
  const tab = params.tab && TABS.some(([t]) => t === params.tab) ? params.tab : "connection";
  main.innerHTML = `
    <header class="dip-pagehead"><div class="dip-pagehead__row"><h1>Settings</h1></div></header>
    <div class="arag-tabs dip-tabs" role="tablist">
      ${TABS.map(
        ([slug, text]) =>
          `<a role="tab" href="${buildHash(`/settings/${slug}`)}" aria-selected="${slug === tab}" tabindex="${slug === tab ? 0 : -1}">${esc(text)}</a>`,
      ).join("")}
    </div>
    <div id="panel" role="tabpanel" tabindex="0">${skeletonRows(3)}</div>`;

  let settings;
  let stats;
  try {
    [settings, stats] = await Promise.all([api("/api/v1/settings"), api("/api/v1/stats").catch(() => null)]);
  } catch (err) {
    if (!stale()) $("#panel", main).innerHTML = errorState(err);
    return;
  }
  if (stale()) return;
  const panel = $("#panel", main);
  wireTabs($(".dip-tabs", main), panel);
  if (tab === "connection") connection(panel, settings, stats);
  else if (tab === "extraction") extraction(panel, settings);
  else if (tab === "branding") branding(panel, settings);
  else apiTab(panel, settings, stats);
}

function connection(panel, s, stats) {
  const c = s.connection;
  panel.innerHTML = `
    <div class="arag-stack">
      <div class="arag-card">
        <div class="head"><h3>Knowledge Box</h3>
          <span class="arag-status" data-state="${c.ok ? "ok" : "error"}"><span class="dot"></span>
            <span>${c.ok ? `Connected · ${Math.round(c.ms ?? 0)} ms` : "Not responding"}</span></span>
        </div>
        <div class="body">
          ${
            c.mock
              ? `<div class="arag-alert warn" style="margin-bottom:12px">This deployment is running the <strong>mock Knowledge Box</strong>. Extraction comes from deterministic fixtures keyed by filename, not from a model reading the page. Set <span class="mono">ARAG_KB_ID</span> and <span class="mono">ARAG_API_KEY</span> for live extraction.</div>`
              : ""
          }
          <dl class="arag-kv">
            <dt>Knowledge Box</dt><dd class="mono">${esc(shortId(c.kbId))}</dd>
            <dt>Region</dt><dd>${esc(c.region || "—")}</dd>
            <dt>Endpoint</dt><dd class="mono small">${esc(c.baseUrl || "—")}</dd>
            <dt>Mode</dt><dd>${c.mock ? "Mock" : "Live"}</dd>
            <dt>Resources</dt><dd>${c.resources ?? "—"}</dd>
            <dt>Last checked</dt><dd>${esc(new Date(c.checkedAt).toLocaleTimeString())}</dd>
          </dl>
        </div>
      </div>
      <div class="arag-card">
        <div class="head"><h3>Processing</h3></div>
        <div class="body">
          <dl class="arag-kv">
            <dt>Generative model</dt><dd>${esc(s.extraction.generativeModel)}</dd>
            <dt>Extract strategy</dt><dd>${s.extraction.visualExtraction ? "Visual extraction on for images and PDFs" : "Default ARAG processing"}</dd>
            <dt>Reranker</dt><dd>${esc(s.extraction.reranker || "KB default")}</dd>
            <dt>Grounding (mean)</dt><dd>${stats?.groundingScore == null ? "—" : `${esc(pct(stats.groundingScore))} across ${stats.documents.total} records`}</dd>
          </dl>
        </div>
      </div>
      <p class="muted small dip-prose">Changing any of these means changing the deployment's environment variables and restarting. Operators: <a href="/admin/#/connection">Admin → Connection</a>.</p>
    </div>`;
}

function extraction(panel, s) {
  panel.innerHTML = `
    <div class="arag-stack">
      <div class="arag-card">
        <div class="head"><h3>What this deployment accepts</h3></div>
        <div class="body">
          <dl class="arag-kv">
            <dt>File types</dt><dd>${esc(s.uploads.acceptedExtensions.map((e) => e.replace(".", "").toUpperCase()).join(" · "))}</dd>
            <dt>Maximum size</dt><dd>${esc(fmtBytes(s.uploads.maxBytes))} per file</dd>
            <dt>Question length</dt><dd>1 200 characters</dd>
            <dt>Extraction configs</dt><dd>${s.extraction.configs} · <a href="${buildHash("/configs")}">Configs ›</a></dd>
          </dl>
        </div>
      </div>
      <div class="arag-card">
        <div class="head"><h3>The pipeline</h3></div>
        <div class="body">
          <ol class="arag-steps">
            ${s.extraction.stages.map((st) => `<li class="ok"><span class="ic"></span><span>${esc(st)}</span><span class="meta"></span></li>`).join("")}
          </ol>
          <p class="muted small" style="margin-top:12px">Every stage is soft: if one fails the run continues with the best record it has, and the failure is reported on the record rather than hidden.</p>
        </div>
      </div>
    </div>`;
}

function branding(panel, s) {
  const b = s.branding;
  const row = (name, value, variable) =>
    `<dt>${esc(name)}<br /><span class="mono small subtle">${esc(variable)}</span></dt><dd>${value}</dd>`;
  panel.innerHTML = `
    <div class="dip-split">
      <div class="arag-card">
        <div class="head"><h3>Effective values</h3></div>
        <div class="body">
          <dl class="arag-kv">
            ${row("Product name", esc(b.productName), "BRAND_PRODUCT_NAME")}
            ${row("Tagline", esc(b.tagline || "—"), "BRAND_TAGLINE")}
            ${row("Logo", b.logoUrl ? `<span class="mono small">${esc(b.logoUrl)}</span>` : "Default wordmark", "BRAND_LOGO_URL")}
            ${row("Primary colour", b.primaryColor ? `<span class="dip-swatch" style="background:${esc(b.primaryColor)}"></span><span class="mono">${esc(b.primaryColor)}</span>` : "Kit default", "BRAND_PRIMARY_COLOR")}
            ${row("Accent colour", b.accentColor ? `<span class="dip-swatch" style="background:${esc(b.accentColor)}"></span><span class="mono">${esc(b.accentColor)}</span>` : "Kit default", "BRAND_ACCENT_COLOR")}
            ${row("Powered-by credit", b.poweredBy ? "Shown" : "Hidden", "BRAND_POWERED_BY")}
            ${row("Footer", esc(b.footerText || "Open source · Apache-2.0"), "BRAND_FOOTER_TEXT")}
            ${row("Docs URL", esc(b.docsUrl || "—"), "BRAND_DOCS_URL")}
            ${row("Support URL", esc(b.supportUrl || "—"), "BRAND_SUPPORT_URL")}
          </dl>
          <p class="muted small" style="margin-top:12px">Read-only: branding is environment configuration, so a form that appeared to save would be a lie. Assets are read from <span class="mono">DATA_DIR/branding</span> and served from <span class="mono">/branding/</span>. Changes need a restart.</p>
        </div>
      </div>
      <div class="arag-card">
        <div class="head"><h3>Preview</h3></div>
        <div class="body">
          <div class="arag-band" style="border-radius:var(--arag-radius);border-bottom:2px solid var(--dip-progress-green)">
            <div class="arag-container" style="max-width:none;padding:0 12px">
              <span class="brand"><img src="/brand/arag-logo-alt.svg" alt="" style="height:16px" /></span>
            </div>
          </div>
          <div class="dip-brandmark" style="padding:12px 0">
            <span class="dip-brandmark__stack">
              <img src="${esc(b.logoUrl || "/brand/arag-logo.svg")}" alt="" style="height:20px" />
              <span class="dip-brandmark__name">${esc(b.productName)}</span>
            </span>
          </div>
          <div class="arag-row" style="margin:12px 0">
            <button class="arag-btn" type="button">Primary</button>
            <button class="arag-btn secondary" type="button">Secondary</button>
          </div>
          <div class="dip-chips">
            <span class="arag-chip ok">Ready</span><span class="arag-chip warn">Degraded</span>
            <span class="arag-chip danger">Failed</span><span class="arag-chip info">Processing</span>
          </div>
          <p class="muted small" style="margin-top:12px">Status, verification and grounding colours are never branded: a partner may recolour their product, but not the evidence.</p>
        </div>
      </div>
    </div>`;
}

function apiTab(panel, s, stats) {
  panel.innerHTML = `
    <div class="arag-stack">
      <div class="dip-statstrip">
        <div class="arag-kpi"><div class="label">Documents</div><div class="value">${stats?.documents.total ?? "—"}</div><div class="sub">${stats?.documents.ready ?? 0} ready</div></div>
        <div class="arag-kpi"><div class="label">Fields extracted</div><div class="value">${stats?.fields ?? "—"}</div><div class="sub">across every record</div></div>
        <div class="arag-kpi"><div class="label">Open issues</div><div class="value">${stats?.issues ?? "—"}</div><div class="sub">validation findings</div></div>
        <div class="arag-kpi"><div class="label">Jobs run</div><div class="value">${(stats?.jobs.succeeded ?? 0) + (stats?.jobs.failed ?? 0)}</div><div class="sub">${stats?.jobs.failed ?? 0} failed</div></div>
      </div>
      <div class="arag-card">
        <div class="head"><h3>API reference</h3></div>
        <div class="body">
          <p class="muted dip-prose">Everything on these screens is also a documented <span class="mono">/api/v1</span> endpoint behind an OpenAPI 3.1 contract — there is no UI-only capability.</p>
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
            <dt>API keys</dt><dd>${s.security.apiKeysEnforced ? "Enforced — send <span class='mono'>X-API-Key</span> or a bearer token" : "Not enforced — reads and uploads are open"}</dd>
            <dt>Session cookie</dt><dd>12 h, SameSite=Lax, HttpOnly, from <span class="mono">POST /api/v1/session</span></dd>
            <dt>Writes</dt><dd>Deletes and config creation always require a credential, even when API keys are not enforced</dd>
            <dt>Admin</dt><dd>${s.security.adminEnabled ? '<a href="/admin/">Admin panel ›</a>' : "Disabled — set ADMIN_TOKEN to enable it"}</dd>
          </dl>
          <p class="muted small" style="margin-top:12px">API keys are set with the <span class="mono">API_KEYS</span> environment variable; there is no key store to create or revoke one from.</p>
        </div>
      </div>
      <div class="arag-card">
        <div class="head"><h3>Guided sample</h3></div>
        <div class="body">
          <p class="muted">Walk the product with a supplier invoice whose totals deliberately do not reconcile, so the validation and evidence surfaces have something real to show.</p>
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
            <dt class="mono">g then d/c/a/j/s</dt><dd>Jump to ${esc(label("documents"))}, Configs, Ask, Jobs or Settings</dd>
          </dl>
        </div>
      </div>
    </div>`;
}
