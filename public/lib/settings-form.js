/**
 * The settings form — one module, both surfaces.
 *
 * Every control on this screen is generated from the API's own field metadata
 * (`GET /api/v1/admin/settings` → `groups[].fields[]` carrying `label`, `description`,
 * `type`, `envVar`, `source`, `secret`, `adminOnly` and the constraints). Nothing here
 * hand-writes a field list: a setting added to `SETTING_DEFS` on the server appears on both
 * screens with no front-end change, and a setting removed there cannot linger here.
 *
 * It is used by the operator app's Settings area (`/#/settings/*`) and by the operator
 * console's Connection, Branding and Security screens (`/admin/#/*`). The console keeps its
 * screens — a partner's operator learned where they are — but there is one form behind them,
 * so an edit behaves identically wherever it is made.
 *
 * Three things it is careful about:
 *
 *  1. **Provenance is visible.** Every row says whether the value came from the store
 *     ("Set here"), the environment ("Environment default") or the product's own built-in,
 *     and names the environment variable. Reset returns one field to its default.
 *  2. **Secrets are never rendered.** A secret row shows `set · ends abcd` and a Rotate
 *     drawer. The value is only ever in the password input, and only until it is sent.
 *  3. **A save proves itself.** After `PATCH` the card re-reads the `applied` block — what
 *     the running process is using *now*, read from the live objects — and shows it. That is
 *     the difference between a form that saved and a product that changed.
 */
import { $, $$, announce, api, confirmDialog, esc, fmtBytes, icon, openDrawer, toast } from "./core.js";

export const SETTINGS_PATH = "/api/v1/admin/settings";

/** Group → the slice of the `applied` block that proves an edit to it took effect. */
const APPLIED_SECTION = {
  connection: "arag",
  limits: "limits",
  security: "security",
  retention: "retention",
  operations: "operations",
  branding: "branding",
};

/**
 * What the card foot says once a save lands. Everything in this product is read from the
 * store per request, so the honest answer is almost always "now" — the two exceptions say
 * so themselves rather than being quietly wrong.
 */
const EFFECT_NOTE = {
  limits: "In effect for the next upload. Requests already in flight keep the old ceiling.",
  operations: "In effect now — the next log line is written at the new level.",
};

/** `maxUploadBytes` → `Max upload bytes`; used only for the applied block's own keys. */
const humanise = (key) =>
  String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());

const BYTE_KEYS = /bytes$/i;

/** Fetch the full settings payload, or report that this viewer may not read it. */
export async function loadSettings() {
  try {
    return { editable: true, data: await api(SETTINGS_PATH) };
  } catch (err) {
    if (err.status === 401 || err.status === 403) return { editable: false, status: err.status };
    throw err;
  }
}

/**
 * Sign in as operator without leaving the page. The same token, the same endpoint and the
 * same cookie as the operator console — a second credential for the same person would be a
 * second thing to lose.
 */
export function operatorSignIn() {
  return new Promise((resolve) => {
    let settled = false;
    const drawer = openDrawer({
      title: "Operator sign-in",
      body: `
        <form id="opSignIn" autocomplete="off">
          <p class="arag-prose muted">Editing this deployment's configuration needs the operator
            token — the <span class="mono">ADMIN_TOKEN</span> set for this deployment. It is
            exchanged for a cookie and never held in the page.</p>
          <div class="arag-field">
            <label for="opToken">Operator token</label>
            <input class="arag-input" id="opToken" name="token" type="password"
                   autocomplete="current-password" />
          </div>
          <div id="opError"></div>
        </form>`,
      foot: '<button class="arag-btn" type="submit" form="opSignIn" id="opSubmit">Sign in</button>',
      onClose: () => {
        if (!settled) resolve(false);
      },
    });
    const input = $("#opToken", drawer.host);
    input?.focus();
    $("#opSignIn", drawer.host).addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#opSubmit", drawer.host);
      btn.disabled = true;
      btn.textContent = "Signing in…";
      try {
        await api("/api/v1/admin/login", { method: "POST", json: { token: input.value } });
        settled = true;
        input.value = "";
        drawer.close();
        announce("Signed in as operator. These settings are now editable.");
        resolve(true);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Sign in";
        $("#opError", drawer.host).innerHTML = `<div class="arag-alert error" role="alert">${esc(
          err.status === 403
            ? "Admin access is disabled for this deployment. Set ADMIN_TOKEN and restart to enable it."
            : "That token was not accepted.",
        )}</div>`;
        input.focus();
        input.select();
      }
    });
  });
}

