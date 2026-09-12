/* Document Intelligence Studio — front-end controller.
   Plain ES modules, no framework. Talks to the bridge API:
     POST /api/ingest → resourceId
     GET  /api/process (SSE) → live stage events → final record
     GET  /api/export → file download
     POST /api/ask → grounded answer
*/

const $ = (sel) => document.querySelector(sel);
const STAGE_ORDER = ["ingest", "process", "classify", "extract", "entities", "summary", "validate", "standardize"];

let currentId = null;
let busy = false;
let preview = null; // { kind, url, text, filename }

const STAGE_LABELS = {
  ingest: "Uploading document…",
  process: "Reading the document — OCR, visual layout, embeddings…",
  classify: "Classifying document type…",
  extract: "Extracting fields with the visual LLM…",
  entities: "Surfacing named entities…",
  summary: "Summarizing and tagging…",
  validate: "Normalizing and validating…",
  standardize: "Standardizing output…",
};

// ── Document preview (shown while processing, kept as source afterwards) ────
async function buildPreviewState(blob, filename, contentType) {
  if (preview?.url) URL.revokeObjectURL(preview.url);
  const ct = contentType || "";
  if (ct.startsWith("image/")) {
    preview = { kind: "image", url: URL.createObjectURL(blob), filename };
  } else if (ct === "application/pdf") {
    preview = { kind: "pdf", url: URL.createObjectURL(blob), filename };
  } else if (ct.startsWith("text/") || /\.txt$/i.test(filename)) {
    const text = (await blob.text()).slice(0, 8000);
    preview = { kind: "text", text, filename };
  } else {
    preview = { kind: "file", filename };
  }
}

function renderPreview(host) {
  if (!host || !preview) return;
  if (preview.kind === "image") {
    host.innerHTML = `<img class="doc-img" src="${preview.url}" alt="${escapeHtml(preview.filename)}">`;
  } else if (preview.kind === "pdf") {
    host.innerHTML = `<embed class="doc-embed" src="${preview.url}#toolbar=0" type="application/pdf">`;
  } else if (preview.kind === "text") {
    host.innerHTML = `<pre class="doc-text">${escapeHtml(preview.text)}</pre>`;
  } else {
    host.innerHTML = `<div class="doc-file">📄 ${escapeHtml(preview.filename)}</div>`;
  }
}

// ── KB status ─────────────────────────────────────────────
async function loadHealth() {
  try {
    const r = await fetch("/api/health");
    const h = await r.json();
    $("#kbDot").className = "dot ok";
    $("#kbText").textContent = `KB ${String(h.kb).slice(0, 8)}… · ${h.model}`;
    if (h.extractStrategy) {
      $("#visStrategy").textContent = String(h.extractStrategy).slice(0, 8) + "…";
      $("#visNote").hidden = false;
    }
  } catch {
    $("#kbDot").className = "dot bad";
    $("#kbText").textContent = "bridge offline";
  }
}

// ── Toast ─────────────────────────────────────────────────
let toastTimer;
function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (isErr ? " err" : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4200);
}

// ── Stage rendering ───────────────────────────────────────
function resetStages() {
  document.querySelectorAll(".stages li").forEach((li) => {
    li.className = "";
    li.querySelector(".st-meta").textContent = "";
  });
}
function setStage(stage, status, meta) {
  const li = document.querySelector(`.stages li[data-stage="${stage}"]`);
  if (!li) return;
  if (status === "start") li.className = "active";
  else if (status === "ok") li.className = "ok";
  else if (status === "error") li.className = "error";
  else if (status === "skip") li.className = "skip";
  if (meta !== undefined) li.querySelector(".st-meta").textContent = meta;
}

