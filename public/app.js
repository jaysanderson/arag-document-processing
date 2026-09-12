/**
 * Document Processing — operator app.
 *
 * A hash-routed static SPA that talks only to `/api/v1`; there are no secrets in the
 * browser. Hash routing rather than path routing because the platform's static file
 * server has no SPA fallback: `/documents/abc` would answer a 404 problem document rather
 * than the app.
 */
import {
  $,
  api,
  applyShellBranding,
  buildHash,
  createRouter,
  esc,
  navigate,
  parseHash,
  renderShell,
  setActiveNav,
  setNavBadge,
} from "./lib/core.js";
import { renderAsk } from "./views/ask.js";
import { renderConfigBuilder, renderConfigDetail, renderConfigs } from "./views/configs.js";
import { renderDocument } from "./views/document.js";
import { renderDocuments, renderUpload } from "./views/documents.js";
import { renderJobDetail, renderJobs } from "./views/jobs.js";
import { renderSettings } from "./views/settings.js";
import { renderWelcome } from "./views/welcome.js";

const NAV = [
  { key: "documents", label: "Documents", href: buildHash("/documents"), icon: "document" },
  { key: "configs", label: "Configs", href: buildHash("/configs"), icon: "layers" },
  { key: "ask", label: "Ask", href: buildHash("/ask"), icon: "quote" },
  { key: "jobs", label: "Jobs", href: buildHash("/jobs"), icon: "clock" },
  { key: "settings", label: "Settings", href: buildHash("/settings/connection"), icon: "settings" },
];

const main = renderShell(document.getElementById("app"), {
  productName: "Document Processing",
  tagline: "Documents in, validated records out",
  nav: NAV,
  bandLinks: [
    { label: "API docs", href: "/api/v1/docs", dataAttr: " data-docs-link" },
    { label: "Admin", href: "/admin/" },
  ],
});

// A session cookie is only needed when API_KEYS is configured; failing is the open case.
api("/api/v1/session", { method: "POST" }).catch(() => undefined);
api("/api/v1/branding")
  .then(applyShellBranding)
  .catch(() => undefined);

/** Live nav badges: what needs review, and what is still moving. */
async function refreshBadges() {
  try {
    const s = await api("/api/v1/stats");
    setNavBadge("documents", s.documents.total, {
      title: `${s.documents.total} documents`,
    });
    setNavBadge("jobs", (s.jobs.queued ?? 0) + (s.jobs.running ?? 0), { title: "queued and running jobs" });
    const configs = await api("/api/v1/extraction-configs");
    setNavBadge("configs", configs.items.length);
  } catch {
    /* badges are decoration; a failed poll must never interrupt a screen */
  }
}

const withNav = (key, fn) => async (ctx) => {
  setActiveNav(key);
  await fn(main, ctx);
  refreshBadges();
  maybeTour(ctx);
};

const router = createRouter(
  [
    ["/welcome", withNav("documents", renderWelcome)],
    ["/documents", withNav("documents", renderDocuments)],
    ["/documents/upload", withNav("documents", renderUpload)],
    ["/documents/:id", withNav("documents", (m, c) => renderDocument(m, c, ""))],
    ["/documents/:id/source", withNav("documents", (m, c) => renderDocument(m, c, "source"))],
    ["/documents/:id/pipeline", withNav("documents", (m, c) => renderDocument(m, c, "pipeline"))],
    ["/documents/:id/ask", withNav("documents", (m, c) => renderDocument(m, c, "ask"))],
    ["/documents/:id/json", withNav("documents", (m, c) => renderDocument(m, c, "json"))],
    ["/configs", withNav("configs", renderConfigs)],
    ["/configs/new", withNav("configs", (m, c) => renderConfigBuilder(m, { ...c, params: {} }))],
    ["/configs/:id", withNav("configs", renderConfigDetail)],
    ["/configs/:id/edit", withNav("configs", renderConfigBuilder)],
    ["/ask", withNav("ask", renderAsk)],
    ["/jobs", withNav("jobs", renderJobs)],
    ["/jobs/:id", withNav("jobs", renderJobDetail)],
    ["/settings", withNav("settings", (m, c) => renderSettings(m, { ...c, params: { tab: "connection" } }))],
    ["/settings/:tab", withNav("settings", renderSettings)],
  ],
  { fallback: () => navigate("/documents", {}, { replace: true }) },
);

