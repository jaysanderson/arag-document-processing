/**
 * Documents — the working queue.
 *
 * Find a document, judge at a glance whether it can be trusted unreviewed, act on many at
 * once. Every filter lives in the hash query string, so a filtered queue is a link a
 * colleague can be sent.
 */
import {
  $,
  $$,
  announce,
  api,
  buildHash,
  confirmDialog,
  docState,
  downloadResponse,
  emptyState,
  errorState,
  esc,
  fmtAbsolute,
  fmtRelative,
  headline,
  icon,
  label,
  menuButton,
  navigate,
  pct,
  skeletonRows,
  statusChip,
  toast,
} from "../lib/core.js";
import { openUploadDrawer } from "./upload.js";

const PAGE_SIZES = [20, 50, 100];
const SORTS = [
  ["created_at:desc", "Newest first"],
  ["created_at:asc", "Oldest first"],
  ["grounding:asc", "Grounding: lowest first"],
  ["grounding:desc", "Grounding: highest first"],
  ["filename:asc", "Name A–Z"],
  ["doc_type:asc", "Type"],
  ["status:asc", "Status"],
];

/** Selection survives paging within a visit — a batch is rarely one page long. */
const selected = new Set();
let liveTimer = null;

function stopLive() {
  clearInterval(liveTimer);
  liveTimer = null;
}

function filtersFrom(query) {
  return {
    q: query.q ?? "",
    status: query.status ?? "",
    doc_type: query.doc_type ?? "",
    config: query.config ?? "",
    has_issues: query.has_issues ?? "",
    degraded: query.degraded ?? "",
    date_from: query.date_from ?? "",
    sort: query.sort ?? "created_at:desc",
    page: Number(query.page ?? 1),
    page_size: Number(query.page_size ?? 20),
  };
}

const activeFilterCount = (f) =>
  ["q", "status", "doc_type", "config", "has_issues", "degraded", "date_from"].filter((k) => f[k]).length;

function toParams(f) {
  const [sort, order] = f.sort.split(":");
  const p = new URLSearchParams({
    page: String(f.page),
    page_size: String(f.page_size),
    sort,
    order,
  });
  for (const k of ["q", "status", "doc_type", "config", "has_issues", "degraded", "date_from"]) {
    if (f[k]) p.set(k, f[k]);
  }
  return p;
}

export async function renderDocuments(main, { query, stale }) {
  const f = filtersFrom(query);
  stopLive();
  main.innerHTML = `
    <header class="dip-pagehead">
      <div class="dip-pagehead__row">
        <h1>Documents</h1>
        <div class="dip-pagehead__actions">
          <button class="arag-btn" id="uploadBtn" type="button">${icon("upload")} Upload document</button>
        </div>
      </div>
    </header>
    <div id="strip"></div>
    <div id="filters"></div>
    <div id="list">${skeletonRows(6)}</div>`;

  $("#uploadBtn", main).addEventListener("click", () => navigate("/documents/upload", query));

  let page;
  try {
    page = await api(`/api/v1/documents?${toParams(f)}`);
  } catch (err) {
    if (stale()) return;
    $("#list", main).innerHTML = errorState(err, {
      retry: '<button class="arag-btn secondary sm" id="retry" type="button">Try again</button>',
    });
    $("#retry", main)?.addEventListener("click", () => renderDocuments(main, { query, stale: () => false }));
    return;
  }
  if (stale()) return;

  // First run is a different product from "no results": send it to the welcome screen
  // rather than showing an empty table with filters nobody set.
  if (page.total === 0 && activeFilterCount(f) === 0) {
    navigate("/welcome", {}, { replace: true });
    return;
  }

  renderStrip($("#strip", main), page.facets);
  renderFilters($("#filters", main), f, page.facets, query);
  renderList(main, page, f, query);

  // While anything is queued or processing, refresh quietly. The list is a queue: it has
  // to move on its own or the user learns to hammer the browser's reload.
  const busy = page.items.some((d) => d.status === "pending" || d.status === "processing");
  if (busy) {
    liveTimer = setInterval(async () => {
      if (!document.getElementById("docsTable")) return stopLive();
      try {
        const next = await api(`/api/v1/documents?${toParams(f)}`);
        renderStrip($("#strip", main), next.facets);
        renderList(main, next, f, query);
        if (!next.items.some((d) => d.status === "pending" || d.status === "processing")) stopLive();
      } catch {
        /* a failed refresh must never wipe the list that is on screen */
      }
    }, 2500);
  }
}

