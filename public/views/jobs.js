/**
 * Jobs — the work in flight. See what is running, cancel what is stuck, and explain what
 * happened to something that failed.
 *
 * The SSE stream is a view of a job, not the work itself, so this screen can subscribe and
 * unsubscribe freely: nothing here can stop a pipeline by navigating away.
 */
import {
  $,
  api,
  buildHash,
  emptyState,
  errorState,
  esc,
  fmtAbsolute,
  fmtMs,
  fmtRelative,
  icon,
  jobChip,
  navigate,
  onLeave,
  openDrawer,
  skeletonRows,
  toast,
  wireTable,
} from "../lib/core.js";

let timer = null;
const stop = () => {
  clearInterval(timer);
  timer = null;
};

const elapsed = (j) => (j.finishedAt ? Date.parse(j.finishedAt) : Date.now()) - Date.parse(j.createdAt);

export async function renderJobs(main, { query, stale }) {
  stop();
  const status = query.status ?? "";
  const q = query.q ?? "";
  const page = Number(query.page ?? 1);
  main.innerHTML = `
    <header class="arag-pagehead">
      <div class="row"><h1>Jobs</h1>
        <div class="actions">
          <label class="arag-switch"><input type="checkbox" id="auto" checked /> Auto-refresh</label>
          <button class="arag-btn ghost" type="button" id="reload">${icon("refresh")} Reload</button>
        </div>
      </div>
      <p class="sub">Every upload starts a job. Its seven stages are recorded, so a finished run can still be explained hours later.</p>
    </header>
    <div class="arag-filterbar">
      <div class="arag-search">${icon("search")}
        <label class="sr-only" for="jq">Search jobs</label>
        <input class="arag-input" id="jq" type="search" value="${esc(q)}" placeholder="Search by job or document id" />
      </div>
      <label class="sr-only" for="jstatus">Status</label>
      <select class="arag-select" id="jstatus">
        ${["", "queued", "running", "succeeded", "failed", "cancelled"]
          .map(
            (s) =>
              `<option value="${s}"${s === status ? " selected" : ""}>${s ? s[0].toUpperCase() + s.slice(1) : "All statuses"}</option>`,
          )
          .join("")}
      </select>
      <span class="spacer"></span>
      ${status || q ? '<button class="arag-btn ghost sm" type="button" id="clearJobs">Clear all filters</button>' : ""}
    </div>
    <div id="jobList">${skeletonRows(5)}</div>`;

  const reload = async () => {
    const params = new URLSearchParams({ page: String(page), page_size: "20" });
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    let res;
    try {
      res = await api(`/api/v1/jobs?${params}`);
    } catch (err) {
      if (!stale()) $("#jobList", main).innerHTML = errorState(err);
      return null;
    }
    if (stale()) return null;
    renderList(main, res, { status, q, page, query });
    return res;
  };

  const first = await reload();
  if (!first) return;

  $("#reload", main).addEventListener("click", reload);
  $("#jstatus", main).addEventListener("change", (e) =>
    navigate("/jobs", { ...query, status: e.target.value || undefined, page: undefined }),
  );
  let debounce;
  $("#jq", main).addEventListener("input", (e) => {
    clearTimeout(debounce);
    const value = e.target.value;
    debounce = setTimeout(() => navigate("/jobs", { ...query, q: value || undefined, page: undefined }), 250);
  });
  $("#clearJobs", main)?.addEventListener("click", () => navigate("/jobs", {}));

  // Auto-refresh is a pause switch for demos and screenshots, not a poll-interval control.
  const auto = $("#auto", main);
  onLeave(stop);
  const arm = () => {
    stop();
    if (auto.checked)
      timer = setInterval(() => (document.getElementById("jobList") ? reload() : stop()), 3000);
  };
  auto.addEventListener("change", arm);
  arm();
}

