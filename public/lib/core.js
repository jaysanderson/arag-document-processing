/**
 * Shared front-end core for both apps (operator and admin).
 *
 * Contains the hash router, the app shell, the overlay primitives (drawer, confirm,
 * menu, popover), the icon set and the formatting helpers. Everything talks to the
 * product through `/api/v1` only — there are no secrets in the browser.
 *
 * Deliberately framework-free and dependency-free (TEAM-BRIEF hard rule 8): plain ES
 * modules, `innerHTML` with an escaping helper, and native DOM events.
 */
import { api, applyBranding, esc, sse, toast } from "/ui/arag-ui.js";

export { api, applyBranding, esc, sse, toast };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ── icons ────────────────────────────────────────────────────────────────────
// Inline SVG only: no icon font, no emoji, no sprites. 1.5 stroke, currentColor, so an
// icon inherits whatever colour the component it sits in has decided on.
const PATHS = {
  document: "M6 2h6l4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z M12 2v4h4",
  upload: "M10 13V3 M6.5 6.5 10 3l3.5 3.5 M3 13v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2",
  search: "M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12Z M13.5 13.5 17 17",
  filter: "M3 4h14l-5.5 6.5V16L8.5 14v-3.5L3 4Z",
  sort: "M10 4v12 M6 12l4 4 4-4",
  "chevron-down": "m5 7.5 5 5 5-5",
  "chevron-right": "m7.5 5 5 5-5 5",
  check: "m4 10.5 4 4 8-9",
  "alert-triangle": "M10 3.5 18 16.5H2L10 3.5Z M10 8v3.5 M10 14h.01",
  "x-circle": "M10 17A7 7 0 1 0 10 3a7 7 0 0 0 0 14Z M7.5 7.5l5 5 M12.5 7.5l-5 5",
  quote: "M7 5v5H4a3 3 0 0 1 3-5Z M16 5v5h-3a3 3 0 0 1 3-5Z M4 10v2a3 3 0 0 0 3 3 M13 10v2a3 3 0 0 0 3 3",
  "external-link": "M11 3h6v6 M17 3l-8 8 M15 12v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4",
  download: "M10 3v10 M6.5 9.5 10 13l3.5-3.5 M3 15v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1",
  trash: "M3.5 5.5h13 M8 5.5V3.5h4v2 M5.5 5.5 6.5 17h7l1-11.5 M8.5 8.5v6 M11.5 8.5v6",
  refresh: "M17 10a7 7 0 1 1-2.05-4.95 M17 3v4h-4",
  settings:
    "M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M16.5 10a6.5 6.5 0 0 0-.1-1.1l1.4-1.1-1.5-2.6-1.7.6a6.5 6.5 0 0 0-1.9-1.1L12.4 3H9.6l-.3 1.7a6.5 6.5 0 0 0-1.9 1.1l-1.7-.6-1.5 2.6 1.4 1.1a6.5 6.5 0 0 0 0 2.2l-1.4 1.1 1.5 2.6 1.7-.6c.6.5 1.2.8 1.9 1.1l.3 1.7h2.8l.3-1.7c.7-.3 1.3-.6 1.9-1.1l1.7.6 1.5-2.6-1.4-1.1c.06-.36.1-.73.1-1.1Z",
  clock: "M10 17A7 7 0 1 0 10 3a7 7 0 0 0 0 14Z M10 6v4.5l3 1.8",
  menu: "M3 5h14 M3 10h14 M3 15h14",
  plus: "M10 4v12 M4 10h12",
  x: "m5 5 10 10 M15 5 5 15",
  info: "M10 17A7 7 0 1 0 10 3a7 7 0 0 0 0 14Z M10 9v5 M10 6.4h.01",
  key: "M12.5 3a4.5 4.5 0 0 1 1.6 8.7L13 13H10v2H8v2H4v-3l5.3-5.3A4.5 4.5 0 0 1 12.5 3Z M13.8 6.2h.01",
  plug: "M7 3v5 M13 3v5 M4.5 8h11v2a5.5 5.5 0 0 1-11 0V8Z M10 15.5V18",
  chart: "M4 16V9 M8.5 16V4 M13 16v-5 M17 16h-14",
  play: "M7 4.5 15 10l-8 5.5v-11Z",
  layers: "M10 3 3 6.5 10 10l7-3.5L10 3Z M3 13.5 10 17l7-3.5 M3 10 10 13.5 17 10",
};