function tile(href, labelText, value, sub) {
  const inner = `<div class="arag-kpi"><div class="label">${esc(labelText)}</div>
      <div class="value">${esc(String(value))}</div>
      <div class="sub">${esc(sub)}</div></div>`;
  return href
    ? `<a class="dip-statstrip__tile" href="${esc(href)}">${inner}</a>`
    : `<div class="dip-statstrip__tile">${inner}</div>`;
}

function renderStrip(host, facets = {}) {
  const f = {
    total: facets.total ?? 0,
    needsReview: facets.needsReview ?? 0,
    degraded: facets.degraded ?? 0,
    status: facets.status ?? {},
  };
  const processing = (f.status.pending ?? 0) + (f.status.processing ?? 0);
  host.innerHTML = `<div class="dip-statstrip">
    ${tile(buildHash("/documents"), "Documents", f.total, "in this workspace")}
    ${tile(buildHash("/documents", { has_issues: "true", sort: "grounding:asc" }), "Need review", f.needsReview, "issues or weak grounding")}
    ${tile(buildHash("/documents", { status: "processing" }), "In flight", processing, "queued or processing")}
    ${tile(buildHash("/documents", { degraded: "true" }), "Degraded", f.degraded, "finished with a failed stage")}
  </div>`;
}

function option(value, text, current) {
  return `<option value="${esc(value)}"${String(current) === String(value) ? " selected" : ""}>${esc(text)}</option>`;
}

function renderFilters(host, f, facets = {}, query) {
  const types = Object.entries(facets.docType ?? {}).sort((a, b) => b[1] - a[1]);
  host.innerHTML = `
    <div class="dip-filterbar${activeFilterCount(f) ? " has-filters" : ""}">
      <div class="dip-search">
        ${icon("search")}
        <label class="sr-only" for="q">Search documents</label>
        <input class="arag-input" id="q" type="search" value="${esc(f.q)}"
               placeholder="Search filename, type or value" />
      </div>
      <label class="sr-only" for="fStatus">Status</label>
      <select class="arag-select" id="fStatus">
        ${option("", "Any status", f.status)}
        ${["pending", "processing", "ready", "failed"]
          .map((s) =>
            option(s, `${label(s === "pending" ? "queued" : s)} (${facets.status?.[s] ?? 0})`, f.status),
          )
          .join("")}
      </select>
      <label class="sr-only" for="fType">Document type</label>
      <select class="arag-select" id="fType">
        ${option("", "Any type", f.doc_type)}
        ${types.map(([t, n]) => option(t, `${label(t)} (${n})`, f.doc_type)).join("")}
      </select>
      <label class="sr-only" for="fReview">Review state</label>
      <select class="arag-select" id="fReview">
        ${option("", "Any review state", f.has_issues ? "issues" : f.degraded ? "degraded" : "")}
        ${option("issues", "Has issues", f.has_issues ? "issues" : "")}
        ${option("degraded", "Degraded", f.degraded ? "degraded" : "")}
      </select>
      <label class="sr-only" for="fSort">Sort</label>
      <select class="arag-select" id="fSort">${SORTS.map(([v, t]) => option(v, t, f.sort)).join("")}</select>
      <span class="dip-filterbar__spacer"></span>
      <button class="arag-btn ghost sm dip-filterbar__clear" type="button" id="clearFilters">Clear all filters</button>
    </div>`;

  const apply = (patch) => {
    selected.clear();
    navigate("/documents", { ...query, page: undefined, ...patch });
  };
  let debounce;
  $("#q", host).addEventListener("input", (e) => {
    clearTimeout(debounce);
    const value = e.target.value;
    debounce = setTimeout(() => apply({ q: value || undefined }), 300);
  });
  $("#fStatus", host).addEventListener("change", (e) => apply({ status: e.target.value || undefined }));
  $("#fType", host).addEventListener("change", (e) => apply({ doc_type: e.target.value || undefined }));
  $("#fReview", host).addEventListener("change", (e) =>
    apply({
      has_issues: e.target.value === "issues" ? "true" : undefined,
      degraded: e.target.value === "degraded" ? "true" : undefined,
    }),
  );
  $("#fSort", host).addEventListener("change", (e) => apply({ sort: e.target.value }));
  $("#clearFilters", host).addEventListener("click", () => {
    selected.clear();
    navigate("/documents", {});
  });
}

