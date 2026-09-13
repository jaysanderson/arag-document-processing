import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * Settings, end to end — the brief's bar #1.
 *
 * Every test follows the same shape: **edit → reload → the value persisted → the effect is
 * visible**. "Visible" is the `applied` block, which the API reads from the live objects on
 * each request, so a green test here means the running process changed — not that a form
 * accepted a value and wrote it somewhere.
 *
 * This file runs last in the suite (alphabetically) because it changes the deployment's own
 * configuration; every test puts back what it moved.
 */
const TOKEN = "e2e-admin-token";

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, token = TOKEN) {
  await page.click("#signInTop");
  await expect(page.locator(".arag-drawer")).toBeVisible();
  await page.fill("#opToken", token);
  await page.click("#opSubmit");
}

async function signedIn(page: Page) {
  await signIn(page);
  await expect(page.locator(".arag-drawer")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".arag-pagehead")).toContainText("Signed in as operator");
}

/**
 * Whatever a test moved, the deployment goes back to its defaults — a spec that renames the
 * product and then fails would rename it for every run after it.
 */
test.afterAll(async ({ request }) => {
  await request.post("/api/v1/admin/login", { data: { token: TOKEN } });
  await request.post("/api/v1/admin/settings/reset", {
    data: {
      keys: [
        "connection.generativeModel",
        "connection.timeoutMs",
        "connection.apiKey",
        "connection.region",
        "branding.productName",
        "branding.primaryColor",
        "limits.maxUploadBytes",
        "operations.logLevel",
      ],
    },
  });
});

test("a viewer reads the effective values and is told exactly what unlocks editing", async ({ page }) => {
  await page.goto("/#/settings/connection");
  await expect(page.locator("#panel")).toContainText("Knowledge Box id", { timeout: 20_000 });
  // DP-40: the credential-free payload is safe to show, so the values are readable signed out.
  await expect(page.locator("#panel")).toContainText("ARAG_KB_ID");
  await expect(page.locator("#panel")).toContainText("Generative model");
  await expect(page.locator("[data-locked-alert]")).toContainText(
    "Editing these settings needs the operator token.",
  );
  // The one group a viewer may not read at all: a list of key names is an inventory of who
  // can call this service.
  await page.click('a[role="tab"]:has-text("API keys")');
  await expect(page.locator("#panel")).toContainText("The key list needs the operator token.");
  await expect(page.locator("#keysTable")).toHaveCount(0);
});

test("signing in as operator unlocks the group in place, and a wrong token says so", async ({ page }) => {
  await page.goto("/#/settings/connection");
  await expect(page.locator("#panel")).toContainText("Knowledge Box id", { timeout: 20_000 });
  await signIn(page, "not-the-token");
  await expect(page.locator(".arag-drawer")).toContainText("That token was not accepted.");
  await page.fill("#opToken", TOKEN);
  await page.click("#opSubmit");
  await expect(page.locator(".arag-drawer")).toHaveCount(0, { timeout: 20_000 });
  // In place: no navigation, and the same group is now a form.
  await expect(page).toHaveURL(/#\/settings\/connection$/);
  await expect(page.locator('[data-key="connection.kbId"] [data-control]')).toBeEnabled();
  await expect(page.locator(".arag-rail .foot")).toContainText("Signed in as operator");
});

test("connection: the generative model persists and the applied block proves it took effect", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/#/settings/connection");
  await expect(page.locator("#panel")).toContainText("Knowledge Box id", { timeout: 20_000 });
  await signedIn(page);

  const row = page.locator('[data-key="connection.generativeModel"]');
  await expect(row.locator("[data-provenance]")).not.toHaveText("Set here");
  await row.locator("[data-control]").fill("e2e-model-9000");
  await expect(page.locator("[data-savebar]")).toBeVisible();
  await expect(page.locator("[data-count]")).toHaveText("1 unsaved change");
  await page.click("[data-save]");
  await expect(page.locator(".arag-toast")).toContainText("Connection settings saved", {
    timeout: 20_000,
  });

  // The effect, not the echo: `applied` is read from the live ARAG client.
  await expect(page.locator("[data-applied]")).toContainText("e2e-model-9000", { timeout: 20_000 });

  await page.reload();
  await expect(page.locator('[data-key="connection.generativeModel"] [data-control]')).toHaveValue(
    "e2e-model-9000",
    { timeout: 20_000 },
  );
  await expect(page.locator('[data-key="connection.generativeModel"] [data-provenance]')).toHaveText(
    "Set here",
  );

  // Reset returns the field to the default it overrode, and the badge says so.
  await page.click('[data-key="connection.generativeModel"] [data-reset]');
  await expect(page.locator('[data-key="connection.generativeModel"] [data-provenance]')).not.toHaveText(
    "Set here",
    { timeout: 20_000 },
  );
  await expect(page.locator("[data-applied]")).not.toContainText("e2e-model-9000");
});