/** Inline SVG for `name`. Decorative by default; pass a label to make it announced. */
export function icon(name, { size = 16, cls = "", label = "" } = {}) {
  const d = PATHS[name] ?? PATHS.document;
  const a = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return `<svg ${a} class="${esc(cls)}" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

// ── formatting ───────────────────────────────────────────────────────────────
export const fmtBytes = (n) =>
  n == null
    ? "—"
    : n < 1024
      ? `${n} B`
      : n < 1048576
        ? `${(n / 1024).toFixed(0)} KB`
        : `${(n / 1048576).toFixed(1)} MB`;

export function fmtMs(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}

const RELATIVE = [
  [60, "second", 1],
  [3600, "minute", 60],
  [86400, "hour", 3600],
  [2592000, "day", 86400],
];

/** "3 min ago" — with the absolute timestamp always available in a `title`. */
export function fmtRelative(iso) {
  if (!iso) return "—";
  const secs = (Date.now() - Date.parse(iso)) / 1000;
  if (secs < 45) return "just now";
  for (const [limit, unit, div] of RELATIVE) {
    if (secs < limit) {
      const n = Math.round(secs / div);
      return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
    }
  }
  return new Date(iso).toLocaleDateString();
}

export const fmtAbsolute = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

/** `purchase_order` → `Purchase order`. Sentence case, never Title Case (§7.1). */
export function label(value) {
  const s = String(value ?? "").replace(/_/g, " ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

export const pct = (n) => (typeof n === "number" ? `${Math.round(n * 100)}%` : "—");

/** Shorten an opaque id for display without losing its ends. */
export const shortId = (id) => (!id ? "—" : id.length <= 12 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`);

// ── document helpers ─────────────────────────────────────────────────────────
const IDENTIFIER_KEYS = [
  "invoice_number",
  "po_number",
  "claim_number",
  "authorisation_number",
  "receipt_number",
  "statement_period",
  "reference",
  "title",
  "full_name",
];
const PARTY_KEYS = [
  "vendor_name",
  "vendor",
  "supplier",
  "merchant",
  "merchant_name",
  "scheme",
  "insurer",
  "bank_name",
  "buyer",
  "parties",
  "employer",
];

const flat = (v) => (Array.isArray(v) ? v.filter(Boolean).join(", ") : v == null ? "" : String(v));

/**
 * What a person calls this document. A scanner's `scan-0041.pdf` says nothing;
 * `INV-2026-1188 · Globex Supply Co` says everything, and it is already in the record.
 */
export function headline(doc) {
  const by = new Map((doc.fields ?? []).map((f) => [f.key, f]));
  const pick = (keys) => {
    for (const k of keys) {
      const v = flat(by.get(k)?.value).trim();
      if (v) return v;
    }
    return "";
  };
  return { identifier: pick(IDENTIFIER_KEYS), counterparty: pick(PARTY_KEYS) };
}

/** The five product states over the API's four (§4.1): `ready` covers two situations. */
export function docState(doc) {
  if (doc.status === "ready" && (doc.meta?.stageErrors ?? []).length) return "degraded";
  return doc.status;
}

const STATE_CHIP = {
  pending: ["Queued", "neutral"],
  processing: ["Processing", "info"],
  ready: ["Ready", "ok"],
  degraded: ["Degraded", "warn"],
  failed: ["Failed", "danger"],
};

export function statusChip(doc) {
  const [text, cls] = STATE_CHIP[docState(doc)] ?? ["Unknown", "neutral"];
  return `<span class="arag-chip ${cls}">${text}</span>`;
}

const JOB_CHIP = {
  queued: ["Queued", "neutral"],
  running: ["Running", "info"],
  succeeded: ["Succeeded", "ok"],
  failed: ["Failed", "danger"],
  cancelled: ["Cancelled", "warn"],
};
export function jobChip(status) {
  const [text, cls] = JOB_CHIP[status] ?? [status, "neutral"];
  return `<span class="arag-chip ${cls}">${esc(text)}</span>`;
}

