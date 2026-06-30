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

// ── KB status ─────────────────────────────────────────────
async function loadHealth() {
  try {
    const r = await fetch("/api/health");
    const h = await r.json();
    $("#kbDot").className = "dot ok";
    $("#kbText").textContent = `KB ${String(h.kb).slice(0, 8)}… · ${h.model}`;
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
  if (meta !== undefined) li.querySelector(".st-meta").textContent = meta;
}

// ── Ingest + process ──────────────────────────────────────
async function processFile(blob, filename, contentType) {
  if (busy) return;
  busy = true;
  currentId = null;
  $("#resultEmpty").hidden = true;
  $("#resultBody").hidden = true;
  $("#fileLabel").textContent = filename;
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
    toast("Upload failed: " + err.message, true);
    busy = false;
    return;
  }

  // Stream the pipeline.
  const url = `/api/process?id=${encodeURIComponent(resourceId)}&filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(contentType)}`;
  const es = new EventSource(url);

  const onStage = (e) => {
    const d = JSON.parse(e.data);
    const meta = d.ms !== undefined ? `${d.ms} ms` : d.message && d.status === "start" ? "" : "";
    setStage(d.stage, d.status, meta || undefined);
    if (d.stage === "classify" && d.status === "ok" && d.data) {
      // surface the chosen type early
      setStage("classify", "ok", `${(d.data.docType || "")} ${Math.round((d.data.confidence || 0) * 100)}%`);
    }
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
  $("#resultBody").hidden = false;

  $("#docTypeBadge").textContent = rec.docType.replace(/_/g, " ");
  $("#docConf").textContent = rec.docTypeConfidence ? `${Math.round(rec.docTypeConfidence * 100)}% confidence` : "";

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
  document.querySelectorAll(".exports .btn[data-fmt]").forEach((b) =>
    b.addEventListener("click", () => download(b.dataset.fmt)),
  );
  $("#askBtn").addEventListener("click", ask);
  $("#askInput").addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });
}

init();