/**
 * The rail's operator marker, and the way out of it.
 *
 * Signing in without being able to sign out is not a control: on a shared machine the only
 * thing ending the session would be the twelve-hour cookie. `POST /api/v1/admin/logout`
 * clears it, and the page is reloaded rather than patched because every settings group,
 * every secret row and the API explorer's credential picker all change with the session —
 * re-deriving that in place would be more code and more ways to leave a stale editable
 * control on screen.
 */
export function markOperator(signedIn) {
  const foot = document.querySelector(".arag-rail .foot");
  if (!foot) return;
  let row = foot.querySelector("[data-operator]");
  if (!signedIn) {
    row?.remove();
    return;
  }
  if (!row) {
    row = document.createElement("div");
    row.className = "arag-status dip-operator";
    row.dataset.operator = "1";
    row.dataset.state = "ok";
    row.innerHTML =
      '<span class="dot"></span><span>Signed in as operator</span>' +
      '<button class="arag-btn ghost sm" id="signOutOp" type="button">Sign out</button>';
    foot.prepend(row);
    $("#signOutOp", row).addEventListener("click", async () => {
      try {
        await api("/api/v1/admin/logout", { method: "POST" });
      } catch {
        // The cookie is the session; a failed call must not leave the operator stuck on a
        // screen that still looks signed in.
      }
      announce("Signed out of the operator session.");
      location.reload();
    });
  }
}

// ── field rendering ──────────────────────────────────────────────────────────

const badgeFor = (f) =>
  f.source === "store"
    ? '<span class="arag-chip info" data-provenance>Set here</span>'
    : f.source === "env"
      ? '<span class="arag-chip neutral" data-provenance>Environment default</span>'
      : '<span class="arag-chip neutral" data-provenance>Built-in default</span>';

/**
 * Where this value came from, in one line, always present. The API reports whether the
 * environment supplies a default but not what it is once the store overrides it, so the
 * line says `set` rather than inventing a value it was not given.
 */
function originLine(f) {
  const envVar = `<span class="mono">${esc(f.envVar)}</span>`;
  if (f.source === "env") {
    const shown = f.secret ? "set" : f.value === "" || f.value == null ? "(empty)" : String(f.value);
    return `Environment default: <span class="mono">${esc(shown)}</span> · ${envVar}`;
  }
  if (f.envSet) return `Environment default: <span class="mono">set</span> · ${envVar}`;
  return `No environment default · ${envVar}`;
}

const idFor = (key) => `set-${key.replace(/\./g, "-")}`;

function controlHtml(f, editable) {
  const id = idFor(f.key);
  const dis = editable ? "" : " disabled";
  const c = f.constraints ?? {};
  const v = f.value == null ? "" : f.value;
  switch (f.type) {
    case "boolean":
      return `<label class="arag-switch">
          <input type="checkbox" id="${id}" data-control${v === true ? " checked" : ""}${dis} />
          <span>${esc(f.label)}</span>
        </label>`;
    case "number":
      return `<input class="arag-input" type="number" id="${id}" data-control value="${esc(String(v))}"
        ${c.min === undefined ? "" : `min="${c.min}"`} ${c.max === undefined ? "" : `max="${c.max}"`}
        step="1" inputmode="numeric"${dis} />`;
    case "enum": {
      const values = ["", ...(c.values ?? [])];
      return `<select class="arag-select" id="${id}" data-control${dis}>
          ${values
            .map(
              (opt) =>
                `<option value="${esc(opt)}"${String(v) === opt ? " selected" : ""}>${esc(
                  opt === "" ? "Not set — the Knowledge Box default" : opt,
                )}</option>`,
            )
            .join("")}
        </select>`;
    }
    case "color":
      return `<div class="dip-setting__colour">
          <input type="color" id="${id}-swatch" data-colour-swatch aria-label="${esc(f.label)} colour picker"
                 value="${esc(/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : "#000000")}"${dis} />
          <input class="arag-input mono" type="text" id="${id}" data-control value="${esc(String(v))}"
                 placeholder="#0b5cff or rgb(11, 92, 255)"${dis} />
        </div>`;
    case "list":
      return `<input class="arag-input" type="text" id="${id}" data-control
                value="${esc(Array.isArray(v) ? v.join(", ") : String(v))}"
                placeholder="one per comma"${dis} />`;
    case "url":
      return `<input class="arag-input" type="text" inputmode="url" id="${id}" data-control
                value="${esc(String(v))}"${c.maxLength ? ` maxlength="${c.maxLength}"` : ""}${dis} />`;
    default:
      return `<input class="arag-input${f.type === "uuid" ? " mono" : ""}" type="text" id="${id}" data-control
                value="${esc(String(v))}"${c.maxLength ? ` maxlength="${c.maxLength}"` : ""}${dis} />`;
  }
}

