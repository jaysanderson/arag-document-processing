/**
 * Document Processing demo. Talks ONLY to /api/v1 — no secrets in the browser.
 *
 *   POST /api/v1/documents            upload → { document, job }
 *   GET  /api/v1/jobs/{id}/events     SSE live pipeline
 *   GET  /api/v1/documents/{id}       canonical record
 *   GET  /api/v1/documents/{id}/export?format=json|xml|csv
 *   POST /api/v1/documents/{id}/ask   grounded Q&A
 *   GET/POST/DELETE /api/v1/extraction-configs
 */
import { api, esc, sse, toast } from "/ui/arag-ui.js";

const $ = (s) => document.querySelector(s);

let currentId = null;
let closeStream = null;
let busy = false;
let preview = null;

// ── session (needed only when API_KEYS is configured) ───────────────────────
async function ensureSession() {
  try {
    await api("/api/v1/session", { method: "POST" });
  } catch {
    /* open API — no session needed */
  }
}

// ── source preview ──────────────────────────────────────────────────────────
async function setPreview(blob, filename, contentType) {
  if (preview?.url) URL.revokeObjectURL(preview.url);
  const host = $("#preview");
  if (contentType.startsWith("image/")) {
    preview = { url: URL.createObjectURL(blob) };
    host.innerHTML = `<img src="${preview.url}" alt="${esc(filename)}" />`;
  } else if (contentType === "application/pdf") {
    preview = { url: URL.createObjectURL(blob) };
    // <iframe>, not <embed>: the CSP sets `object-src 'none'` and allows `frame-src blob:`.
    host.innerHTML = `<iframe src="${preview.url}#toolbar=0" title="${esc(filename)}"></iframe>`;
  } else if (contentType.startsWith("text/")) {
    preview = null;
    host.innerHTML = `<pre>${esc((await blob.text()).slice(0, 8000))}</pre>`;
  } else {
    preview = null;
    host.innerHTML = `<div class="muted">📄 ${esc(filename)}</div>`;
  }
}