test("connection: a value outside its range is rejected and the field is named", async ({ page }) => {
  await page.goto("/#/settings/connection");
  await expect(page.locator("#panel")).toContainText("Knowledge Box id", { timeout: 20_000 });
  await signedIn(page);
  await page.fill('[data-key="connection.timeoutMs"] [data-control]', "10");
  await page.click("[data-save]");
  await expect(page.locator("[data-save-error]")).toContainText("Must be at least 1000", {
    timeout: 20_000,
  });
  await expect(page.locator('[data-key="connection.timeoutMs"] [data-field-error]')).toBeVisible();
  await expect(page.locator('[data-key="connection.timeoutMs"] [data-control]')).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  // Save stays enabled: disabling it on a field error hides which field is wrong.
  await expect(page.locator("[data-save]")).toBeEnabled();
  await page.click("[data-discard]");
  await expect(page.locator("[data-savebar]")).toBeHidden();
});

test("connection: the service-account key is write-only and rotates without being rendered", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const candidate = "e2e-rotated-service-key";
  await page.goto("/#/settings/connection");
  await expect(page.locator("#panel")).toContainText("Knowledge Box id", { timeout: 20_000 });
  await signedIn(page);

  const row = page.locator('[data-key="connection.apiKey"]');
  await expect(row).toContainText("The current value is never shown");
  await row.locator("[data-rotate]").click();
  await page.fill("#secretValue", candidate);
  await page.click("#saveSecret");
  await expect(page.locator(".arag-toast")).toContainText("replaced", { timeout: 20_000 });
  // The row reports that a key is set and its tail, never the key.
  await expect(row).toContainText("ends", { timeout: 20_000 });
  expect(await page.content()).not.toContain(candidate);

  // Put back the deployment's own key — the rotated one is not the mock's, and the connection
  // says so honestly rather than pretending to be healthy.
  await page.click('[data-key="connection.apiKey"] [data-reset]');
  await expect(page.locator('[data-key="connection.apiKey"] [data-provenance]')).not.toHaveText("Set here", {
    timeout: 20_000,
  });
});