function secretHtml(f, editable) {
  const state = f.set ? "ok" : "warn";
  const line = f.set
    ? `Set${f.hint ? ` · ends ${f.hint.replace(/^…/, "")}` : ""}${f.source === "env" ? " · from the environment" : ""}`
    : "Not set — this deployment cannot reach the Knowledge Box with it";
  return `<div class="arag-row dip-setting__secret">
      <span class="arag-status" data-state="${state}"><span class="dot"></span><span>${esc(line)}</span></span>
      <button class="arag-btn secondary sm" type="button" data-rotate${editable ? "" : " disabled"}>${
        f.set ? "Rotate" : "Set the key"
      }</button>
    </div>
    <p class="arag-help">The current value is never shown. A new one replaces it immediately — any
      service still using the old one gets a 401.</p>`;
}

function fieldHtml(f, editable) {
  const id = idFor(f.key);
  const labelTag = f.type === "boolean" ? "span" : "label";
  const labelAttr = f.type === "boolean" ? "" : ` for="${id}"`;
  return `<div class="dip-setting" data-key="${esc(f.key)}" data-type="${esc(f.type)}"${
    f.secret ? " data-secret" : ""
  }>
    <div class="dip-setting__head">
      <${labelTag} class="dip-setting__label"${labelAttr}>${esc(f.label)}</${labelTag}>
      ${badgeFor(f)}
      <button class="arag-btn ghost sm" type="button" data-reset${
        f.source === "store" && editable ? "" : " hidden"
      }>${icon("refresh", { size: 13 })} Reset</button>
    </div>
    ${f.secret ? secretHtml(f, editable) : `<div class="dip-setting__control">${controlHtml(f, editable)}</div>`}
    <p class="arag-help">${esc(f.description)}${f.note ? ` ${esc(f.note)}` : ""}</p>
    <p class="dip-setting__origin small muted">${originLine(f)}</p>
    <p class="dip-setting__error" data-field-error hidden></p>
  </div>`;
}

/**
 * The rail's identity block as a partner will see it, updating as the form is typed in.
 *
 * Deliberately no wordmark, in either slot: DP-43 allows the Progress mark exactly once on a
 * signed-in screen and it is already in the band above this card, so the band is represented
 * by a labelled placeholder rather than a second copy of the artwork. Turning the powered-by
 * switch off removes the strip, which is the honest preview of what that switch does.
 */
export const brandPreviewHead = (b) => `
  <div class="dip-bandstrip"${b.poweredBy === false ? " hidden" : ""}>
    <span class="dip-wordmark-ph" aria-hidden="true">Progress wordmark</span>
    <span class="sr-only">The Progress Agentic RAG wordmark appears here when the powered-by credit is on.</span>
  </div>
  <div class="dip-brandslot" role="group" aria-label="Rail identity preview">
    ${
      b.logoUrl
        ? `<img src="${esc(b.logoUrl)}" alt="${esc(b.productName)} logo" />`
        : `<div class="dip-brandslot__empty" aria-hidden="true">Partner logo</div>
           <span class="sr-only">No logo is set, so the rail shows the product name alone.</span>`
    }
    <strong>${esc(b.productName || "Product name")}</strong>
    <span class="muted small">${esc(b.tagline || "—")}</span>
  </div>`;

// ── the applied block ────────────────────────────────────────────────────────

