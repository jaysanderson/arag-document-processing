/**
 * Document Processing — operations.
 *
 * An operator product, not a tab inside the app: the same shell, its own navigation, and a
 * sign-in boundary that looks like a door. Everything here needs ADMIN_TOKEN, exchanged
 * once for an HttpOnly cookie and never held in the page.
 */
import {
  $,
  $$,
  api,
  applyShellBranding,
  buildHash,
  confirmDialog,
  createRouter,
  emptyState,
  errorState,
  esc,
  fmtAbsolute,
  fmtBytes,
  fmtRelative,
  icon,
  jobChip,
  label,
  navigate,
  openDrawer,
  pct,
  renderShell,
  setActiveNav,
  shortId,
  skeletonRows,
  toast,
} from "/lib/core.js";

const NAV = [
  { key: "overview", label: "Overview", href: buildHash("/overview"), icon: "chart" },
  { key: "connection", label: "Connection", href: buildHash("/connection"), icon: "plug" },
  { key: "configs", label: "Configs", href: buildHash("/configs"), icon: "layers" },
  { key: "jobs", label: "Jobs", href: buildHash("/jobs"), icon: "clock" },
  { key: "logs", label: "Logs", href: buildHash("/logs"), icon: "document" },
  { key: "usage", label: "Usage", href: buildHash("/usage"), icon: "chart" },
  { key: "branding", label: "Branding", href: buildHash("/branding"), icon: "settings" },
  { key: "security", label: "Security", href: buildHash("/security"), icon: "key" },
];

const root = document.getElementById("app");
let main = null;

api("/api/v1/branding")
  .then((b) => {
    window.__branding = b;
  })
  .catch(() => undefined);

// ── sign-in ──────────────────────────────────────────────────────────────────
/**
 * Two distinct failures, two distinct messages: a wrong token is something the visitor can
 * fix by typing again; `ADMIN_TOKEN` unset is not, and must not be dressed up as one.
 */
function renderSignIn(message = "") {
  const logo = window.__branding?.logoUrl || "/brand/arag-logo.svg";
  root.innerHTML = `
    <div class="dip-app">
      <div class="arag-band"><div class="arag-container">
        <span class="brand dip-bandmark"><img src="/brand/arag-logo-alt.svg" alt="Progress Agentic RAG" /></span>
        <span class="band-actions">
          <a class="arag-btn ghost sm" style="color:#fff;border-color:rgba(255,255,255,.3)" href="/api/v1/docs">API docs</a>
          <a class="arag-btn ghost sm" style="color:#fff;border-color:rgba(255,255,255,.3)" href="/">Open app</a>
        </span>
      </div></div>
      <div class="dip-signin">
        <div class="arag-card pad dip-signin__card">
          <img src="${esc(logo)}" alt="" />
          <h1 style="font-size:1.2rem">${esc(window.__branding?.productName ?? "Document Processing")} — operations</h1>
          <form id="loginForm" autocomplete="off">
            <div class="arag-field">
              <label for="token">Admin token</label>
              <input id="token" name="token" class="arag-input" type="password" autocomplete="current-password" />
            </div>
            <div class="dip-signin__error">${message ? `<div class="arag-alert error" role="alert">${esc(message)}</div>` : ""}</div>
            <button id="signin" class="arag-btn" type="submit">Sign in</button>
          </form>
          <p class="arag-help" style="margin-top:12px">
            The token is the <span class="mono">ADMIN_TOKEN</span> set for this deployment. It is
            exchanged for a cookie and never stored in the page.
          </p>
          <p style="margin-top:12px"><a href="/">Open the app ›</a></p>
        </div>
      </div>
    </div>`;
  $("#token", root).focus();
  $("#loginForm", root).addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/v1/admin/login", { method: "POST", json: { token: $("#token", root).value } });
      boot();
    } catch (err) {
      renderSignIn(
        err.status === 403
          ? "Admin access is disabled for this deployment. Set ADMIN_TOKEN and restart to enable it."
          : "That token was not accepted.",
      );
    }
  });
}

// ── shell ────────────────────────────────────────────────────────────────────
function mountShell() {
  main = renderShell(root, {
    productName: "Operations",
    tagline: "Document Processing",
    nav: NAV,
    ariaLabel: "Operations",
    bandLinks: [
      { label: "API docs", href: "/api/v1/docs", dataAttr: " data-docs-link" },
      { label: "Open app", href: "/" },
    ],
  });
  if (window.__branding) applyShellBranding({ ...window.__branding, productName: "Operations" });
}