function renderList(main, res, ctx) {
  const host = $("#jobList", main);
  if (!res.items.length) {
    host.innerHTML =
      ctx.status || ctx.q
        ? emptyState({
            icon: "search",
            title: "No jobs match these filters",
            actions:
              '<button class="arag-btn secondary" type="button" id="clearJobs2">Clear all filters</button>',
          })
        : emptyState({
            icon: "clock",
            title: "No jobs yet",
            body: "Every upload starts a job. Its seven stages appear here while it runs.",
            actions: `<a class="arag-btn" href="${buildHash("/documents/upload")}">Upload document</a>`,
          });
    $("#clearJobs2", host)?.addEventListener("click", () => navigate("/jobs", {}));
    return;
  }
  const from = (res.page - 1) * res.page_size + 1;
  host.innerHTML = `
    <div class="arag-datatable" id="jobsTable"><div class="scroll">
    <table class="arag-table">
      <caption class="sr-only">Processing jobs, newest first</caption>
      <thead><tr><th>Job</th><th>Status</th><th>Stage</th><th>Elapsed</th><th>Started</th></tr></thead>
      <tbody>
        ${res.items
          .map(
            (j) => `<tr data-job="${esc(j.id)}" data-href="${buildHash(`/jobs/${j.id}`)}">
            <td><a class="cell-title" href="${buildHash(`/jobs/${j.id}`)}">${esc(j.kind)}</a>
              <span class="cell-sub mono">${esc(j.id)}${j.ref ? ` · document ${esc(j.ref.slice(0, 8))}…` : ""}</span></td>
            <td>${jobChip(j.status)}</td>
            <td>${esc(j.stage ?? "—")}</td>
            <td class="num">${esc(fmtMs(elapsed(j)))}</td>
            <td title="${esc(fmtAbsolute(j.createdAt))}">${esc(fmtRelative(j.createdAt))}</td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table></div>
    <nav class="arag-pagination" aria-label="Pagination">
      <span class="range">${from}–${Math.min(res.page * res.page_size, res.total)} of ${res.total}</span>
      <span class="spacer"></span>
      <button type="button" data-page="prev"${res.page <= 1 ? " disabled" : ""}>Previous</button>
      <button type="button" data-page="next"${res.next_page ? "" : " disabled"}>Next</button>
    </nav></div>`;

  wireTable($("#jobsTable", host), {
    onPage: (to) =>
      navigate("/jobs", { ...ctx.query, page: String(to === "prev" ? res.page - 1 : res.page + 1) }),
  });
}

/** The job drawer is a route over the list, so Back closes it. */
export async function renderJobDetail(main, ctx) {
  const query = { ...ctx.query };
  await renderJobs(main, { query, stale: ctx.stale });
  let job;
  try {
    job = await api(`/api/v1/jobs/${ctx.params.id}`);
  } catch (err) {
    toast(err.message, "error");
    navigate("/jobs", query, { replace: true });
    return;
  }
  const live = job.status === "queued" || job.status === "running";
  const drawer = openDrawer({
    wide: true,
    title: `Job <span class="mono">${esc(job.id.slice(0, 8))}…</span>`,
    onClose: () => navigate("/jobs", query, { replace: true }),
    body: `
      <dl class="arag-kv">
        <dt>Kind</dt><dd>${esc(job.kind)}</dd>
        <dt>Status</dt><dd>${jobChip(job.status)}</dd>
        <dt>Started</dt><dd>${esc(fmtAbsolute(job.createdAt))}</dd>
        <dt>Elapsed</dt><dd>${esc(fmtMs(elapsed(job)))}</dd>
        ${job.ref ? `<dt>Document</dt><dd><a href="${buildHash(`/documents/${job.ref}`)}">Open document ›</a></dd>` : ""}
        ${job.error ? `<dt>Error</dt><dd class="arag-chip danger">${esc(job.error.message)}</dd>` : ""}
      </dl>
      <h3 style="margin-top:16px">Stages</h3>
      <arag-job-timeline id="jobTimeline"${live ? ` events-src="/api/v1/jobs/${esc(job.id)}/events"` : ""}></arag-job-timeline>
      <details style="margin-top:16px"><summary class="muted small">Raw JSON</summary><arag-json id="jobJson"></arag-json></details>`,
    foot: live ? '<button class="arag-btn danger" type="button" id="cancelJob">Cancel job</button>' : "",
  });
  $("#jobTimeline", drawer.host).job = job;
  $("#jobJson", drawer.host).data = job;
  $("#cancelJob", drawer.host)?.addEventListener("click", async () => {
    try {
      await api(`/api/v1/jobs/${job.id}`, { method: "DELETE" });
      toast("Job cancelled");
      drawer.close();
    } catch (err) {
      toast(
        err.status === 409 ? "That job already finished, so it cannot be cancelled." : err.message,
        "error",
      );
    }
  });
}
