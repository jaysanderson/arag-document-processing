/**
 * Document detail — the verified-evidence record.
 *
 * This is the screen the product is judged on, so the three signals that arrive with
 * every record are kept apart on purpose: confidence is the model's self-report,
 * verification is our check of the quote against the document's own text, and validation
 * is deterministic arithmetic. Verification outranks confidence everywhere: nothing here
 * gives a confident-but-unverified value a green treatment.
 */
import {
  $,
  $$,
  api,
  buildHash,
  confirmDialog,
  docState,
  errorState,
  esc,
  failureAdvice,
  fmtAbsolute,
  fmtBytes,
  fmtMs,
  headline,
  icon,
  jobChip,
  label,
  menuButton,
  navigate,
  onLeave,
  pct,
  popover,
  sse,
  statusChip,
  toast,
  verifyOf,
  wireTabs,
} from "../lib/core.js";
import { exportOne, reprocess } from "./documents.js";

const TABS = [
  ["", "Record"],
  ["source", "Source & evidence"],
  ["pipeline", "Pipeline"],
  ["ask", "Ask"],
  ["json", "JSON"],
];

const STAGE_GLOSSARY = [
  [
    "process",
    "Progress Agentic RAG reads the file — OCR, visual layout and embeddings — and waits until it is searchable.",
  ],
  [
    "classify",
    "An agent picks one of the built-in document types. Skipped when a config is forced on upload.",
  ],
  [
    "extract",
    "The type's stored ARAG search configuration runs, forcing the declared fields plus a verbatim quote for each.",
  ],
  ["entities", "People, organisations, dates, amounts and locations."],
  ["summary", "A plain-language summary and topic tags."],
  [
    "validate",
    "Deterministic checks: amounts re-added, dates normalised, required fields confirmed. No model involved.",
  ],
  [
    "standardize",
    "Everything is assembled into the canonical record and each quote is checked against the document's own text.",
  ],
];

const ISSUE_CONSEQUENCE = [
  [/≠ total|does not reconcile|subtotal/i, "Check the printed total against the line items before posting."],
  [
    /required field/i,
    "The schema requires this field. The document may not contain it, or it may be on a page that did not read cleanly.",
  ],
  [/could not parse amount/i, "The value is kept exactly as written and has not been converted to a number."],
  [
    /not iso|left as-is/i,
    "The value is kept as written. Downstream systems expecting ISO dates will need to handle it.",
  ],
  [/stage failed|stage error/i, "This part of the record is missing. Reprocess to try again."],
  [
    /quote|evidence/i,
    "The value is not backed by the document. Check it against the source before using it.",
  ],
];

const consequence = (msg) => ISSUE_CONSEQUENCE.find(([re]) => re.test(msg))?.[1] ?? "";

/**
 * Fields are shown in schema order — a person reads an invoice in the shape of an invoice —
 * with the rest behind a disclosure so a fourteen-field claim form is still scannable. The
 * exception is above: anything unverified is pinned into "Check these first", because trust
 * beats familiarity when the two conflict.
 */
const FIELD_PREVIEW = 10;

let closeStream = null;