/** Any 401 anywhere means the cookie expired: return to the door, saying so. */
const guard = (fn) => async (ctx) => {
  try {
    await fn(ctx);
  } catch (err) {
    if (err?.status === 401) renderSignIn("Your admin session expired. Sign in again.");
    else main.innerHTML = errorState(err);
  }
};

const withNav = (key, fn) =>
  guard(async (ctx) => {
    setActiveNav(key);
    await fn(ctx);
  });

// ── overview ─────────────────────────────────────────────────────────────────
async function overview() {
  main.innerHTML = `<header class="dip-pagehead"><div class="dip-pagehead__row"><h1>Overview</h1>
      <div class="dip-pagehead__actions"><button class="arag-btn ghost" type="button" id="refresh">${icon("refresh")} Refresh</button></div>
    </div></header><div id="body">${skeletonRows(4)}</div>`;
  const [health, usage, logs, configs, degraded, failed] = await Promise.all([
    api("/api/v1/admin/health"),
    api("/api/v1/admin/usage"),
    api("/api/v1/admin/logs?limit=10"),
    api("/api/v1/extraction-configs"),
    api("/api/v1/documents?degraded=true&page_size=5"),
    api("/api/v1/documents?status=failed&page_size=5"),
  ]);
  const unprovisioned = configs.items.filter((c) => !c.provisioned);
  const attention = [
    ...failed.items.map((d) => ({
      chip: '<span class="arag-chip danger">Failed</span>',
      text: `${d.filename} — ${d.error ?? "processing failed"}`,
      when: d.updatedAt,
      href: `/#/documents/${d.id}`,
    })),
    ...degraded.items.map((d) => ({
      chip: '<span class="arag-chip warn">Degraded</span>',
      text: `${d.filename} — ${(d.meta?.stageErrors ?? []).join("; ")}`,
      when: d.updatedAt,
      href: `/#/documents/${d.id}`,
    })),
    ...unprovisioned.map((c) => ({
      chip: '<span class="arag-chip warn">Not provisioned</span>',
      text: `${c.name} has no stored ARAG search configuration`,
      when: c.updatedAt,
      href: buildHash(`/configs`),
    })),
  ];

  $("#body", main).innerHTML = `
    <div class="dip-statstrip">
      ${kpi("Service", health.ok ? "Healthy" : "Degraded", `v${health.version} · up ${Math.round(health.uptimeSec / 60)} min`)}
      ${kpi("Knowledge Box", health.arag.ok ? `${Math.round(health.arag.ms)} ms` : "Offline", shortId(health.arag.kbId))}
      ${kpi("Documents", health.documents.total, `${health.documents.degraded} degraded · ${health.documents.failed} failed`)}
      ${kpi("Jobs", `${usage.jobs.running} running`, `${usage.jobs.queued} queued · ${usage.jobs.failed} failed`)}
      ${kpi("Grounding", health.groundingScore == null ? "—" : pct(health.groundingScore), "mean across records")}
      ${kpi("ARAG calls", usage.aragCalls, `${usage.aragErrors} errors · ${usage.aragConflicts} expected conflicts`)}
    </div>
    <div class="arag-card" style="margin-bottom:16px">
      <div class="head"><h3>Needs attention</h3></div>
      <div class="body">
        ${
          attention.length
            ? `<table class="arag-table"><tbody>${attention
                .slice(0, 8)
                .map(
                  (a) => `<tr><td style="width:1%">${a.chip}</td><td>${esc(a.text)}</td>
                  <td style="width:1%;white-space:nowrap" class="muted small">${esc(fmtRelative(a.when))}</td>
                  <td style="width:1%"><a href="${esc(a.href)}">Open ›</a></td></tr>`,
                )
                .join("")}</tbody></table>`
            : '<p class="muted">Nothing needs attention: every document finished, and every config is provisioned.</p>'
        }
      </div>
    </div>
    <div class="arag-grid cols-2">
      <div class="arag-card">
        <div class="head"><h3>Configuration</h3></div>
        <div class="body"><dl class="arag-kv">
          <dt>Extract strategy</dt><dd>${health.extractStrategy ? esc(health.extractStrategy) : "none (default processing)"}</dd>
          <dt>Model</dt><dd>${esc(health.generativeModel)}</dd>
          <dt>Mode</dt><dd>${health.arag.mock ? "Mock Knowledge Box" : "Live"}</dd>
          <dt>Requests served</dt><dd>${usage.requests}</dd>
        </dl></div>
      </div>
      <div class="arag-card">
        <div class="head"><h3>Recent activity</h3><a class="small" href="${buildHash("/logs")}">All logs ›</a></div>
        <div class="body"><table class="arag-table"><tbody>
          ${logs.items
            .slice(-8)
            .reverse()
            .map(
              (l) => `<tr><td class="mono small" style="width:1%">${esc(String(l.ts).slice(11, 19))}</td>
                <td style="width:1%">${levelChip(l.level)}</td><td class="small">${esc(l.msg)}</td></tr>`,
            )
            .join("")}
        </tbody></table></div>
      </div>
    </div>`;
  $("#refresh", main).addEventListener("click", () => overview());
}

