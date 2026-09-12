/**
 * Upload drawer — get bytes in with the fewest decisions, and make the one decision that
 * matters (auto-classify or force a config) legible.
 *
 * Accepted types and the size ceiling come from `GET /api/v1/settings`, never from markup:
 * a hard-coded `accept=` attribute drifts from `ALLOWED_MIME` the moment either changes,
 * and a 25 MB limit the user only learns about from a 413 is not a limit, it is a trap.
 */
import { $, $$, api, esc, fmtBytes, icon, openDrawer, toast } from "../lib/core.js";

let settings = null;
let configs = null;

async function load() {
  if (!settings) settings = await api("/api/v1/settings").catch(() => null);
  if (!configs) configs = (await api("/api/v1/extraction-configs").catch(() => ({ items: [] }))).items;
}

export async function openUploadDrawer({ onClose, onUploaded, preselect = "auto" } = {}) {
  await load();
  const accepted = settings?.uploads?.acceptedExtensions ?? [];
  const maxBytes = settings?.uploads?.maxBytes ?? 26_214_400;
  const builtin = configs.filter((c) => c.builtin);
  const custom = configs.filter((c) => !c.builtin);
  const offline = settings?.connection?.ok === false;

  const drawer = openDrawer({
    title: "Upload document",
    onClose,
    body: `
      ${
        offline
          ? '<div class="arag-alert error" role="alert">The Knowledge Box is not responding. Uploads are paused until it recovers.</div>'
          : ""
      }
      <div class="arag-stack">
        <div class="arag-dropzone" id="dropzone" tabindex="0" role="button"
             aria-label="Drop files here, or press Enter to browse">
          <input type="file" id="fileInput" hidden multiple accept="${esc(accepted.join(","))}" />
          <div>${icon("upload", { size: 24 })}</div>
          <div><strong>Drop files here</strong></div>
          <div class="muted small">or browse</div>
        </div>
        <p class="arag-help">${esc(
          accepted.map((e) => e.replace(".", "").toUpperCase()).join(" · "),
        )} · up to ${esc(fmtBytes(maxBytes))} each</p>

        <div class="arag-field">
          <label for="cfg">Extraction config</label>
          <select class="arag-select" id="cfg">
            <option value="auto">Auto-detect (classify first)</option>
            <option value="agent">ARAG data-augmentation agent (persisted fields)</option>
            ${builtin.length ? `<optgroup label="Built in">${builtin.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</optgroup>` : ""}
            ${custom.length ? `<optgroup label="Custom">${custom.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</optgroup>` : ""}
          </select>
          <p class="arag-help">Auto-detect picks one of the ${builtin.length} built-in types. Choosing a config forces exactly its fields.</p>
        </div>

        <div id="queueWrap" hidden>
          <h3>Queued (<span id="queueCount">0</span>)</h3>
          <div class="dip-uploadqueue" id="queue" aria-live="polite"></div>
        </div>
      </div>`,
    foot: `<button class="arag-btn ghost" type="button" data-close>Close</button>`,
  });

  const host = drawer.host;
  const cfg = $("#cfg", host);
  if (preselect) cfg.value = preselect;
  const dz = $("#dropzone", host);
  const input = $("#fileInput", host);

  dz.addEventListener("click", () => input.click());
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  for (const ev of ["dragenter", "dragover"]) {
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add("drag");
    });
  }
  for (const ev of ["dragleave", "drop"]) {
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove("drag");
    });
  }
  dz.addEventListener("drop", (e) => queueFiles([...(e.dataTransfer?.files ?? [])]));
  input.addEventListener("change", () => queueFiles([...input.files]));

  async function queueFiles(files) {
    if (!files.length) return;
    const wrap = $("#queueWrap", host);
    const queue = $("#queue", host);
    wrap.hidden = false;
    // Sequential, not parallel: the job runner takes two at a time, so firing ten uploads
    // at once only makes the progress dishonest.
    for (const file of files) {
      const row = document.createElement("div");
      row.innerHTML = `<span>${esc(file.name)}</span><span class="arag-chip info">uploading</span>`;
      queue.appendChild(row);
      $("#queueCount", host).textContent = String(queue.children.length);
      if (file.size > maxBytes) {
        row.lastElementChild.className = "arag-chip danger";
        row.lastElementChild.textContent = "too large";
        toast(`That file is larger than the ${fmtBytes(maxBytes)} limit for this deployment.`, "error");
        continue;
      }
      try {
        const body = new FormData();
        body.append("file", file, file.name);
        await api(`/api/v1/documents?config=${encodeURIComponent(cfg.value)}`, { method: "POST", body });
        row.lastElementChild.className = "arag-chip ok";
        row.lastElementChild.textContent = "queued";
        onUploaded?.();
      } catch (err) {
        row.lastElementChild.className = "arag-chip danger";
        row.lastElementChild.textContent = "failed";
        toast(
          err.status === 415
            ? `That file type is not accepted. This deployment reads ${accepted.map((e) => e.replace(".", "").toUpperCase()).join(", ")}.`
            : err.message,
          "error",
        );
      }
    }
  }

  return drawer;
}

/** Used by the welcome screen: process a bundled sample in one call. */
export async function startSample(sampleId, config) {
  const out = await api("/api/v1/documents/sample", { method: "POST", json: { sampleId, config } });
  return out;
}

export async function listSamples() {
  return (await api("/api/v1/samples")).items;
}

export { $$ };