export async function renderDocument(main, { params, query, stale }, tab = "") {
  closeStream?.();
  closeStream = null;
  main.innerHTML = `<div class="dip-skeleton" style="width:40%"></div>${'<div class="dip-skeleton"></div>'.repeat(5)}`;
  let doc;
  try {
    doc = await api(`/api/v1/documents/${params.id}`);
  } catch (err) {
    if (stale()) return;
    main.innerHTML =
      err.status === 404
        ? errorState(
            { message: "This document no longer exists. It may have been deleted or purged." },
            {
              retry: `<a class="arag-btn secondary sm" href="${buildHash("/documents")}">Back to documents</a>`,
            },
          )
        : errorState(err);
    return;
  }
  if (stale()) return;

  const h = headline(doc);
  const title = [h.counterparty, h.identifier].filter(Boolean).join(" — ") || doc.filename;
  main.innerHTML = `
    <header class="dip-pagehead">
      <nav class="dip-breadcrumb" aria-label="Breadcrumb">
        <ol>
          <li><a href="${buildHash("/documents")}">Documents</a></li>
          <li aria-current="page" title="${esc(doc.filename)}">${esc(doc.filename)}</li>
        </ol>
      </nav>
      <div class="dip-pagehead__row">
        <h1>${esc(title)}</h1>
        <div class="dip-pagehead__actions" id="docActions">
          <button class="arag-btn secondary" type="button" id="exportCsv">${icon("download")} Export CSV</button>
          <a class="arag-btn ghost" href="${buildHash(`/documents/${doc.id}/ask`)}">Ask</a>
        </div>
      </div>
    </header>
    <div class="arag-tabs dip-tabs" role="tablist">
      ${TABS.map(([slug, text]) => {
        const href = buildHash(`/documents/${doc.id}${slug ? `/${slug}` : ""}`);
        const on = slug === tab;
        return `<a role="tab" href="${href}" aria-selected="${on}" tabindex="${on ? 0 : -1}">${esc(text)}</a>`;
      }).join("")}
    </div>
    <div id="tabPanel" role="tabpanel" tabindex="0"></div>`;

  $("#exportCsv", main).addEventListener("click", () => exportOne(doc, "csv"));
  $("#docActions", main).appendChild(
    menuButton(
      () => [
        { label: "Export JSON", onSelect: () => exportOne(doc, "json") },
        { label: "Export XML", onSelect: () => exportOne(doc, "xml") },
        { label: "Reprocess", onSelect: () => reprocess(doc, null) },
        { label: "Copy document id", onSelect: () => copy(doc.id, "Document id copied") },
        { label: "Copy job id", hidden: !doc.jobId, onSelect: () => copy(doc.jobId, "Job id copied") },
        { label: "Delete document", danger: true, onSelect: () => remove(doc) },
      ],
      { ariaLabel: `More actions for ${doc.filename}` },
    ),
  );

  const panel = $("#tabPanel", main);
  wireTabs($(".dip-tabs", main), panel);
  if (tab === "source") await renderSource(panel, doc, query);
  else if (tab === "pipeline") await renderPipeline(panel, doc);
  else if (tab === "ask") renderAskTab(panel, doc);
  else if (tab === "json") renderJson(panel, doc);
  else renderRecord(panel, doc);

  // A document that is still moving should move on screen too — and the stream is closed
  // when the screen is left, not only when this screen renders again.
  if ((doc.status === "pending" || doc.status === "processing") && doc.jobId) {
    onLeave(() => {
      closeStream?.();
      closeStream = null;
    });
    closeStream = sse(`/api/v1/jobs/${doc.jobId}/events`, {
      job: (payload) => {
        const j = payload.job ?? payload;
        if (["succeeded", "failed", "cancelled"].includes(j.status)) {
          closeStream?.();
          closeStream = null;
          renderDocument(main, { params, query, stale: () => false }, tab);
        }
      },
    });
  }
}

async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast("Copy failed — select the text manually.", "error");
  }
}

async function remove(doc) {
  const ok = await confirmDialog({
    title: "Delete document",
    body: `<p>Delete <strong>${esc(doc.filename)}</strong>? This also deletes the resource from the Knowledge Box. This cannot be undone.</p>`,
    confirmLabel: "Delete document",
  });
  if (!ok) return;
  await api(`/api/v1/documents/${doc.id}`, { method: "DELETE" });
  toast("Document deleted — record and Knowledge Box resource");
  navigate("/documents");
}

// ── record tab ───────────────────────────────────────────────────────────────

