/**
 * Ask — one document, or every document in this workspace.
 *
 * The per-document ask (`POST /documents/{id}/ask`) is per-resource by design and stays
 * exactly as it was. The corpus ask (`POST /api/v1/ask`) is a second, different endpoint
 * over a filtered set of resources, so the distinction is now a visible control rather than
 * an unstated limitation — and the filter is the Documents list's own filter, so "ask the
 * twelve invoices I am looking at" is the list you are already looking at.
 *
 * The conversation is deliberately not carried across the scope switch: a question answered
 * from one document and the same question answered from twenty are different answers, and
 * stacking them in one thread invites a comparison that is not a comparison.
 */
import {
  $,
  $$,
  announce,
  api,
  buildHash,
  emptyState,
  errorState,
  esc,
  fmtMs,
  headline,
  icon,
  label,
  navigate,
  openDrawer,
  toast,
  wireSegmented,
} from "../lib/core.js";
import { renderAskPanel } from "./document.js";

const SCOPE_KEY = "dip.askScope";
/** The composer's ceiling. Longer questions are a retrieval problem, not a prompt. */
const MAX_QUESTION = 1200;

const readScope = (query) => {
  if (query.scope === "corpus" || query.scope === "document") return query.scope;
  try {
    return localStorage.getItem(SCOPE_KEY) === "corpus" ? "corpus" : "document";
  } catch {
    // A private window has no preference to remember; the grounded single-document answer
    // is the product's strongest moment, so it is the one a stranger meets first.
    return "document";
  }
};

export async function renderAsk(main, { query, stale }) {
  const scope = readScope(query);
  try {
    localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    /* nothing to remember in a private window */
  }

  main.innerHTML = `
    <header class="arag-pagehead">
      <div class="row"><h1>Ask</h1></div>
      <p class="sub">Every answer carries the quote from the document behind it. Nothing is remembered
        between visits — these conversations are not saved.</p>
    </header>
    <div class="dip-scope">
      <div class="arag-segmented" id="askScope" role="tablist" aria-label="What to ask">
        <button type="button" data-value="document" role="tab" aria-controls="askBody" aria-selected="${scope === "document"}">One document</button>
        <button type="button" data-value="corpus" role="tab" aria-controls="askBody" aria-selected="${scope === "corpus"}">Everything in this workspace</button>
      </div>
    </div>
    <div id="askBody" role="tabpanel" tabindex="0"></div>`;

  const body = $("#askBody", main);
  wireSegmented($("#askScope", main), (value) => {
    if (value === scope) return;
    // Cleared, and said so: the thread cannot survive a change of what it was asking.
    announce("Cleared — this asks a different question.");
    navigate("/ask", { scope: value });
  });

  if (scope === "corpus") await renderCorpus(body, query, stale);
  else await renderOneDocument(body, query, stale);
}

// ── one document ─────────────────────────────────────────────────────────────

async function renderOneDocument(body, query, stale) {
  body.innerHTML = `
    <div class="arag-field" style="max-width:640px">
      <label for="docPick">Document</label>
      <select class="arag-select" id="docPick"><option>Loading…</option></select>
    </div>
    <div id="askPanel" style="margin-top:16px"></div>`;

  let page;
  try {
    page = await api("/api/v1/documents?page_size=100&sort=created_at&order=desc");
  } catch (err) {
    if (!stale()) $("#askPanel", body).innerHTML = errorState(err);
    return;
  }
  if (stale()) return;

  const askable = page.items.filter((d) => d.status === "ready");
  const picker = $("#docPick", body);
  if (!askable.length) {
    picker.parentElement.hidden = true;
    $("#askPanel", body).innerHTML = emptyState({
      icon: "document",
      title: "Nothing to ask yet",
      body: "Documents become searchable once they finish processing.",
      actions: `<a class="arag-btn" href="${buildHash("/documents/upload")}">Upload a document</a>`,
    });
    return;
  }
  picker.innerHTML = askable
    .map((d) => {
      const h = headline(d);
      const tail = [h.counterparty, h.identifier].filter(Boolean).join(", ");
      return `<option value="${esc(d.id)}">${esc(d.filename)}${tail ? ` — ${esc(tail)}` : ""} · ${esc(label(d.docType))}</option>`;
    })
    .join("");
  picker.value = query.doc && askable.some((d) => d.id === query.doc) ? query.doc : askable[0].id;

  const show = (id) =>
    renderAskPanel(
      $("#askPanel", body),
      askable.find((d) => d.id === id),
    );
  picker.addEventListener("change", () => {
    navigate("/ask", { scope: "document", doc: picker.value }, { replace: true });
    show(picker.value);
  });
  show(picker.value);
}

