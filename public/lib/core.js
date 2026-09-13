/**
 * Shared front-end core for both apps (operator and admin).
 *
 * Since platform kit v0.2.0 the generic application chrome — the left-rail shell, the
 * overlays (drawer, confirm, menu, popover, tour), the table/tab/segmented behaviours, the
 * icon set, the render helpers and the formatters — lives in the kit. This module is now
 * only two things: a thin re-export of the kit surface the views import, and the handful of
 * helpers that are genuinely this product's (the document/evidence vocabulary and the hash
 * router).
 *
 * Everything talks to the product through `/api/v1` only — there are no secrets in the
 * browser. Deliberately framework-free and dependency-free (TEAM-BRIEF hard rule 8): plain
 * ES modules, `innerHTML` with an escaping helper, and native DOM events.
 */
import {
  announce,
  api,
  applyBranding,
  closeOverlay,
  confirmDialog,
  emptyState,
  errorState,
  esc,
  filterRows,
  fmtBytes,
  fmtMs,
  fmtRelative,
  iconNames,
  icon as kitIcon,
  menuButton,
  nextSort,
  openDrawer,
  paginate,
  popover,
  skeletonRows,
  snippet,
  sortRows,
  sse,
  toast,
  tour,
  wireCopy,
  wireSegmented,
  wireTable,
  wireTabs,
} from "/ui/arag-ui.js";

