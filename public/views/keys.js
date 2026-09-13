/**
 * API keys — the real key store that replaces the `API_KEYS` environment placeholder.
 *
 * A key is minted once and shown once. The reveal is the only modal in this product that
 * Escape does not close, because a key lost at that moment cannot be recovered: the server
 * keeps a salted digest and nothing else. Everything else here is the kit — a data table, a
 * row menu, a drawer, a typed confirm.
 *
 * The list is operator-only: names and last-used times are an inventory of who can call this
 * service, which is not a thing a passer-by is owed.
 */
import {
  $,
  $$,
  announce,
  api,
  confirmDialog,
  emptyState,
  errorState,
  esc,
  fmtAbsolute,
  fmtRelative,
  icon,
  menuButton,
  openDrawer,
  skeletonRows,
  snippet,
  toast,
  wireCopy,
  wireTable,
} from "../lib/core.js";
import { forget, remember } from "../lib/keyring.js";
import { operatorSignIn } from "../lib/settings-form.js";

export async function renderKeys(panel, { editable, onSignedIn }) {
  if (!editable) {
    panel.innerHTML = `
      <section class="arag-card dip-settings" data-group="keys" data-locked aria-labelledby="keysHead">
        <div class="head"><h3 id="keysHead">API keys</h3></div>
        <div class="body">
          <p class="muted arag-prose">A key lets a service call this API without a browser session.
            Keys are shown once, stored as a hash, and can be revoked at any time.</p>
          <div class="arag-alert">
            <strong>The key list needs the operator token.</strong>
            A list of key names and last-used times is an inventory of who can call this service,
            so it is not published to a signed-out viewer.
            <div style="margin-top:8px"><button class="arag-btn sm" type="button" id="keysSignIn">Sign in as operator</button></div>
          </div>
        </div>
      </section>`;
    $("#keysSignIn", panel).addEventListener("click", async () => {
      if (await operatorSignIn()) await onSignedIn?.();
    });
    return;
  }

  panel.innerHTML = `<div id="keysBody">${skeletonRows(4)}</div>`;
  const body = $("#keysBody", panel);
  const paint = async () => {
    let data;
    try {
      data = await api("/api/v1/admin/api-keys");
    } catch (err) {
      body.innerHTML = errorState(err, {
        retry: '<button class="arag-btn secondary sm" type="button" id="keysRetry">Try again</button>',
      });
      $("#keysRetry", body)?.addEventListener("click", paint);
      return;
    }
    const items = data.items ?? [];
    const revoked = items.filter((k) => k.revoked).length;
    body.innerHTML = `
      <header class="arag-row" style="margin-bottom:12px">
        <p class="muted arag-prose" style="flex:1;margin:0">Keys let a service call this API without a
          browser session. Send one as <span class="mono">X-API-Key</span> or as a bearer token.</p>
        <button class="arag-btn" type="button" id="createKey">${icon("plus")} Create a key</button>
      </header>
      ${
        data.enforced
          ? ""
          : `<div class="arag-alert warn" style="margin-bottom:12px">
               <strong>API keys are not enforced on this deployment.</strong> Reads and uploads are open to
               anyone who can reach it. Creating a key does not turn enforcement on — switch
               <em>Require an API key</em> on the Security tab. Writes to shared state always need a
               credential either way.</div>`
      }
      ${
        items.length
          ? `<div class="arag-datatable" id="keysTable"><div class="scroll">
              <table class="arag-table">
                <thead><tr>
                  <th>Name</th><th>Key</th><th>Created</th><th>Created by</th><th>Last used</th>
                  <th class="rowactions"><span class="sr-only">Actions</span></th>
                </tr></thead>
                <tbody>${items.map(rowHtml).join("")}</tbody>
              </table></div>
              <nav class="arag-pagination"><span class="range">${items.length} key${
                items.length === 1 ? "" : "s"
              }${revoked ? ` · ${revoked} revoked` : ""}${
                data.seeded ? ` · ${data.seeded} seeded from API_KEYS` : ""
              }</span></nav>
            </div>`
          : emptyState({
              icon: "key",
              title: "No API keys yet",
              body: "A key lets a service call this API without a browser session. Keys are shown once, stored as a hash, and can be revoked at any time.",
              actions: '<button class="arag-btn" type="button" id="createKeyEmpty">Create a key</button>',
            })
      }`;

    for (const id of ["createKey", "createKeyEmpty"]) {
      $(`#${id}`, body)?.addEventListener("click", () => createKey(paint));
    }
    for (const tr of $$("#keysTable tbody tr", body)) {
      const key = items.find((k) => k.id === tr.dataset.id);
      const cell = $(".rowactions", tr);
      if (!key || !cell) continue;
      cell.appendChild(
        menuButton(
          () => [
            {
              label: "Copy the prefix",
              onSelect: () => copy(key.prefix, "Key prefix copied"),
            },
            {
              label: "Revoke",
              danger: true,
              hidden: key.revoked,
              onSelect: () => revoke(key, paint),
            },
          ],
          { ariaLabel: `More actions for ${key.name}` },
        ),
      );
    }
    // Sorting only: bulk-revoking keys is not a workflow anyone wants.
    wireTable($("#keysTable", body), {});
  };
  await paint();
}

