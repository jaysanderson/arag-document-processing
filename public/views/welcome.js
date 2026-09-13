/**
 * Welcome — first run. Turn an empty deployment into a processed document in one click,
 * and be honest about which Knowledge Box it is talking to.
 *
 * The headline and subheadline are the customer promise from
 * `marketing/site/document-processing.json`: the product must say on screen what the site
 * says about it. The mock notice is not dismissible — fixture output is never presented
 * as extraction.
 */
import { $, $$, api, buildHash, errorState, esc, icon, navigate, toast } from "../lib/core.js";
import { listSamples, startSample } from "./upload.js";

const GUIDED_SAMPLE = "invoice";

export async function renderWelcome(main, { stale }) {
  const [ready, configs, samples] = await Promise.all([
    api("/readyz").catch(() => null),
    api("/api/v1/extraction-configs").catch(() => ({ items: [] })),
    listSamples().catch(() => []),
  ]);
  if (stale()) return;
  const mock = ready?.arag?.mock === true;

  main.innerHTML = `
    <div class="arag-prose" style="max-width:760px">
      <h1>Read every document the first time</h1>
      <p class="muted" style="font-size:1rem">
        Paperwork arrives as pictures of data — invoices, claim forms, statements, permits,
        delivery notes, applications. This turns them into checked, structured records your
        systems can use, and shows you exactly where every value came from.
      </p>
    </div>

    <div class="arag-grid cols-2" style="margin-top:24px;max-width:860px">
      <div class="arag-card">
        <div class="head"><h2>Try it with a sample</h2></div>
        <div class="body arag-stack">
          <p class="muted">A supplier invoice whose totals do not reconcile — so you can see the validation catch something, and the evidence behind every value it did read.</p>
          <div><button class="arag-btn lg" type="button" id="startSample">${icon("play")} Start the guided sample</button></div>
          <details>
            <summary class="muted small">Other samples</summary>
            <div class="arag-chips" style="margin-top:8px">
              ${samples
                .map(
                  (s) =>
                    `<button class="arag-btn ghost sm" type="button" data-sample="${esc(s.id)}" title="${esc(s.description)}">${esc(s.title)}</button>`,
                )
                .join("")}
            </div>
          </details>
        </div>
      </div>
      <div class="arag-card">
        <div class="head"><h2>Use your own document</h2></div>
        <div class="body arag-stack">
          <p class="muted">PDF, PNG, JPEG, TIFF, DOCX, TXT, CSV or Markdown. Bring a difficult one — a bad scan tells you more than a clean one.</p>
          <div><a class="arag-btn secondary lg" href="${buildHash("/documents/upload")}">${icon("upload")} Upload a document</a></div>
        </div>
      </div>
    </div>

    ${
      mock
        ? `<div class="arag-alert warn arag-prose" style="margin-top:24px;max-width:860px" role="note">
             <strong>This deployment is running the mock Knowledge Box.</strong> Extraction comes from
             deterministic fixtures keyed by filename, not from a model reading the page. Set
             <span class="mono">ARAG_KB_ID</span> and <span class="mono">ARAG_API_KEY</span> for live
             extraction. <a href="${buildHash("/settings/connection")}">Settings → Connection</a>
           </div>`
        : ""
    }

    <p class="muted small" style="margin-top:24px">
      ${configs.items.filter((c) => c.builtin).length} document types are ready to use ·
      <a href="${buildHash("/configs")}">Configs</a>
    </p>
    <div id="welcomeError"></div>`;

  const run = async (sampleId) => {
    const btn = $("#startSample", main);
    btn.disabled = true;
    btn.textContent = "Starting…";
    try {
      const out = await startSample(sampleId);
      toast(`Processing ${out.document.filename}`);
      // Land in the queue, watching the row move — the product is the list, not a wizard.
      navigate("/documents", { tour: "1" });
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Start the guided sample";
      $("#welcomeError", main).innerHTML = errorState(err);
    }
  };
  $("#startSample", main).addEventListener("click", () => run(GUIDED_SAMPLE));
  for (const b of $$("[data-sample]", main)) b.addEventListener("click", () => run(b.dataset.sample));
}