// ── the guided path ──────────────────────────────────────────────────────────
/**
 * A spotlight over the real screens, never a mock of them. At most four steps, each
 * describing something visible; `Esc` and `Skip tour` end it and it never restarts on its
 * own. The step lives in the hash so the showcase recording can link straight to it.
 */
const TOUR = [
  {
    sel: "#strip",
    text: "This is the queue. Everything you process lands here, with the numbers that decide what to look at first.",
  },
  {
    sel: "#docsTable",
    text: "Each row carries the document's own identity — the invoice number and the supplier — not just the filename a scanner gave it. Open the row when it says Ready.",
  },
  {
    sel: "[data-nav='configs']",
    text: "Configs are what the model is forced to return. Eleven types are built in; a new one is a list of field names.",
  },
];

function maybeTour(ctx) {
  clearTour();
  if (ctx.query.tour !== "1") return;
  const step = Math.max(0, Math.min(TOUR.length - 1, Number(ctx.query.step ?? 1) - 1));
  const item = TOUR[step];
  const target = document.querySelector(item.sel);
  if (!target) return;
  const scrim = document.createElement("div");
  scrim.className = "dip-tour__scrim";
  scrim.dataset.tour = "1";
  document.body.appendChild(scrim);
  target.classList.add("dip-tour__target");
  target.dataset.tourTarget = "1";
  const card = document.createElement("div");
  card.className = "dip-tour__card";
  card.dataset.tour = "1";
  card.innerHTML = `
    <div class="dip-tour__step">Step ${step + 1} of ${TOUR.length}</div>
    <p>${esc(item.text)}</p>
    <div class="dip-tour__actions">
      ${step > 0 ? '<button class="arag-btn ghost sm" type="button" data-tour-back>Back</button>' : ""}
      ${step < TOUR.length - 1 ? '<button class="arag-btn sm" type="button" data-tour-next>Next</button>' : '<button class="arag-btn sm" type="button" data-tour-end>Done</button>'}
      <span style="flex:1"></span>
      <button class="arag-btn ghost sm" type="button" data-tour-end>Skip tour</button>
    </div>`;
  document.body.appendChild(card);
  // Below the target, right-aligned to it, and never off-screen — the card must not sit
  // on top of the thing its sentence is pointing at.
  const r = target.getBoundingClientRect();
  card.style.top = `${window.scrollY + Math.min(r.bottom + 10, window.innerHeight - 170)}px`;
  card.style.left = `${Math.max(12, Math.min(window.scrollX + r.right - 340, window.innerWidth - 350))}px`;

  const go = (n) => {
    const { path, query } = parseHash();
    navigate(path, {
      ...query,
      tour: n === null ? undefined : "1",
      step: n === null ? undefined : String(n + 1),
    });
  };
  card.querySelector("[data-tour-next]")?.addEventListener("click", () => go(step + 1));
  card.querySelector("[data-tour-back]")?.addEventListener("click", () => go(step - 1));
  for (const b of card.querySelectorAll("[data-tour-end]")) b.addEventListener("click", () => go(null));
}

function clearTour() {
  for (const el of document.querySelectorAll("[data-tour]")) el.remove();
  for (const el of document.querySelectorAll("[data-tour-target]")) {
    el.classList.remove("dip-tour__target");
    delete el.dataset.tourTarget;
  }
}

// ── keyboard shortcuts (documented in Settings → API, none required) ─────────
let chord = false;
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "");
  if (e.key === "Escape") clearTour();
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (chord) {
    chord = false;
    const to = { d: "/documents", c: "/configs", a: "/ask", j: "/jobs", s: "/settings/connection" }[e.key];
    if (to) {
      e.preventDefault();
      navigate(to);
    }
    return;
  }
  if (e.key === "g") {
    chord = true;
    return;
  }
  if (e.key === "/") {
    const box = $("#q") ?? $(".dip-search input");
    if (box) {
      e.preventDefault();
      box.focus();
    }
  }
  if (e.key === "u") {
    e.preventDefault();
    navigate("/documents/upload");
  }
});

if (!location.hash) {
  // First run goes to the welcome screen; anything else lands in the queue.
  api("/api/v1/documents?page_size=1")
    .then((p) => navigate(p.total === 0 ? "/welcome" : "/documents", {}, { replace: true }))
    .catch(() => navigate("/documents", {}, { replace: true }));
} else {
  router.run();
}
refreshBadges();