const COLUMNS = [
  ["filename", "File"],
  ["doc_type", "Type"],
  ["status", "Status"],
  ["fields", "Fields"],
  ["grounding", "Grounding"],
  [null, "Issues"],
];

function issueChip(doc) {
  const issues = (doc.issues ?? []).filter((i) => i.severity !== "info");
  if (!issues.length) return '<span class="subtle">—</span>';
  const worst = issues.some((i) => i.severity === "error") ? "danger" : "warn";
  return `<span class="arag-chip ${worst}" title="${esc(issues.map((i) => i.message).join(" · "))}">${issues.length}</span>`;
}

function subline(doc) {
  const h = headline(doc);
  const bits = [h.identifier, h.counterparty].filter(Boolean);
  const state = docState(doc);
  if (state === "processing" || state === "pending") {
    bits.push(`${esc(doc.jobId ? "processing" : "queued")}`);
  } else if (state === "failed") {
    bits.push(esc(doc.error ?? "processing failed"));
  } else if (state === "degraded") {
    bits.push(esc((doc.meta?.stageErrors ?? [])[0] ?? "a stage failed"));
  }
  bits.push(`<span title="${esc(fmtAbsolute(doc.createdAt))}">${esc(fmtRelative(doc.createdAt))}</span>`);
  return bits.join(" · ");
}