function groundingStrip(doc) {
  const fields = doc.fields ?? [];
  const evidence = doc.evidence ?? [];
  const byField = new Map(evidence.map((e) => [e.field, e]));
  const exact = evidence.filter((e) => e.verified === "exact").length;
  const near = evidence.filter((e) => e.verified === "normalised").length;
  const none = fields.length - exact - near;
  const score = doc.meta?.groundingScore;

  let band = "strong";
  let scoreHtml = "";
  let claim = "";
  if (!fields.length) {
    band = "empty";
    claim = "No fields were extracted, so there is nothing to check against the document.";
  } else if (!evidence.length) {
    // A missing measurement and a measured zero are different facts. Never show 0%.
    band = "none";
    claim =
      "No evidence returned. This record's fields are not backed by quotes — treat every value as unchecked.";
  } else {
    const verified = fields.filter((f) => {
      const v = byField.get(f.key);
      return v && v.verified !== "unverified";
    }).length;
    const ratio = typeof score === "number" ? score : verified / fields.length;
    band = ratio >= 0.85 ? "strong" : ratio >= 0.5 ? "partial" : "weak";
    claim = `${verified} of ${fields.length} fields carry a quote found in this document.`;
    scoreHtml = `<div class="dip-grounding__score">
        <span class="dip-grounding__label">Grounding</span>
        <span class="dip-grounding__pct">${esc(pct(ratio))}</span>
        <span class="arag-progress" role="img" aria-label="Grounding: ${band}, ${claim}"><i style="width:${Math.round(ratio * 100)}%"></i></span>
        <span class="small muted">${esc(label(band))}</span>
      </div>`;
  }

  const durations = Object.values(doc.meta?.durationsMs ?? {}).reduce((a, b) => a + b, 0);
  const issues = (doc.issues ?? []).filter((i) => i.severity !== "info");
  return `<section class="dip-grounding" data-band="${band}">
    ${scoreHtml}
    <div>
      <p class="dip-grounding__claim">${esc(claim)}</p>
      ${
        evidence.length
          ? `<p class="dip-grounding__breakdown">${exact} exact · ${near} near match · ${Math.max(0, none)} no quote</p>`
          : ""
      }
    </div>
    <div class="dip-grounding__facts">
      ${statusChip(doc)}
      <span>${esc(label(doc.meta?.forced ? doc.meta.config : doc.docType))}${
        doc.meta?.forced
          ? ' <span class="subtle" title="Auto-classification was skipped — this config was chosen on upload.">· config forced</span>'
          : doc.docTypeConfidence
            ? ` · ${esc(pct(doc.docTypeConfidence))} classifier`
            : ""
      }</span>
      ${issues.length ? `<span class="arag-chip ${issues.some((i) => i.severity === "error") ? "danger" : "warn"}">${issues.length} ${issues.length === 1 ? "issue" : "issues"}</span>` : ""}
      <span>${esc(fmtMs(durations))}</span>
      <span class="spacer" style="flex:1"></span>
      <button class="dip-help" type="button" id="groundingHelp">${icon("info", { size: 14 })} What is this?</button>
    </div>
  </section>`;
}

function valueHtml(f) {
  if (Array.isArray(f.value)) {
    const shown = f.value.slice(0, 5);
    return `<ul>${shown.map((v) => `<li>${esc(String(v))}</li>`).join("")}</ul>${
      f.value.length > 5 ? `<span class="small muted">+ ${f.value.length - 5} more</span>` : ""
    }`;
  }
  const v = f.value;
  if (v === null || v === undefined || v === "") return '<span class="dip-field__empty">Not found</span>';
  const raw =
    f.raw && String(f.raw) !== String(v)
      ? `<span class="dip-field__raw">raw “${esc(String(f.raw))}”</span>`
      : "";
  return `${esc(String(v))} ${raw}`;
}

function fieldRow(doc, f, evidence, issues) {
  const ev = evidence.get(f.key);
  const v = verifyOf(ev);
  const unverified = !ev || ev.verified === "unverified";
  const conf = typeof f.confidence === "number" ? Math.round(f.confidence * 100) : null;
  const mine = issues.filter((i) => i.field === f.key);
  return `<div class="dip-field${unverified ? " dip-field--unverified" : ""}" id="field-${esc(f.key)}" tabindex="-1">
    <div class="dip-field__label">${esc(f.label)}</div>
    <div class="dip-field__value">${valueHtml(f)}</div>
    <div class="dip-field__meta">
      ${
        conf === null
          ? ""
          : `<span class="dip-field__conf" title="How sure the model was of this value. It is not a check against the document.">
               <span class="arag-progress" role="img" aria-label="Confidence ${conf} per cent"><i style="width:${conf}%"></i></span> ${conf}%</span>`
      }
      <span class="arag-chip ${v.cls}">${esc(v.text)}</span>
    </div>
    ${
      ev
        ? `<details class="dip-field__evidence"><summary>Evidence</summary>
             <blockquote class="dip-quote">“${esc(ev.quote)}”</blockquote>
             <a class="dip-field__jump" href="${buildHash(`/documents/${doc.id}/source`, { ev: f.key })}">${icon("external-link", { size: 13 })} Open in source</a>
           </details>`
        : `<p class="small muted" style="margin:6px 0 0">This value is not backed by a quote from the document. Check it against the source before using it.
             <a class="dip-field__jump" href="${buildHash(`/documents/${doc.id}/source`)}">Open source</a></p>`
    }
    ${mine
      .map(
        (i) =>
          `<div class="arag-alert ${i.severity === "error" ? "error" : i.severity === "warning" ? "warn" : ""} dip-field__issue">${esc(i.message)}</div>`,
      )
      .join("")}
  </div>`;
}