function appliedHtml(applied, groupId) {
  const section = applied?.[APPLIED_SECTION[groupId]];
  if (!section || typeof section !== "object") return "";
  const rows = Object.entries(section)
    .filter(([, v]) => v !== undefined && typeof v !== "object")
    .map(([k, v]) => {
      const shown =
        v === null
          ? "—"
          : typeof v === "boolean"
            ? v
              ? "on"
              : "off"
            : BYTE_KEYS.test(k) && typeof v === "number"
              ? fmtBytes(v)
              : String(v);
      return `<dt>${esc(humanise(k))}</dt><dd class="mono small">${esc(shown)}</dd>`;
    });
  if (!rows.length) return "";
  return `<div class="dip-applied" data-applied>
      <h4>What the running service is using now</h4>
      <dl class="arag-kv">${rows.join("")}</dl>
      <p class="small muted">Read from the live objects on each request, not from the saved
        document — so this is proof the edit took effect, not a copy of what was typed.</p>
    </div>`;
}

// ── the card ─────────────────────────────────────────────────────────────────

/**
 * Render one group as a card and wire it.
 *
 * `ctx` is `{ data, editable, reload }` — `reload()` re-fetches the payload and re-renders
 * every card the caller mounted, which is what a save, a reset and a sign-in all need.
 */