const kpi = (labelText, value, sub) =>
  `<div class="arag-kpi"><div class="label">${esc(labelText)}</div><div class="value">${esc(String(value))}</div><div class="sub">${esc(sub)}</div></div>`;

const levelChip = (level) =>
  `<span class="arag-chip ${{ error: "danger", warn: "warn", info: "neutral", debug: "outline" }[level] ?? "neutral"}">${esc(level)}</span>`;

// ── connection ───────────────────────────────────────────────────────────────
async function connection() {
  main.innerHTML = `<header class="dip-pagehead"><div class="dip-pagehead__row"><h1>Connection</h1>
      <div class="dip-pagehead__actions">
        <button class="arag-btn ghost" type="button" id="test">Test connection</button>
        <button class="arag-btn secondary" type="button" id="provAll">Re-provision all</button>
      </div></div></header><div id="body">${skeletonRows(4)}</div>`;
  const [health, config, stored] = await Promise.all([
    api("/api/v1/admin/health"),
    api("/api/v1/admin/config"),
    api("/api/v1/admin/search-configurations").catch(() => ({ items: [], other: [] })),
  ]);
  const env = config.env ?? {};
  $("#body", main).innerHTML = `
    <div class="arag-alert ${health.arag.ok ? "ok" : "error"}" style="margin-bottom:16px">
      ${health.arag.ok ? `Connected · ${Math.round(health.arag.ms)} ms · last tested ${esc(fmtAbsolute(new Date().toISOString()))}` : `Not responding — ${esc(health.arag.error ?? "unknown error")}`}
    </div>
    <div class="arag-card" style="margin-bottom:16px"><div class="body"><dl class="arag-kv">
      <dt>Knowledge Box</dt><dd class="mono">${esc(health.arag.kbId ?? "—")}</dd>
      <dt>Region</dt><dd>${esc(env.ARAG_REGION ?? env.arag?.region ?? "—")}</dd>
      <dt>Endpoint</dt><dd class="mono small">${esc(health.arag.baseUrl ?? "—")}</dd>
      <dt>Resources</dt><dd>${health.arag.resources ?? "—"}</dd>
      <dt>Mode</dt><dd>${health.arag.mock ? "Mock (ARAG_MOCK=1)" : "Live"}</dd>
      <dt>Model</dt><dd>${esc(health.generativeModel)}</dd>
      <dt>Extract strategy</dt><dd>${health.extractStrategy ? `<span class="mono">${esc(health.extractStrategy)}</span>` : "none"}</dd>
    </dl></div></div>
    <h2>Stored ARAG search configurations (${stored.items.length})</h2>
    <p class="muted small dip-prose">What the extraction agents actually run against — the model, the RAG strategy, the grounding prompt and the JSON schema — without opening the ARAG dashboard.</p>
    <div class="dip-tablewrap"><div class="dip-tablescroll">
    <table class="arag-table dip-datatable">
      <thead><tr><th>Name</th><th>Kind</th><th>Model</th><th>Strategy</th></tr></thead>
      <tbody>${stored.items
        .map((s) => {
          const c = s.config ?? {};
          const strategies = (c.rag_strategies ?? []).map((r) => r.name).join(", ");
          return `<tr data-cfg="${esc(s.name)}">
            <td class="mono"><span class="dip-datatable__primary">${esc(s.name)}</span></td>
            <td>${esc(s.kind)}</td><td class="small">${esc(c.generative_model ?? "KB default")}</td>
            <td class="small">${esc(strategies || "—")}</td></tr>`;
        })
        .join("")}</tbody>
    </table></div></div>
    ${stored.other?.length ? `<p class="muted small" style="margin-top:12px">Not created by this product (${stored.other.length}): ${esc(stored.other.join(", "))}</p>` : ""}
    <div id="provResult" style="margin-top:12px"></div>`;

  for (const tr of $$("tr[data-cfg]", main)) {
    tr.addEventListener("click", () => {
      const item = stored.items.find((s) => s.name === tr.dataset.cfg);
      const d = openDrawer({
        wide: true,
        title: `<span class="mono">${esc(item.name)}</span>`,
        body: '<arag-json id="cfgJson"></arag-json>',
      });
      $("#cfgJson", d.host).data = item.config;
    });
  }
  $("#test", main).addEventListener("click", async () => {
    const h = await api("/api/v1/admin/health");
    toast(
      h.arag.ok ? `KB connected · ${Math.round(h.arag.ms)} ms` : `KB unreachable: ${h.arag.error}`,
      h.arag.ok ? "info" : "error",
    );
  });
  $("#provAll", main).addEventListener("click", async () => {
    $("#provResult", main).innerHTML = '<div class="arag-alert">Provisioning…</div>';
    const r = await api("/api/v1/admin/provision", { method: "POST" });
    $("#provResult", main).innerHTML =
      `<div class="arag-alert ${r.failed ? "warn" : "ok"}">${r.ok} provisioned · ${r.failed} failed</div>`;
  });
}

