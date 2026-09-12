/**
 * Ask — a home for grounded per-document Q&A that does not start with finding a row in a
 * list. The screen says plainly that there is no cross-document search: each question is
 * scoped to one file, because `POST /documents/{id}/ask` is per-resource by design.
 */
import { $, api, buildHash, emptyState, errorState, esc, headline, label, navigate } from "../lib/core.js";
import { renderAskPanel } from "./document.js";

export async function renderAsk(main, { query, stale }) {
  main.innerHTML = `
    <header class="dip-pagehead">
      <div class="dip-pagehead__row"><h1>Ask</h1></div>
      <p class="dip-pagehead__sub">Answers come from the selected document only. There is no cross-document search: each question is scoped to one file.</p>
    </header>
    <div class="arag-field" style="max-width:640px">
      <label for="docPick">Document</label>
      <select class="arag-select" id="docPick"><option>Loading…</option></select>
    </div>
    <div id="askPanel" style="margin-top:16px"></div>`;

  let page;
  try {
    page = await api("/api/v1/documents?page_size=100&sort=created_at&order=desc");
  } catch (err) {
    if (!stale()) $("#askPanel", main).innerHTML = errorState(err);
    return;
  }
  if (stale()) return;

  const askable = page.items.filter((d) => d.status === "ready");
  const picker = $("#docPick", main);
  if (!askable.length) {
    picker.parentElement.hidden = true;
    $("#askPanel", main).innerHTML = emptyState({
      iconName: "quote",
      title: "Pick a document to ask about",
      body: "Answers come from one document at a time, so there needs to be a processed document first.",
      actions: `<a class="arag-btn" href="${buildHash("/documents/upload")}">Upload document</a>`,
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

  const show = (id) => {
    const doc = askable.find((d) => d.id === id);
    renderAskPanel($("#askPanel", main), doc);
  };
  picker.addEventListener("change", () => {
    navigate("/ask", { doc: picker.value }, { replace: true });
    show(picker.value);
  });
  show(picker.value);
}
