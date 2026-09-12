/**
 * Playwright walkthrough that records the Document Processing showcase (video + numbered
 * screenshots) against the mock ARAG. Run: `make showcase`.
 *
 * Follows showcase/SCRIPT.md beat by beat; screenshot names match showcase/STORYBOARD.md.
 * Selectors are the ones exercised (and kept working) by test/e2e/app.spec.ts and
 * test/e2e/admin.spec.ts — nothing here is a new, unverified selector.
 *
 * The click path follows design/PRODUCT-EXPERIENCE.md §6.3, with one deliberate change: the
 * guided sample (`#startSample`) posts the clean, built-in `invoice.txt` sample, which has
 * nothing for the validation surfaces to show. So the tour is still run for its own sake —
 * it is a real, on-screen product feature worth recording — but the record the walkthrough
 * actually inspects is `showcase/fixtures/invoice-review.txt`, uploaded afterwards through
 * the upload drawer. That fixture's subtotal and tax deliberately do not reconcile with the
 * printed total, so the trust strip, the field evidence and the source highlight all have a
 * real validation issue to carry, not an empty one.
 *
 * The mock ARAG resolves the whole pipeline in well under a second (no simulated latency),
 * so a still screenshot cannot show a genuine mid-stage "processing" frame distinct from
 * "ready" — the video captures the real transition; the stills are taken once each screen
 * has settled.
 */
import { expect, test } from "@playwright/test";

// Chromium's full-page screenshot composites `position: sticky` elements oddly once the
// page is taller than one viewport: the band can be drawn twice and the sidebar's contents
// can vanish. Make both static for the instant of the capture — the sidebar column keeps
// its painted background either way, so the still looks exactly like the live screen. The
// video (not a stitched screenshot) is unaffected.
const PIN_STICKY =
  ".dip-app > .arag-band{position:static!important}" +
  ".dip-sidebar{position:static!important;height:auto!important}";

