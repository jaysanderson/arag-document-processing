/**
 * Playwright walkthrough that records the Document Processing showcase (video +
 * numbered screenshots) against the mock ARAG. Run: `make showcase`.
 *
 * Follows showcase/SCRIPT.md beat by beat; screenshot names match showcase/STORYBOARD.md.
 * Selectors are the same ones exercised (and kept working) by test/e2e/demo.spec.ts and
 * test/e2e/admin.spec.ts — nothing here is a new, unverified selector.
 *
 * The mock ARAG resolves the whole pipeline in well under a second (no simulated
 * latency), so a still screenshot cannot show a genuine "mid-stage" frame distinct from
 * "complete" — the video captures the real transition; the still is taken once the run
 * has settled. showcase/fixtures/invoice-review.txt is a deliberately imperfect invoice
 * (a subtotal + tax that don't add up to the printed total) so the canonical-record shot
 * has something in the validation-issues panel to show, rather than an empty one — the
 * built-in sample documents are all clean. (The mock's field-synthesis always fabricates
 * a placeholder for a field it can't find in the text rather than leaving it absent, so
 * a "required field missing" error cannot be demonstrated against the mock — every other
 * field in the fixture is filled in correctly so only the arithmetic check fires.)
 */
import { expect, test } from "@playwright/test";