export function mountGroup(host, group, ctx, { extraHtml = "", onSaved } = {}) {
  const { editable } = ctx;
  const fields = group.fields.filter((f) => editable || !f.adminOnly);
  host.innerHTML = `
    <section class="arag-card dip-settings" data-group="${esc(group.id)}" aria-labelledby="sg-${esc(group.id)}">
      <div class="head">
        <h3 id="sg-${esc(group.id)}">${esc(group.label)}</h3>
        <span class="arag-chip warn" data-dirty hidden>Unsaved</span>
      </div>
      <div class="body">
        <p class="muted arag-prose">${esc(group.description)}</p>
        <div data-save-error></div>
        ${fields.map((f) => fieldHtml(f, editable)).join("")}
        ${extraHtml}
        ${appliedHtml(ctx.data.applied, group.id)}
        ${
          editable
            ? ""
            : `<div class="arag-alert" data-locked>
                 <strong>Editing these settings needs the operator token.</strong>
                 The values above are what this deployment is using now.
                 <div style="margin-top:8px"><button class="arag-btn sm" type="button" data-signin>Sign in as operator</button></div>
               </div>`
        }
      </div>
      <div class="dip-settings__bar" data-savebar hidden>
        <span data-count role="status" aria-live="polite"></span>
        <span class="spacer"></span>
        <button class="arag-btn ghost" type="button" data-discard>Discard</button>
        <button class="arag-btn" type="button" data-save>Save changes</button>
      </div>
    </section>`;

  const card = $("section", host);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const initial = new Map();
  for (const row of $$(".dip-setting[data-key]", card)) {
    const el = $("[data-control]", row);
    if (el) initial.set(row.dataset.key, readControl(el, byKey.get(row.dataset.key)));
  }

  const dirtyKeys = () => {
    const out = [];
    for (const row of $$(".dip-setting[data-key]", card)) {
      const el = $("[data-control]", row);
      if (!el) continue;
      const now = readControl(el, byKey.get(row.dataset.key));
      if (!same(now, initial.get(row.dataset.key))) out.push(row.dataset.key);
    }
    return out;
  };

  const paintDirty = () => {
    const keys = dirtyKeys();
    $("[data-dirty]", card).hidden = keys.length === 0;
    const bar = $("[data-savebar]", card);
    bar.hidden = keys.length === 0;
    $("[data-count]", card).textContent =
      keys.length === 1 ? "1 unsaved change" : `${keys.length} unsaved changes`;
    ctx.setDirty?.(group.id, keys.length);
  };

  for (const el of $$("[data-control]", card)) {
    el.addEventListener("input", paintDirty);
    el.addEventListener("change", paintDirty);
  }
  // A colour picker and its hex input are the same value seen twice, and each must be able
  // to set the other — colour is never the only way to read or write a brand colour.
  for (const row of $$('.dip-setting[data-type="color"]', card)) {
    const swatch = $("[data-colour-swatch]", row);
    const text = $("[data-control]", row);
    swatch?.addEventListener("input", () => {
      text.value = swatch.value;
      paintDirty();
    });
    text?.addEventListener("input", () => {
      if (/^#[0-9a-f]{6}$/i.test(text.value)) swatch.value = text.value;
    });
  }

  $("[data-signin]", card)?.addEventListener("click", async () => {
    if (await operatorSignIn()) await ctx.reload();
  });

  $("[data-discard]", card)?.addEventListener("click", () => {
    for (const row of $$(".dip-setting[data-key]", card)) {
      const el = $("[data-control]", row);
      if (el) writeControl(el, byKey.get(row.dataset.key), initial.get(row.dataset.key));
    }
    clearErrors(card);
    paintDirty();
  });

  for (const row of $$(".dip-setting[data-key]", card)) {
    $("[data-reset]", row)?.addEventListener("click", async () => {
      const f = byKey.get(row.dataset.key);
      await api("/api/v1/admin/settings/reset", { method: "POST", json: { keys: [f.key] } });
      toast(`${f.label} reset to its default`);
      announce(`${f.label} reset to its environment default.`);
      await ctx.reload();
    });
    $("[data-rotate]", row)?.addEventListener("click", () => rotateSecret(byKey.get(row.dataset.key), ctx));
  }

  $("[data-save]", card)?.addEventListener("click", async () => {
    const keys = dirtyKeys();
    if (!keys.length) return;
    const patch = {};
    for (const key of keys) {
      const row = $(`.dip-setting[data-key="${CSS.escape(key)}"]`, card);
      patch[key] = readControl($("[data-control]", row), byKey.get(key));
    }
    clearErrors(card);
    const btn = $("[data-save]", card);
    btn.disabled = true;
    btn.textContent = "Saving…";
    card.setAttribute("aria-busy", "true");
    announce(`Saving ${group.label.toLowerCase()} settings`);
    try {
      const out = await api(SETTINGS_PATH, { method: "PATCH", json: patch });
      ctx.data = { ...out.settings, applied: out.settings.applied };
      const n = out.changed.length;
      toast(`${group.label} settings saved`);
      announce(
        `${group.label} settings saved. ${n === 1 ? "One change" : `${n} changes`} applied. ${
          EFFECT_NOTE[group.id] ?? "In effect now."
        }`,
      );
      await ctx.reload();
      onSaved?.(out);
    } catch (err) {
      card.removeAttribute("aria-busy");
      btn.disabled = false;
      btn.textContent = "Save changes";
      if (err.status === 401 || err.status === 403) {
        $("[data-save-error]", card).innerHTML = `<div class="arag-alert error" role="alert">
            Your operator session expired. Sign in again to save — your edits are still here.
            <div style="margin-top:8px"><button class="arag-btn sm" type="button" data-resignin>Sign in as operator</button></div>
          </div>`;
        $("[data-resignin]", card).addEventListener("click", async () => {
          if (await operatorSignIn()) $("[data-save]", card).click();
        });
        return;
      }
      showErrors(card, err, group);
    }
  });

  paintDirty();
  return card;
}

function clearErrors(card) {
  $("[data-save-error]", card).innerHTML = "";
  for (const p of $$("[data-field-error]", card)) {
    p.hidden = true;
    p.textContent = "";
  }
  for (const el of $$("[data-control]", card)) {
    el.removeAttribute("aria-invalid");
    el.removeAttribute("aria-describedby");
  }
}

/**
 * A rejected save names the fields, links to each one and keeps Save enabled — disabling it
 * on a field error hides which field is wrong.
 */
function showErrors(card, err, group) {
  const errors = err.problem?.errors ?? [];
  const named = [];
  for (const e of errors) {
    const row = $(`.dip-setting[data-key="${CSS.escape(e.path)}"]`, card);
    if (!row) continue;
    const control = $("[data-control]", row);
    const slot = $("[data-field-error]", row);
    slot.textContent = e.message;
    slot.hidden = false;
    slot.id = `err-${e.path.replace(/\./g, "-")}`;
    control?.setAttribute("aria-invalid", "true");
    control?.setAttribute("aria-describedby", slot.id);
    named.push({ path: e.path, label: $(".dip-setting__label", row)?.textContent ?? e.path });
  }
  $("[data-save-error]", card).innerHTML = `<div class="arag-alert error" role="alert">
      ${esc(err.message)}
      ${
        named.length
          ? `<div class="small" style="margin-top:6px">${
              named.length === 1 ? "One value was" : `${named.length} values were`
            } not accepted: ${named
              .map((n) => `<a href="#${esc(idFor(n.path))}" data-goto="${esc(n.path)}">${esc(n.label)}</a>`)
              .join(", ")}.</div>`
          : ""
      }
    </div>`;
  for (const a of $$("[data-goto]", card)) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      $(`.dip-setting[data-key="${CSS.escape(a.dataset.goto)}"] [data-control]`, card)?.focus();
    });
  }
  announce(`${group.label} settings were not saved. ${err.message}`);
}