async function shot(page: import("@playwright/test").Page, name: string): Promise<void> {
  const tag = await page.addStyleTag({ content: PIN_STICKY });
  await page.screenshot({ path: `showcase/out/${name}.png`, fullPage: true });
  await tag.evaluate((el) => (el as HTMLElement).remove());
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("showcase walkthrough", async ({ page }) => {
  test.setTimeout(240_000);

  // ── 1. Welcome: first run, and the mock-Knowledge-Box honesty rule ───────────
  await page.goto("/#/welcome");
  await expect(page.locator("h1")).toContainText("Read every document the first time");
  await expect(page.locator(".arag-alert.warn")).toContainText("mock Knowledge Box");
  await expect(page.locator("#startSample")).toBeVisible();
  await pause(600);
  await shot(page, "01-welcome");

  // ── 2. The guided sample and its advisory tour ────────────────────────────────
  await page.click("#startSample");
  await expect(page).toHaveURL(/#\/documents/, { timeout: 20_000 });
  await expect(page.locator(".dip-tour__card")).toBeVisible();
  await expect(page.locator(".dip-tour__card")).toContainText("This is the queue");
  await pause(600);
  await shot(page, "02-tour");
  await page.click("[data-tour-end]");
  await expect(page.locator(".dip-tour__card")).toHaveCount(0);
  // The tour is advisory, not a cage: the sample keeps processing underneath it.
  await expect(page.locator("#docsTable tbody tr")).not.toHaveCount(0, { timeout: 30_000 });

  // ── 3. Upload the imperfect invoice through the drawer ────────────────────────
  await page.click("#uploadBtn");
  await expect(page).toHaveURL(/#\/documents\/upload/);
  await expect(page.locator(".dip-drawer")).toBeVisible();
  await expect(page.locator(".dip-drawer .arag-help").first()).toContainText("PDF");
  await expect(page.locator(".dip-drawer .arag-help").first()).toContainText("MB each");
  await pause(500);
  await shot(page, "03-upload-drawer");

  await page.setInputFiles("#fileInput", "showcase/fixtures/invoice-review.txt");
  await expect(page.locator("#queue .arag-chip")).toContainText("queued", { timeout: 20_000 });
  await page.click(".dip-drawer [data-close]");
  await expect(page.locator(".dip-drawer")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/documents(\?|$)/);

  // ── 4. The queue: the new row reads its way to Ready, worth reviewing ─────────
  const row = page.locator("#docsTable tbody tr", { hasText: "invoice-review.txt" });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.locator(".arag-chip").first()).toContainText("Ready", { timeout: 30_000 });
  await expect(row.locator(".dip-datatable__sub")).toContainText("INV-2026-1188");
  await expect(row).toContainText("12"); // fields
  await expect(row).toContainText("100%"); // grounding
  await expect(row.locator(".arag-chip.warn, .arag-chip.danger")).toContainText("1"); // the reconciliation issue
  await pause(600);
  await shot(page, "04-fixture-ready");

  // ── 5. The record: the trust strip, worded not just coloured ─────────────────
  await row.locator(".dip-datatable__primary").click();
  await expect(page.locator(".dip-grounding")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".dip-grounding__claim")).toContainText(
    "of 12 fields carry a quote found in this document",
  );
  await expect(page.locator(".dip-grounding__breakdown")).toContainText("exact");
  await expect(page.locator(".dip-grounding")).toHaveAttribute("data-band", "strong");
  await expect(page.locator(".arag-alert.warn").first()).toContainText("≠ total");
  await expect(page.locator("#field-total")).toBeVisible();
  await pause(700);
  await shot(page, "05-record");

  // ── 6. The evidence beat: a field's own quote, and the issue it carries ──────
  await page.click("#field-total .dip-field__evidence summary");
  await expect(page.locator("#field-total blockquote")).toBeVisible();
  await expect(page.locator("#field-total blockquote")).toContainText("TOTAL DUE");
  await expect(page.locator("#field-total blockquote")).toContainText("25,750");
  await expect(page.locator("#field-total .dip-field__issue")).toContainText("≠ total");
  // Normalisation is shown, not hidden: the raw value sits beside the normalised one.
  await expect(page.locator("#field-invoice_date .dip-field__raw")).toContainText("raw");
  await pause(900);
  await shot(page, "06-evidence-quote");

  // ── 7. Source & evidence: the same quote, found in the document's own text ───
  await page.click('a[role="tab"]:has-text("Source & evidence")');
  await expect(page.locator(".dip-source__text")).toContainText("TAX INVOICE", { timeout: 20_000 });
  await expect(page.locator("mark.dip-hit")).not.toHaveCount(0);
  await page.click('.dip-source__item[data-ev="invoice_number"]');
  await expect(page.locator("mark.dip-hit.is-active")).toContainText("INV-2026-1188");
  await page.click('.dip-source__item[data-ev="total"]');
  await expect(page.locator("mark.dip-hit.is-active")).toContainText("25,750.00");
  await pause(700);
  await shot(page, "07-source-highlight");

  // ── 8. Pipeline: the seven stages, with real timings ──────────────────────────
  await page.click('a[role="tab"]:has-text("Pipeline")');
  for (const stage of ["process", "classify", "extract", "entities", "summary", "validate", "standardize"]) {
    await expect(page.locator("#tabPanel")).toContainText(stage);
  }
  await expect(page.locator("#tabPanel")).toContainText("Total");
  await pause(600);
  await shot(page, "08-pipeline");

  // ── 9. Export the record ───────────────────────────────────────────────────────
  await page.click('a[role="tab"]:has-text("Record")');
  await expect(page.locator(".dip-grounding")).toBeVisible({ timeout: 20_000 });
  const csv = page.waitForEvent("download");
  await page.click("#exportCsv");
  expect((await csv).suggestedFilename()).toBe("invoice-review.csv");
  await expect(page.locator(".arag-toast")).toContainText("Downloaded invoice-review.csv");
  await pause(500);
  await shot(page, "09-export");

  // ── 10. Ask this document ──────────────────────────────────────────────────────
  await page.click('a[role="tab"]:has-text("Ask")');
  await page.fill("#askInput", "What is the total due and when?");
  await page.click("#askBtn");
  await expect(page.locator(".arag-bubble.assistant").last()).not.toContainText("Thinking", {
    timeout: 30_000,
  });
  await expect(page.locator(".arag-bubble.assistant").last()).toContainText("25,750");
  await expect(page.locator(".arag-bubble.assistant").last()).toContainText("Open in source");
  await pause(900);
  await shot(page, "10-ask");

  // ── 11. A custom extraction config: the five-minute new document type ────────
  await page.click('[data-nav="configs"]');
  await expect(page.locator("h2").first()).toContainText("Built in");
  await page.click('a[href="#/configs/new"]');
  await expect(page.locator("h1")).toContainText("New extraction config");
  await page.fill("#cfgName", "Insurance Card");
  await page.fill(".dip-fieldrow .fld-label", "Policy Number");
  await page.click("#addField");
  await page.fill(".dip-fieldrow:nth-child(2) .fld-label", "Insurer");
  await expect(page.locator("#keyPreview")).toContainText("policy_number, insurer");
  await pause(700);
  await shot(page, "11-config-builder");

  await page.click("#saveCfg");
  await expect(page).toHaveURL(/#\/configs\/cfg_/, { timeout: 20_000 });
  await expect(page.locator("h1")).toContainText("Insurance Card");
  await expect(page.locator(".arag-chip.ok")).toContainText("Ready");
  await expect(page.locator("dl")).toContainText("dip_custom_insurance_card");
  await pause(700);
  await shot(page, "12-config-saved");

  // ── 12. Settings: what this deployment is connected to, no admin token needed ──
  await page.click('[data-nav="settings"]');
  await expect(page.locator("#panel")).toContainText("Knowledge Box", { timeout: 20_000 });
  await expect(page.locator(".arag-alert.warn")).toContainText("mock Knowledge Box");
  await expect(page.locator("#panel")).toContainText("Grounding (mean)");
  await pause(700);
  await shot(page, "13-settings");

  // ── 13. Admin: sign in, and the operator's own view ───────────────────────────
  await page.click('a[href="/admin/"]');
  await expect(page.locator(".dip-signin")).toBeVisible({ timeout: 20_000 });
  await page.fill("#token", "e2e-admin-token");
  await page.press("#token", "Enter");
  await expect(page.locator(".dip-sidenav")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("h1")).toContainText("Overview");
  await expect(page.locator(".dip-statstrip")).toContainText("Grounding");
  await expect(page.locator("body")).toContainText("Needs attention");
  await pause(700);
  await shot(page, "14-admin-overview");

  // ── 14. Admin → Connection: the stored ARAG search configurations ────────────
  await page.click('[data-nav="connection"]');
  await expect(page.locator("table")).toContainText("dip_invoice_extraction", { timeout: 20_000 });
  await expect(page.locator("table")).toContainText("dip_custom_insurance_card");
  await page.click("tr[data-cfg='dip_invoice_extraction']");
  await expect(page.locator(".dip-drawer")).toContainText("full_resource", { timeout: 20_000 });
  await expect(page.locator(".dip-drawer")).toContainText("answer_json_schema");
  await pause(700);
  await shot(page, "15-admin-connection");
  await page.keyboard.press("Escape");

  // ── 15. The API docs: every screen is a documented, contract-tested endpoint ──
  await page.click("a[data-docs-link]");
  await expect(page).toHaveTitle(/API reference/, { timeout: 20_000 });
  await pause(1500);
  await shot(page, "16-api-docs");
});