// ── configs ──────────────────────────────────────────────────────────────────
async function configs() {
  main.innerHTML = `<header class="dip-pagehead"><div class="dip-pagehead__row"><h1>Configs</h1>
    <div class="dip-pagehead__actions"><button class="arag-btn secondary" type="button" id="provAll">Re-provision all</button></div>
  </div></header><div id="body">${skeletonRows(5)}</div>`;
  const { items } = await api("/api/v1/extraction-configs");
  $("#body", main).innerHTML = `
    <div class="dip-tablewrap"><div class="dip-tablescroll">
    <table class="arag-table dip-datatable">
      <thead><tr><th>Name</th><th>Kind</th><th>Fields</th><th>ARAG configuration</th><th>Documents</th><th>State</th><th class="dip-datatable__actions"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${items
        .map(
          (c) => `<tr data-id="${esc(c.id)}">
          <td><span class="dip-datatable__primary">${esc(c.name)}</span><span class="dip-datatable__sub">${esc(c.description)}</span></td>
          <td>${c.builtin ? "Built in" : "Custom"}</td>
          <td class="num">${c.fields.length}</td>
          <td class="mono small">${esc(c.aragConfig)}</td>
          <td class="num">${c.documentCount ?? 0}</td>
          <td>${c.provisioned ? '<span class="arag-chip ok">Ready</span>' : '<span class="arag-chip warn">Not provisioned</span>'}</td>
          <td class="dip-datatable__actions"><button class="arag-btn ghost sm" type="button" data-prov="${esc(c.id)}">Re-provision</button></td>
        </tr>`,
        )
        .join("")}</tbody>
    </table></div></div>
    <div id="provResult" style="margin-top:12px"></div>`;
  for (const b of $$("[data-prov]", main)) {
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const r = await api(`/api/v1/extraction-configs/${b.dataset.prov}/provision`, { method: "POST" });
      toast(r.ok ? `Provisioned ${r.aragConfig}` : `Failed: ${r.error}`, r.ok ? "info" : "error");
      await configs();
    });
  }
  $("#provAll", main).addEventListener("click", async () => {
    const r = await api("/api/v1/admin/provision", { method: "POST" });
    // Re-render first, then report: the table has to show the new state, and the message
    // has to survive the re-render that shows it.
    await configs();
    $("#provResult", main).innerHTML =
      `<div class="arag-alert ${r.failed ? "warn" : "ok"}">${r.ok} provisioned · ${r.failed} failed</div>`;
  });
}

