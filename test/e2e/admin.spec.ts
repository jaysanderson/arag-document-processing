import { expect, test } from "@playwright/test";
import { DOC_TYPE_VALUES } from "../../src/types.ts";

const TOKEN = "e2e-admin-token";

test.describe.configure({ mode: "serial" });

test("admin: the sign-in is a door, and a wrong token says so plainly", async ({ page }) => {
  await page.goto("/admin/");
  await expect(page.locator(".dip-signin")).toBeVisible();
  // No navigation before sign-in: a nav the visitor cannot use is noise.
  await expect(page.locator(".dip-sidenav")).toHaveCount(0);
  await expect(page.locator(".dip-signin__card img")).toHaveAttribute("src", "/brand/arag-logo.svg");

  await page.fill("#token", "nope");
  await page.click("#signin");
  await expect(page.locator(".dip-signin__error")).toContainText("That token was not accepted.");

  // Enter must submit: a lone password input does not do this reliably without a form.
  await page.fill("#token", TOKEN);
  await page.press("#token", "Enter");
  await expect(page.locator(".dip-sidenav")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".dip-sidenav a")).toHaveCount(8);
});

test("admin: overview, connection and configs are an operator product", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/admin/");
  await page.fill("#token", TOKEN);
  await page.press("#token", "Enter");
  await expect(page.locator("h1")).toContainText("Overview", { timeout: 20_000 });
  await expect(page.locator(".dip-statstrip .arag-kpi")).toHaveCount(6);
  await expect(page.locator(".dip-statstrip")).toContainText("Grounding");
  // Expected provisioning conflicts must never read as failures.
  await expect(page.locator(".dip-statstrip")).toContainText("expected conflicts");
  await expect(page.locator("body")).toContainText("Needs attention");

  await page.click('[data-nav="connection"]');
  await expect(page.locator("h1")).toContainText("Connection");
  await expect(page.locator("table")).toContainText("dip_invoice_extraction");
  await page.click("#test");
  await expect(page.locator(".arag-toast")).toContainText("KB connected");
  // The stored configuration is readable without opening the ARAG dashboard.
  await page.click("tr[data-cfg] >> nth=0");
  await expect(page.locator(".dip-drawer")).toContainText("full_resource", { timeout: 20_000 });
  await expect(page.locator(".dip-drawer")).toContainText("answer_json_schema");
  await page.keyboard.press("Escape");

  await page.click('[data-nav="configs"]');
  await expect(page.locator("table tbody tr")).toHaveCount(DOC_TYPE_VALUES.length);
  await page.click("#provAll");
  await expect(page.locator("#provResult")).toContainText("provisioned", { timeout: 30_000 });
  await expect(page.locator("#provResult")).toContainText("0 failed");
});

test("admin: jobs, logs, usage and branding", async ({ page }) => {
  test.setTimeout(120_000);
  // A job to look at, created through the public API so this spec stands alone.
  const upload = await page.request.post("/api/v1/documents?config=invoice", {
    headers: { "Content-Type": "text/plain", "X-Filename": "admin-e2e.txt" },
    data: "TAX INVOICE\nInvoice Number: INV-ADMIN-1\nTOTAL DUE: $10.00 AUD\n",
  });
  expect(upload.status()).toBe(202);

  await page.goto("/admin/");
  await page.fill("#token", TOKEN);
  await page.press("#token", "Enter");
  await expect(page.locator(".dip-sidenav")).toBeVisible({ timeout: 20_000 });

  await page.click('[data-nav="jobs"]');
  await expect(page.locator("tr[data-job]").first()).toBeVisible({ timeout: 20_000 });
  await page.click("tr[data-job] >> nth=0");
  await expect(page.locator(".dip-drawer .arag-steps li").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".dip-drawer")).toContainText("process-document");
  await page.keyboard.press("Escape");

  await page.click('[data-nav="logs"]');
  await expect(page.locator("tr[data-line]").first()).toBeVisible({ timeout: 20_000 });
  await page.click("tr[data-line] >> nth=0");
  await expect(page.locator(".dip-drawer")).toContainText("level");
  await page.keyboard.press("Escape");
  await page.selectOption("#level", "warn");
  await expect(page).toHaveURL(/level=warn/);

  await page.click('[data-nav="usage"]');
  await expect(page.locator(".dip-statstrip")).toContainText("ARAG calls");
  await expect(page.locator("body")).toContainText("Documents processed, last 14 days");
  await expect(page.locator(".dip-bar")).toHaveCount(14);

  await page.click('[data-nav="branding"]');
  await expect(page.locator("body")).toContainText("BRAND_PRODUCT_NAME");
  await expect(page.locator("body")).toContainText("Document Processing");
  await expect(page.locator("body")).toContainText("never branded");
});

test("admin: security states the posture and purge is previewed before it is confirmed", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/admin/");
  await page.fill("#token", TOKEN);
  await page.press("#token", "Enter");
  await expect(page.locator(".dip-sidenav")).toBeVisible({ timeout: 20_000 });
  await page.click('[data-nav="security"]');

  await expect(page.locator("body")).toContainText("Always require a credential");
  await expect(page.locator("body")).toContainText("API_KEYS");
  // The token is never echoed back to the panel that asked for it.
  await expect(page.locator("body")).not.toContainText(TOKEN);
  await expect(page.locator("#purge")).toBeDisabled();

  // Preview first: the dialog has to be able to state the blast radius.
  await page.fill("#days", "0");
  await page.click("#preview");
  await expect(page.locator("#purgeResult")).toContainText("would be deleted", { timeout: 20_000 });
  await expect(page.locator("#purgeResult")).toContainText("Nothing has been deleted yet");
  await expect(page.locator("#purge")).toBeEnabled();

  await page.click("#purge");
  await expect(page.locator(".dip-confirm")).toBeVisible();
  // The confirm button stays disabled until the word is typed.
  await expect(page.locator(".dip-confirm [data-ok]")).toBeDisabled();
  await page.fill("#typedConfirm", "DELETE");
  await expect(page.locator(".dip-confirm [data-ok]")).toBeEnabled();
  await page.click(".dip-confirm [data-ok]");
  await expect(page.locator("#purgeResult")).toContainText("Deleted", { timeout: 30_000 });
});

test("admin: API docs are served (Redoc + Swagger + raw spec)", async ({ page }) => {
  const spec = await page.request.get("/api/v1/openapi.json");
  expect(spec.ok()).toBeTruthy();
  const doc = await spec.json();
  expect(doc.info.title).toBe("Document Processing API");
  expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(25);

  await page.goto("/api/v1/docs");
  await expect(page).toHaveTitle(/API reference/);
  await page.goto("/api/v1/swagger");
  await expect(page).toHaveTitle(/Swagger/i);
});