function renderRecord(panel, doc) {
  const evidence = new Map((doc.evidence ?? []).map((e) => [e.field, e]));
  const issues = doc.issues ?? [];
  const fields = doc.fields ?? [];
  // Schema order, because a person reads an invoice in the shape of an invoice — with one
  // exception: an unverified field is pinned to the top, because trust beats familiarity.
  const risky = fields.filter((f) => {
    const ev = evidence.get(f.key);
    return !ev || ev.verified === "unverified";
  });
  const stageErrors = doc.meta?.stageErrors ?? [];

  panel.innerHTML = `
    ${groundingStrip(doc)}
    ${
      docState(doc) === "failed"
        ? `<div class="arag-alert error dip-prose" role="alert"><strong>Processing failed.</strong> ${esc(doc.error ?? "")}<br />${esc(failureAdvice(doc.error))}
             <div style="margin-top:8px"><button class="arag-btn sm" type="button" id="retryDoc">Reprocess</button></div></div>`
        : ""
    }
    ${
      stageErrors.length
        ? `<div class="arag-alert warn dip-prose"><strong>Degraded.</strong> ${esc(stageErrors.join("; "))}. The extracted fields are unaffected.
             <div style="margin-top:8px"><button class="arag-btn sm secondary" type="button" id="retryDoc2">Reprocess</button></div></div>`
        : ""
    }
    ${issues
      .filter((i) => i.severity !== "info")
      .map(
        (i) => `<div class="arag-alert ${i.severity === "error" ? "error" : "warn"} dip-prose">
            <strong>${esc(label(i.field))}</strong> — ${esc(i.message)}
            ${consequence(i.message) ? `<div class="small" style="margin-top:4px">${esc(consequence(i.message))}</div>` : ""}
            <div style="margin-top:6px"><a href="#field-${esc(i.field)}" data-focus-field="${esc(i.field)}">Go to field ›</a></div>
          </div>`,
      )
      .join("")}

    <div class="dip-split" style="margin-top:16px">
      <section>
        ${
          risky.length && fields.length
            ? `<h2>Check these first (${risky.length})</h2>
               <div class="dip-fields">${risky.map((f) => fieldRow(doc, f, evidence, issues)).join("")}</div>`
            : ""
        }
        <h2>Extracted fields (${fields.length})</h2>
        ${
          fields.length
            ? `<div class="dip-fields">${fields
                .slice(0, FIELD_PREVIEW)
                .map((f) => fieldRow(doc, f, evidence, issues))
                .join("")}</div>
               ${
                 fields.length > FIELD_PREVIEW
                   ? `<details id="allFields"><summary class="arag-btn ghost sm" style="display:inline-flex;margin-top:12px">Show all fields (${fields.length - FIELD_PREVIEW} more)</summary>
                        <div class="dip-fields">${fields
                          .slice(FIELD_PREVIEW)
                          .map((f) => fieldRow(doc, f, evidence, issues))
                          .join("")}</div>
                      </details>`
                   : ""
               }`
            : `<div class="arag-empty">No fields were extracted. Nothing matched this schema — try a different extraction config.</div>`
        }
      </section>
      <aside class="arag-stack">
        <div class="arag-card">
          <div class="head"><h3>Summary</h3></div>
          <div class="body">
            ${
              doc.summary
                ? `<p class="dip-prose">${esc(doc.summary)}</p>
                   <div class="dip-chips">${(doc.tags ?? []).map((t) => `<span class="arag-chip neutral">${esc(t)}</span>`).join("")}</div>`
                : `<p class="muted">${stageErrors.some((s) => s.startsWith("summary")) ? "Not produced — the summary stage failed." : "No summary was produced."}</p>`
            }
          </div>
        </div>
        <div class="arag-card">
          <div class="head"><h3>Entities (${(doc.entities ?? []).length})</h3></div>
          <div class="body">
            ${
              (doc.entities ?? []).length
                ? `<div class="dip-chips">${doc.entities
                    .slice(0, 24)
                    .map((e) => `<span class="dip-entity"><b>${esc(e.type)}</b>${esc(e.text)}</span>`)
                    .join("")}</div>`
                : '<p class="muted">No entities surfaced.</p>'
            }
          </div>
        </div>
        <div class="arag-card">
          <div class="head"><h3>How this was produced</h3></div>
          <div class="body">
            <dl class="arag-kv">
              <dt>Config</dt><dd>${esc(doc.meta?.config ?? doc.docType)}${doc.meta?.forced ? " (forced)" : " (auto-detected)"}</dd>
              <dt>Schema</dt><dd class="mono">${esc(doc.meta?.schema ?? "—")}</dd>
              <dt>Model</dt><dd>${esc(doc.meta?.model ?? "—")}</dd>
              <dt>ARAG config</dt><dd class="mono">${esc(doc.meta?.searchConfiguration ?? "—")}</dd>
              <dt>Source</dt><dd>${doc.meta?.sourceChars ? `${doc.meta.sourceChars.toLocaleString()} characters` : "—"} · ${esc(fmtBytes(doc.bytes))}</dd>
              <dt>Run</dt><dd>${esc(fmtAbsolute(doc.meta?.processedAt))}</dd>
              <dt>Document id</dt><dd class="mono small">${esc(doc.id)}</dd>
            </dl>
          </div>
        </div>
        <div class="arag-card dip-danger-zone">
          <div class="head"><h3>Danger zone</h3></div>
          <div class="body">
            <p class="muted small">Deleting removes the record and the Knowledge Box resource.</p>
            <button class="arag-btn danger sm" type="button" id="deleteDoc">Delete document</button>
          </div>
        </div>
      </aside>
    </div>`;

  $("#groundingHelp", panel)?.addEventListener("click", (e) => {
    e.currentTarget.id = "groundingHelp";
    popover(
      e.currentTarget,
      `<p>Each extracted value is asked for with the sentence that supports it. We then look for that sentence in the text Progress Agentic RAG read from your document.</p>
       <p><strong>Exact</strong> means we found it character for character; <strong>near match</strong> means we found it after ignoring case, spacing and punctuation; <strong>no quote</strong> means we did not find it, or the model returned none.</p>`,
    );
  });
  for (const a of $$("[data-focus-field]", panel)) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const el = document.getElementById(`field-${a.dataset.focusField}`);
      if (!el) return;
      // The field may be inside the "Show all fields" disclosure.
      el.closest("details")?.setAttribute("open", "");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("is-highlighted");
      el.focus();
      setTimeout(() => el.classList.remove("is-highlighted"), 1400);
    });
  }
  $("#deleteDoc", panel)?.addEventListener("click", () => remove(doc));
  for (const id of ["retryDoc", "retryDoc2"]) {
    $(`#${id}`, panel)?.addEventListener("click", () => reprocess(doc, null));
  }
}