// ── jobs ─────────────────────────────────────────────────────────────────────
async function jobs(ctx) {
  const status = ctx.query.status ?? "";
  main.innerHTML = `<header class="dip-pagehead"><div class="dip-pagehead__row"><h1>Jobs</h1>
    <div class="dip-pagehead__actions"><button class="arag-btn ghost" type="button" id="reload">${icon("refresh")} Reload</button></div>
  </div></header>
  <div class="dip-filterbar">
    <label class="sr-only" for="jstatus">Status</label>
    <select class="arag-select" id="jstatus">
      ${["", "queued", "running", "succeeded", "failed", "cancelled"]
        .map(
          (s) =>
            `<option value="${s}"${s === status ? " selected" : ""}>${s ? s[0].toUpperCase() + s.slice(1) : "All statuses"}</option>`,
        )
        .join("")}
    </select>
  </div>
  <div id="body">${skeletonRows(5)}</div>`;
  const res = await api(`/api/v1/jobs?page_size=50${status ? `&status=${status}` : ""}`);
  $("#body", main).innerHTML = res.items.length
    ? `<div class="dip-tablewrap"><div class="dip-tablescroll">
      <table class="arag-table dip-datatable">
        <thead><tr><th>Job</th><th>Kind</th><th>Status</th><th>Stage</th><th>Started</th></tr></thead>
        <tbody>${res.items
          .map(
            (j) => `<tr data-job="${esc(j.id)}">
            <td class="mono small">${esc(j.id)}</td><td>${esc(j.kind)}</td><td>${jobChip(j.status)}</td>
            <td>${esc(j.stage ?? "—")}</td><td title="${esc(fmtAbsolute(j.createdAt))}">${esc(fmtRelative(j.createdAt))}</td></tr>`,
          )
          .join("")}</tbody>
      </table></div>
      <div class="dip-tablefoot"><span class="muted small">${res.items.length} of ${res.total}</span></div></div>`
    : emptyState({ iconName: "clock", title: "No jobs match these filters" });
  $("#reload", main).addEventListener("click", () => jobs(ctx));
  $("#jstatus", main).addEventListener("change", (e) =>
    navigate("/jobs", { status: e.target.value || undefined }),
  );
  for (const tr of $$("tr[data-job]", main)) {
    tr.addEventListener("click", async () => {
      const job = await api(`/api/v1/jobs/${tr.dataset.job}`);
      const live = job.status === "queued" || job.status === "running";
      const d = openDrawer({
        wide: true,
        title: `Job <span class="mono">${esc(shortId(job.id))}</span>`,
        body: `<dl class="arag-kv">
            <dt>Kind</dt><dd>${esc(job.kind)}</dd>
            <dt>Status</dt><dd>${jobChip(job.status)}</dd>
            <dt>Started</dt><dd>${esc(fmtAbsolute(job.createdAt))}</dd>
            ${job.ref ? `<dt>Document</dt><dd><a href="/#/documents/${esc(job.ref)}">Open in the app ›</a></dd>` : ""}
            ${job.error ? `<dt>Error</dt><dd class="arag-chip danger">${esc(job.error.message)}</dd>` : ""}
          </dl>
          <h3 style="margin-top:16px">Stages</h3>
          <arag-job-timeline id="tl"></arag-job-timeline>
          <details style="margin-top:16px"><summary class="muted small">Raw JSON</summary><arag-json id="jj"></arag-json></details>`,
        foot: live ? '<button class="arag-btn danger" type="button" id="cancel">Cancel job</button>' : "",
      });
      $("#tl", d.host).job = job;
      $("#jj", d.host).data = job;
      $("#cancel", d.host)?.addEventListener("click", async () => {
        try {
          await api(`/api/v1/jobs/${job.id}`, { method: "DELETE" });
          toast("Job cancelled");
          d.close();
          jobs(ctx);
        } catch (err) {
          toast(
            err.status === 409 ? "That job already finished, so it cannot be cancelled." : err.message,
            "error",
          );
        }
      });
    });
  }
}