test("branding: the product name saves, reaches the rail, and never brands the evidence", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/#/settings/branding");
  await expect(page.locator("#panel")).toContainText("Product name", { timeout: 20_000 });
  await signedIn(page);
  // DP-43 holds while the preview is on screen: the band carries the only wordmark.
  expect(await page.locator('img[src*="arag-logo"]').count()).toBe(1);

  const danger = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--arag-danger-fg").trim(),
    );
  const before = await danger();

  await page.fill('[data-key="branding.productName"] [data-control]', "Northwind DocFlow");
  await page.fill('[data-key="branding.primaryColor"] [data-control]', "#c81e1e");
  // The preview updates on input, before anything is saved, and still stamps no wordmark.
  await expect(page.locator(".dip-brandpreview")).toContainText("Northwind DocFlow");
  expect(await page.locator('img[src*="arag-logo"]').count()).toBe(1);
  await expect(page.locator(".dip-wordmark-ph")).toBeVisible();

  await page.click("[data-save]");
  await expect(page.locator(".arag-toast")).toContainText("Branding settings saved", { timeout: 20_000 });
  await page.reload();
  await expect(page.locator("[data-brand-name]")).toHaveText("Northwind DocFlow", { timeout: 20_000 });
  const brand = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--arag-brand-600").trim(),
  );
  // `applyBranding` writes the value it was given, so the token holds the hex verbatim.
  expect(brand).toBe("#c81e1e");
  // DP-35: a partner may recolour their product, never the evidence.
  expect(await danger()).toBe(before);

  await page.click('[data-key="branding.productName"] [data-reset]');
  await page.click('[data-key="branding.primaryColor"] [data-reset]');
  await page.reload();
  await expect(page.locator("[data-brand-name]")).toHaveText("Document Processing", { timeout: 20_000 });
});

test("limits: a smaller upload ceiling is what the upload drawer publishes", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/#/settings/limits");
  await expect(page.locator("#panel")).toContainText("Max upload size", { timeout: 20_000 });
  await signedIn(page);
  await page.fill('[data-key="limits.maxUploadBytes"] [data-control]', "3145728");
  await page.click("[data-save]");
  await expect(page.locator("[data-applied]")).toContainText("3.0 MB", { timeout: 20_000 });

  // The drawer reads the limit from the API, so the edit is visible where a user meets it.
  await page.goto("/#/documents/upload");
  await expect(page.locator(".arag-drawer .arag-help").first()).toContainText("3.0 MB", {
    timeout: 20_000,
  });
  // The drawer is a route over the list; close it before leaving or it keeps the overlay.
  await page.keyboard.press("Escape");
  await expect(page.locator(".arag-drawer")).toHaveCount(0);

  await page.goto("/#/settings/limits");
  await expect(page.locator('[data-key="limits.maxUploadBytes"] [data-reset]')).toBeVisible({
    timeout: 20_000,
  });
  await page.click('[data-key="limits.maxUploadBytes"] [data-reset]');
  await expect(page.locator('[data-key="limits.maxUploadBytes"] [data-provenance]')).not.toHaveText(
    "Set here",
    { timeout: 20_000 },
  );
});

test("operations: the log level saves and the applied block names the level in force", async ({ page }) => {
  await page.goto("/#/settings/operations");
  // Operations publishes nothing on the credential-free endpoint, so a signed-out viewer sees
  // the group and the reason rather than a value the API never sent.
  await expect(page.locator("#panel")).toContainText("Log verbosity", { timeout: 20_000 });
  await expect(page.locator("#panel")).toContainText("These values are operator-only");
  await signedIn(page);
  await expect(page.locator('[data-key="operations.logLevel"]')).toBeVisible({ timeout: 20_000 });
  await page.selectOption('[data-key="operations.logLevel"] [data-control]', "debug");
  await page.click("[data-save]");
  await expect(page.locator("[data-applied]")).toContainText("debug", { timeout: 20_000 });
  await page.reload();
  await expect(page.locator('[data-key="operations.logLevel"] [data-control]')).toHaveValue("debug", {
    timeout: 20_000,
  });
  await page.click('[data-key="operations.logLevel"] [data-reset]');
  await expect(page.locator('[data-key="operations.logLevel"] [data-provenance]')).not.toHaveText(
    "Set here",
    { timeout: 20_000 },
  );
});