// ── upload + live pipeline ──────────────────────────────────────────────────
function guessType(name) {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".tif") || n.endsWith(".tiff")) return "image/tiff";
  if (n.endsWith(".md")) return "text/markdown";
  if (n.endsWith(".csv")) return "text/csv";
  if (n.endsWith(".txt")) return "text/plain";
  if (n.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

async function processFile(blob, filename, contentType) {
  if (busy) return;
  busy = true;
  currentId = null;
  $("#fileLabel").textContent = filename;
  $("#resultBody").hidden = true;
  $("#resultEmpty").hidden = false;
  $("#exports").hidden = true;
  $("#askInput").disabled = true;
  $("#askBtn").disabled = true;
  $("#answer").innerHTML = "";
  $("#timeline").job = { status: "queued", events: [] };
  await setPreview(blob, filename, contentType);

  const config = $("#configSelect").value || "auto";
  let document_;
  let job;
  try {
    const body = new FormData();
    body.append("file", blob, filename);
    const out = await api(`/api/v1/documents?config=${encodeURIComponent(config)}`, {
      method: "POST",
      body,
    });
    document_ = out.document;
    job = out.job;
  } catch (err) {
    busy = false;
    toast(`Upload failed: ${err.message}`, "error");
    return;
  }

  $("#timeline").job = job;
  closeStream?.();
  closeStream = sse(`/api/v1/jobs/${job.id}/events`, {
    event: (e) => $("#timeline").apply(e),
    job: async (payload) => {
      const j = payload.job ?? payload;
      $("#timeline").job = j;
      if (["succeeded", "failed", "cancelled"].includes(j.status)) {
        closeStream?.();
        closeStream = null;
        busy = false;
        if (j.status === "succeeded") {
          await showRecord(document_.id);
        } else {
          toast(`Processing ${j.status}: ${j.error?.message ?? ""}`, "error");
        }
        loadDocuments();
      }
    },
    error: () => {
      busy = false;
    },
  });
  loadDocuments();
}

// ── record rendering ────────────────────────────────────────────────────────
function valueHtml(f) {
  if (Array.isArray(f.value)) return `<ul>${f.value.map((v) => `<li>${esc(String(v))}</li>`).join("")}</ul>`;
  const raw =
    f.raw && String(f.raw) !== String(f.value) ? `<span class="f-raw">raw: ${esc(String(f.raw))}</span>` : "";
  return `${esc(String(f.value))}${raw}`;
}

async function showRecord(id) {
  const rec = await api(`/api/v1/documents/${id}`);
  currentId = rec.id;
  $("#resultEmpty").hidden = true;
  $("#resultBody").hidden = false;
  $("#exports").hidden = false;
  $("#askInput").disabled = false;
  $("#askBtn").disabled = false;

  $("#docTypeBadge").textContent = (rec.meta?.forced ? rec.meta.config : rec.docType).replace(/_/g, " ");
  $("#docConf").textContent = rec.meta?.forced
    ? `via “${rec.meta.config}” config (auto-classification skipped)`
    : rec.docTypeConfidence
      ? `${Math.round(rec.docTypeConfidence * 100)}% classifier confidence`
      : "";
  const total = Object.values(rec.meta?.durationsMs ?? {}).reduce((a, b) => a + b, 0);
  const elapsed = total >= 1000 ? `${(total / 1000).toFixed(1)} s` : `${Math.round(total)} ms`;
  $("#timings").textContent = `${elapsed} · ${rec.meta.schema} · ${rec.meta.model}`;

  $("#summary").textContent = rec.summary ?? "";
  $("#summary").hidden = !rec.summary;
  $("#tags").innerHTML = (rec.tags ?? [])
    .map((t) => `<span class="arag-chip neutral">${esc(t)}</span>`)
    .join("");
  $("#issues").innerHTML = (rec.issues ?? [])
    .map(
      (i) =>
        `<div class="arag-alert ${i.severity === "error" ? "error" : i.severity === "warning" ? "warn" : "ok"}"><b>${esc(i.field)}</b> — ${esc(i.message)}</div>`,
    )
    .join("");

  // Grounding: what share of the extracted fields carry a quote we found in the document.
  const grounding = rec.meta?.groundingScore;
  const gb = $("#groundingBadge");
  if (typeof grounding === "number") {
    const pct = Math.round(grounding * 100);
    gb.textContent = `${pct}% grounded`;
    gb.className = `arag-chip ${pct >= 80 ? "ok" : pct >= 50 ? "warn" : "danger"}`;
    gb.hidden = false;
  } else {
    gb.hidden = true;
  }

  const evidenceByField = new Map((rec.evidence ?? []).map((e) => [e.field, e]));
  $("#fieldsTable").querySelector("tbody").innerHTML =
    (rec.fields ?? [])
      .map((f) => {
        const conf = f.confidence !== undefined ? Math.round(f.confidence * 100) : null;
        const bar =
          conf === null ? "" : `<div class="f-bar" title="${conf}%"><i style="width:${conf}%"></i></div>`;
        return `<tr><td>${esc(f.label)}</td><td class="f-value">${valueHtml(f)}${evidenceHtml(evidenceByField.get(f.key))}</td><td>${bar}</td><td>${evidenceBadge(evidenceByField.get(f.key))}</td></tr>`;
      })
      .join("") || `<tr><td colspan="4" class="muted">No fields extracted.</td></tr>`;

  $("#entities").innerHTML =
    (rec.entities ?? [])
      .map((e) => `<span class="ent"><b>${esc(e.type)}</b>${esc(e.text)}</span>`)
      .join("") || '<span class="subtle">No entities surfaced.</span>';
}

/** A one-word badge saying whether this field's quote was found in the document. */
function evidenceBadge(evidence) {
  if (!evidence) return '<span class="subtle small">—</span>';
  const cls = { exact: "ok", normalised: "warn", unverified: "danger" }[evidence.verified] ?? "neutral";
  const label = { exact: "verified", normalised: "near match", unverified: "not found" }[evidence.verified];
  return `<span class="arag-chip ${cls}" title="${esc(evidence.quote)}">${esc(label)}</span>`;
}

/** The quote itself, collapsed behind a toggle so the table stays scannable. */
function evidenceHtml(evidence) {
  if (!evidence) return "";
  return `<details class="evidence"><summary>evidence</summary><blockquote>${esc(evidence.quote)}</blockquote></details>`;
}

// ── exports ─────────────────────────────────────────────────────────────────
async function download(fmt) {
  if (!currentId) return toast("Process a document first.", "error");
  const res = await fetch(`/api/v1/documents/${currentId}/export?format=${fmt}`, {
    credentials: "same-origin",
  });
  if (!res.ok) return toast(`Export failed (${res.status})`, "error");
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name ?? `document.${fmt}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Downloaded ${a.download}`);
}

