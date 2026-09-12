/**
 * Document Processing admin panel. Consumes /api/v1/admin/* (plus /api/v1/jobs) only;
 * auth is an HttpOnly cookie issued by POST /api/v1/admin/login. No token is ever stored
 * in the page.
 */
import { api, esc, toast } from "/ui/arag-ui.js";

const $ = (s) => document.querySelector(s);
let selectedJob = null;

function show(authed) {
  $("#login").hidden = authed;
  $("#panel").hidden = !authed;
  if (!authed) return;
  // Components mounted before sign-in rendered 401s; reload them now that the cookie is set.
  for (const el of document.querySelectorAll("arag-health, arag-json[src], arag-log")) el.load?.();
  loadHealth();
  loadUsage();
  loadConfigs();
  loadJobs();
}

async function check() {
  try {
    await api("/api/v1/admin/health");
    show(true);
  } catch (e) {
    show(false);
    if (e.status === 403) {
      $("#loginError").hidden = false;
      $("#loginError").textContent = e.message;
    }
  }
}

$("#signin").addEventListener("click", async () => {
  try {
    await api("/api/v1/admin/login", { method: "POST", json: { token: $("#token").value } });
    $("#token").value = "";
    $("#loginError").hidden = true;
    toast("Signed in");
    check();
  } catch (e) {
    $("#loginError").hidden = false;
    $("#loginError").textContent = e.message;
  }
});
$("#token").addEventListener("keydown", (e) => e.key === "Enter" && $("#signin").click());

for (const t of document.querySelectorAll('[role="tab"]')) {
  t.addEventListener("click", () => {
    for (const x of document.querySelectorAll('[role="tab"]'))
      x.setAttribute("aria-selected", String(x === t));
    for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== t.dataset.tab;
  });
}

