/**
 * Configs — what this product can read today, and how to teach it something new.
 *
 * A config is the thing the model is forced to return: every one, built-in or custom, is
 * backed by a stored ARAG search configuration that pins the model, the full_resource
 * grounding strategy, the prompt and the JSON schema. That is why "a new document type"
 * is five minutes rather than a project, and the screen says so in those words.
 */
import {
  $,
  $$,
  api,
  buildHash,
  confirmDialog,
  emptyState,
  errorState,
  esc,
  icon,
  label,
  menuButton,
  navigate,
  skeletonRows,
  toast,
  wireTable,
} from "../lib/core.js";

/**
 * The Knowledge Box's own ceiling, shown before a partner runs into it: 20 key-value schemas
 * of 50 fields each. Every provisioned config takes one, and a generator agent takes a second
 * one of its own — which is why the number here can be larger than the config count.
 */
const KV_SCHEMA_BUDGET = 20;
const KV_FIELD_BUDGET = 50;

const kvBudget = (items) => {
  const used = new Set(
    items.filter((c) => c.provisioning?.keyValueSchema?.state === "provisioned").map((c) => c.kvSchemaId),
  ).size;
  return `${used} of ${KV_SCHEMA_BUDGET} Knowledge Box schemas`;
};

export async function renderConfigs(main, { query, stale }) {
  main.innerHTML = `
    <header class="arag-pagehead">
      <div class="row">
        <h1>Configs</h1>
        <div class="actions">
          <a class="arag-btn" href="${buildHash("/configs/new")}">${icon("plus")} New config</a>
        </div>
      </div>
      <p class="sub">Each config is provisioned as a stored ARAG search configuration, so the model, the grounding strategy and the JSON schema live in the Knowledge Box rather than in client code.</p>
    </header>
    <div id="list">${skeletonRows(5)}</div>`;

  let items;
  try {
    items = (await api("/api/v1/extraction-configs")).items;
  } catch (err) {
    if (!stale()) $("#list", main).innerHTML = errorState(err);
    return;
  }
  if (stale()) return;

  const q = (query.q ?? "").toLowerCase();
  const kind = query.kind ?? "";
  const match = (c) =>
    (!q || `${c.name} ${c.aragConfig} ${c.docType}`.toLowerCase().includes(q)) &&
    (!kind || (kind === "builtin") === c.builtin);
  const shown = items.filter(match);
  const custom = shown.filter((c) => !c.builtin);
  const builtin = shown.filter((c) => c.builtin);

  $("#list", main).innerHTML = `
    <div class="arag-filterbar">
      <div class="arag-search">${icon("search")}
        <label class="sr-only" for="cq">Search configs</label>
        <input class="arag-input" id="cq" type="search" value="${esc(query.q ?? "")}" placeholder="Search configs" />
      </div>
      <label class="sr-only" for="ckind">Kind</label>
      <select class="arag-select" id="ckind">
        <option value="">All configs</option>
        <option value="custom"${kind === "custom" ? " selected" : ""}>Custom</option>
        <option value="builtin"${kind === "builtin" ? " selected" : ""}>Built in</option>
      </select>
      <span class="spacer"></span>
      <span class="count">${items.length} configs</span>
      <span class="count" title="A Knowledge Box holds at most 20 key-value schemas of 50 fields each. Every config that is provisioned takes one.">${kvBudget(items)}</span>
      ${q || kind ? '<button class="arag-btn ghost sm" type="button" id="clearCfg">Clear all filters</button>' : ""}
    </div>
    ${shown.length ? "" : emptyState({ icon: "search", title: "No configs match", actions: '<button class="arag-btn secondary" type="button" id="clearCfg2">Clear all filters</button>' })}
    ${custom.length ? section("Custom", custom) : ""}
    ${builtin.length ? section("Built in", builtin) : ""}`;

  let debounce;
  $("#cq", main).addEventListener("input", (e) => {
    clearTimeout(debounce);
    const value = e.target.value;
    debounce = setTimeout(() => navigate("/configs", { ...query, q: value || undefined }), 250);
  });
  $("#ckind", main).addEventListener("change", (e) =>
    navigate("/configs", { ...query, kind: e.target.value || undefined }),
  );
  for (const id of ["clearCfg", "clearCfg2"]) {
    $(`#${id}`, main)?.addEventListener("click", () => navigate("/configs", {}));
  }
  // Row activation (and the "click anywhere but a control" rule) comes from the kit.
  for (const table of $$(".arag-datatable", main)) wireTable(table);
  for (const tr of $$("tr[data-cfg]", main)) {
    const cfg = items.find((c) => c.id === tr.dataset.cfg);
    $(".rowactions", tr).appendChild(
      menuButton(
        () => [
          { label: "Open", onSelect: () => navigate(`/configs/${cfg.id}`) },
          { label: "Use for an upload", onSelect: () => navigate("/documents/upload", { config: cfg.id }) },
          {
            label: "View documents using it",
            onSelect: () => navigate("/documents", { config: cfg.id }),
            hidden: cfg.documentCount === 0,
          },
          { label: "Edit", hidden: cfg.builtin, onSelect: () => navigate(`/configs/${cfg.id}/edit`) },
          { label: "Re-provision", onSelect: () => provision(cfg, main, query) },
          { label: "Delete", danger: true, hidden: cfg.builtin, onSelect: () => remove(cfg, main, query) },
        ],
        { ariaLabel: `Actions for ${cfg.name}` },
      ),
    );
  }
}

