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
  // The official wordmark is shown once, white/green on the ink band. The sidebar head is
  // the product's identity, not a second copy of the platform's.
  await expect(page.locator(".arag-appband .wordmark img")).toHaveAttribute(
    "src",
    "/ui/brand/arag-logo-alt.svg",
  );
  await expect(page.locator(".arag-rail .ident img")).toBeHidden();
  expect(await page.locator('img[src*="arag-logo"]').count()).toBe(1);
  // Progress green is a brand colour, not a UI colour: it appears only on the band's rule.
  const rule = await page.evaluate(() => {
    const band = document.querySelector(".arag-app .arag-appband");
    return band ? getComputedStyle(band).borderBottomColor : "";
  });
  expect(rule).toBe("rgb(92, 229, 0)");

  await page.evaluate((b) => window.dipApplyBranding(b), BRAND);

  await expect(page.locator("[data-brand-name]")).toHaveText(BRAND.productName);
  await expect(page.locator("[data-brand-tagline]")).toHaveText(BRAND.tagline);
  // No BRAND_LOGO_URL in this payload, so the sidebar head still carries no image.
  await expect(page.locator(".arag-rail .ident img")).toBeHidden();
  // The powered-by band and footer credit are hidden when a partner turns them off.
  await expect(page.locator("[data-powered-by]")).toBeHidden();
  await expect(page.locator("[data-powered-by-credit]")).toBeHidden();
  await expect(page.locator("[data-brand-footer]")).toHaveText(BRAND.footerText);
  const brandVar = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--arag-brand-600").trim(),
  );
  expect(brandVar).toBe(BRAND.primaryColor);
});

test("a partner logo takes the sidebar head's image slot", async ({ page }) => {
  await page.goto("/#/documents");
  await expect(page.locator(".arag-rail .ident img")).toBeHidden();
  // Any served asset stands in for a partner's; what matters is that it appears in the
  // sidebar head, beside the product name, and that the band keeps the Progress wordmark.
  await page.evaluate((b) => window.dipApplyBranding(b), {
    ...BRAND,
    poweredBy: true,
    logoUrl: "/ui/brand/arag-logo.svg",
  });
  await expect(page.locator(".arag-rail .ident img")).toBeVisible();
  await expect(page.locator(".arag-rail .ident img")).toHaveAttribute("src", "/ui/brand/arag-logo.svg");
  await expect(page.locator(".arag-rail .ident img")).toHaveAttribute("alt", BRAND.productName);
  await expect(page.locator(".arag-appband .wordmark img")).toHaveAttribute(
    "src",
    "/ui/brand/arag-logo-alt.svg",
  );
});

test("the admin sign-in card keeps the Progress wordmark", async ({ page }) => {
  await page.goto("/admin/");
  await expect(page.locator(".arag-signin .card img.wordmark")).toHaveAttribute(
    "src",
    "/ui/brand/arag-logo.svg",
  );
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
  expect((await page.request.get("/ui/brand/arag-logo.svg")).ok()).toBeTruthy();
  expect((await page.request.get("/ui/brand/arag-logo-alt.svg")).ok()).toBeTruthy();
});

/**
 * DP-43, pinned across the whole product rather than on one screen.
 *
 * The assertion used to run on Documents alone, so the Settings → Branding preview could
 * (and did) stamp two more copies of the wordmark without failing anything.
 */
const APP_SCREENS: [string, string][] = [
  ["#/welcome", "Read every document the first time"],
  ["#/documents", "Documents"],
  ["#/configs", "Configs"],
  ["#/ask", "Ask"],
  ["#/jobs", "Jobs"],
  ["#/api", "API"],
  ["#/settings/connection", "Connection"],
  ["#/settings/extraction", "Extraction"],
  ["#/settings/branding", "Branding"],
  ["#/settings/api", "API"],
];

const ADMIN_SCREENS = ["Overview", "Connection", "Configs", "Jobs", "Logs", "Usage", "Branding", "Security"];

test("the wordmark appears exactly once on every screen of the app", async ({ page }) => {
  // An empty deployment sends Documents to Welcome, so give the queue something to show.
  await page.request.post("/api/v1/documents?config=invoice", {
    headers: { "Content-Type": "text/plain", "X-Filename": "brand-e2e.txt" },
    data: "TAX INVOICE\nInvoice Number: INV-BRAND-1\nTOTAL DUE: $10.00 AUD\n",
  });
  for (const [hash, marker] of APP_SCREENS) {
    await page.goto(`/${hash}`);
    // Wait for the screen itself, so the count below is never taken mid-render.
    if (hash.startsWith("#/settings")) {
      await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveText(marker);
      await expect(page.locator("#panel")).not.toBeEmpty();
    } else {
      await expect(page.locator("h1")).toContainText(marker, { timeout: 20_000 });
    }
    await expect(page.locator(".arag-appband .wordmark img")).toBeVisible();
    expect(await page.locator('img[src*="arag-logo"]').count(), hash).toBe(1);
  }
});

test("the wordmark appears exactly once on every screen of the operator console", async ({ page }) => {
  await page.goto("/admin/");
  await page.fill("#token", "e2e-admin-token");
  await page.press("#token", "Enter");
  await expect(page.locator(".arag-railnav")).toBeVisible({ timeout: 20_000 });
  for (const label of ADMIN_SCREENS) {
    await page.click(`[data-nav="${label}"]`);
    await expect(page.locator("h1")).toContainText(label, { timeout: 20_000 });
    await expect(page.locator(".arag-appband .wordmark img")).toBeVisible();
    expect(await page.locator('img[src*="arag-logo"]').count(), label).toBe(1);
  }
});