// The shared UI kit's `.arag-header` is `position: sticky`, which Chromium's full-page
// screenshot can render twice (once in place, once composited again lower down) once the
// page is taller than one viewport. Un-stick it for the instant of the capture only, so
// the still images are correct; the live recording (which is not a stitched screenshot)
// is unaffected either way.
async function shot(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>(".arag-header")) el.style.position = "static";
  });
  await page.screenshot({ path: `showcase/out/${name}.png`, fullPage: true });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>(".arag-header")) el.style.position = "";
  });
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("showcase walkthrough", async ({ page }) => {
  test.setTimeout(240_000);

  // ── 1. The problem: a fresh, empty demo ───────────────────────────────────
  await page.goto("/");
  await expect(page.locator("arag-shell .product")).toContainText("Document Processing");
  await expect(page.locator("#configSelect option")).not.toHaveCount(0);
  // The demo says plainly, in-page, that it is running against the mock Knowledge Box —
  // so nobody watching mistakes fixture-driven extraction for genuine visual extraction.
  await expect(page.locator("#mockNote")).toBeVisible({ timeout: 10_000 });
  await pause(1800);
  await shot(page, "01-home");

  // ── 2. Drop an invoice; the live pipeline runs; the canonical record ─────
  await page.setInputFiles("#fileInput", "showcase/fixtures/invoice-review.txt");
  await expect(page.locator("#preview pre")).toContainText("TAX INVOICE", { timeout: 20_000 });
  await expect(page.locator("#timeline .arag-chip")).toContainText("succeeded", { timeout: 60_000 });
  for (const stage of ["process", "classify", "extract", "entities", "summary", "validate", "standardize"]) {
    await expect(page.locator("#timeline .arag-steps")).toContainText(stage);
  }
  await expect(page.locator("#resultBody")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#docTypeBadge")).toContainText("invoice");
  await expect(page.locator("#fieldsTable tbody tr")).not.toHaveCount(0);
  await expect(page.locator("#fieldsTable")).toContainText("GLOBEX SUPPLY CO PTY LTD");
  await expect(page.locator("#fieldsTable .f-bar").first()).toBeVisible();
  await expect(page.locator("#entities .ent").first()).toBeVisible();
  await expect(page.locator("#summary")).not.toBeEmpty();
  // Validation issue: subtotal + tax do not reconcile with the printed total — a
  // deterministic arithmetic check on the fixture's numbers, not a scripted UI state.
  await expect(page.locator("#issues")).toContainText("≠ total");
  await expect(page.locator("#issues .arag-alert.warn")).toBeVisible();
  await pause(1800);
  await shot(page, "02-pipeline-and-record");

  // ── 3. Export the record ───────────────────────────────────────────────────
  for (const fmt of ["json", "xml", "csv"]) {
    const download = page.waitForEvent("download");
    await page.click(`#exports [data-fmt="${fmt}"]`);
    expect((await download).suggestedFilename()).toBe(`invoice-review.${fmt}`);
    await pause(400);
  }
  await expect(page.locator(".arag-toast")).toContainText("Downloaded invoice-review.csv");
  await pause(500);
  await shot(page, "03-exports");

  // ── 4. Ask the document a question ────────────────────────────────────────
  await page.fill("#askInput", "What is the total due?");
  await page.click("#askBtn");
  await expect(page.locator("#answer .arag-bubble.assistant").last()).not.toContainText("Thinking", {
    timeout: 30_000,
  });
  await pause(1500);
  await shot(page, "04-ask-answer");

  // ── 5. The visual path: an image sample, config forced (classification skipped) ──
  await page.selectOption("#configSelect", "purchase_order");
  await page.click('[data-image="purchase-order"]');
  await expect(page.locator("#preview img")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#resultBody")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#docConf")).toContainText("auto-classification skipped");
  await expect(page.locator("#docTypeBadge")).toContainText("purchase order");
  await expect(page.locator("#fieldsTable")).toContainText("PO-55218");
  // The mock note (card #1) is still on screen here too — the fields shown do not come
  // from reading the pixels of this particular image, and the note says so plainly.
  await expect(page.locator("#mockNote")).toBeVisible();
  await pause(1500);
  await shot(page, "05-image-sample");

  // ── 6. The extraction-config manager: built-ins, then a custom config ─────
  await page.click("#manageConfigs");
  await expect(page.locator("#configModal")).toBeVisible();
  await expect(page.locator("#cfgList")).toContainText("Built-in");
  await expect(page.locator("#cfgList")).toContainText("dip_invoice_extraction");
  await pause(1000);
  await shot(page, "06-config-manager");

  await page.fill("#cfgName", "Insurance Card");
  await page.fill("#cfgFields .fld-label", "Policy Number");
  await page.click("#addField");
  await page.fill("#cfgFields .cfg-field-row:nth-child(2) .fld-label", "Insurer");
  await pause(800);
  await shot(page, "07-config-fields");

  await page.click("#saveConfig");
  await expect(page.locator("#configSelect")).toHaveValue(/^cfg_/, { timeout: 20_000 });
  await expect(page.locator("#cfgList")).toContainText("Insurance Card");
  await expect(page.locator("#cfgList")).toContainText("provisioned", { timeout: 20_000 });
  // The new custom card renders at the top of the (now re-rendered, scrolled) list —
  // bring it back into view so the screenshot actually shows what the toast promises.
  await page.locator(".cfg-card", { hasText: "Insurance Card" }).scrollIntoViewIfNeeded();
  await pause(1000);
  await shot(page, "08-config-provisioned");

  await page.click("#closeConfigs");
  await expect(page.locator("#configModal")).toBeHidden();

  // ── 7. The admin panel: health, configs, jobs ─────────────────────────────
  await page.goto("/admin/");
  await page.fill("#token", "e2e-admin-token");
  await page.click("#signin");
  await expect(page.locator("arag-health")).toContainText("connected", { timeout: 20_000 });
  await pause(1200);
  await shot(page, "09-admin-overview");

  await page.click('[data-tab="configs"]');
  await expect(page.locator("#cfgTable tbody tr")).not.toHaveCount(0);
  await expect(page.locator("#cfgTable")).toContainText("Insurance Card");
  await pause(1000);
  await shot(page, "10-admin-configs");

  await page.click('[data-tab="jobs"]');
  await page.click("#reloadJobs");
  await expect(page.locator("#jobs tbody tr[data-id]").first()).toBeVisible({ timeout: 20_000 });
  await page.click("#jobs tbody tr[data-id]");
  await expect(page.locator("#jobDetail .arag-steps li").first()).toBeVisible({ timeout: 20_000 });
  await pause(1000);
  await shot(page, "11-admin-jobs");

  // ── 8. The API docs, then the one-command try-it ──────────────────────────
  await page.goto("/api/v1/docs");
  await expect(page).toHaveTitle(/API reference/, { timeout: 20_000 });
  await pause(2500);
  await shot(page, "12-api-docs");
});