// ── ask ─────────────────────────────────────────────────────────────────────
async function ask() {
  const q = $("#askInput").value.trim();
  if (!q || !currentId) return;
  const box = $("#answer");
  box.insertAdjacentHTML(
    "beforeend",
    `<div class="arag-bubble user">${esc(q)}</div><div class="arag-bubble assistant" id="pending">Thinking…</div>`,
  );
  try {
    const r = await api(`/api/v1/documents/${currentId}/ask`, { method: "POST", json: { question: q } });
    const sources = (r.sources ?? []).map((s) => `<span class="arag-cite">${esc(s)}</span>`).join("");
    $("#pending").outerHTML =
      `<div class="arag-bubble assistant">${esc(r.answer || "(no answer)")}<div class="arag-row small" style="margin-top:6px">${sources}<span class="subtle">${r.ms} ms</span></div></div>`;
  } catch (err) {
    $("#pending").outerHTML =
      `<div class="arag-bubble assistant"><span class="arag-chip danger">${esc(err.message)}</span></div>`;
  }
  $("#askInput").value = "";
}

// ── samples ─────────────────────────────────────────────────────────────────
async function loadSample(name) {
  try {
    const res = await fetch(`/samples/${name}.txt`);
    if (!res.ok) throw new Error("sample missing");
    const blob = await res.blob();
    await processFile(new Blob([blob], { type: "text/plain" }), `${name}.txt`, "text/plain");
  } catch (err) {
    toast(`Could not load sample: ${err.message}`, "error");
  }
}

async function loadImageSample(name) {
  try {
    const res = await fetch(`/samples/images/${name}.png`);
    if (!res.ok) throw new Error("image sample missing");
    await processFile(await res.blob(), `${name}.png`, "image/png");
  } catch (err) {
    toast(`Could not load image sample: ${err.message}`, "error");
  }
}

// ── documents table ─────────────────────────────────────────────────────────
async function loadDocuments() {
  try {
    const d = await api("/api/v1/documents?page_size=10");
    $("#docs tbody").innerHTML =
      d.items
        .map((r) => {
          const degraded = (r.meta?.stageErrors ?? []).length > 0;
          const cls = r.status === "failed" ? "danger" : r.status === "ready" && !degraded ? "ok" : "warn";
          const label = r.status === "ready" && degraded ? "ready · degraded" : r.status;
          const title = degraded ? ` title="${esc((r.meta.stageErrors ?? []).join("; "))}"` : "";
          return `<tr data-id="${esc(r.id)}"><td>${esc(r.filename)}</td><td class="small">${esc(r.docType.replace(/_/g, " "))}</td><td><span class="arag-chip ${cls}"${title}>${esc(label)}</span></td><td class="num">${r.fields.length}</td><td><button class="arag-btn ghost sm del">Delete</button></td></tr>`;
        })
        .join("") || '<tr><td colspan="5" class="muted">No documents yet — drop one above.</td></tr>';
    for (const row of $("#docs").querySelectorAll("tr[data-id]")) {
      row.querySelector(".del")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        await api(`/api/v1/documents/${row.dataset.id}`, { method: "DELETE" });
        if (currentId === row.dataset.id) {
          currentId = null;
          $("#resultBody").hidden = true;
          $("#resultEmpty").hidden = false;
        }
        toast("Document deleted (record + KB resource)");
        loadDocuments();
      });
      row.addEventListener("click", () => showRecord(row.dataset.id).catch(() => undefined));
    }
  } catch {
    /* listing is best-effort */
  }
}

