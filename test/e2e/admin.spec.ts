import { expect, test } from "@playwright/test";

const TOKEN = "e2e-admin-token";

test("admin: login is required, then health, configs, jobs, logs and retention are usable", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/admin/");
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#panel")).toBeHidden();

  // Wrong token is rejected.
  await page.fill("#token", "nope");
  await page.click("#signin");
  await expect(page.locator("#loginError")).toBeVisible();

  await page.fill("#token", TOKEN);
  await page.click("#signin");
  await expect(page.locator("#panel")).toBeVisible();
  // Only the selected tab's section is on screen.
  await expect(page.locator('[data-panel="overview"]')).toBeVisible();
  for (const tab of ["configs", "jobs", "logs", "config", "retention"]) {
    await expect(page.locator(`[data-panel="${tab}"]`)).toBeHidden();
  }

  // Overview: KB connection test, extract strategy, model.
  await expect(page.locator("arag-health")).toContainText("connected", { timeout: 20_000 });
  await expect(page.locator("#model")).not.toBeEmpty();
  await expect(page.locator("#extractStrategy")).not.toBeEmpty();
  await page.click("#testKb");
  await expect(page.locator(".arag-toast")).toContainText("KB connected");

  // Extraction configs and their ARAG search configurations.
  await page.click('[data-tab="configs"]');
  await expect(page.locator("#cfgTable tbody tr")).toHaveCount(11);
  await expect(page.locator("#cfgTable")).toContainText("dip_medical_claim_extraction");
  await page.click("#provision");
  await expect(page.locator("#provisionResult")).toContainText("provisioned", { timeout: 30_000 });
  await expect(page.locator("#provisionResult")).toContainText("0 failed");

  // Jobs: create one through the public API so this spec does not depend on the demo spec.
  const upload = await page.request.post("/api/v1/documents?config=invoice", {
    headers: { "Content-Type": "text/plain", "X-Filename": "admin-e2e.txt" },
    data: "TAX INVOICE\nInvoice Number: INV-ADMIN-1\nTOTAL DUE: $10.00 AUD\n",
  });
  expect(upload.status()).toBe(202);
  await page.click('[data-tab="jobs"]');
  await page.click("#reloadJobs");
  await expect(page.locator("#jobs tbody tr[data-id]").first()).toBeVisible({ timeout: 20_000 });
  await page.click("#jobs tbody tr[data-id]");
  await expect(page.locator("#jobDetail .arag-steps li").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#jobJson")).toContainText("process-document");

  // Logs.
  await page.click('[data-tab="logs"]');
  await expect(page.locator("#log .line").first()).toBeVisible({ timeout: 20_000 });
  await page.selectOption("#level", "warn");
  await expect(page.locator("#log")).toBeVisible();

  // Configuration view, with secrets redacted.
  await page.click('[data-tab="config"]');
  await expect(page.locator("#configJson")).toContainText("adminToken");
  await expect(page.locator("#configJson")).not.toContainText(TOKEN);

  // Retention.
  await page.click('[data-tab="retention"]');
  await expect(page.locator("#purgeDays")).toHaveValue("30");
  page.once("dialog", (d) => d.accept());
  await page.fill("#purgeDays", "3650");
  await page.click("#purge");
  await expect(page.locator("#purgeResult")).toContainText("Deleted", { timeout: 30_000 });
});

test("admin: API docs are served (Redoc + Swagger + raw spec)", async ({ page }) => {
  const spec = await page.request.get("/api/v1/openapi.json");
  expect(spec.ok()).toBeTruthy();
  const doc = await spec.json();
  expect(doc.info.title).toBe("Document Processing API");
  expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(15);

  await page.goto("/api/v1/docs");
  await expect(page).toHaveTitle(/API reference/);
  await page.goto("/api/v1/swagger");
  await expect(page).toHaveTitle(/Swagger/i);
});