// ── Ingest + process ──────────────────────────────────────
async function processFile(blob, filename, contentType) {
  if (busy) return;
  busy = true;
  currentId = null;
  $("#fileLabel").textContent = filename;

  // Show the document immediately, while it processes.
  await buildPreviewState(blob, filename, contentType);
  $("#resultEmpty").hidden = true;
  $("#resultBody").hidden = true;
  $("#resultProcessing").hidden = false;
  renderPreview($("#procPreview"));
  $("#procStage").textContent = STAGE_LABELS.ingest;

  resetStages();
  setStage("ingest", "start");

  let resourceId;
  try {
    const res = await fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": contentType || "application/octet-stream", "X-Filename": filename },
      body: blob,
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "ingest failed");
    resourceId = j.resourceId;
    setStage("ingest", "ok", `${(j.bytes / 1024).toFixed(0)} KB`);
  } catch (err) {
    setStage("ingest", "error");
    $("#procStage").textContent = "Upload failed: " + err.message;
    toast("Upload failed: " + err.message, true);
    busy = false;
    return;
  }

  // Stream the pipeline (with the chosen extraction config).
  const cfg = $("#configSelect")?.value || "auto";
  const url = `/api/process?id=${encodeURIComponent(resourceId)}&filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(contentType)}&config=${encodeURIComponent(cfg)}`;
  const es = new EventSource(url);

  const onStage = (e) => {
    const d = JSON.parse(e.data);
    const meta = d.ms !== undefined ? `${d.ms} ms` : d.message && d.status === "start" ? "" : "";
    setStage(d.stage, d.status, meta || undefined);
    if (d.status === "start" && STAGE_LABELS[d.stage]) $("#procStage").textContent = STAGE_LABELS[d.stage];
    if (d.stage === "classify" && d.status === "ok" && d.data) {
      // surface the chosen type early
      setStage("classify", "ok", `${(d.data.docType || "")} ${Math.round((d.data.confidence || 0) * 100)}%`);
    }
    if (d.stage === "classify" && d.status === "skip") setStage("classify", "skip", "forced");
  };
  STAGE_ORDER.forEach((s) => es.addEventListener(s, onStage));

  es.addEventListener("complete", async (e) => {
    es.close();
    busy = false;
    const { id } = JSON.parse(e.data);
    currentId = id;
    try {
      const r = await fetch(`/api/record?id=${encodeURIComponent(id)}`);
      const rec = await r.json();
      if (!r.ok) throw new Error(rec.error || "record fetch failed");
      renderRecord(rec);
    } catch (err) {
      toast("Could not load record: " + err.message, true);
    }
  });
  es.addEventListener("fatal", (e) => {
    es.close();
    busy = false;
    const d = JSON.parse(e.data);
    $("#procStage").textContent = "Processing failed: " + (d.error || "unknown");
    toast("Processing failed: " + (d.error || "unknown"), true);
  });
  es.onerror = () => {
    es.close();
    busy = false;
  };
}

// ── Result rendering ──────────────────────────────────────
function valueHtml(f) {
  if (Array.isArray(f.value)) {
    return "<ul>" + f.value.map((v) => `<li>${escapeHtml(String(v))}</li>`).join("") + "</ul>";
  }
  const raw = f.raw && String(f.raw) !== String(f.value) ? `<span class="raw">raw: ${escapeHtml(String(f.raw))}</span>` : "";
  return `${escapeHtml(String(f.value))}${raw}`;
}

function renderRecord(rec) {
  $("#resultEmpty").hidden = true;
  $("#resultProcessing").hidden = true;
  $("#resultBody").hidden = false;

  // Keep the source document visible alongside the extracted data.
  $("#sourceName").textContent = rec.filename || "";
  renderPreview($("#srcPreview"));

  $("#docTypeBadge").textContent = (rec.meta?.forced ? rec.meta.config : rec.docType).replace(/_/g, " ");
  $("#docConf").textContent = rec.meta?.forced
    ? `via "${rec.meta.config}" config (forced)`
    : rec.docTypeConfidence
      ? `${Math.round(rec.docTypeConfidence * 100)}% confidence`
      : "";

  $("#summary").textContent = rec.summary || "";
  $("#summary").hidden = !rec.summary;

  $("#tags").innerHTML = (rec.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");

  $("#issues").innerHTML = (rec.issues || [])
    .map((i) => `<div class="issue ${i.severity}"><b>${escapeHtml(i.field)}</b> ${escapeHtml(i.message)}</div>`)
    .join("");

  const rows = (rec.fields || [])
    .map((f) => {
      const conf = f.confidence !== undefined ? Math.round(f.confidence * 100) : null;
      const bar = conf !== null ? `<div class="f-bar"><i style="width:${conf}%"></i></div>` : "";
      return `<tr>
        <td class="f-label">${escapeHtml(f.label)}</td>
        <td class="f-value">${valueHtml(f)}</td>
        <td class="f-conf">${bar}</td>
      </tr>`;
    })
    .join("");
  $("#fieldsTable").querySelector("tbody").innerHTML = rows || `<tr><td class="muted">No fields extracted.</td></tr>`;

  $("#entities").innerHTML = (rec.entities || [])
    .map((e) => `<span class="ent"><b>${escapeHtml(e.type)}</b>${escapeHtml(e.text)}</span>`)
    .join("");

  $("#askAnswer").hidden = true;
  $("#askInput").value = "";
}

// ── Exports ───────────────────────────────────────────────
function download(fmt) {
  if (!currentId) return toast("Process a document first.", true);
  window.location.href = `/api/export?id=${encodeURIComponent(currentId)}&format=${fmt}`;
}

// ── Ask ───────────────────────────────────────────────────
async function ask() {
  const q = $("#askInput").value.trim();
  if (!q) return;
  if (!currentId) return toast("Process a document first.", true);
  const box = $("#askAnswer");
  box.hidden = false;
  box.innerHTML = `<span class="spin"></span> thinking…`;
  try {
    const r = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, resourceId: currentId }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "ask failed");
    const src = j.sources && j.sources.length ? `<div class="src">Sources: ${j.sources.map(escapeHtml).join(", ")}</div>` : "";
    box.innerHTML = `${escapeHtml(j.answer || "(no answer)")}${src}`;
  } catch (err) {
    box.innerHTML = `<span style="color:var(--err)">${escapeHtml(err.message)}</span>`;
  }
}