const rowHtml = (k) => `
  <tr data-id="${esc(k.id)}"${k.revoked ? ' class="is-revoked"' : ""}>
    <td><span class="cell-title">${esc(k.name)}</span><span class="cell-sub mono">${esc(k.id)}</span></td>
    <td class="mono small">${esc(k.prefix)}…</td>
    <td class="small" title="${esc(fmtAbsolute(k.createdAt))}">${esc(new Date(k.createdAt).toLocaleDateString())}</td>
    <td class="small">${esc(k.createdBy)}</td>
    <td class="small">${
      k.revoked
        ? `<span class="dip-revoked">Revoked ${esc(new Date(k.revokedAt).toLocaleDateString())}</span>`
        : k.lastUsedAt
          ? `<span title="${esc(fmtAbsolute(k.lastUsedAt))}">${esc(fmtRelative(k.lastUsedAt))}</span>`
          : '<span class="muted">Never used</span>'
    }</td>
    <td class="rowactions"></td>
  </tr>`;

async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast("Copy failed — select the text manually.", "error");
  }
}

function createKey(onDone) {
  const drawer = openDrawer({
    title: "Create an API key",
    body: `
      <form id="newKeyForm" autocomplete="off">
        <div class="arag-field">
          <label for="keyName">Name</label>
          <input class="arag-input" id="keyName" name="name" maxlength="80" required />
          <p class="arag-help">What this key is for. It appears in the audit log beside every change
            it makes, so "Nightly export" beats "key 3".</p>
        </div>
        <div id="newKeyError"></div>
      </form>`,
    foot: '<button class="arag-btn" type="submit" form="newKeyForm" id="createSubmit">Create key</button>',
  });
  const name = $("#keyName", drawer.host);
  name.focus();
  $("#newKeyForm", drawer.host).addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#createSubmit", drawer.host);
    btn.disabled = true;
    btn.textContent = "Creating…";
    try {
      const out = await api("/api/v1/admin/api-keys", { method: "POST", json: { name: name.value.trim() } });
      remember(out.apiKey, out.key);
      revealKey(drawer, out, onDone);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Create key";
      $("#newKeyError", drawer.host).innerHTML =
        `<div class="arag-alert error" role="alert">${esc(err.message)}</div>`;
    }
  });
}

/**
 * The create-once reveal. The drawer's body is replaced rather than followed by a toast, the
 * scrim and Escape stop dismissing it, and the only way out is the button that says you have
 * copied the key. This is the one dismissal rule the product breaks on purpose.
 */
function revealKey(drawer, out, onDone) {
  const aside = $(".arag-drawer", drawer.host);
  aside.setAttribute("role", "alertdialog");
  aside.setAttribute("aria-describedby", "keyOnce");
  // Both dismissal paths are removed by replacing the nodes that carry their listeners.
  const backdrop = $(".arag-drawer-backdrop", drawer.host);
  backdrop.replaceWith(backdrop.cloneNode(false));
  $(".arag-drawer .head .close", drawer.host)?.remove();
  const swallowEscape = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  document.addEventListener("keydown", swallowEscape, true);

  $(".arag-drawer .body", drawer.host).innerHTML = `
    <div class="arag-alert warn" id="keyOnce">
      <strong>This is the only time this key is shown.</strong> It is stored as a hash and cannot be
      shown again. Copy it now.
    </div>
    ${snippet(out.key, { lang: "text" })}
    <dl class="arag-kv" style="margin-top:12px">
      <dt>Name</dt><dd>${esc(out.apiKey.name)}</dd>
      <dt>Prefix</dt><dd class="mono">${esc(out.apiKey.prefix)}</dd>
      <dt>Created by</dt><dd>${esc(out.apiKey.createdBy)}</dd>
    </dl>
    <p class="arag-help">Send it as <span class="mono">X-API-Key</span>, or as a bearer token. It is
      also offered by name in the API explorer's credential picker for as long as this tab stays
      open — a reload forgets it, because a key kept in the browser is a key on somebody's disk.</p>
    ${snippet(`curl -H 'X-API-Key: $API_KEY' ${location.origin}/api/v1/documents`, { lang: "bash" })}`;
  const foot = $(".arag-drawer .foot", drawer.host);
  foot.innerHTML = '<button class="arag-btn" type="button" id="copiedIt">I have copied it</button>';
  wireCopy(drawer.host);
  announce("Your new API key is shown once. Copy it before closing.");
  $("#copiedIt", drawer.host).addEventListener("click", () => {
    document.removeEventListener("keydown", swallowEscape, true);
    drawer.close();
    toast(`API key “${out.apiKey.name}” created`);
    onDone?.();
  });
  $("#copiedIt", drawer.host).focus();
}

async function revoke(key, onDone) {
  const ok = await confirmDialog({
    title: `Revoke “${esc(key.name)}”?`,
    body: `<p>Any integration using this key gets a 401 on its next call. This cannot be undone —
           create a new key instead of un-revoking this one.</p>`,
    confirmLabel: "Revoke key",
    typed: "REVOKE",
    danger: true,
  });
  if (!ok) return;
  await api(`/api/v1/admin/api-keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });
  forget(key.id);
  toast(`“${key.name}” revoked`);
  announce(`API key ${key.name} revoked. It returns 401 on its next call.`);
  await onDone?.();
}