function section(title, rows) {
  return `<h2 style="margin-top:20px">${esc(title)} (${rows.length})</h2>
    <div class="arag-datatable"><div class="scroll">
    <table class="arag-table">
      <thead><tr><th>Name</th><th>Fields</th><th>ARAG configuration</th><th>Documents</th><th>State</th><th class="rowactions"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>
        ${rows
          .map(
            (c) => `<tr data-cfg="${esc(c.id)}" data-href="${buildHash(`/configs/${c.id}`)}">
            <td><a class="cell-title" href="${buildHash(`/configs/${c.id}`)}">${esc(c.name)}</a>
                <span class="cell-sub">${esc(c.description)}</span></td>
            <td class="num">${c.fields.length}</td>
            <td class="mono small">${esc(c.aragConfig)}</td>
            <td class="num">${c.documentCount ?? 0}</td>
            <td>${c.provisioned ? '<span class="arag-chip ok">Ready</span>' : '<span class="arag-chip warn">Not provisioned</span>'}</td>
            <td class="rowactions"></td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table></div></div>`;
}

async function provision(cfg, main, query) {
  try {
    const r = await api(`/api/v1/extraction-configs/${cfg.id}/provision`, { method: "POST" });
    toast(
      r.ok ? `${cfg.name} provisioned as ${r.aragConfig}` : `Provisioning failed: ${r.error}`,
      r.ok ? "info" : "error",
    );
    renderConfigs(main, { query, stale: () => false });
  } catch (err) {
    toast(err.message, "error");
  }
}

async function remove(cfg, main, query) {
  const ok = await confirmDialog({
    title: "Delete config",
    body: `<p>Delete <strong>${esc(cfg.name)}</strong> and its stored ARAG search configuration?</p>
      ${cfg.documentCount ? `<p>${cfg.documentCount} document${cfg.documentCount === 1 ? " was" : "s were"} processed with this config. Their records are unaffected.</p>` : ""}`,
    confirmLabel: "Delete config",
  });
  if (!ok) return;
  try {
    await api(`/api/v1/extraction-configs/${cfg.id}`, { method: "DELETE" });
    toast("Config deleted");
    renderConfigs(main, { query, stale: () => false });
  } catch (err) {
    toast(err.message, "error");
  }
}

// ── detail ───────────────────────────────────────────────────────────────────

export async function renderConfigDetail(main, { params, stale }) {
  main.innerHTML = skeletonRows(4);
  let cfg;
  try {
    cfg = await api(`/api/v1/extraction-configs/${params.id}`);
  } catch (err) {
    if (!stale())
      main.innerHTML = errorState(err.status === 404 ? { message: "That config no longer exists." } : err, {
        retry: `<a class="arag-btn secondary sm" href="${buildHash("/configs")}">Back to configs</a>`,
      });
    return;
  }
  if (stale()) return;

  main.innerHTML = `
    <header class="arag-pagehead">
      <nav class="arag-breadcrumb" aria-label="Breadcrumb">
        <ol><li><a href="${buildHash("/configs")}">Configs</a></li><li aria-current="page">${esc(cfg.name)}</li></ol>
      </nav>
      <div class="row">
        <h1>${esc(cfg.name)}</h1>
        <div class="actions">
          <a class="arag-btn secondary" href="${buildHash("/documents/upload", { config: cfg.id })}">Use for an upload</a>
          ${cfg.builtin ? "" : `<a class="arag-btn" href="${buildHash(`/configs/${cfg.id}/edit`)}">Edit</a>`}
        </div>
      </div>
      <p class="sub">${esc(cfg.description)}</p>
    </header>
    <div class="arag-split">
      <section>
        <h2>Fields (${cfg.fields.length})</h2>
        <div class="arag-datatable"><div class="scroll">
        <table class="arag-table">
          <thead><tr><th>Label</th><th>Key</th><th>Type</th><th>Knowledge Box type</th><th>Required</th></tr></thead>
          <tbody>${cfg.fields
            .map(
              (f) => `<tr><td><span class="cell-title">${esc(f.label)}</span>
                  ${f.description ? `<span class="cell-sub">${esc(f.description)}</span>` : ""}</td>
                <td class="mono small">${esc(f.key)}</td>
                <td>${esc(f.type)}</td>
                <td class="mono small">${esc(cfg.kvFields?.[f.key] ? (f.kvType ?? "text") : "—")}</td>
                <td>${f.required ? "Yes" : "—"}</td></tr>`,
            )
            .join("")}</tbody>
        </table></div></div>
      </section>
      <aside class="arag-stack">
        <div class="arag-card" id="provCard">
          <div class="head"><h3>Provisioning</h3></div>
          <div class="body">
            <dl class="arag-kv">
              <dt>Kind</dt><dd>${cfg.builtin ? "Built in" : "Custom"}</dd>
              <dt>Document type</dt><dd>${esc(label(cfg.docType))}</dd>
              <dt>ARAG configuration</dt><dd class="mono">${esc(cfg.aragConfig)}</dd>
              <dt>State</dt><dd>${cfg.provisioned ? '<span class="arag-chip ok">Ready</span>' : '<span class="arag-chip warn">Not provisioned</span>'}</dd>
              <dt>Documents</dt><dd>${cfg.documentCount ?? 0}</dd>
            </dl>
            <div class="arag-row" style="margin-top:12px">
              <button class="arag-btn ghost sm" type="button" id="reprov">Re-provision</button>
              ${cfg.documentCount ? `<a class="arag-btn ghost sm" href="${buildHash("/documents", { config: cfg.id })}">View documents</a>` : ""}
            </div>
          </div>
        </div>
        <div class="arag-card" id="kvCard">${kvSchemaCard(cfg)}</div>
        <div class="arag-card" id="genCard">${skeletonRows(2)}</div>
        ${
          cfg.builtin
            ? `<div class="arag-card pad"><p class="muted small">Built-in configs cannot be edited or deleted. To change what is extracted for this type, create a custom config with the fields you want and force it on upload.</p></div>`
            : `<div class="arag-card dip-danger-zone">
                 <div class="head"><h3>Danger zone</h3></div>
                 <div class="body"><p class="muted small">Deleting removes the stored ARAG search configuration too. Records already produced with it are unaffected.</p>
                 <button class="arag-btn danger sm" type="button" id="delCfg">Delete config</button></div>
               </div>`
        }
      </aside>
    </div>`;

  await renderGeneratorCard($("#genCard", main), cfg, () =>
    renderConfigDetail(main, { params, stale: () => false }),
  );

  $("#reprov", main).addEventListener("click", async () => {
    const r = await api(`/api/v1/extraction-configs/${cfg.id}/provision`, { method: "POST" });
    toast(r.ok ? "Re-provisioned" : `Provisioning failed: ${r.error}`, r.ok ? "info" : "error");
    renderConfigDetail(main, { params, stale: () => false });
  });
  $("#delCfg", main)?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Delete config",
      body: `<p>Delete <strong>${esc(cfg.name)}</strong>?</p>${cfg.documentCount ? `<p>${cfg.documentCount} document${cfg.documentCount === 1 ? " was" : "s were"} processed with it. Their records are unaffected.</p>` : ""}`,
      confirmLabel: "Delete config",
    });
    if (!ok) return;
    await api(`/api/v1/extraction-configs/${cfg.id}`, { method: "DELETE" });
    toast("Config deleted");
    navigate("/configs");
  });
}

/**
 * What this config provisions *in the Knowledge Box* — the typed key-value schema the
 * extracted record is written to, so the structured values live there rather than only in
 * this product's store. A failed provision is stated here, where it can be retried, rather
 * than swallowed into a boolean.
 */
function kvSchemaCard(cfg) {
  const p = cfg.provisioning ?? {};
  const sc = p.searchConfiguration ?? {};
  const kvs = p.keyValueSchema ?? {};
  const chip = (state) =>
    state === "provisioned"
      ? '<span class="arag-chip ok">Provisioned</span>'
      : state === "failed"
        ? '<span class="arag-chip danger">Failed</span>'
        : '<span class="arag-chip warn">Not provisioned</span>';
  const fields = kvs.fields ?? Object.keys(cfg.kvFields ?? {}).length;
  return `
    <div class="head"><h3>Knowledge Box schema</h3>${chip(kvs.state)}</div>
    <div class="body">
      <dl class="arag-kv">
        <dt>Key-value schema</dt><dd class="mono">${esc(cfg.kvSchemaId ?? "—")}</dd>
        <dt>Fields</dt><dd>${fields} of ${KV_FIELD_BUDGET} allowed in one schema</dd>
        <dt>Search configuration</dt><dd class="mono">${esc(sc.name ?? cfg.aragConfig)} ${chip(sc.state)}</dd>
        <dt>Provisioned</dt><dd>${kvs.at ? esc(new Date(kvs.at).toLocaleString()) : "—"}</dd>
      </dl>
      ${
        kvs.error || sc.error
          ? `<div class="arag-alert error" style="margin-top:12px">${esc(kvs.error ?? sc.error)}
               <div class="small" style="margin-top:6px">Re-provision to try again. Until it succeeds,
                 records processed with this config are written to this product's store only.</div></div>`
          : `<p class="muted small" style="margin-top:12px">After extraction the verified record is written
               to this schema on the resource, so the values are searchable and filterable through the
               Knowledge Box itself. Field types are mapped from the config's own schema and the
               descriptions are carried over to guide the extraction.</p>`
      }
    </div>`;
}

/**
 * The alternative extraction path: a Data Augmentation generator agent that writes the same
 * fields into its own key-value schema. It is offered here, where the schema it needs is
 * defined — and the card states the asymmetry plainly, because the agent's values are not
 * grounded to the same standard as the pipeline's.
 */
async function renderGeneratorCard(host, cfg, refresh) {
  const out = await api(`/api/v1/extraction-configs/${cfg.id}/generator`).catch(() => null);
  const agent = out?.agent ?? null;
  host.innerHTML = `
    <div class="head"><h3>Generator agent</h3>${
      agent
        ? `<span class="arag-chip ${agent.state === "running" ? "info" : "neutral"}">${esc(label(agent.state))}</span>`
        : '<span class="arag-chip neutral">Not provisioned</span>'
    }</div>
    <div class="body">
      <p class="muted small">Progress Agentic RAG can populate a key-value schema itself, with a Data
        Augmentation generator agent whose field descriptions guide the extraction. It is a second path
        to the same values — and a way to compare this product's pipeline against the Knowledge Box's own.</p>
      <p class="muted small"><strong>It returns no quote.</strong> The agent writes values and nothing to
        verify them against, so its column on the comparison carries no verification badge and never
        counts towards a grounding score.</p>
      ${
        agent
          ? `<dl class="arag-kv">
               <dt>Agent</dt><dd class="mono small">${esc(agent.name)}</dd>
               <dt>Its own schema</dt><dd class="mono small">${esc(agent.kvSchemaId)}</dd>
               <dt>Started</dt><dd>${esc(new Date(agent.startedAt).toLocaleString())}</dd>
             </dl>
             <div class="arag-row" style="margin-top:12px">
               <button class="arag-btn ghost sm" type="button" id="genStop">Stop</button>
               <button class="arag-btn danger sm" type="button" id="genDelete">Delete the agent</button>
             </div>`
          : `<div class="arag-row" style="margin-top:12px">
               <button class="arag-btn secondary sm" type="button" id="genProvision">Provision a generator agent</button>
             </div>`
      }
    </div>`;
  $("#genProvision", host)?.addEventListener("click", async () => {
    try {
      await api(`/api/v1/extraction-configs/${cfg.id}/generator`, { method: "POST", json: {} });
      toast("Generator agent provisioned");
      await refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  });
  $("#genStop", host)?.addEventListener("click", async () => {
    await api(`/api/v1/extraction-configs/${cfg.id}/generator/stop`, { method: "POST", json: {} }).catch(
      (err) => toast(err.message, "error"),
    );
    await refresh();
  });
  $("#genDelete", host)?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Delete the generator agent?",
      body: "<p>The agent and its own key-value schema are removed from the Knowledge Box. Values it has already written stay on the resources until they are overwritten.</p>",
      confirmLabel: "Delete the agent",
    });
    if (!ok) return;
    await api(`/api/v1/extraction-configs/${cfg.id}/generator`, { method: "DELETE" }).catch((err) =>
      toast(err.message, "error"),
    );
    await refresh();
  });
}

// ── field builder ────────────────────────────────────────────────────────────

const TYPES = [
  ["string", "text"],
  ["number", "number/amount"],
  ["array", "list"],
];

export async function renderConfigBuilder(main, { params, stale }) {
  const editing = Boolean(params?.id);
  let cfg = null;
  if (editing) {
    try {
      cfg = await api(`/api/v1/extraction-configs/${params.id}`);
    } catch (err) {
      if (!stale()) main.innerHTML = errorState(err);
      return;
    }
    if (stale()) return;
    if (cfg.builtin) {
      main.innerHTML = errorState(
        {
          message:
            "Built-in configs cannot be edited. Create a custom config with the fields you want instead.",
        },
        { retry: `<a class="arag-btn secondary sm" href="${buildHash("/configs")}">Back to configs</a>` },
      );
      return;
    }
  }

  main.innerHTML = `
    <header class="arag-pagehead">
      <nav class="arag-breadcrumb" aria-label="Breadcrumb">
        <ol><li><a href="${buildHash("/configs")}">Configs</a></li><li aria-current="page">${editing ? esc(cfg.name) : "New config"}</li></ol>
      </nav>
      <div class="row">
        <h1>${editing ? "Edit extraction config" : "New extraction config"}</h1>
        <div class="actions">
          <a class="arag-btn ghost" href="${buildHash(editing ? `/configs/${cfg.id}` : "/configs")}">Cancel</a>
          <button class="arag-btn" type="button" id="saveCfg">Save config</button>
        </div>
      </div>
    </header>
    <div id="formError"></div>
    <div class="arag-split">
      <section class="arag-stack">
        <div class="arag-field">
          <label for="cfgName">Name</label>
          <input class="arag-input" id="cfgName" maxlength="80" value="${esc(cfg?.name ?? "")}" placeholder="Insurance Card" />
        </div>
        <div class="arag-field">
          <label for="cfgDesc">Description (optional)</label>
          <textarea class="arag-textarea" id="cfgDesc" maxlength="400" placeholder="Member-facing medical scheme card, front and back.">${esc(cfg?.description ?? "")}</textarea>
        </div>
        <h2>Fields</h2>
        <div id="fieldRows"></div>
        <div><button class="arag-btn ghost sm" type="button" id="addField">${icon("plus", { size: 14 })} Add field</button></div>
      </section>
      <aside class="arag-stack">
        <div class="arag-card">
          <div class="head"><h3>What saving does</h3></div>
          <div class="body"><p class="muted small">Saving provisions a stored ARAG search configuration that pins the model, full_resource grounding, the prompt and a JSON schema built from these fields. Every document uploaded with this config is then read the same way.</p>
          <p class="muted small">Labels become the machine keys: <span class="mono" id="keyPreview"></span></p></div>
        </div>
        <div class="arag-card">
          <div class="head"><h3>Tips</h3></div>
          <div class="body"><p class="muted small">Name fields as they appear on the page. Capture amounts as text — they are parsed and checked afterwards.</p></div>
        </div>
      </aside>
    </div>`;

  const rows = $("#fieldRows", main);
  const addRow = (f = {}) => {
    const row = document.createElement("div");
    row.className = "dip-fieldrow";
    const n = rows.children.length + 1;
    row.innerHTML = `
      <input class="arag-input fld-label" placeholder="Field label (e.g. Policy Number)" aria-label="Label for field ${n}" value="${esc(f.label ?? "")}" />
      <select class="arag-select fld-type" aria-label="Type for field ${n}">
        ${TYPES.map(([v, t]) => `<option value="${v}"${f.type === v ? " selected" : ""}>${t}</option>`).join("")}
      </select>
      <label class="dip-fieldrow__req"><input type="checkbox" class="fld-required"${f.required ? " checked" : ""} /> required</label>
      <button class="arag-btn ghost sm fld-up" type="button" aria-label="Move field ${n} up">↑</button>
      <button class="arag-btn ghost sm fld-down" type="button" aria-label="Move field ${n} down">↓</button>
      <button class="arag-btn ghost sm fld-del" type="button" aria-label="Remove field ${n}">${icon("x", { size: 14 })}</button>`;
    rows.appendChild(row);
    $(".fld-del", row).addEventListener("click", () => {
      row.remove();
      updateKeys();
    });
    $(".fld-up", row).addEventListener("click", () => {
      row.previousElementSibling?.before(row);
      updateKeys();
    });
    $(".fld-down", row).addEventListener("click", () => {
      row.nextElementSibling?.after(row);
      updateKeys();
    });
    $(".fld-label", row).addEventListener("input", updateKeys);
    updateKeys();
  };
  const toKey = (s) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field";
  function updateKeys() {
    // Mirror `buildCustomSchema`'s de-duplication, so the preview shows the keys that will
    // actually be saved rather than two identical ones.
    const seen = new Map();
    const keys = $$(".fld-label", rows)
      .map((i) => i.value.trim())
      .filter(Boolean)
      .map((labelText) => {
        const base = toKey(labelText);
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        return n === 1 ? base : `${base}_${n}`;
      });
    $("#keyPreview", main).textContent = keys.join(", ") || "—";
  }

  for (const f of cfg?.fields ?? [{}]) addRow(f);
  $("#addField", main).addEventListener("click", () => addRow());

  $("#saveCfg", main).addEventListener("click", async () => {
    const name = $("#cfgName", main).value.trim();
    const description = $("#cfgDesc", main).value.trim();
    const fields = $$(".dip-fieldrow", rows)
      .map((r) => ({
        label: $(".fld-label", r).value.trim(),
        type: $(".fld-type", r).value,
        required: $(".fld-required", r).checked,
      }))
      .filter((f) => f.label);
    const problems = [];
    if (!name) problems.push("Give the config a name.");
    if (!fields.length) problems.push("Add at least one field with a label.");
    if (problems.length) {
      $("#formError", main).innerHTML =
        `<div class="arag-alert error" role="alert">${problems.map(esc).join(" ")}</div>`;
      return;
    }
    $("#formError", main).innerHTML = "";
    try {
      const body = { name, fields, ...(description ? { description } : {}) };
      const saved = editing
        ? await api(`/api/v1/extraction-configs/${cfg.id}`, { method: "PUT", json: body })
        : await api("/api/v1/extraction-configs", { method: "POST", json: body });
      toast(`Saved “${saved.name}” — provisioned as ${saved.aragConfig}`);
      navigate(`/configs/${saved.id}`);
    } catch (err) {
      $("#formError", main).innerHTML =
        `<div class="arag-alert error" role="alert">Could not save the config. ${esc(err.message)}</div>`;
    }
  });
}
