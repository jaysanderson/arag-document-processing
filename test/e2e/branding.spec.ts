import { expect, test } from "@playwright/test";

/** The UI kit publishes its helpers on `window.aragUI` (see vendor/arag-platform/ui). */
declare global {
  interface Window {
    aragUI: { applyBranding: (branding: Record<string, unknown>) => void };
  }
}

/**
 * The white-label path end to end. The e2e server runs unbranded, so this spec asks the
 * page to apply a branding payload the way the shell does at boot (the kit exposes
 * `applyBranding` on `window.aragUI`) and asserts what a partner would actually see.
 * The unbranded defaults are asserted first, so a regression in either direction fails.
 */
const BRAND = {
  productName: "Northwind DocFlow",
  tagline: "Claims intake, automated",
  logoUrl: "",
  primaryColor: "rgb(11, 92, 255)",
  accentColor: "",
  poweredBy: false,
  footerText: "© Northwind Insurance",
  docsUrl: "/api/v1/docs",
  supportUrl: "",
};

test("demo: default branding, then a partner's branding replaces it", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("arag-shell [data-brand-name]")).toHaveText("Document Processing");
  await expect(page.locator("arag-shell [data-powered-by]")).toBeVisible();

  await page.evaluate((b) => window.aragUI.applyBranding(b), BRAND);

  await expect(page.locator("arag-shell [data-brand-name]")).toHaveText(BRAND.productName);
  await expect(page.locator("arag-shell [data-brand-tagline]")).toHaveText(BRAND.tagline);
  // The powered-by band and footer credit are hidden when a partner turns them off.
  await expect(page.locator("arag-shell [data-powered-by]")).toBeHidden();
  await expect(page.locator("arag-shell [data-powered-by-credit]")).toBeHidden();
  await expect(page.locator("arag-shell [data-brand-footer]")).toHaveText(BRAND.footerText);
  // The primary colour lands on the CSS variables the whole kit is built from.
  const brandVar = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--arag-brand-600").trim(),
  );
  expect(brandVar).toBe(BRAND.primaryColor);
});

test("admin: the same branding applies to the operator surface", async ({ page }) => {
  await page.goto("/admin/");
  await page.evaluate((b) => window.aragUI.applyBranding(b), BRAND);
  await expect(page.locator("arag-shell [data-brand-name]")).toHaveText(BRAND.productName);
  await expect(page.locator("arag-shell [data-powered-by]")).toBeHidden();
});

test("admin: the Configuration tab reports the effective branding", async ({ page }) => {
  await page.goto("/admin/");
  await page.fill("#token", "e2e-admin-token");
  await page.press("#token", "Enter");
  await expect(page.locator("#panel")).toBeVisible();
  await page.click('[data-tab="config"]');
  await expect(page.locator("#brandingKv")).toContainText("Document Processing");
  await expect(page.locator("#brandingKv")).toContainText("BRAND_PRODUCT_NAME");
  await expect(page.locator("#brandingKv")).toContainText("Powered-by credit");
});

test("the branding endpoint is public and the favicon is served", async ({ page }) => {
  const branding = await page.request.get("/api/v1/branding");
  expect(branding.ok()).toBeTruthy();
  expect((await branding.json()).productName).toBe("Document Processing");
  expect((await page.request.get("/ui/favicon.svg")).ok()).toBeTruthy();
});