// ── logs ─────────────────────────────────────────────────────────────────────
let tailTimer = null;
async function logs(ctx) {
  clearInterval(tailTimer);
  const level = ctx.query.level ?? "";
  const contains = ctx.query.contains ?? "";
  main.innerHTML = `<header class="dip-pagehead"><div class="dip-pagehead__row"><h1>Logs</h1>
      <div class="dip-pagehead__actions">
        <label class="arag-switch"><input type="checkbox" id="tail" /> Live tail</label>
        <button class="arag-btn ghost" type="button" id="download">${icon("download")} Download</button>
      </div></div></header>
    <div class="dip-filterbar${level || contains ? " has-filters" : ""}">
      <label class="sr-only" for="level">Level</label>
      <select class="arag-select" id="level">
        ${["", "debug", "info", "warn", "error"].map((l) => `<option value="${l}"${l === level ? " selected" : ""}>${l ? l : "All levels"}</option>`).join("")}
      </select>
      <div class="dip-search">${icon("search")}
        <label class="sr-only" for="contains">Contains</label>
        <input class="arag-input" id="contains" type="search" value="${esc(contains)}" placeholder="contains…" />
      </div>
      <span class="dip-filterbar__spacer"></span>
      <span class="muted small" id="count"></span>
      <button class="arag-btn ghost sm dip-filterbar__clear" type="button" id="clear">Clear filters</button>
    </div>
    <div id="body">${skeletonRows(6)}</div>`;

  let rows = [];
  const load = async () => {
    const p = new URLSearchParams({ limit: "200" });
    if (level) p.set("level", level);
    if (contains) p.set("contains", contains);
    rows = (await api(`/api/v1/admin/logs?${p}`)).items;
    $("#count", main).textContent = `${rows.length} lines`;
    $("#body", main).innerHTML = rows.length
      ? `<div class="dip-tablewrap"><div class="dip-tablescroll"><table class="arag-table dip-datatable">
          <thead><tr><th>Time</th><th>Level</th><th>Message</th></tr></thead>
          <tbody>${rows
            .slice()
            .reverse()
            .map(
              (
                l,
                i,
              ) => `<tr data-line="${i}"><td class="mono small" style="width:1%;white-space:nowrap">${esc(String(l.ts).slice(11, 23))}</td>
              <td style="width:1%">${levelChip(l.level)}</td>
              <td class="small">${esc(l.msg)} <span class="subtle">${esc(summarise(l))}</span></td></tr>`,
            )
            .join("")}</tbody></table></div></div>`
      : emptyState({
          iconName: "search",
          title: "No log lines match",
          actions: '<button class="arag-btn secondary" type="button" id="clear2">Clear filters</button>',
        });
    $("#clear2", main)?.addEventListener("click", () => navigate("/logs", {}));
    const reversed = rows.slice().reverse();
    for (const tr of $$("tr[data-line]", main)) {
      tr.addEventListener("click", () => {
        const d = openDrawer({ title: "Log record", body: '<arag-json id="lj"></arag-json>' });
        $("#lj", d.host).data = reversed[Number(tr.dataset.line)];
      });
    }
  };
  await load();

  $("#level", main).addEventListener("change", (e) =>
    navigate("/logs", { ...ctx.query, level: e.target.value || undefined }),
  );
  let deb;
  $("#contains", main).addEventListener("input", (e) => {
    clearTimeout(deb);
    const v = e.target.value;
    deb = setTimeout(() => navigate("/logs", { ...ctx.query, contains: v || undefined }), 300);
  });
  $("#clear", main).addEventListener("click", () => navigate("/logs", {}));
  // A toggle, not an unconditional poll: a log pane that refreshes while it is being read
  // is unreadable.
  $("#tail", main).addEventListener("change", (e) => {
    clearInterval(tailTimer);
    if (e.target.checked)
      tailTimer = setInterval(
        () => (document.getElementById("body") ? load() : clearInterval(tailTimer)),
        4000,
      );
  });
  $("#download", main).addEventListener("click", () => {
    const ndjson = rows.map((r) => JSON.stringify(r)).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ndjson], { type: "application/x-ndjson" }));
    a.download = `logs-${new Date().toISOString().slice(0, 19)}.ndjson`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}

/** The structured fields of a log record, minus the three the table already shows. */
const summarise = (record) => {
  const rest = { ...record };
  for (const k of ["ts", "level", "msg"]) delete rest[k];
  const s = JSON.stringify(rest);
  return s === "{}" ? "" : s.length > 120 ? `${s.slice(0, 120)}…` : s;
};

// ── usage ────────────────────────────────────────────────────────────────────
async function usage() {
  main.innerHTML = `<header class="dip-pagehead"><div class="dip-pagehead__row"><h1>Usage</h1></div></header><div id="body">${skeletonRows(4)}</div>`;
  const [u, docs] = await Promise.all([api("/api/v1/admin/usage"), api("/api/v1/documents?page_size=200")]);
  // Documents per day for the last fortnight, derived from the records themselves. No
  // ARAG-calls time series is drawn: the counters are cumulative since boot, and a chart
  // invented from a single number would be a chart that lies.
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    days.push({ key: d.toISOString().slice(0, 10), count: 0 });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const doc of docs.items) {
    const k = doc.createdAt.slice(0, 10);
    if (byKey.has(k)) byKey.get(k).count++;
  }
  const max = Math.max(1, ...days.map((d) => d.count));

  $("#body", main).innerHTML = `
    <div class="dip-statstrip">
      ${kpi("Requests", u.requests, `uptime ${Math.round(u.uptimeSec / 60)} min`)}
      ${kpi("ARAG calls", u.aragCalls, `${Math.round(u.aragMs)} ms total`)}
      ${kpi("ARAG errors", u.aragErrors, `${u.aragConflicts} expected provisioning conflicts`)}
      ${kpi("Client errors", u.aragClientErrors, "4xx from the Knowledge Box")}
      ${kpi("Documents", u.documents.total, `${u.documents.degraded} degraded`)}
      ${kpi("Grounding", u.groundingScore == null ? "—" : pct(u.groundingScore), "mean across records")}
    </div>
    <div class="arag-card">
      <div class="head"><h3>Documents processed, last 14 days</h3></div>
      <div class="body">
        ${days
          .map(
            (d) => `<div class="dip-bar"><span class="muted small">${esc(d.key.slice(5))}</span>
            <span class="dip-bar__track"><i style="width:${Math.round((d.count / max) * 100)}%"></i></span>
            <span class="num small">${d.count}</span></div>`,
          )
          .join("")}
        <p class="muted small" style="margin-top:12px">Derived from the stored records. ARAG call counters are cumulative since boot, so there is no time series to draw for them.</p>
      </div>
    </div>
    <div class="arag-card" style="margin-top:16px">
      <div class="head"><h3>Jobs</h3></div>
      <div class="body"><dl class="arag-kv">
        ${Object.entries(u.jobs)
          .map(([k, v]) => `<dt>${esc(label(k))}</dt><dd>${v}</dd>`)
          .join("")}
      </dl></div>
    </div>`;
}