// ── source & evidence tab ────────────────────────────────────────────────────

function markUp(text, evidence) {
  // Build the marked HTML in one pass over sorted, non-overlapping spans.
  const spans = evidence
    .filter((e) => typeof e.start === "number" && typeof e.end === "number" && e.end > e.start)
    .sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const s of spans) {
    if (s.start < cursor) continue;
    out += esc(text.slice(cursor, s.start));
    out += `<mark class="dip-hit" id="hit-${esc(s.field)}" tabindex="-1">${esc(text.slice(s.start, s.end))}</mark>`;
    cursor = s.end;
  }
  out += esc(text.slice(cursor));
  return out;
}

const ORDER = { unverified: 0, normalised: 1, exact: 2 };

async function renderSource(panel, doc, query) {
  panel.innerHTML = `<div class="dip-skeleton" style="width:30%"></div>${'<div class="dip-skeleton"></div>'.repeat(8)}`;
  let text = null;
  let textError = null;
  try {
    text = await api(`/api/v1/documents/${doc.id}/text`);
  } catch (err) {
    textError = err;
  }

  const evidence = [...(doc.evidence ?? [])].sort(
    (a, b) => (ORDER[a.verified] ?? 0) - (ORDER[b.verified] ?? 0),
  );
  const fieldLabels = new Map((doc.fields ?? []).map((f) => [f.key, f.label]));
  const missing = (doc.fields ?? []).filter((f) => !evidence.some((e) => e.field === f.key));

  panel.innerHTML = `
    <div class="dip-source">
      <section class="arag-card">
        <div class="head"><h3>Evidence (${evidence.length + missing.length})</h3></div>
        <div class="dip-source__rail" id="rail">
          ${missing
            .map(
              (f) => `<div class="dip-source__item"><strong>${esc(f.label)}</strong>
                <div class="small muted">No quote returned for this field. Nothing to verify.</div></div>`,
            )
            .join("")}
          ${evidence
            .map((e) => {
              const v = verifyOf(e);
              const locatable = typeof e.start === "number";
              return `<button class="dip-source__item" type="button" data-ev="${esc(e.field)}"${locatable ? "" : " disabled"}
                        title="${locatable ? "Show this quote in the source text" : "This quote could not be located in the source text"}">
                  <span class="arag-chip ${v.cls}">${esc(v.text)}</span>
                  <strong style="display:block;margin-top:4px">${esc(fieldLabels.get(e.field) ?? e.field)}</strong>
                  <span class="dip-quote" style="margin:4px 0 0">“${esc(e.quote)}”</span>
                  <span class="small subtle">${locatable ? `characters ${e.start}–${e.end}` : "position not found"}</span>
                </button>`;
            })
            .join("")}
        </div>
        <div class="body small muted">
          Legend: <span class="arag-chip ok">Verified</span> found verbatim ·
          <span class="arag-chip warn">Near match</span> found after ignoring case, spacing and punctuation ·
          <span class="arag-chip danger">Quote not found</span>
        </div>
      </section>
      <section class="arag-card">
        <div class="head">
          <h3>Source text</h3>
          <div class="arag-row">
            <button class="arag-btn ghost sm" type="button" data-view="text" aria-pressed="true">Extracted text</button>
            <button class="arag-btn ghost sm" type="button" data-view="file" aria-pressed="false">Original file</button>
          </div>
        </div>
        <div class="body">
          <div id="viewText">
            ${
              textError
                ? errorState({
                    message:
                      "The source text is no longer available, so the quotes above cannot be located in the document.",
                  })
                : `<pre class="dip-source__text" id="sourceText">${markUp(text.text, doc.evidence ?? [])}</pre>
                   <p class="small muted" style="margin-top:8px">${text.chars.toLocaleString()} characters extracted by Progress Agentic RAG at ingestion. This is the text every extraction stage read.${text.truncated ? " Showing the first part only." : ""}</p>`
            }
          </div>
          <div id="viewFile" hidden></div>
        </div>
      </section>
    </div>`;

  const select = (field) => {
    for (const b of $$("[data-ev]", panel)) b.setAttribute("aria-current", String(b.dataset.ev === field));
    for (const m of $$("mark.dip-hit", panel)) m.classList.remove("is-active");
    const mark = document.getElementById(`hit-${field}`);
    if (!mark) return;
    mark.classList.add("is-active");
    mark.scrollIntoView({ block: "center", behavior: "smooth" });
    mark.focus();
  };
  for (const b of $$("[data-ev]", panel)) {
    b.addEventListener("click", () => {
      history.replaceState(null, "", buildHash(`/documents/${doc.id}/source`, { ev: b.dataset.ev }));
      select(b.dataset.ev);
    });
  }
  for (const m of $$("mark.dip-hit", panel)) {
    m.addEventListener("click", () => select(m.id.replace("hit-", "")));
  }
  if (query.ev) setTimeout(() => select(query.ev), 60);

  // The original file is fetched only when asked for: a 20 MB scan should not load
  // because someone opened the evidence tab.
  const views = { text: $("#viewText", panel), file: $("#viewFile", panel) };
  for (const b of $$("[data-view]", panel)) {
    b.addEventListener("click", async () => {
      for (const other of $$("[data-view]", panel)) other.setAttribute("aria-pressed", String(other === b));
      views.text.hidden = b.dataset.view !== "text";
      views.file.hidden = b.dataset.view !== "file";
      if (b.dataset.view === "file" && !views.file.dataset.loaded) {
        views.file.dataset.loaded = "1";
        views.file.innerHTML = '<div class="dip-skeleton" style="height:200px"></div>';
        const url = `/api/v1/documents/${doc.id}/source`;
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) {
          views.file.innerHTML = errorState({
            message: "The original file is no longer available for this document.",
          });
          return;
        }
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        if (doc.contentType.startsWith("image/")) {
          views.file.innerHTML = `<div class="dip-preview"><img src="${objectUrl}" alt="${esc(doc.filename)}" /></div>`;
        } else if (doc.contentType === "application/pdf") {
          // <iframe>, not <embed>: the CSP sets object-src 'none' and allows frame-src blob:
          views.file.innerHTML = `<div class="dip-preview"><iframe src="${objectUrl}#toolbar=0" title="${esc(doc.filename)}"></iframe></div>`;
        } else {
          views.file.innerHTML = `<pre class="dip-source__text">${esc((await blob.text()).slice(0, 20000))}</pre>`;
        }
      }
    });
  }
}