// ── Samples ───────────────────────────────────────────────
async function loadSample(name) {
  try {
    const r = await fetch(`/samples/${name}.txt`);
    if (!r.ok) throw new Error("sample missing");
    const text = await r.text();
    const blob = new Blob([text], { type: "text/plain" });
    processFile(blob, `sample-${name}.txt`, "text/plain");
  } catch (err) {
    toast("Could not load sample: " + err.message, true);
  }
}

async function loadImageSample(name) {
  try {
    const r = await fetch(`/samples/images/${name}.png`);
    if (!r.ok) throw new Error("image sample missing");
    const blob = await r.blob();
    processFile(blob, `${name}.png`, "image/png");
  } catch (err) {
    toast("Could not load image sample: " + err.message, true);
  }
}

// ── Document-generation prompts (for image models) ─────────
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
  const grid = document.getElementById("promptGrid");
  if (!grid) return;
  grid.innerHTML = PROMPTS.map(
    (p, i) => `
    <div class="prompt-card">
      <div class="pc-head"><span class="pc-title">${escapeHtml(p.title)}</span>
        <button class="btn sm copy" data-i="${i}">Copy</button></div>
      <pre class="pc-text">${escapeHtml(p.text)}</pre>
    </div>`,
  ).join("");
  grid.querySelectorAll(".copy").forEach((b) =>
    b.addEventListener("click", async () => {
      const text = PROMPTS[Number(b.dataset.i)].text;
      try {
        await navigator.clipboard.writeText(text);
        const orig = b.textContent;
        b.textContent = "Copied ✓";
        setTimeout(() => (b.textContent = orig), 1500);
      } catch {
        toast("Copy failed — select the text manually.", true);
      }
    }),
  );
}

// ── Extraction configs (select + manage) ──────────────────
const LS_KEY = "dip.customConfigs";
let configs = [];

function loadCustomDefs() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveCustomDefs(defs) {
  localStorage.setItem(LS_KEY, JSON.stringify(defs));
}