// ── branding ─────────────────────────────────────────────────────────────────
async function branding() {
  const [cfg, b] = await Promise.all([api("/api/v1/admin/config"), api("/api/v1/branding")]);
  const row = (name, value, variable) =>
    `<dt>${esc(name)}<br /><span class="mono small subtle">${esc(variable)}</span></dt><dd>${value}</dd>`;
  main.innerHTML = `<header class="dip-pagehead"><div class="dip-pagehead__row"><h1>Branding</h1></div>
      <p class="dip-pagehead__sub">Read-only: branding is environment configuration, and a form that appeared to save but could not would be a lie.</p>
    </header>
    <div class="dip-split">
      <div class="arag-card"><div class="head"><h3>Effective values</h3></div><div class="body">
        <dl class="arag-kv">
          ${row("Product name", esc(b.productName), "BRAND_PRODUCT_NAME")}
          ${row("Tagline", esc(b.tagline || "—"), "BRAND_TAGLINE")}
          ${row("Logo", b.logoUrl ? `<span class="mono small">${esc(b.logoUrl)}</span>` : "Default Progress wordmark", "BRAND_LOGO_URL")}
          ${row("Primary colour", b.primaryColor ? `<span class="dip-swatch" style="background:${esc(b.primaryColor)}"></span><span class="mono">${esc(b.primaryColor)}</span>` : "Kit default", "BRAND_PRIMARY_COLOR")}
          ${row("Accent colour", b.accentColor ? `<span class="dip-swatch" style="background:${esc(b.accentColor)}"></span><span class="mono">${esc(b.accentColor)}</span>` : "Kit default", "BRAND_ACCENT_COLOR")}
          ${row("Powered-by credit", b.poweredBy ? "Shown" : "Hidden", "BRAND_POWERED_BY")}
          ${row("Footer", esc(b.footerText || "Open source · Apache-2.0"), "BRAND_FOOTER_TEXT")}
          ${row("Docs URL", esc(b.docsUrl || "—"), "BRAND_DOCS_URL")}
          ${row("Support URL", esc(b.supportUrl || "—"), "BRAND_SUPPORT_URL")}
        </dl>
        <p class="muted small" style="margin-top:12px">${esc(cfg.branding?.howToChange ?? "")}</p>
      </div></div>
      <div class="arag-card"><div class="head"><h3>Preview</h3></div><div class="body">
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
      </div></div>
    </div>`;
}