// ── the whole workspace ──────────────────────────────────────────────────────

const FILTER_KEYS = ["q", "doc_type", "config"];

/** The filter the Documents list uses, in the shape `POST /api/v1/ask` takes. */
function filtersFrom(query) {
  const out = {};
  if (query.q) out.q = query.q;
  if (query.config) out.config = query.config;
  if (query.doc_type) out.doc_type = [].concat(query.doc_type);
  return out;
}

async function renderCorpus(body, query, stale) {
  body.innerHTML = `<div class="arag-skeleton" style="width:50%"></div>`;
  const filters = filtersFrom(query);
  let facets;
  let configs;
  let scope;
  try {
    const qs = new URLSearchParams({ page_size: "1" });
    if (filters.q) qs.set("q", filters.q);
    if (filters.config) qs.set("config", filters.config);
    for (const t of filters.doc_type ?? []) qs.append("doc_type", t);
    const scoped = new URLSearchParams(qs);
    scoped.set("status", "ready");
    [facets, scope, configs] = await Promise.all([
      api("/api/v1/documents?page_size=1"),
      api(`/api/v1/documents?${scoped}`),
      api("/api/v1/extraction-configs").catch(() => ({ items: [] })),
    ]);
  } catch (err) {
    if (!stale()) body.innerHTML = errorState(err);
    return;
  }
  if (stale()) return;

  const searchable = scope.total;
  const notReady = facets.total - (facets.facets?.status?.ready ?? 0);
  const filtered = FILTER_KEYS.some((k) => query[k]);
  const docTypes = Object.keys(facets.facets?.docType ?? {}).sort();

  body.innerHTML = `
    <p class="dip-scopeline" id="scopeLine">${
      filtered
        ? `Answers come from the <strong>${searchable}</strong> document${searchable === 1 ? "" : "s"} matching these filters.`
        : `Answers come from the <strong>${searchable}</strong> document${
            searchable === 1 ? "" : "s"
          } in this workspace's Knowledge Box.${
            notReady > 0
              ? ` ${notReady} ${notReady === 1 ? "is" : "are"} still processing and not searchable yet.`
              : ""
          }`
    }</p>
    <div class="arag-filterbar">
      <div class="arag-search">${icon("search")}
        <label class="sr-only" for="askQ">Limit to documents matching</label>
        <input class="arag-input" id="askQ" type="search" value="${esc(query.q ?? "")}" placeholder="Limit to documents matching…" />
      </div>
      <label class="sr-only" for="askType">Type</label>
      <select class="arag-select" id="askType">
        <option value="">Any type</option>
        ${docTypes
          .map(
            (t) =>
              `<option value="${esc(t)}"${[].concat(query.doc_type ?? []).includes(t) ? " selected" : ""}>${esc(label(t))}</option>`,
          )
          .join("")}
      </select>
      <label class="sr-only" for="askCfg">Config</label>
      <select class="arag-select" id="askCfg">
        <option value="">Any config</option>
        ${configs.items
          .map(
            (c) =>
              `<option value="${esc(c.id)}"${query.config === c.id ? " selected" : ""}>${esc(c.name)}</option>`,
          )
          .join("")}
      </select>
      ${filtered ? '<button class="arag-btn ghost sm" type="button" id="askClear">Clear filters</button>' : ""}
      <span class="spacer"></span>
      <a class="small" href="${buildHash("/documents", { q: query.q, doc_type: query.doc_type, config: query.config })}">See these documents ›</a>
    </div>
    <div id="corpusThread" class="arag-chat" role="log" aria-live="polite"></div>
    <div id="corpusEmpty"></div>
    <div class="arag-row" style="margin-top:12px;align-items:flex-end">
      <div class="arag-field" style="flex:1;margin:0">
        <label class="sr-only" for="corpusInput">Ask something about these documents</label>
        <textarea class="arag-textarea" id="corpusInput" rows="2" maxlength="${MAX_QUESTION}"
          placeholder="Ask something about these documents…"${searchable ? "" : " disabled"}></textarea>
      </div>
      <button class="arag-btn" type="button" id="corpusAsk"${searchable ? "" : " disabled"}>Ask</button>
    </div>
    <p class="arag-help"><span id="corpusCount">0</span> / ${MAX_QUESTION} · ⌘↵ or Ctrl+↵ sends; Enter starts a new line.
      Answers are drawn from these documents, not from the model's general knowledge.</p>`;

  const push = (k, v) => navigate("/ask", { ...query, scope: "corpus", [k]: v || undefined });
  let deb;
  $("#askQ", body).addEventListener("input", (e) => {
    clearTimeout(deb);
    const v = e.target.value;
    deb = setTimeout(() => push("q", v), 350);
  });
  $("#askType", body).addEventListener("change", (e) => push("doc_type", e.target.value));
  $("#askCfg", body).addEventListener("change", (e) => push("config", e.target.value));
  $("#askClear", body)?.addEventListener("click", () => navigate("/ask", { scope: "corpus" }));

  if (!searchable) {
    $("#corpusEmpty", body).innerHTML = filtered
      ? emptyState({
          icon: "search",
          title: "No document matches these filters",
          body: "Widen the filters and the scope line will say how many documents the next question reaches.",
          actions: '<button class="arag-btn secondary" type="button" id="widen">Clear filters</button>',
        })
      : emptyState({
          icon: "document",
          title: "Nothing to ask yet",
          body: "Documents become searchable once they finish processing.",
          actions: `<a class="arag-btn" href="${buildHash("/documents/upload")}">Upload a document</a>`,
        });
    $("#widen", body)?.addEventListener("click", () => navigate("/ask", { scope: "corpus" }));
    return;
  }

  $("#corpusEmpty", body).innerHTML = emptyState({
    icon: "document",
    title: "Ask across every document here",
    body: "Questions are answered from the documents in this workspace's Knowledge Box, with the quote from each document behind every claim.",
    actions: starters(docTypes)
      .map(
        (s) => `<button class="arag-btn ghost sm" type="button" data-starter="${esc(s)}">${esc(s)}</button>`,
      )
      .join(""),
  });

  const input = $("#corpusInput", body);
  const thread = $("#corpusThread", body);
  const counter = $("#corpusCount", body);
  input.addEventListener("input", () => {
    counter.textContent = String(input.value.length);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      ask();
    }
  });
  for (const b of $$("[data-starter]", body)) {
    b.addEventListener("click", () => {
      input.value = b.dataset.starter;
      counter.textContent = String(input.value.length);
      input.focus();
      ask();
    });
  }
  $("#corpusAsk", body).addEventListener("click", () => ask());
  input.focus();

  async function ask() {
    const question = input.value.trim();
    if (!question) return;
    $("#corpusEmpty", body).innerHTML = "";
    input.value = "";
    counter.textContent = "0";
    const id = `a${Date.now()}`;
    thread.insertAdjacentHTML(
      "beforeend",
      `<div class="arag-bubble user">${esc(question)}</div>
       <div class="arag-bubble assistant" id="${id}">Searching ${searchable} document${searchable === 1 ? "" : "s"}…</div>`,
    );
    thread.lastElementChild.scrollIntoView({ block: "nearest" });
    const btn = $("#corpusAsk", body);
    btn.disabled = true;
    try {
      const r = await api("/api/v1/ask", {
        method: "POST",
        json: { question, filters, maxResources: 50 },
      });
      document.getElementById(id).outerHTML = answerHtml(r);
      wireCitations(thread);
      announce(
        r.citations.length
          ? `Answer ready. ${r.citations.length} quote${r.citations.length === 1 ? "" : "s"} from ${
              r.documents.length
            } document${r.documents.length === 1 ? "" : "s"}.`
          : "Answer ready, with no source returned.",
      );
    } catch (err) {
      const el = document.getElementById(id);
      el.outerHTML = `<div class="arag-alert error" role="alert">That question could not be answered. ${esc(
        err.message,
      )}</div>`;
      // The question goes back in the composer rather than being lost to a failed call.
      input.value = question;
      counter.textContent = String(question.length);
      if (err.status === 429) toast("You are asking faster than this deployment allows.", "error");
    } finally {
      btn.disabled = false;
    }
  }
}