async function registerCustom(def) {
  const r = await fetch("/api/extract-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(def),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "register failed");
  return j;
}

async function loadConfigs() {
  let builtin = [];
  try {
    const j = await (await fetch("/api/configs")).json();
    builtin = (j.configs || []).filter((c) => c.builtin);
  } catch {
    /* offline — selector still gets Auto + customs */
  }
  // Re-register locally-saved custom defs so they survive server restarts/redeploys.
  const defs = loadCustomDefs();
  const custom = [];
  for (const def of defs) {
    try {
      const j = await registerCustom(def);
      custom.push({ id: j.id, name: def.name, builtin: false, fields: j.fields, def });
    } catch {
      /* skip bad def */
    }
  }
  configs = [...builtin, ...custom];
  populateConfigSelect(custom);
  renderCfgList(builtin, custom);
}

function populateConfigSelect(custom) {
  const sel = $("#configSelect");
  const prev = sel.value;
  sel.innerHTML = "";
  sel.add(new Option("Auto-detect (classify)", "auto"));
  sel.add(new Option("ARAG DA agent (persisted fields)", "agent"));
  const gB = document.createElement("optgroup");
  gB.label = "Built-in";
  configs.filter((c) => c.builtin).forEach((c) => gB.appendChild(new Option(c.name, c.docType)));
  sel.add(gB);
  if (custom.length) {
    const gC = document.createElement("optgroup");
    gC.label = "Custom";
    custom.forEach((c) => gC.appendChild(new Option(c.name, c.id)));
    sel.add(gC);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function renderCfgList(builtin, custom) {
  const host = $("#cfgList");
  if (!host) return;
  const card = (c, deletable) => `
    <div class="cfg-card">
      <div class="cfg-card-head">
        <b>${escapeHtml(c.name)}</b>
        ${deletable ? `<button class="cfg-del" data-name="${escapeHtml(c.name)}" title="Delete">✕</button>` : `<span class="cfg-tag">built-in</span>`}
      </div>
      <div class="cfg-flds">${(c.fields || []).map((f) => `<span class="cfg-chip">${escapeHtml(f.label)}${f.required ? " *" : ""}</span>`).join("")}</div>
    </div>`;
  host.innerHTML =
    (custom.length ? `<div class="cfg-group">Custom</div>` + custom.map((c) => card(c, true)).join("") : "") +
    `<div class="cfg-group">Built-in</div>` +
    builtin.map((c) => card(c, false)).join("");
  host.querySelectorAll(".cfg-del").forEach((b) =>
    b.addEventListener("click", () => deleteCustom(b.dataset.name)),
  );
}

function deleteCustom(name) {
  saveCustomDefs(loadCustomDefs().filter((d) => d.name !== name));
  loadConfigs();
  toast(`Deleted config “${name}”.`);
}

function addFieldRow(label = "", type = "string", required = false) {
  const row = document.createElement("div");
  row.className = "cfg-field-row";
  row.innerHTML = `
    <input class="cfg-input fld-label" placeholder="Field label (e.g. Policy Number)" value="${escapeHtml(label)}">
    <select class="cfg-input fld-type">
      <option value="string"${type === "string" ? " selected" : ""}>text</option>
      <option value="number"${type === "number" ? " selected" : ""}>number/amount</option>
      <option value="array"${type === "array" ? " selected" : ""}>list</option>
    </select>
    <label class="fld-req"><input type="checkbox" class="fld-required"${required ? " checked" : ""}> required</label>
    <button class="cfg-del fld-remove" type="button" title="Remove">✕</button>`;
  row.querySelector(".fld-remove").addEventListener("click", () => row.remove());
  $("#cfgFields").appendChild(row);
}

async function saveConfig() {
  const name = $("#cfgName").value.trim();
  if (!name) return toast("Give the config a name.", true);
  const fields = [...document.querySelectorAll("#cfgFields .cfg-field-row")]
    .map((r) => ({
      label: r.querySelector(".fld-label").value.trim(),
      type: r.querySelector(".fld-type").value,
      required: r.querySelector(".fld-required").checked,
    }))
    .filter((f) => f.label);
  if (fields.length === 0) return toast("Add at least one field.", true);

  const def = { name, fields };
  try {
    await registerCustom(def); // validate server-side
    const defs = loadCustomDefs().filter((d) => d.name !== name);
    defs.push(def);
    saveCustomDefs(defs);
    await loadConfigs();
    // select the new config
    const opt = [...$("#configSelect").options].find((o) => o.text === name);
    if (opt) $("#configSelect").value = opt.value;
    $("#cfgName").value = "";
    $("#cfgFields").innerHTML = "";
    addFieldRow();
    toast(`Saved config “${name}”. It's now selected.`);
  } catch (err) {
    toast("Could not save config: " + err.message, true);
  }
}

function openConfigModal() {
  $("#configModal").hidden = false;
  if (!$("#cfgFields").children.length) addFieldRow();
}
function closeConfigModal() {
  $("#configModal").hidden = true;
}

// ── Utils ─────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function guessType(name) {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".txt")) return "text/plain";
  if (n.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

// ── Wiring ────────────────────────────────────────────────
function init() {
  loadHealth();

  const dz = $("#dropzone");
  const fi = $("#fileInput");
  $("#browseBtn").addEventListener("click", (e) => { e.stopPropagation(); fi.click(); });
  dz.addEventListener("click", () => fi.click());
  fi.addEventListener("change", () => {
    const f = fi.files[0];
    if (f) processFile(f, f.name, f.type || guessType(f.name));
  });
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }),
  );
  dz.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) processFile(f, f.name, f.type || guessType(f.name));
  });

  document.querySelectorAll(".chip[data-sample]").forEach((b) =>
    b.addEventListener("click", () => loadSample(b.dataset.sample)),
  );
  document.querySelectorAll(".chip[data-image]").forEach((b) =>
    b.addEventListener("click", () => loadImageSample(b.dataset.image)),
  );
  renderPrompts();
  document.querySelectorAll(".exports .btn[data-fmt]").forEach((b) =>
    b.addEventListener("click", () => download(b.dataset.fmt)),
  );
  $("#askBtn").addEventListener("click", ask);
  $("#askInput").addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });

  // Extraction configs
  loadConfigs();
  $("#manageConfigsBtn").addEventListener("click", openConfigModal);
  $("#closeConfigsBtn").addEventListener("click", closeConfigModal);
  $("#addFieldBtn").addEventListener("click", () => addFieldRow());
  $("#saveConfigBtn").addEventListener("click", saveConfig);
  $("#configModal").addEventListener("click", (e) => { if (e.target.id === "configModal") closeConfigModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#configModal").hidden) closeConfigModal(); });
}

init();