// ── pipeline tab ─────────────────────────────────────────────────────────────

async function renderPipeline(panel, doc) {
  const durations = doc.meta?.durationsMs ?? {};
  const stageErrors = doc.meta?.stageErrors ?? [];
  const errorFor = (stage) => stageErrors.find((e) => e.startsWith(`${stage}:`));
  const max = Math.max(1, ...Object.values(durations));
  const job = doc.jobId ? await api(`/api/v1/jobs/${doc.jobId}`).catch(() => null) : null;
  const messages = new Map();
  for (const e of job?.events ?? []) if (e.message) messages.set(e.stage, e.message);
  const total = Object.values(durations).reduce((a, b) => a + b, 0);

  panel.innerHTML = `
    ${
      stageErrors.length
        ? `<div class="arag-alert warn dip-prose"><strong>Degraded</strong> — ${esc(stageErrors.join("; "))}. The rest of the record is complete.
             <div style="margin-top:8px"><button class="arag-btn sm secondary" type="button" id="rerun">Reprocess</button></div></div>`
        : ""
    }
    <table class="arag-table">
      <thead><tr><th>Stage</th><th>Duration</th><th>Status</th></tr></thead>
      <tbody>
        ${STAGE_GLOSSARY.map(([stage]) => {
          const ms = durations[stage];
          const failed = errorFor(stage);
          const width = ms ? Math.max(2, Math.round((ms / max) * 100)) : 0;
          return `<tr>
            <td><strong>${esc(stage)}</strong>${messages.get(stage) ? ` <span class="subtle small">${esc(messages.get(stage))}</span>` : ""}</td>
            <td style="width:240px"><span class="dip-stagecell">
              <span class="dip-timeline__bar"><i style="width:${width}%;${failed ? "background:var(--arag-danger-fg)" : ""}"></i></span>
              <span class="dip-timeline__ms">${ms === undefined ? "—" : esc(fmtMs(ms))}</span>
            </span></td>
            <td>${failed ? '<span class="arag-chip danger">Failed</span>' : ms === undefined ? '<span class="arag-chip neutral">Not run</span>' : '<span class="arag-chip ok">Done</span>'}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    <p class="muted small" style="margin-top:12px">
      Total ${esc(fmtMs(total))}${job ? ` · Job <span class="mono">${esc(job.id)}</span> ${jobChip(job.status)} · Started ${esc(fmtAbsolute(job.createdAt))}` : " · the job for this document is no longer stored"}
      ${job ? ` · <a href="${buildHash("/jobs", { q: job.id })}">Open in Jobs</a>` : ""}
    </p>
    <details class="arag-card pad" style="margin-top:16px" id="glossary">
      <summary><strong>What each stage does</strong></summary>
      <dl class="arag-kv" style="margin-top:12px">
        ${STAGE_GLOSSARY.map(([s, d]) => `<dt>${esc(s)}</dt><dd>${esc(d)}</dd>`).join("")}
      </dl>
    </details>`;
  $("#rerun", panel)?.addEventListener("click", () => reprocess(doc, null));
  const glossary = $("#glossary", panel);
  if (localStorage.getItem("dip.glossarySeen") !== "1") glossary.open = true;
  glossary.addEventListener("toggle", () => {
    try {
      localStorage.setItem("dip.glossarySeen", "1");
    } catch {
      /* private window — the disclosure simply opens again next time */
    }
  });
}

// ── ask tab ──────────────────────────────────────────────────────────────────

const SUGGESTIONS = {
  invoice: [
    "What is the total due and when?",
    "Who issued this invoice?",
    "What tax was charged?",
    "What was purchased?",
  ],
  purchase_order: [
    "What is the PO number?",
    "Who is the supplier?",
    "What was ordered?",
    "What is the delivery date?",
  ],
  contract: [
    "What is the termination notice period?",
    "Who are the parties?",
    "What is the governing law?",
    "What is the total value?",
  ],
  medical_claim: [
    "What is the claim number?",
    "What is the amount claimed?",
    "Which member is this for?",
    "What was the date of service?",
  ],
  preauthorisation: [
    "What length of stay was approved?",
    "What is the authorisation number?",
    "What is the co-payment?",
    "Which procedure was requested?",
  ],
  bank_statement: [
    "What is the closing balance?",
    "What period does this cover?",
    "What were the largest transactions?",
    "Whose account is this?",
  ],
  receipt: ["What was the total?", "Where was this bought?", "When was it bought?", "How was it paid for?"],
  resume: [
    "What is this candidate's most recent role?",
    "What skills are listed?",
    "How can they be contacted?",
    "How many years of experience?",
  ],
};
const DEFAULT_SUGGESTIONS = [
  "What is this document about?",
  "What dates does it mention?",
  "What amounts does it mention?",
  "Who is it from?",
];

export function renderAskPanel(panel, doc) {
  const suggestions = SUGGESTIONS[doc.docType] ?? DEFAULT_SUGGESTIONS;
  panel.innerHTML = `
    <p class="muted dip-prose">Answers come from this document only. Nothing is remembered between visits — this conversation is not saved.</p>
    <div class="dip-suggestions">
      ${suggestions.map((s) => `<button class="arag-btn ghost sm" type="button" data-suggest="${esc(s)}">${esc(s)}</button>`).join("")}
    </div>
    <div class="arag-chat" id="answers"></div>
    <div class="arag-row" style="margin-top:12px">
      <label class="sr-only" for="askInput">Ask a question about this document</label>
      <input class="arag-input" id="askInput" placeholder="Ask a question about this document…" style="flex:1" />
      <button class="arag-btn" type="button" id="askBtn">Ask</button>
    </div>
    <p class="arag-help">Answers are drawn from this document, not from the model's general knowledge. If it is not in the document, you will be told so.</p>`;

  const box = $("#answers", panel);
  const input = $("#askInput", panel);
  async function ask(question) {
    const q = (question ?? input.value).trim();
    if (!q) return;
    input.value = "";
    box.insertAdjacentHTML(
      "beforeend",
      `<div class="arag-bubble user">${esc(q)}</div><div class="arag-bubble assistant" id="pending">Thinking…</div>`,
    );
    box.lastElementChild.scrollIntoView({ block: "nearest" });
    try {
      const r = await api(`/api/v1/documents/${doc.id}/ask`, { method: "POST", json: { question: q } });
      const cites = (r.citations ?? []).slice(0, 3);
      $("#pending", panel).outerHTML = `<div class="arag-bubble assistant">${esc(r.answer || "(no answer)")}
        <div class="arag-row small" style="margin-top:8px">
          ${
            cites.length
              ? cites
                  .map(
                    (c) =>
                      `<a class="arag-cite" href="${buildHash(`/documents/${doc.id}/source`)}" title="${esc(c.text)}">${icon("quote", { size: 12 })} Open in source</a>`,
                  )
                  .join("")
              : '<span class="subtle">No source returned</span>'
          }
          <span class="subtle">${r.ms} ms</span>
        </div></div>`;
    } catch (err) {
      $("#pending", panel).outerHTML =
        `<div class="arag-alert error" role="alert">That question could not be answered. ${esc(err.message)}</div>`;
      input.value = q;
    }
  }
  $("#askBtn", panel).addEventListener("click", () => ask());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ask();
  });
  for (const b of $$("[data-suggest]", panel)) b.addEventListener("click", () => ask(b.dataset.suggest));
  input.focus();
}

function renderAskTab(panel, doc) {
  if (doc.status !== "ready") {
    panel.innerHTML = `<div class="arag-alert warn">This document is ${esc(docState(doc))}. Ask becomes available once it is ready.</div>`;
    return;
  }
  renderAskPanel(panel, doc);
}

function renderJson(panel, doc) {
  panel.innerHTML = `<p class="muted dip-prose">The canonical record exactly as <span class="mono">GET /api/v1/documents/${esc(doc.id)}</span> returns it.</p>
    <arag-json id="recJson"></arag-json>`;
  $("#recJson", panel).data = doc;
}