/** Starter questions drawn from what is actually in this workspace, not from a fixture. */
function starters(docTypes) {
  const known = {
    invoice: "Which suppliers have invoiced the most?",
    purchase_order: "Which purchase orders are still open?",
    contract: "Which contracts mention a termination notice period?",
    receipt: "What did we spend the most on?",
    bank_statement: "Which statements show the largest transactions?",
    medical_claim: "Which claims are for the largest amounts?",
    preauthorisation: "Which authorisations approved the longest stay?",
    resume: "Which candidates have the most experience?",
  };
  const picked = docTypes
    .map((t) => known[t])
    .filter(Boolean)
    .slice(0, 3);
  return picked.length ? picked : ["What do these documents have in common?"];
}

function answerHtml(r) {
  const cites = r.citations ?? [];
  // Citations are numbered in the order they came back, and the Sources block groups them by
  // document — three quotes from one invoice is one row with three quotes, not three rows.
  const byDoc = new Map();
  cites.forEach((c, i) => {
    const entry = byDoc.get(c.documentId) ?? { doc: c, quotes: [] };
    entry.quotes.push({ n: i + 1, c });
    byDoc.set(c.documentId, entry);
  });
  const marks = cites
    .map(
      (c, i) =>
        `<button class="arag-cite" type="button" data-cite="${i}" data-doc="${esc(c.documentId)}"
           aria-label="Source ${i + 1}, ${esc(c.filename)}, ${esc(c.text.slice(0, 80))}">[${i + 1}]</button>`,
    )
    .join(" ");

  return `<div class="arag-bubble assistant">
      ${esc(r.answer || "No document in this workspace matched that question.")}
      ${cites.length ? `<div class="arag-row small" style="margin-top:8px">${marks}</div>` : ""}
      ${
        cites.length
          ? `<h4 style="margin:12px 0 0;font-size:0.8125rem">Sources</h4>
             <ol class="dip-sources">
               ${[...byDoc.values()]
                 .map(
                   (e) => `<li>
                     <span class="num">[${e.quotes.map((q) => q.n).join("][")}]</span>
                     <span class="doc">${esc(e.doc.filename)} · ${esc(label(e.doc.docType))}${
                       e.quotes.length > 1 ? ` · ${e.quotes.length} quotes` : ""
                     }</span>
                     <a class="open arag-btn ghost sm" href="${buildHash(`/documents/${e.doc.documentId}/source`)}">${icon(
                       "external-link",
                       { size: 13 },
                     )} Open the record</a>
                     ${e.quotes
                       .map(
                         (q) =>
                           `<blockquote class="dip-quote" data-cite-quote="${q.n - 1}">“${esc(
                             q.c.text.slice(0, 320),
                           )}”</blockquote>`,
                       )
                       .join("")}
                   </li>`,
                 )
                 .join("")}
             </ol>`
          : `<div class="arag-alert warn" style="margin-top:8px"><strong>No source returned.</strong>
               The model answered without quoting any document. Treat it as unverified.</div>`
      }
      <p class="small subtle" style="margin:8px 0 0">${cites.length} quote${
        cites.length === 1 ? "" : "s"
      } from ${(r.documents ?? []).length} document${(r.documents ?? []).length === 1 ? "" : "s"} · searched ${
        r.scope?.documents ?? 0
      } · ${esc(fmtMs(r.ms))}</p>
    </div>`;
}