/** Advice for a failed document, keyed to the failure class (§4.1). */
export function failureAdvice(message = "") {
  const m = message.toLowerCase();
  if (/unreachable|econn|network|timed? ?out after|5\d\d/.test(m) && /arag|knowledge|request/.test(m))
    return "The Knowledge Box did not respond. Check Settings → Connection, then reprocess.";
  if (/never became|not processed|searchable|timed out/.test(m))
    return "Progress Agentic RAG did not finish reading this file in time. Large scans can need a second attempt.";
  if (/unsupported|content type|no text|empty/.test(m))
    return "This file could not be read. Check it opens, and that it is one of the accepted types.";
  if (/too large|payload/.test(m)) return "This file is larger than the limit for this deployment.";
  if (/cancel/.test(m)) return "Processing was cancelled. Reprocess to run it again.";
  return "Processing failed. The job's timeline shows which stage stopped.";
}

// ── evidence ─────────────────────────────────────────────────────────────────
export const VERIFY = {
  exact: { text: "Verified", cls: "ok" },
  normalised: { text: "Near match", cls: "warn" },
  unverified: { text: "Quote not found", cls: "danger" },
  none: { text: "No quote returned", cls: "danger" },
};

export const verifyOf = (ev) => (ev ? (VERIFY[ev.verified] ?? VERIFY.none) : VERIFY.none);

// ── hash router ──────────────────────────────────────────────────────────────
/**
 * Hash routing, not path routing: the platform's static file server has no SPA fallback,
 * so `/documents/abc` would answer a 404 problem document rather than the app, and the
 * admin app is served from a sub-path where hash routes need no base configuration.
 * Filters live in the hash query string, so a filtered queue is a shareable link.
 */
export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  const query = {};
  for (const [k, v] of new URLSearchParams(qs ?? "")) {
    if (k in query) query[k] = [].concat(query[k], v);
    else query[k] = v;
  }
  return { path: path.replace(/\/+$/, "") || "/", query, raw };
}

export function buildHash(path, query = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    for (const one of [].concat(v)) qs.append(k, one);
  }
  const s = qs.toString();
  return `#${path}${s ? `?${s}` : ""}`;
}