export {
  announce,
  api,
  applyBranding,
  closeOverlay,
  confirmDialog,
  emptyState,
  errorState,
  esc,
  filterRows,
  fmtBytes,
  fmtMs,
  fmtRelative,
  menuButton,
  nextSort,
  openDrawer,
  paginate,
  popover,
  skeletonRows,
  snippet,
  sortRows,
  sse,
  toast,
  tour,
  wireCopy,
  wireSegmented,
  wireTable,
  wireTabs,
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ── icons ────────────────────────────────────────────────────────────────────
/**
 * The kit's 35-icon core set covers everything this product draws except the one glyph the
 * evidence vocabulary needs: a quotation mark for Ask and for a citation. `icon()` renders
 * nothing for a name it does not know, so the product map is consulted first and the kit
 * answers everything else. Same convention as the kit: one 20×20 grid, `currentColor`,
 * stroke width scaled with render size, no icon font and no emoji.
 */
const PRODUCT_ICONS = {
  quote: "M7 5v5H4a3 3 0 0 1 3-5Z M16 5v5h-3a3 3 0 0 1 3-5Z M4 10v2a3 3 0 0 0 3 3 M13 10v2a3 3 0 0 0 3 3",
};

const STROKE = (size) => (size <= 14 ? 1.7 : size <= 20 ? 1.5 : size <= 24 ? 1.4 : 1.25);

export function icon(name, { size = 16, cls = "", label: ariaLabel = "" } = {}) {
  const d = PRODUCT_ICONS[name];
  if (!d) return kitIcon(name, { size, cls, label: ariaLabel });
  const a = ariaLabel ? `role="img" aria-label="${esc(ariaLabel)}"` : 'aria-hidden="true" focusable="false"';
  return (
    `<svg ${a} class="arag-icon${cls ? ` ${esc(cls)}` : ""}" width="${size}" height="${size}" ` +
    `viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${STROKE(size)}" ` +
    `stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`
  );
}

/** Names this product draws itself, for the shell adapter below. */
const isProductIcon = (name) => name in PRODUCT_ICONS;

export { iconNames };

// ── formatting ───────────────────────────────────────────────────────────────
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

/**
 * Route table: `[pattern, handler]` where a pattern segment starting with `:` binds a
 * parameter. First match wins, so order the table from most to least specific.
 */
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
 * Mount the kit's `<arag-app-shell>` and return its content host.
 *
 * `nav` is `[{ key, label, href, icon }]` — the same table both apps already kept — which
 * is serialised into the element's `nav` attribute grammar (`Label=href=icon`, `--Group`).
 *
 * Two small adapters sit on top of the element, both because this product is hash-routed
 * (DP-32) and the kit's rail assumes path routing. Neither touches `vendor/`:
 *
 *  1. `setActivePath()` is overridden. The kit's `activeNavHref()` splits an href on `#`
 *     before matching, so every `#/documents`-style href collapses to `/` and the first
 *     rail item would always be the current one. The override does the same longest-prefix
 *     match over the hash path instead, and ignores the `location.pathname` the element's
 *     own popstate/hashchange/click handlers pass in.
 *  2. Nav icons the kit does not ship (`quote`) are injected after the rail renders, since
 *     the kit's `icon()` deliberately renders nothing for an unknown name.
 */
export function mountShell(root, { productName, tagline, nav, docsHref = "/api/v1/docs", bandLink }) {
  root.innerHTML = "";
  const shell = document.createElement("arag-app-shell");
  shell.setAttribute("product", productName);
  shell.setAttribute("tagline", tagline ?? "");
  shell.setAttribute("nav", nav.map((n) => `${n.label}=${n.href}=${n.icon ?? ""}`).join(","));
  shell.setAttribute("docs-href", docsHref);
  shell.setAttribute("home-href", nav[0].href);
  shell.setAttribute("status-endpoint", "/readyz");
  shell.setAttribute("rail", "light");
  // The product applies the branding payload itself (both apps read it once at boot, and
  // the admin app rewrites the name), so the shell must not race it with its own fetch.
  shell.setAttribute("branding-src", "none");
  shell.setAttribute("collapsible", "");
  root.appendChild(shell);

  for (const a of $$(".arag-railnav a[data-nav]", shell)) {
    const item = nav.find((n) => n.label === a.dataset.nav);
    if (item && isProductIcon(item.icon) && !a.querySelector("svg"))
      a.insertAdjacentHTML("afterbegin", icon(item.icon, { size: 18 }));
  }

  // The band's second link is "Admin" in the kit; the operator app's is "Open app". One
  // label, rewritten after render rather than by forking the element.
  if (bandLink) {
    const band = $(".arag-appband", shell);
    const a = document.createElement("a");
    a.href = bandLink.href;
    a.textContent = bandLink.label;
    band.appendChild(a);
  }

  const byKey = new Map(nav.map((n) => [n.key, n]));
  const hashPath = (h) =>
    String(h ?? "")
      .replace(/^#/, "")
      .split("?")[0]
      .replace(/\/+$/, "") || "/";
  shell.setActivePath = (path) => {
    const p = hashPath(typeof path === "string" && path.startsWith("#") ? path : location.hash);
    let best = null;
    for (const a of $$(".arag-railnav a[href]", shell)) {
      const h = hashPath(a.getAttribute("href"));
      const hit = h === p || (h !== "/" && p.startsWith(`${h}/`));
      if (hit && (!best || h.length > best.len)) best = { a, len: h.length };
      a.removeAttribute("aria-current");
    }
    best?.a.setAttribute("aria-current", "page");
  };
  shell.setActivePath();

  return {
    shell,
    main: $('[data-slot="content"]', shell),
    /** Mark the rail item for `key` current — the router calls this after every render. */
    setActiveNav: (key) => shell.setActivePath(byKey.get(key)?.href),
    setNavBadge: (key, value, { title } = {}) => {
      const item = byKey.get(key);
      if (!item) return;
      shell.setNavBadge(item.label, value);
      // The explanatory title belongs on the badge, not on the anchor: the kit puts the
      // item's own label in the anchor's `title`, and overwriting that would rename the
      // link for a screen reader ("Jobs" becoming "queued and running jobs").
      if (title) $(`[data-nav="${CSS.escape(item.label)}"] .count`, shell)?.setAttribute("title", title);
    },
  };
}

/**
 * A partner mark that 404s must hide itself rather than leave a torn icon above the product
 * name. The kit's `applyBranding()` sets `src`/`alt`/`hidden` on `[data-brand-logo]` but has
 * nothing to say about a broken URL, so this one capture-phase listener covers every shell.
 */
document.addEventListener(
  "error",
  (e) => {
    const el = e.target;
    if (el instanceof HTMLImageElement && el.hasAttribute("data-brand-logo")) el.hidden = true;
  },
  true,
);

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

// The white-label e2e spec applies a partner payload the way the app does at boot, without
// importing a module by URL. It is the kit's hook now, not a local re-implementation.
window.dipApplyBranding = applyBranding;