// ── extraction configs ──────────────────────────────────────────────────────
let configs = [];

async function loadConfigs() {
  const prev = $("#configSelect").value;
  try {
    configs = (await api("/api/v1/extraction-configs")).items;
  } catch {
    configs = [];
  }
  const sel = $("#configSelect");
  sel.innerHTML = "";
  sel.add(new Option("Auto-detect (classify first)", "auto"));
  sel.add(new Option("ARAG DA agent (persisted fields)", "agent"));
  const builtin = configs.filter((c) => c.builtin);
  const custom = configs.filter((c) => !c.builtin);
  if (builtin.length) {
    const g = document.createElement("optgroup");
    g.label = "Built-in";
    for (const c of builtin) g.appendChild(new Option(c.name, c.id));
    sel.add(g);
  }
  if (custom.length) {
    const g = document.createElement("optgroup");
    g.label = "Custom";
    for (const c of custom) g.appendChild(new Option(c.name, c.id));
    sel.add(g);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  renderConfigList(builtin, custom);
}

function configCard(c) {
  const badge = c.builtin
    ? '<span class="arag-chip neutral">built-in</span>'
    : `<button class="arag-btn ghost sm cfg-del" data-id="${esc(c.id)}">Delete</button>`;
  const provisioned = c.provisioned
    ? '<span class="arag-chip ok">provisioned</span>'
    : '<span class="arag-chip warn">not provisioned</span>';
  return `<div class="cfg-card">
    <div class="cfg-head"><b>${esc(c.name)}</b><span class="arag-row">${provisioned}${badge}</span></div>
    <div class="muted small mono">${esc(c.aragConfig)}</div>
    <div class="cfg-chips">${c.fields.map((f) => `<span class="arag-chip outline">${esc(f.label)}${f.required ? " *" : ""}</span>`).join("")}</div>
  </div>`;
}

function renderConfigList(builtin, custom) {
  $("#cfgList").innerHTML =
    (custom.length ? `<div class="cfg-group">Custom</div>${custom.map(configCard).join("")}` : "") +
    `<div class="cfg-group">Built-in</div>${builtin.map(configCard).join("")}`;
  for (const b of $("#cfgList").querySelectorAll(".cfg-del")) {
    b.addEventListener("click", async () => {
      try {
        await api(`/api/v1/extraction-configs/${b.dataset.id}`, { method: "DELETE" });
        toast("Config deleted");
        loadConfigs();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }
}

function addFieldRow(label = "", type = "string", required = false) {
  const row = document.createElement("div");
  row.className = "cfg-field-row";
  row.innerHTML = `
    <input class="arag-input fld-label" placeholder="Field label (e.g. Policy Number)" value="${esc(label)}" />
    <select class="arag-select fld-type">
      <option value="string"${type === "string" ? " selected" : ""}>text</option>
      <option value="number"${type === "number" ? " selected" : ""}>number/amount</option>
      <option value="array"${type === "array" ? " selected" : ""}>list</option>
    </select>
    <label class="small"><input type="checkbox" class="fld-required"${required ? " checked" : ""} /> required</label>
    <button class="arag-btn ghost sm fld-remove" type="button" aria-label="Remove field">✕</button>`;
  row.querySelector(".fld-remove").addEventListener("click", () => row.remove());
  $("#cfgFields").appendChild(row);
}

async function saveConfig() {
  const name = $("#cfgName").value.trim();
  if (!name) return toast("Give the config a name.", "error");
  const fields = [...document.querySelectorAll("#cfgFields .cfg-field-row")]
    .map((r) => ({
      label: r.querySelector(".fld-label").value.trim(),
      type: r.querySelector(".fld-type").value,
      required: r.querySelector(".fld-required").checked,
    }))
    .filter((f) => f.label);
  if (!fields.length) return toast("Add at least one field.", "error");
  try {
    const created = await api("/api/v1/extraction-configs", { method: "POST", json: { name, fields } });
    await loadConfigs();
    $("#configSelect").value = created.id;
    $("#cfgName").value = "";
    $("#cfgFields").innerHTML = "";
    addFieldRow();
    toast(`Saved “${name}” — it is now selected.`);
  } catch (err) {
    toast(`Could not save config: ${err.message}`, "error");
  }
}

// ── prompt gallery ──────────────────────────────────────────────────────────
const PROMPTS = [
  {
    title: "Invoice",
    text:
      "A photorealistic scan of a one-page commercial TAX INVOICE on white A4 paper, portrait. " +
      "Company 'Northwind Logistics Pty Ltd' at top-left with a small geometric logo; invoice number INV-2027-1185, " +
      "date 12/02/2027, due date 14/03/2027. A clean line-item table (description, qty, unit price, amount) with 4 rows, " +
      "then Subtotal, VAT 15%, and a bold TOTAL DUE in ZAR. Crisp, legible printed text, subtle paper texture, no watermark.",
  },
  {
    title: "Purchase order",
    text:
      "A photorealistic one-page PURCHASE ORDER, white A4 portrait. Buyer 'Cobalt Manufacturing Inc.', " +
      "supplier 'Apex Industrial Supplies', PO number PO-55218, order date 03/05/2027, currency USD. " +
      "Include a 5-row item table with quantities and unit prices, a totals block (subtotal, tax, total), " +
      "ship-to address, and an authorised-by signature line. Sharp, clearly readable text suitable for OCR.",
  },
  {
    title: "Medical claim form",
    text:
      "A photorealistic scanned HEALTH INSURANCE CLAIM FORM, white A4 portrait, with labelled field/value rows. " +
      "Insurer 'Meridian Health'; member name Sarah Donovan; membership number MER-4471902; claim number CLM-90233; " +
      "date of service 18/06/2027; diagnosis code ICD-10 J45.9; procedure code 99213; amount claimed $420.00. " +
      "Include a green 'RECEIVED' stamp angled in the corner. Legible printed text, light scan shadows.",
  },
  {
    title: "Pre-authorisation request",
    text:
      "A photorealistic scanned HOSPITAL PRE-AUTHORISATION REQUEST form, white A4 portrait. Scheme 'Meridian Health', " +
      "benefit option 'Comprehensive Plus', membership number MER-4471902, patient Sarah Donovan (DOB 04/11/1984), " +
      "treating provider Dr Anil Mehta, facility 'St Jude Private Hospital', proposed admission 22/06/2027, " +
      "length of stay 3 nights, procedure 'Arthroscopic knee reconstruction (CPT 29888)', authorisation number AUTH-90233, " +
      "status APPROVED, co-payment $250.00. Boxed form fields, crisp legible text.",
  },
  {
    title: "Contract page",
    text:
      "A photorealistic first page of a SERVICES AGREEMENT, white A4 portrait, professional legal typography. " +
      "Title 'Master Services Agreement', effective date 1 March 2027, between 'Helios Software LLC' (Provider) and " +
      "'Vanguard Retail Group' (Customer). Number sections 1–5 (Term, Fees of USD $480,000, Termination, Governing Law: Delaware, " +
      "Confidentiality) with short paragraphs. Clean serif body text, justified, clearly readable.",
  },
  {
    title: "Receipt",
    text:
      "A photorealistic photograph of a retail RECEIPT on thermal paper, slightly curled, on a dark surface. " +
      "Merchant 'Brew & Bean Cafe', date 09/09/2027 14:32, 4 line items with prices, subtotal, tax, and total $27.85, " +
      "card payment VISA ending 4417. Monospaced receipt font, realistic but fully legible text.",
  },
  {
    title: "Bank statement",
    text:
      "A photorealistic one-page BANK STATEMENT, white A4 portrait. Bank 'Sterling National Bank', account holder " +
      "'Priya Nair', account number ending 8842, statement period 01–31 July 2027. A transaction table with date, " +
      "description, debit, credit, and balance columns (about 8 rows), plus opening and closing balances in USD. " +
      "Clean corporate layout, crisp legible figures.",
  },
];

function renderPrompts() {
  $("#promptGrid").innerHTML = PROMPTS.map(
    (p, i) => `<div class="prompt-card">
      <div class="pc-head"><b>${esc(p.title)}</b><button class="arag-btn ghost sm copy" data-i="${i}">Copy</button></div>
      <pre>${esc(p.text)}</pre>
    </div>`,
  ).join("");
  for (const b of $("#promptGrid").querySelectorAll(".copy")) {
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(PROMPTS[Number(b.dataset.i)].text);
        const orig = b.textContent;
        b.textContent = "Copied ✓";
        setTimeout(() => {
          b.textContent = orig;
        }, 1500);
      } catch {
        toast("Copy failed — select the text manually.", "error");
      }
    });
  }
}

// ── header chip: mock vs live, and whether visual extraction is on ──────────
async function loadStrategyHint() {
  try {
    const r = await api("/readyz");
    const chip = $("#strategyChip");
    if (r?.arag?.mock) {
      chip.textContent = "mock ARAG — deterministic fixtures";
      chip.className = "arag-chip warn";
      // Be explicit rather than let someone think the model read the picture.
      $("#mockNote").hidden = false;
    } else if (r?.visualExtraction) {
      chip.textContent = "visual extraction on for images & PDFs";
      chip.className = "arag-chip info";
      chip.title = "Images and PDFs are read by a multimodal LLM at ingestion (ARAG extract strategy).";
    } else {
      chip.textContent = "default ARAG processing";
      chip.className = "arag-chip neutral";
    }
    chip.hidden = false;
  } catch {
    /* ignore — the chip is decoration */
  }
}

// ── wiring ──────────────────────────────────────────────────────────────────
const dz = $("#dropzone");
const fi = $("#fileInput");
dz.addEventListener("click", () => fi.click());
dz.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fi.click();
});
fi.addEventListener("change", () => {
  const f = fi.files[0];
  if (f) processFile(f, f.name, f.type || guessType(f.name));
});
for (const ev of ["dragenter", "dragover"])
  dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.add("drag");
  });