export function navigate(path, query = {}, { replace = false } = {}) {
  const target = buildHash(path, query);
  if (replace) history.replaceState(null, "", target);
  else location.hash = target;
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/**
 * Route table: `[pattern, handler]` where a pattern segment starting with `:` binds a
 * parameter. First match wins, so order the table from most to least specific.
 */
/**
 * Teardown registered by a screen for whatever it started — a poll timer, an SSE stream —
 * and run by the router before the next screen renders. Without it a document left open
 * while its pipeline runs keeps a stream alive for the rest of the session.
 */
const leavers = new Set();

export function onLeave(fn) {
  leavers.add(fn);
}

export function runLeavers() {
  for (const fn of leavers) {
    try {
      fn();
    } catch {
      /* a broken teardown must not stop the next screen rendering */
    }
  }
  leavers.clear();
}

export function createRouter(routes, { fallback } = {}) {
  const compiled = routes.map(([pattern, handler]) => ({
    parts: pattern.split("/").filter(Boolean),
    pattern,
    handler,
  }));
  let token = 0;
  async function run() {
    const { path, query } = parseHash();
    const parts = path.split("/").filter(Boolean);
    for (const route of compiled) {
      if (route.parts.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < route.parts.length; i++) {
        const p = route.parts[i];
        if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(parts[i]);
        else if (p !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const mine = ++token;
      runLeavers();
      // A slow render must never paint over a newer navigation.
      await route.handler({ params, query, path, stale: () => mine !== token });
      return;
    }
    runLeavers();
    await fallback?.({ path, query });
  }
  window.addEventListener("hashchange", () => {
    run().catch((err) => toast(err.message, "error"));
  });
  return { run: () => run().catch((err) => toast(err.message, "error")) };
}

// ── app shell ────────────────────────────────────────────────────────────────
/**
 * Renders the two-band shell: a Progress brand band and a left sidebar holding the
 * wordmark, the primary navigation and a connection pill. `<arag-shell>` is deliberately
 * not used — it lays out a centred container with a horizontal nav, which is the
 * single-page shape this pass replaces — but the kit's `applyBranding()` still drives
 * every brand-dependent element, so `BRAND_*` overrides keep working.
 */
export function renderShell(root, opts) {
  const { productName, tagline, nav, bandLinks, ariaLabel = "Main" } = opts;
  root.innerHTML = `
    <a class="dip-skip" href="#main">Skip to content</a>
    <div class="dip-app">
      <div class="arag-band" data-powered-by>
        <div class="arag-container">
          <span class="brand dip-bandmark">
            <img src="/brand/arag-logo-alt.svg" alt="Progress Agentic RAG" />
          </span>
          <span class="band-actions">
            <button class="arag-btn ghost sm dip-navtoggle" type="button" aria-label="Show navigation"
                    aria-expanded="false" style="color:#fff;border-color:rgba(255,255,255,.3)">${icon("menu")}</button>
            ${bandLinks
              .map(
                (l) =>
                  `<a class="arag-btn ghost sm" style="color:#fff;border-color:rgba(255,255,255,.3)" href="${esc(l.href)}"${l.dataAttr ?? ""}>${esc(l.label)}</a>`,
              )
              .join("")}
          </span>
        </div>
      </div>
      <div class="dip-app__body">
        <aside class="dip-sidebar" id="sidebar">
          <a class="dip-brandmark" href="${esc(nav[0].href)}">
            <span class="dip-brandmark__stack">
              <img data-brand-logo src="/brand/arag-logo.svg" alt="Progress Agentic RAG" />
              <span class="dip-brandmark__name" data-brand-name>${esc(productName)}</span>
            </span>
          </a>
          <nav class="dip-sidenav" aria-label="${esc(ariaLabel)}">
            ${nav
              .map(
                (
                  n,
                ) => `<a href="${esc(n.href)}" data-nav="${esc(n.key)}">${icon(n.icon, { size: 18 })}<span>${esc(n.label)}</span>
                  <span class="dip-sidenav__badge" data-badge="${esc(n.key)}" hidden></span></a>`,
              )
              .join("")}
          </nav>
          <div class="dip-sidebar__foot">
            <arag-status endpoint="/readyz" label="Knowledge Box"></arag-status>
            <span data-brand-tagline>${esc(tagline)}</span>
            <span data-brand-footer data-powered-by-credit>Built on Progress Agentic RAG</span>
          </div>
        </aside>
        <main class="dip-content" id="main" tabindex="-1"></main>
      </div>
    </div>
    <div class="sr-only" id="liveRegion" role="status" aria-live="polite"></div>`;

  const sidebar = $("#sidebar", root);
  const toggle = $(".dip-navtoggle", root);
  toggle.addEventListener("click", () => {
    const open = sidebar.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  window.addEventListener("hashchange", () => sidebar.classList.remove("is-open"));
  return $("#main", root);
}

/** Mark the active nav item with `aria-current`, not merely a class (accessibility). */
export function setActiveNav(key) {
  for (const a of $$("[data-nav]")) {
    if (a.dataset.nav === key) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

export function setNavBadge(key, value, { title } = {}) {
  const el = document.querySelector(`[data-badge="${key}"]`);
  if (!el) return;
  const show = Number(value) > 0;
  el.hidden = !show;
  el.textContent = show ? String(value) : "";
  if (title) el.title = title;
}

/**
 * Branding beyond what the kit's `applyBranding()` covers: the kit targets
 * `<arag-shell>`'s own hooks, and this shell is not that element. A partner logo replaces
 * the wordmark; a broken one falls back to the product name rather than an empty header.
 */
export function applyShellBranding(b) {
  // Also reachable as `window.dipApplyBranding` so the white-label e2e spec can apply a
  // partner payload the way the shell does at boot, without importing a module by URL.
  if (!b) return;
  applyBranding(b);
  const name = document.querySelector("[data-brand-name]");
  if (name && b.productName) name.textContent = b.productName;
  const tag = document.querySelector("[data-brand-tagline]");
  if (tag) tag.textContent = b.tagline || "";
  const logo = document.querySelector("[data-brand-logo]");
  if (logo && b.logoUrl) {
    logo.src = b.logoUrl;
    logo.alt = b.productName || "";
    logo.addEventListener("error", () => {
      logo.hidden = true;
    });
  }
  if (b.footerText) {
    const foot = document.querySelector("[data-brand-footer]");
    if (foot) foot.textContent = b.footerText;
  }
  if (b.poweredBy === false) {
    // The band is the Progress signature; a partner may switch it off entirely.
    for (const el of $$("[data-powered-by], [data-powered-by-credit]")) el.hidden = true;
    document.documentElement.style.setProperty("--dip-band-h", "0px");
  }
  for (const l of $$("[data-docs-link]")) if (b.docsUrl) l.href = b.docsUrl;
  if (b.productName) document.title = `${b.productName} · ${document.title.split("·").pop().trim()}`;
}

// ── overlays ─────────────────────────────────────────────────────────────────
let openOverlay = null;

function trapFocus(container) {
  const onKey = (e) => {
    if (e.key !== "Tab") return;
    const items = $$(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      container,
    ).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  container.addEventListener("keydown", onKey);
}

/**
 * Right-hand inspector. Because drawers are routes, `onClose` is what pops the hash —
 * so Back closes the drawer and the browser's history stays honest.
 */
export function openDrawer({ title, body, foot = "", wide = false, onClose }) {
  closeOverlay();
  const host = document.createElement("div");
  host.innerHTML = `
    <div class="dip-drawer__scrim" data-close></div>
    <aside class="dip-drawer${wide ? " dip-drawer--wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
      <header class="dip-drawer__head">
        <h2 id="drawerTitle" tabindex="-1">${title}</h2>
        <button class="arag-btn ghost sm" type="button" data-close aria-label="Close">${icon("x")}</button>
      </header>
      <div class="dip-drawer__body">${body}</div>
      ${foot ? `<footer class="dip-drawer__foot">${foot}</footer>` : ""}
    </aside>`;
  document.body.appendChild(host);
  const el = $(".dip-drawer", host);
  requestAnimationFrame(() => el.classList.add("is-open"));
  const trigger = document.activeElement;
  $("#drawerTitle", host).focus();
  trapFocus(el);
  const close = () => {
    host.remove();
    openOverlay = null;
    trigger?.focus?.();
    onClose?.();
  };
  for (const b of $$("[data-close]", host)) b.addEventListener("click", close);
  openOverlay = { close, el: host };
  return { host, close };
}

/** Confirmation for anything destructive. Focus starts on Cancel, never on the verb. */
export function confirmDialog({ title, body, confirmLabel = "Delete", typed = null, danger = true }) {
  return new Promise((resolve) => {
    closeOverlay();
    const host = document.createElement("div");
    host.className = "arag-modal-backdrop";
    host.innerHTML = `
      <div class="arag-modal dip-confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmBody">
        <div class="head"><h2 id="confirmTitle" tabindex="-1">${title}</h2></div>
        <div class="dip-confirm__body" id="confirmBody">${body}
          ${
            typed
              ? `<div class="arag-field" style="margin-top:12px">
                   <label for="typedConfirm">Type <code>${esc(typed)}</code> to confirm</label>
                   <input class="arag-input" id="typedConfirm" autocomplete="off" />
                 </div>`
              : ""
          }
        </div>
        <div class="dip-confirm__foot">
          <button class="arag-btn ghost" type="button" data-cancel>Cancel</button>
          <button class="arag-btn${danger ? " danger" : ""}" type="button" data-ok${typed ? " disabled" : ""}>${esc(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(host);
    const trigger = document.activeElement;
    const ok = $("[data-ok]", host);
    const done = (value) => {
      host.remove();
      openOverlay = null;
      trigger?.focus?.();
      resolve(value);
    };
    if (typed) {
      const input = $("#typedConfirm", host);
      input.addEventListener("input", () => {
        ok.disabled = input.value.trim() !== typed;
      });
    }
    $("[data-cancel]", host).addEventListener("click", () => done(false));
    ok.addEventListener("click", () => done(true));
    host.addEventListener("click", (e) => {
      if (e.target === host) done(false);
    });
    trapFocus(host);
    $("[data-cancel]", host).focus();
    openOverlay = { close: () => done(false), el: host };
  });
}

export function closeOverlay() {
  openOverlay?.close();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeOverlay();
});

// ── row-actions menu ─────────────────────────────────────────────────────────
/**
 * `items` is `[{ label, onSelect, danger, hidden }]`. The trigger carries the object's
 * name in its accessible label, so twenty identical `⋯` buttons are still distinguishable.
 */
export function menuButton(itemsFactory, { ariaLabel }) {
  const wrap = document.createElement("div");
  wrap.className = "dip-menu";
  wrap.innerHTML = `<button class="dip-menu__trigger" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(ariaLabel)}">⋯</button>`;
  const trigger = wrap.firstElementChild;
  let list = null;
  const close = () => {
    list?.remove();
    list = null;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onOutside, true);
  };
  const onOutside = (e) => {
    if (!wrap.contains(e.target)) close();
  };
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (list) return close();
    list = document.createElement("div");
    list.className = "dip-menu__list";
    list.setAttribute("role", "menu");
    for (const item of itemsFactory().filter((i) => i && !i.hidden)) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      if (item.danger) b.className = "danger";
      b.textContent = item.label;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        close();
        item.onSelect();
      });
      list.appendChild(b);
    }
    wrap.appendChild(list);
    trigger.setAttribute("aria-expanded", "true");
    list.querySelector("button")?.focus();
    document.addEventListener("click", onOutside, true);
    list.addEventListener("keydown", (ev) => {
      const buttons = [...list.querySelectorAll("button")];
      const i = buttons.indexOf(document.activeElement);
      if (ev.key === "ArrowDown") buttons[(i + 1) % buttons.length].focus();
      if (ev.key === "ArrowUp") buttons[(i - 1 + buttons.length) % buttons.length].focus();
      if (ev.key === "Escape") {
        close();
        trigger.focus();
      }
    });
  });
  return wrap;
}

/** A small explanatory popover, opened from a `What is this?` button. */
export function popover(anchor, html) {
  const existing = document.querySelector(".dip-popover");
  existing?.remove();
  if (existing?.dataset.for === anchor.id) return;
  const el = document.createElement("div");
  el.className = "dip-popover";
  el.dataset.for = anchor.id;
  el.innerHTML = html;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  el.style.top = `${window.scrollY + r.bottom + 6}px`;
  el.style.left = `${Math.max(8, Math.min(window.scrollX + r.left - 160, window.innerWidth - el.offsetWidth - 8))}px`;
  setTimeout(() => {
    document.addEventListener("click", function once(e) {
      if (!el.contains(e.target)) {
        el.remove();
        document.removeEventListener("click", once);
      }
    });
  }, 0);
}

// ── small render helpers ─────────────────────────────────────────────────────
export const skeletonRows = (n = 6) =>
  `<div aria-busy="true">${Array.from({ length: n }, () => '<div class="dip-skeleton dip-skeleton--row" aria-hidden="true"></div>').join("")}</div>`;

export function emptyState({ iconName = "document", title, body = "", actions = "" }) {
  return `<div class="dip-emptystate">${icon(iconName, { size: 24, cls: "dip-emptystate__icon" })}
    <h2>${esc(title)}</h2>${body ? `<p>${esc(body)}</p>` : ""}
    ${actions ? `<div class="dip-emptystate__actions">${actions}</div>` : ""}</div>`;
}

/** What happened · what it affects · what to do (§4.5), with the code behind a disclosure. */
export function errorState(err, { retry = "" } = {}) {
  const detail = err?.problem?.detail || err?.message || "The service did not respond.";
  const code = err?.status ? `HTTP ${err.status}` : "";
  const rid = err?.problem?.requestId ? ` · request ${esc(err.problem.requestId)}` : "";
  return `<div class="arag-alert error dip-prose" role="alert">
      <div>${esc(detail)}</div>
      ${retry ? `<div style="margin-top:8px">${retry}</div>` : ""}
      ${code ? `<details style="margin-top:8px"><summary class="small">Details</summary><span class="small mono">${esc(code)}${rid}</span></details>` : ""}
    </div>`;
}

export function announce(message) {
  const region = document.getElementById("liveRegion");
  if (!region) return;
  region.textContent = message;
}

/** Download a response body the browser would otherwise render in place. */
export async function downloadResponse(res, fallbackName) {
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return name;
}

window.dipApplyBranding = applyShellBranding;