test("API keys: created once, shown once, and revoked behind a typed confirmation", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/#/settings/keys");
  await expect(page.locator("#panel")).toContainText("A key lets a service call this API", {
    timeout: 20_000,
  });
  await signedIn(page);
  await expect(page.locator("#createKey")).toBeVisible({ timeout: 20_000 });
  await page.click("#createKey");
  await page.fill("#keyName", "E2E service");
  await page.click("#createSubmit");

  await expect(page.locator(".arag-drawer")).toContainText("This is the only time this key is shown.", {
    timeout: 20_000,
  });
  const shown = (await page.locator(".arag-snippet").first().innerText()).replace("Copy", "").trim();
  expect(shown).toMatch(/^dip_[0-9a-f]{8}_/);

  // The one modal in this product Escape does not close: a key lost here is unrecoverable.
  await page.keyboard.press("Escape");
  await expect(page.locator(".arag-drawer")).toBeVisible();
  await page.click("#copiedIt");
  await expect(page.locator(".arag-drawer")).toHaveCount(0);

  await expect(page.locator("#keysTable")).toContainText("E2E service", { timeout: 20_000 });
  await expect(page.locator("#keysTable")).toContainText("Never used");
  // The key is a real credential against the live deployment.
  const res = await page.request.get("/api/v1/documents?page_size=1", {
    headers: { "X-API-Key": shown },
  });
  expect(res.ok()).toBeTruthy();

  await page.click("#keysTable tbody tr .arag-menu .trigger");
  await page.click('[role="menuitem"]:has-text("Revoke")');
  await expect(page.locator(".arag-confirm")).toContainText("This cannot be undone");
  await expect(page.locator(".arag-confirm [data-ok]")).toBeDisabled();
  await page.fill("#aragTyped", "REVOKE");
  await page.click(".arag-confirm [data-ok]");
  await expect(page.locator("#keysTable")).toContainText("Revoked", { timeout: 20_000 });
});

test("retention: the purge is previewed, and Delete does not exist until it has been", async ({ page }) => {
  await page.goto("/#/settings/retention");
  await expect(page.locator("#panel")).toContainText("Retention", { timeout: 20_000 });
  await signedIn(page);
  await expect(page.locator("#purgeGo")).toHaveCount(0);
  await page.fill("#purgeDays", "3650");
  await page.click("#purgePreview");
  await expect(page.locator("#purgeResult")).toContainText("Nothing would be deleted", {
    timeout: 20_000,
  });
  await expect(page.locator("#purgeGo")).toHaveCount(0);
});

test("the operator can sign out again, and the settings lock behind them", async ({ page }) => {
  // Sign-in without sign-out is not a control: on a shared machine the twelve-hour cookie
  // would be the only thing ending the session.
  await page.goto("/#/settings/connection");
  await signedIn(page);
  await expect(page.locator("[data-operator]")).toContainText("Signed in as operator");

  await page.click("#signOutOp");
  await expect(page.locator("[data-operator]")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator("#panel")).toContainText("Editing these settings needs the operator token.");
  // And it is the session that ended, not just the screen: a reload stays locked.
  await page.reload();
  await expect(page.locator("#panel")).toContainText("Editing these settings needs the operator token.", {
    timeout: 20_000,
  });
});

test("an unsaved change survives a stray click on another tab", async ({ page }) => {
  await page.goto("/#/settings/connection");
  await expect(page.locator("#panel")).toContainText("Knowledge Box id", { timeout: 20_000 });
  await signedIn(page);
  await page.fill('[data-key="connection.region"] [data-control]', "europe-1");
  await expect(page.locator("[data-savebar]")).toBeVisible();
  await page.click('a[role="tab"]:has-text("Branding")');
  await expect(page.locator(".arag-confirm")).toContainText("Leave without saving?");
  await page.click(".arag-confirm [data-cancel]");
  await expect(page).toHaveURL(/#\/settings\/connection$/);
  await expect(page.locator('[data-key="connection.region"] [data-control]')).toHaveValue("europe-1");
  await page.click("[data-discard]");
  await expect(page.locator("[data-savebar]")).toBeHidden();
});

test("settings hold at 1440 px and at 390 px with no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/settings/branding");
  await expect(page.locator("#panel")).toContainText("Product name", { timeout: 20_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.arag-tabs a[aria-selected="true"]')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