// ── security ─────────────────────────────────────────────────────────────────
async function security() {
  main.innerHTML = `<header class="dip-pagehead"><div class="dip-pagehead__row"><h1>Security</h1></div></header><div id="body">${skeletonRows(3)}</div>`;
  const s = await api("/api/v1/admin/security");
  $("#body", main).innerHTML = `
    <div class="arag-stack">
      <div class="arag-card"><div class="head"><h3>Credentials</h3></div><div class="body">
        <dl class="arag-kv">
          <dt>API keys</dt><dd>${s.apiKeys.count ? `${s.apiKeys.count} configured · ${s.apiKeys.hints.map((h) => `<span class="mono">${esc(h)}</span>`).join(" ")}` : "None — the public API is open for reads and uploads"}</dd>
          <dt>Admin token</dt><dd>${s.adminTokenSet ? "Set" : "Not set"}</dd>
          <dt>Session cookie</dt><dd>${Math.round(s.sessionTtlSec / 3600)} h, SameSite=Lax, HttpOnly</dd>
          <dt>Writes</dt><dd>${s.writesRequireCredential ? "Always require a credential — deletes and config creation, even when API_KEYS is unset" : "Open"}</dd>
        </dl>
        <p class="muted small" style="margin-top:12px">API keys are set with the <span class="mono">API_KEYS</span> environment variable; there is no key store, so they cannot be created or revoked from here.</p>
      </div></div>
      <div class="arag-card"><div class="head"><h3>Request protection</h3></div><div class="body">
        <dl class="arag-kv">
          <dt>Rate limit</dt><dd>${s.rateLimit.rps} req/s, burst ${s.rateLimit.burst}</dd>
          <dt>CORS</dt><dd>${s.cors.length ? esc(s.cors.join(", ")) : "same-origin only"}</dd>
          <dt>Max upload</dt><dd>${esc(fmtBytes(s.maxUploadBytes))}</dd>
          <dt>Max body</dt><dd>${esc(fmtBytes(s.maxBodyBytes))}</dd>
          <dt>Headers</dt><dd>${Object.entries(s.headers)
            .filter(([, v]) => v)
            .map(([k]) => k.toUpperCase())
            .join(", ")} on</dd>
          <dt>Trusted proxy</dt><dd>${esc(s.trustProxy)}</dd>
        </dl>
      </div></div>
      <div class="arag-card dip-danger-zone"><div class="head"><h3>Retention</h3></div><div class="body">
        <div class="arag-row">
          <label class="arag-label" for="days">Delete documents older than</label>
          <input class="arag-input" id="days" type="number" min="0" max="3650" value="${s.retention.defaultOlderThanDays}" style="width:90px" />
          <span class="muted">days</span>
          <button class="arag-btn ghost" type="button" id="preview">Preview</button>
          <button class="arag-btn danger" type="button" id="purge" disabled>Purge</button>
        </div>
        <div id="purgeResult" style="margin-top:12px"><p class="muted small">Preview first: nothing is deleted until the exact count and date range have been shown.</p></div>
      </div></div>
    </div>`;

  let previewed = null;
  $("#preview", main).addEventListener("click", async () => {
    const olderThanDays = Number($("#days", main).value);
    previewed = await api("/api/v1/admin/purge", { method: "POST", json: { olderThanDays, dryRun: true } });
    $("#purge", main).disabled = previewed.wouldDelete === 0;
    $("#purgeResult", main).innerHTML = previewed.wouldDelete
      ? `<div class="arag-alert warn"><strong>${previewed.wouldDelete} document${previewed.wouldDelete === 1 ? "" : "s"}</strong> would be deleted from the store and the Knowledge Box —
           created between ${esc(fmtAbsolute(previewed.oldest))} and ${esc(fmtAbsolute(previewed.newest))}. Nothing has been deleted yet.</div>`
      : '<div class="arag-alert ok">No documents are older than that. Nothing would be deleted.</div>';
  });
  $("#purge", main).addEventListener("click", async () => {
    const olderThanDays = Number($("#days", main).value);
    const ok = await confirmDialog({
      title: "Purge documents",
      body: `<p><strong>${previewed.wouldDelete} document${previewed.wouldDelete === 1 ? "" : "s"}</strong> will be deleted from the store and from the Knowledge Box. This cannot be undone.</p>`,
      confirmLabel: `Purge ${previewed.wouldDelete}`,
      typed: "DELETE",
    });
    if (!ok) return;
    const out = await api("/api/v1/admin/purge", { method: "POST", json: { olderThanDays } });
    $("#purge", main).disabled = true;
    $("#purgeResult", main).innerHTML =
      `<div class="arag-alert ${out.failed.length ? "warn" : "ok"}">Deleted ${out.deleted.length} document${out.deleted.length === 1 ? "" : "s"}${out.failed.length ? `; ${out.failed.length} failed` : ""}.</div>`;
  });
}

// ── boot ─────────────────────────────────────────────────────────────────────
let router = null;

async function boot() {
  try {
    await api("/api/v1/admin/health");
  } catch (err) {
    renderSignIn(
      err.status === 403
        ? "Admin access is disabled for this deployment. Set ADMIN_TOKEN and restart to enable it."
        : "",
    );
    return;
  }
  mountShell();
  if (!router) {
    router = createRouter(
      [
        ["/overview", withNav("overview", overview)],
        ["/connection", withNav("connection", connection)],
        ["/configs", withNav("configs", configs)],
        ["/jobs", withNav("jobs", jobs)],
        ["/logs", withNav("logs", logs)],
        ["/usage", withNav("usage", usage)],
        ["/branding", withNav("branding", branding)],
        ["/security", withNav("security", security)],
      ],
      { fallback: () => navigate("/overview", {}, { replace: true }) },
    );
  }
  if (!location.hash || location.hash === "#/") navigate("/overview", {}, { replace: true });
  else router.run();
}

boot();
