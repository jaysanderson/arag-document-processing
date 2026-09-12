import { expect, test } from "@playwright/test";

/** The UI kit publishes its helpers on `window.aragUI` (see vendor/arag-platform/ui). */
declare global {
  interface Window {
    /** `public/lib/core.js` publishes the shell's branding hook for the e2e suite. */
    dipApplyBranding: (branding: Record<string, unknown>) => void;
  }
}

/**
 * The white-label path end to end. The e2e server runs unbranded, so this spec asks the
 * page to apply a branding payload the way it does at boot and asserts what a partner
 * would actually see. The unbranded Progress defaults are asserted first, so a regression
 * in either direction fails.
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

test("the default look is Progress-branded, then a partner's branding replaces it", async ({ page }) => {
  await page.goto("/#/documents");
  await expect(page.locator("[data-brand-name]")).toHaveText("Document Processing");
  await expect(page.locator("[data-powered-by]")).toBeVisible();
  // The official wordmarks: white/green on the ink band, grey/green on the light sidebar.
  await expect(page.locator(".dip-bandmark img")).toHaveAttribute("src", "/brand/arag-logo-alt.svg");
  await expect(page.locator(".dip-brandmark img")).toHaveAttribute("src", "/brand/arag-logo.svg");
  // Progress green is a brand colour, not a UI colour: it appears only on the band's rule.
  const rule = await page.evaluate(() => {
    const band = document.querySelector(".dip-app > .arag-band");
    return band ? getComputedStyle(band).borderBottomColor : "";
  });
  expect(rule).toBe("rgb(92, 229, 0)");

  await page.evaluate((b) => window.dipApplyBranding(b), BRAND);

  await expect(page.locator("[data-brand-name]")).toHaveText(BRAND.productName);
  await expect(page.locator("[data-brand-tagline]")).toHaveText(BRAND.tagline);
  // The powered-by band and footer credit are hidden when a partner turns them off.
  await expect(page.locator("[data-powered-by]")).toBeHidden();
  await expect(page.locator("[data-powered-by-credit]")).toBeHidden();
  await expect(page.locator("[data-brand-footer]")).toHaveText(BRAND.footerText);
  const brandVar = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--arag-brand-600").trim(),
  );
  expect(brandVar).toBe(BRAND.primaryColor);
});

test("status and verification colours are never branded", async ({ page }) => {
  await page.goto("/#/settings/branding");
  await expect(page.locator("#panel")).toContainText("never branded", { timeout: 20_000 });
  const before = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--arag-danger-fg").trim(),
  );
  await page.evaluate((b) => window.dipApplyBranding(b), BRAND);
  const after = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--arag-danger-fg").trim(),
  );
  expect(after).toBe(before);
});

test("the branding endpoint is public and the favicon is served", async ({ page }) => {
  const branding = await page.request.get("/api/v1/branding");
  expect(branding.ok()).toBeTruthy();
  expect((await branding.json()).productName).toBe("Document Processing");
  expect((await page.request.get("/ui/favicon.svg")).ok()).toBeTruthy();
  expect((await page.request.get("/brand/arag-logo.svg")).ok()).toBeTruthy();
  expect((await page.request.get("/brand/arag-logo-alt.svg")).ok()).toBeTruthy();
});