/**
 * A citation opens the quote in a drawer rather than navigating: the thread is the work, and
 * losing it to check a quote is the failure mode this screen exists to avoid.
 */
function wireCitations(root) {
  for (const b of $$("[data-cite]", root)) {
    if (b.dataset.wired) continue;
    b.dataset.wired = "1";
    b.addEventListener("click", () => {
      const bubble = b.closest(".arag-bubble");
      const quote = $(`[data-cite-quote="${b.dataset.cite}"]`, bubble);
      openSource(b.dataset.doc, quote?.textContent?.replace(/^[“"]|[”"]$/g, "") ?? "");
    });
  }
}

async function openSource(documentId, quote) {
  const drawer = openDrawer({
    wide: true,
    title: "Source",
    body: '<div class="arag-skeleton" style="height:200px"></div>',
    foot: `<a class="arag-btn" href="${buildHash(`/documents/${documentId}/source`)}">Open the full record ›</a>`,
  });
  try {
    const [doc, text] = await Promise.all([
      api(`/api/v1/documents/${documentId}`),
      api(`/api/v1/documents/${documentId}/text`),
    ]);
    $("#aragDrawerTitle", drawer.host).textContent = doc.filename;
    const at = quote ? text.text.indexOf(quote.slice(0, 120)) : -1;
    const marked =
      at === -1
        ? esc(text.text)
        : `${esc(text.text.slice(0, at))}<mark class="dip-hit is-active" id="citeHit">${esc(
            text.text.slice(at, at + quote.length),
          )}</mark>${esc(text.text.slice(at + quote.length))}`;
    $(".arag-drawer .body", drawer.host).innerHTML = `
      ${
        at === -1
          ? '<div class="arag-alert warn">Quote not found in this document’s extracted text, so it cannot be located below.</div>'
          : ""
      }
      <pre class="dip-source__text">${marked}</pre>`;
    document.getElementById("citeHit")?.scrollIntoView({ block: "center" });
  } catch (err) {
    $(".arag-drawer .body", drawer.host).innerHTML = errorState(err);
  }
}