for (const ev of ["dragleave", "drop"])
  dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
  });
dz.addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) processFile(f, f.name, f.type || guessType(f.name));
});

for (const b of document.querySelectorAll("[data-sample]"))
  b.addEventListener("click", () => loadSample(b.dataset.sample));
for (const b of document.querySelectorAll("[data-image]"))
  b.addEventListener("click", () => loadImageSample(b.dataset.image));
for (const b of document.querySelectorAll("#exports [data-fmt]"))
  b.addEventListener("click", () => download(b.dataset.fmt));

$("#askBtn").addEventListener("click", ask);
$("#askInput").addEventListener("keydown", (e) => e.key === "Enter" && ask());
$("#refreshDocs").addEventListener("click", loadDocuments);
$("#manageConfigs").addEventListener("click", () => {
  $("#configModal").hidden = false;
  if (!$("#cfgFields").children.length) addFieldRow();
});
$("#closeConfigs").addEventListener("click", () => {
  $("#configModal").hidden = true;
});
$("#configModal").addEventListener("click", (e) => {
  if (e.target.id === "configModal") $("#configModal").hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("#configModal").hidden = true;
});
$("#addField").addEventListener("click", () => addFieldRow());
$("#saveConfig").addEventListener("click", saveConfig);

await ensureSession();
renderPrompts();
loadStrategyHint();
loadConfigs();
loadDocuments();