function rotateSecret(field, ctx) {
  const drawer = openDrawer({
    title: `${field.label}`,
    body: `
      <form id="rotateForm" autocomplete="off">
        <p class="arag-prose muted">${esc(field.description)}</p>
        <div class="arag-field">
          <label for="secretValue">New value</label>
          <div class="arag-row">
            <input class="arag-input" id="secretValue" type="password" autocomplete="new-password" style="flex:1" />
            <button class="arag-btn ghost sm" type="button" id="showSecret" aria-pressed="false">Show</button>
          </div>
        </div>
        <p class="arag-help">The current value is never shown. The new one replaces it immediately —
          any service still using the old one gets a 401.</p>
        <div id="rotateError"></div>
      </form>`,
    foot: '<button class="arag-btn" type="submit" form="rotateForm" id="saveSecret">Save the key</button>',
  });
  const input = $("#secretValue", drawer.host);
  input.focus();
  $("#showSecret", drawer.host).addEventListener("click", (e) => {
    const on = input.type === "password";
    input.type = on ? "text" : "password";
    e.currentTarget.setAttribute("aria-pressed", String(on));
    e.currentTarget.textContent = on ? "Hide" : "Show";
  });
  $("#rotateForm", drawer.host).addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = input.value;
    if (!value) {
      $("#rotateError", drawer.host).innerHTML =
        '<div class="arag-alert error" role="alert">Type the new value first.</div>';
      return;
    }
    try {
      await api(SETTINGS_PATH, { method: "PATCH", json: { [field.key]: value } });
      // Out of memory as soon as it is sent: it is never echoed back and never in the DOM.
      input.value = "";
      drawer.close();
      toast(`${field.label} replaced`);
      announce(`${field.label} replaced. It is in effect now.`);
      await ctx.reload();
    } catch (err) {
      $("#rotateError", drawer.host).innerHTML =
        `<div class="arag-alert error" role="alert">${esc(err.message)}</div>`;
    }
  });
}

// ── control ↔ value ──────────────────────────────────────────────────────────

function readControl(el, field) {
  if (!field) return el.value;
  if (field.type === "boolean") return el.checked;
  if (field.type === "number") return el.value === "" ? "" : Number(el.value);
  if (field.type === "list")
    return el.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return el.value;
}