// ── overview ────────────────────────────────────────────────────────────────
async function loadHealth() {
  try {
    const h = await api("/api/v1/admin/health");
    $("#extractStrategy").textContent = h.extractStrategy ?? "none (default ARAG processing)";
    $("#model").textContent = h.generativeModel ?? "KB default";
    $("#docCounts").textContent = Object.entries(h.documents ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ");
    // A "degraded" document finished but lost a stage — worth an operator's attention.
    $("#docCounts").className = h.documents?.degraded ? "arag-chip warn" : "";
  } catch (e) {
    toast(e.message, "error");
  }
}

const kpi = (label, value, sub = "") =>
  `<div class="arag-kpi"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>`;

async function loadUsage() {
  try {
    const u = await api("/api/v1/admin/usage");
    const avgArag = u.aragCalls ? `${Math.round(u.aragMs / u.aragCalls)} ms avg` : "";
    const mins = Math.round((u.uptimeSec ?? 0) / 60);
    $("#usageKpis").innerHTML = [
      kpi("Requests", u.requests ?? 0, `${mins} min uptime`),
      kpi("ARAG calls", u.aragCalls ?? 0, avgArag),
      kpi("ARAG errors", u.aragErrors ?? 0, u.aragErrors ? "check the logs" : "none"),
      kpi(
        "Documents",
        u.documents?.total ?? 0,
        `${u.documents?.ready ?? 0} ready · ${u.documents?.failed ?? 0} failed`,
      ),
      kpi(
        "Jobs succeeded",
        u.jobs?.succeeded ?? 0,
        `${u.jobs?.running ?? 0} running · ${u.jobs?.queued ?? 0} queued`,
      ),
      kpi("Jobs failed", u.jobs?.failed ?? 0, `${u.jobs?.cancelled ?? 0} cancelled`),
    ].join("");
  } catch (e) {
    $("#usageKpis").innerHTML = `<div class="arag-alert error">${esc(e.message)}</div>`;
  }
}
$("#reloadUsage").addEventListener("click", () => {
  loadUsage();
  $("#usage").load();
});

$("#testKb").addEventListener("click", async () => {
  try {
    const h = await api("/api/v1/admin/health");
    document.querySelector("arag-health").load();
    loadUsage();
    loadHealth();
    toast(
      h.arag?.ok ? `KB connected in ${Math.round(h.arag.ms)} ms` : `KB error: ${h.arag?.error}`,
      h.arag?.ok ? "info" : "error",
    );
  } catch (e) {
    toast(e.message, "error");
  }
});

// ── extraction configs ──────────────────────────────────────────────────────
async function loadConfigs() {
  try {
    const d = await api("/api/v1/extraction-configs");
    $("#cfgTable tbody").innerHTML = d.items
      .map(
        (c) =>
          `<tr><td>${esc(c.name)}</td><td>${c.builtin ? '<span class="arag-chip neutral">built-in</span>' : '<span class="arag-chip info">custom</span>'}</td><td class="mono small">${esc(c.aragConfig)}</td><td class="num">${c.fields.length}</td><td><span class="arag-chip ${c.provisioned ? "ok" : "warn"}">${c.provisioned ? "yes" : "not yet"}</span></td></tr>`,
      )
      .join("");
  } catch (e) {
    toast(e.message, "error");
  }
}
$("#reloadConfigs").addEventListener("click", () => {
  loadConfigs();
  $("#storedConfigsJson").load();
});

$("#provision").addEventListener("click", async () => {
  $("#provision").disabled = true;
  $("#provisionResult").innerHTML = '<span class="muted">Provisioning…</span>';
  try {
    const r = await api("/api/v1/admin/provision", { method: "POST" });
    $("#provisionResult").innerHTML =
      `<div class="arag-alert ${r.failed ? "warn" : "ok"}">${r.ok} provisioned, ${r.failed} failed</div>` +
      `<table class="arag-table"><thead><tr><th>Schema</th><th>ARAG configuration</th><th>Result</th></tr></thead><tbody>${r.items
        .map(
          (i) =>
            `<tr><td>${esc(i.schema)}</td><td class="mono small">${esc(i.aragConfig)}</td><td><span class="arag-chip ${i.ok ? "ok" : "danger"}">${i.ok ? "ok" : esc(i.error ?? "failed")}</span></td></tr>`,
        )
        .join("")}</tbody></table>`;
    loadConfigs();
    $("#storedConfigsJson").load();
  } catch (e) {
    $("#provisionResult").innerHTML = `<div class="arag-alert error">${esc(e.message)}</div>`;
  } finally {
    $("#provision").disabled = false;
  }
});

// ── jobs ────────────────────────────────────────────────────────────────────
async function loadJobs() {
  try {
    const d = await api("/api/v1/jobs?limit=50");
    $("#jobs tbody").innerHTML =
      d.items
        .map(
          (j) =>
            `<tr data-id="${esc(j.id)}"><td>${esc(j.kind)}</td><td><span class="arag-chip ${({ succeeded: "ok", failed: "danger", cancelled: "warn" })[j.status] ?? "info"}">${esc(j.status)}</span></td><td class="small muted">${esc(j.stage ?? "")}</td><td class="small muted">${esc(j.createdAt.slice(11, 19))}</td></tr>`,
        )
        .join("") || '<tr><td colspan="4" class="muted">No jobs yet.</td></tr>';
    for (const r of $("#jobs").querySelectorAll("tr[data-id]"))
      r.addEventListener("click", () => openJob(r.dataset.id));
  } catch (e) {
    toast(e.message, "error");
  }
}

async function openJob(id) {
  const j = await api(`/api/v1/jobs/${id}`);
  selectedJob = j;
  $("#jobDetail").job = j;
  $("#jobJson").data = j;
  $("#cancelJob").hidden = !["queued", "running"].includes(j.status);
}

$("#reloadJobs").addEventListener("click", loadJobs);
$("#cancelJob").addEventListener("click", async () => {
  if (!selectedJob) return;
  try {
    await api(`/api/v1/jobs/${selectedJob.id}`, { method: "DELETE" });
    toast("Job cancelled");
  } catch (e) {
    // 409 when the job finished between the panel rendering and the click.
    toast(e.message, "error");
  }
  loadJobs();
  openJob(selectedJob.id);
});

// ── logs ────────────────────────────────────────────────────────────────────
$("#level").addEventListener("change", (e) => {
  $("#log").setAttribute("level", e.target.value);
  $("#log").load();
});
$("#contains").addEventListener("change", (e) => {
  $("#log").setAttribute("contains", e.target.value);
  $("#log").load();
});

// ── retention ───────────────────────────────────────────────────────────────
$("#purge").addEventListener("click", async () => {
  const days = Number($("#purgeDays").value || 30);
  if (!confirm(`Delete every document older than ${days} day(s) from the store and the KB?`)) return;
  $("#purge").disabled = true;
  try {
    const r = await api("/api/v1/admin/purge", { method: "POST", json: { olderThanDays: days } });
    $("#purgeResult").innerHTML =
      `<div class="arag-alert ${r.failed.length ? "warn" : "ok"}">Deleted ${r.deleted.length} document(s); ${r.failed.length} failed.</div>`;
    loadHealth();
  } catch (e) {
    $("#purgeResult").innerHTML = `<div class="arag-alert error">${esc(e.message)}</div>`;
  } finally {
    $("#purge").disabled = false;
  }
});

check();