function renderList(main, page, f, query) {
  const host = $("#list", main);
  if (!page.items.length) {
    host.innerHTML = emptyState({
      iconName: "search",
      title: "No documents match these filters",
      body: "Try a wider date range, or a different status.",
      actions: '<button class="arag-btn secondary" type="button" id="clear2">Clear all filters</button>',
    });
    $("#clear2", host)?.addEventListener("click", () => navigate("/documents", {}));
    return;
  }
  const [sortKey, sortOrder] = f.sort.split(":");
  const from = (page.page - 1) * page.page_size + 1;
  const to = Math.min(page.page * page.page_size, page.total);
  const pageIds = page.items.map((d) => d.id);
  const allOnPage = pageIds.every((id) => selected.has(id));

  host.innerHTML = `
    <div class="dip-tablewrap">
      <div class="dip-tablescroll">
      <table class="arag-table dip-datatable" id="docsTable">
        <caption class="sr-only">Documents, ${esc(SORTS.find(([v]) => v === f.sort)?.[1] ?? "")}</caption>
        <thead><tr>
          <th class="dip-datatable__check"><input type="checkbox" id="selectAll" aria-label="Select all documents on this page"${allOnPage ? " checked" : ""} /></th>
          ${COLUMNS.map(([key, text]) => {
            if (!key) return `<th>${esc(text)}</th>`;
            const sorted = key === sortKey ? (sortOrder === "asc" ? "ascending" : "descending") : "none";
            return `<th aria-sort="${sorted}"><button type="button" data-sort="${key}">${esc(text)}${icon("chevron-down", { cls: "dip-sortic", size: 14 })}</button></th>`;
          }).join("")}
          <th class="dip-datatable__actions"><span class="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>
          ${page.items
            .map((d) => {
              const grounding = d.meta?.groundingScore;
              return `<tr data-id="${esc(d.id)}" aria-selected="${selected.has(d.id)}">
              <td class="dip-datatable__check"><input type="checkbox" data-check="${esc(d.id)}" aria-label="Select ${esc(d.filename)}"${selected.has(d.id) ? " checked" : ""} /></td>
              <td>
                <a class="dip-datatable__primary" href="${buildHash(`/documents/${d.id}`)}">${esc(d.filename)}</a>
                <span class="dip-datatable__sub">${subline(d)}</span>
              </td>
              <td>${esc(label(d.docType))}</td>
              <td>${statusChip(d)}</td>
              <td class="num">${d.fields?.length ? d.fields.length : '<span class="subtle">—</span>'}</td>
              <td class="num">${typeof grounding === "number" ? esc(pct(grounding)) : '<span class="subtle">—</span>'}</td>
              <td>${issueChip(d)}</td>
              <td class="dip-datatable__actions"></td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
      </div>
      <div class="dip-tablefoot">
        <div class="dip-bulkbar" id="bulkbar"${selected.size ? "" : " hidden"}>
          <span class="dip-bulkbar__count" aria-live="polite">${selected.size} selected</span>
          <button class="arag-btn sm" type="button" data-bulk="csv">Export CSV</button>
          <button class="arag-btn ghost sm" type="button" data-bulk="json">Export JSON</button>
          <button class="arag-btn ghost sm" type="button" data-bulk="xml">Export XML</button>
          <button class="arag-btn danger sm" type="button" data-bulk="delete">Delete</button>
          <button class="arag-btn ghost sm" type="button" id="clearSelection">Clear selection</button>
        </div>
        <nav class="dip-pagination" aria-label="Pagination">
          <span class="dip-pagination__count">${from}–${to} of ${page.total}</span>
          <button class="arag-btn ghost sm" type="button" id="prevPage"${page.page <= 1 ? " disabled" : ""}>Previous</button>
          <button class="arag-btn ghost sm" type="button" id="nextPage"${page.next_page ? "" : " disabled"}>Next</button>
          <label class="sr-only" for="pageSize">Documents per page</label>
          <select class="arag-select" id="pageSize" style="width:auto">
            ${PAGE_SIZES.map((n) => option(String(n), `${n} per page`, f.page_size)).join("")}
          </select>
        </nav>
      </div>
    </div>`;

  // sorting
  for (const b of $$("[data-sort]", host)) {
    b.addEventListener("click", () => {
      const key = b.dataset.sort;
      const order = key === sortKey && sortOrder === "desc" ? "asc" : key === sortKey ? "desc" : "desc";
      navigate("/documents", { ...query, sort: `${key}:${order}`, page: undefined });
    });
  }

  // selection
  const refreshBulk = () => {
    const bar = $("#bulkbar", host);
    bar.hidden = selected.size === 0;
    $(".dip-bulkbar__count", bar).textContent = `${selected.size} selected`;
    announce(`${selected.size} document${selected.size === 1 ? "" : "s"} selected`);
  };
  $("#selectAll", host).addEventListener("change", (e) => {
    for (const id of pageIds) {
      if (e.target.checked) selected.add(id);
      else selected.delete(id);
    }
    for (const cb of $$("[data-check]", host)) cb.checked = selected.has(cb.dataset.check);
    for (const tr of $$("tr[data-id]", host))
      tr.setAttribute("aria-selected", String(selected.has(tr.dataset.id)));
    refreshBulk();
  });
  for (const cb of $$("[data-check]", host)) {
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(cb.dataset.check);
      else selected.delete(cb.dataset.check);
      cb.closest("tr").setAttribute("aria-selected", String(cb.checked));
      refreshBulk();
    });
  }
  $("#clearSelection", host)?.addEventListener("click", () => {
    selected.clear();
    for (const cb of $$("[data-check]", host)) cb.checked = false;
    for (const tr of $$("tr[data-id]", host)) tr.setAttribute("aria-selected", "false");
    refreshBulk();
  });

  // row click (the anchor stays for keyboard and middle-click)
  for (const tr of $$("tr[data-id]", host)) {
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".dip-datatable__check, .dip-datatable__actions, a")) return;
      navigate(`/documents/${tr.dataset.id}`);
    });
    const doc = page.items.find((d) => d.id === tr.dataset.id);
    $(".dip-datatable__actions", tr).appendChild(rowMenu(doc, main, query));
  }

  // bulk actions
  for (const b of $$("[data-bulk]", host)) {
    b.addEventListener("click", () => runBulk(b.dataset.bulk, page, main, query));
  }

  $("#prevPage", host).addEventListener("click", () =>
    navigate("/documents", { ...query, page: String(page.page - 1) }),
  );
  $("#nextPage", host).addEventListener("click", () =>
    navigate("/documents", { ...query, page: String(page.page + 1) }),
  );
  $("#pageSize", host).addEventListener("change", (e) =>
    navigate("/documents", { ...query, page_size: e.target.value, page: undefined }),
  );
}

function rowMenu(doc, main, query) {
  const state = docState(doc);
  return menuButton(
    () => [
      { label: "Open", onSelect: () => navigate(`/documents/${doc.id}`) },
      { label: "Ask this document", onSelect: () => navigate("/ask", { doc: doc.id }) },
      { label: "Export JSON", onSelect: () => exportOne(doc, "json") },
      { label: "Export XML", onSelect: () => exportOne(doc, "xml") },
      { label: "Export CSV", onSelect: () => exportOne(doc, "csv") },
      {
        label: "Reprocess",
        hidden: state !== "failed" && state !== "degraded",
        onSelect: () => reprocess(doc, main, query),
      },
      { label: "Delete", danger: true, onSelect: () => deleteOne(doc, main, query) },
    ],
    { ariaLabel: `Actions for ${doc.filename}` },
  );
}

export async function exportOne(doc, format) {
  const res = await fetch(`/api/v1/documents/${doc.id}/export?format=${format}`, {
    credentials: "same-origin",
  });
  if (!res.ok) return toast(`Export failed (${res.status})`, "error");
  toast(`Downloaded ${await downloadResponse(res, `${doc.filename}.${format}`)}`);
}

export async function reprocess(doc, main, query) {
  try {
    await api(`/api/v1/documents/${doc.id}/reprocess`, { method: "POST" });
    toast(`Reprocessing ${doc.filename}`);
    if (main) renderDocuments(main, { query: query ?? {}, stale: () => false });
  } catch (err) {
    toast(err.message, "error");
  }
}

async function deleteOne(doc, main, query) {
  const ok = await confirmDialog({
    title: "Delete document",
    body: `<p>Delete <strong>${esc(doc.filename)}</strong>? This also deletes the resource from the Knowledge Box. This cannot be undone.</p>`,
    confirmLabel: "Delete document",
  });
  if (!ok) return;
  try {
    await api(`/api/v1/documents/${doc.id}`, { method: "DELETE" });
    selected.delete(doc.id);
    toast("Document deleted — record and Knowledge Box resource");
    renderDocuments(main, { query: query ?? {}, stale: () => false });
  } catch (err) {
    toast(err.message, "error");
  }
}

async function runBulk(kind, page, main, query) {
  const ids = [...selected];
  if (!ids.length) return;
  if (kind === "delete") {
    const names = page.items.filter((d) => ids.includes(d.id)).map((d) => d.filename);
    const ok = await confirmDialog({
      title: `Delete ${ids.length} document${ids.length === 1 ? "" : "s"}`,
      body: `<p>This also deletes ${ids.length === 1 ? "the resource" : "their resources"} from the Knowledge Box. This cannot be undone.</p>
        <ul class="dip-confirm__list">${names
          .slice(0, 5)
          .map((n) => `<li>${esc(n)}</li>`)
          .join("")}</ul>
        ${ids.length > names.slice(0, 5).length ? `<p class="small">…and ${ids.length - Math.min(5, names.length)} more.</p>` : ""}`,
      confirmLabel: `Delete ${ids.length} document${ids.length === 1 ? "" : "s"}`,
    });
    if (!ok) return;
    try {
      const out = await api("/api/v1/documents/bulk-delete", { method: "POST", json: { ids } });
      selected.clear();
      toast(
        out.failed.length
          ? `Deleted ${out.deleted.length}; ${out.failed.length} could not be deleted`
          : `Deleted ${out.deleted.length} documents`,
        out.failed.length ? "error" : "info",
      );
      renderDocuments(main, { query, stale: () => false });
    } catch (err) {
      toast(err.message, "error");
    }
    return;
  }
  const res = await fetch("/api/v1/documents/bulk-export", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, format: kind }),
  });
  if (!res.ok) return toast(`Export failed (${res.status})`, "error");
  toast(`Downloaded ${await downloadResponse(res, `documents.${kind}`)}`);
}

/** The upload drawer is a route over the list, so Back closes it. */
export async function renderUpload(main, ctx) {
  const query = { ...ctx.query };
  await renderDocuments(main, { query, stale: ctx.stale });
  openUploadDrawer({
    onClose: () => navigate("/documents", query, { replace: true }),
    onUploaded: () => renderDocuments(main, { query, stale: () => false }),
    preselect: ctx.query.config,
  });
}

export { selected as documentSelection };