function writeControl(el, field, value) {
  if (field?.type === "boolean") el.checked = Boolean(value);
  else if (field?.type === "list") el.value = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  else el.value = value == null ? "" : String(value);
  if (field?.type === "color") {
    const swatch = el.parentElement?.querySelector("[data-colour-swatch]");
    if (swatch && /^#[0-9a-f]{6}$/i.test(String(value))) swatch.value = String(value);
  }
}

/** Element-wise, so no separator can make two different lists look the same. */
const same = (a, b) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b;

// ── the locked view ──────────────────────────────────────────────────────────

/**
 * What a signed-out viewer sees. `GET /api/v1/settings` is credential-free by design
 * (DP-40) and carries the effective values but no field metadata and no provenance, so the
 * locked card shows the real values without inventing a source for them — and says exactly
 * what unlocks the rest.
 */
/**
 * DP-40, extended: the Knowledge Box id and the endpoint host identify the customer's own
 * tenant, so `GET /api/v1/settings` no longer publishes them to an anonymous caller. The row
 * stays — a reader should know the setting exists and which variable feeds it — and says
 * plainly why the value is not there rather than rendering a misleading dash.
 */
const OPERATOR_ONLY = "Operator-only — sign in to read it";

const PUBLIC_ROWS = {
  connection: (s) => [
    ["Knowledge Box id", s.connection.kbId ?? OPERATOR_ONLY, "ARAG_KB_ID"],
    ["Region", s.connection.region || "—", "ARAG_REGION"],
    ["Base URL", s.connection.baseUrl ?? OPERATOR_ONLY, "ARAG_BASE_URL"],
    ["Generative model", s.extraction.generativeModel, "ARAG_GENERATIVE_MODEL"],
    ["Reranker", s.extraction.reranker || "Knowledge Box default", "ARAG_RERANKER"],
    [
      "Visual extraction",
      s.extraction.visualExtraction ? "On for images and PDFs" : "Off — default processing",
      "DIP_EXTRACT_STRATEGY",
    ],
  ],
  branding: (s) => [
    ["Product name", s.branding.productName, "BRAND_PRODUCT_NAME"],
    ["Tagline", s.branding.tagline || "—", "BRAND_TAGLINE"],
    ["Logo URL", s.branding.logoUrl || "—", "BRAND_LOGO_URL"],
    ["Primary colour", s.branding.primaryColor || "Kit default", "BRAND_PRIMARY_COLOR"],
    ["Accent colour", s.branding.accentColor || "Kit default", "BRAND_ACCENT_COLOR"],
    ["Powered-by credit", s.branding.poweredBy ? "Shown" : "Hidden", "BRAND_POWERED_BY"],
    ["Footer text", s.branding.footerText || "—", "BRAND_FOOTER_TEXT"],
    ["Docs URL", s.branding.docsUrl || "—", "BRAND_DOCS_URL"],
    ["Support URL", s.branding.supportUrl || "—", "BRAND_SUPPORT_URL"],
  ],
  limits: (s) => [
    ["Max upload size", fmtBytes(s.uploads.maxBytes), "DIP_MAX_UPLOAD_BYTES"],
    ["Accepted types", s.uploads.acceptedExtensions.join(" · "), "—"],
  ],
  security: (s) => [
    [
      "API keys",
      s.security.apiKeysEnforced ? "Enforced" : "Not enforced — reads and uploads are open",
      "API_KEYS",
    ],
    ["Admin", s.security.adminEnabled ? "Enabled" : "Disabled — ADMIN_TOKEN is not set", "ADMIN_TOKEN"],
  ],
  retention: () => [],
  operations: () => [],
};

const GROUP_META = {
  connection: ["Connection", "Which Knowledge Box this deployment talks to, and how it extracts."],
  branding: ["Branding", "White-label presentation only. Branding never recolours the evidence."],
  limits: ["Limits", "Upload ceiling, body ceiling and rate limits."],
  security: ["Security", "Credentials in force, CORS and the proxy header the client IP is read from."],
  retention: ["Retention", "How long documents are kept, and automatic purge."],
  operations: ["Operations", "Log verbosity and other operational levers."],
};

export function mountLockedGroup(host, groupId, publicSettings, { onSignedIn, extraHtml = "" } = {}) {
  const [label, description] = GROUP_META[groupId] ?? [groupId, ""];
  const rows = publicSettings ? (PUBLIC_ROWS[groupId]?.(publicSettings) ?? []) : [];
  host.innerHTML = `
    <section class="arag-card dip-settings" data-group="${esc(groupId)}" data-locked aria-labelledby="lg-${esc(groupId)}">
      <div class="head"><h3 id="lg-${esc(groupId)}">${esc(label)}</h3></div>
      <div class="body">
        <p class="muted arag-prose">${esc(description)}</p>
        ${
          rows.length
            ? `<dl class="arag-kv">${rows
                .map(
                  ([name, value, envVar]) =>
                    `<dt>${esc(name)}<br /><span class="mono small subtle">${esc(envVar)}</span></dt>
                     <dd>${esc(String(value))}</dd>`,
                )
                .join("")}</dl>`
            : `<p class="muted arag-prose">These values are operator-only: they are not published on the
                credential-free settings endpoint, so they are readable here once you sign in.</p>`
        }
        ${extraHtml}
        <div class="arag-alert" data-locked-alert>
          <strong>Editing these settings needs the operator token.</strong>
          The values above are what this deployment is using now.
          <div style="margin-top:8px"><button class="arag-btn sm" type="button" data-signin>Sign in as operator</button></div>
        </div>
      </div>
    </section>`;
  $("[data-signin]", host).addEventListener("click", async () => {
    if (await operatorSignIn()) await onSignedIn?.();
  });
}

// ── purge (retention's second card) ──────────────────────────────────────────

/**
 * DP-38: the preview runs first and the confirmation states its own blast radius. `Delete N
 * documents` does not exist until a preview has run, and changing the day count clears it.
 */
export function mountPurge(host, { editable, defaultDays }) {
  host.innerHTML = `
    <section class="arag-card dip-danger-zone" aria-labelledby="purgeHead">
      <div class="head"><h3 id="purgeHead">Purge now</h3></div>
      <div class="body">
        <div class="arag-row">
          <label class="arag-label" for="purgeDays">Delete documents older than</label>
          <input class="arag-input" id="purgeDays" type="number" min="0" max="3650"
                 value="${Number(defaultDays ?? 0)}" style="width:90px"${editable ? "" : " disabled"} />
          <span class="muted">days</span>
          <button class="arag-btn ghost" type="button" id="purgePreview"${editable ? "" : " disabled"}>Preview</button>
        </div>
        <div id="purgeResult" style="margin-top:12px">
          <p class="muted small">Preview first: nothing is deleted until the exact count and date range
            have been shown. Deleting a record also deletes its resource, its evidence and its
            key-value fields from the Knowledge Box.</p>
        </div>
      </div>
    </section>`;
  if (!editable) return;
  const daysEl = $("#purgeDays", host);
  const result = $("#purgeResult", host);
  daysEl.addEventListener("input", () => {
    result.innerHTML =
      '<p class="muted small">The day count changed, so the preview no longer applies. Preview again.</p>';
  });
  $("#purgePreview", host).addEventListener("click", async () => {
    const olderThanDays = Number(daysEl.value);
    const preview = await api("/api/v1/admin/purge", {
      method: "POST",
      json: { olderThanDays, dryRun: true },
    });
    if (!preview.wouldDelete) {
      result.innerHTML =
        '<div class="arag-alert ok">No documents are older than that. Nothing would be deleted.</div>';
      return;
    }
    result.innerHTML = `<div class="arag-alert warn">
        <strong>${preview.wouldDelete} document${preview.wouldDelete === 1 ? "" : "s"}</strong> would be
        deleted from this product and from the Knowledge Box — created between
        ${esc(new Date(preview.oldest).toLocaleDateString())} and
        ${esc(new Date(preview.newest).toLocaleDateString())}. Nothing has been deleted.
        <div style="margin-top:8px">
          <button class="arag-btn danger sm" type="button" id="purgeGo">Delete ${preview.wouldDelete} document${
            preview.wouldDelete === 1 ? "" : "s"
          }</button>
        </div>
      </div>`;
    $("#purgeGo", host).addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: `Delete ${preview.wouldDelete} document${preview.wouldDelete === 1 ? "" : "s"}?`,
        body: `<p>This deletes ${preview.wouldDelete} record${
          preview.wouldDelete === 1 ? "" : "s"
        } from this product and the same number of resources from the Knowledge Box. It cannot be undone.</p>`,
        confirmLabel: `Delete ${preview.wouldDelete} document${preview.wouldDelete === 1 ? "" : "s"}`,
        typed: "DELETE",
        danger: true,
      });
      if (!ok) return;
      const out = await api("/api/v1/admin/purge", { method: "POST", json: { olderThanDays } });
      toast(`${out.deleted.length} document${out.deleted.length === 1 ? "" : "s"} deleted`);
      announce(`${out.deleted.length} documents deleted.`);
      result.innerHTML = `<div class="arag-alert ${out.failed.length ? "warn" : "ok"}">
          Deleted ${out.deleted.length} document${out.deleted.length === 1 ? "" : "s"} on
          ${esc(new Date().toLocaleDateString())}${out.failed.length ? `; ${out.failed.length} failed` : ""}.
          <div style="margin-top:8px"><button class="arag-btn ghost sm" type="button" id="purgeAgain">Preview again</button></div>
        </div>`;
      $("#purgeAgain", host).addEventListener("click", () => $("#purgePreview", host).click());
    });
  });
}
