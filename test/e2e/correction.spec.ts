import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * Field correction — the honest behaviour is the feature.
 *
 * A correction is re-checked against the document's own text. A value that is in the document
 * earns a real, locatable quote and keeps its place in the grounding numerator; a value that
 * is not shows no quote and the score visibly falls. The one thing this must never do is let
 * somebody type over the evidence and raise the number the product quotes.
 */
test.describe.configure({ mode: "serial" });

const FILE = "correction-e2e.txt";
const SAMPLE = readFileSync("public/samples/invoice.txt", "utf8");

async function openRecord(page: Page) {
  await page.goto(`/#/documents?q=${FILE}`);
  await expect(page.locator("#docsTable tbody tr")).toHaveCount(1, { timeout: 30_000 });
  await page.click("#docsTable .cell-title >> nth=0");
  await expect(page.locator(".dip-grounding")).toBeVisible({ timeout: 20_000 });
}

test.beforeAll(async ({ request }) => {
  const res = await request.post("/api/v1/documents?config=invoice", {
    headers: { "Content-Type": "text/plain", "X-Filename": FILE },
    data: SAMPLE,
  });
  expect(res.status()).toBe(202);
});

test("the row menu offers a correction, and the hash carries the field so Back cancels", async ({ page }) => {
  test.setTimeout(120_000);
  await openRecord(page);
  await expect(page.locator("#field-bill_to .arag-chip.ok")).toHaveText("Verified", { timeout: 60_000 });

  await page.click("#field-bill_to .arag-menu .trigger");
  await page.click('[role="menuitem"]:has-text("Correct this value")');
  await expect(page).toHaveURL(/edit=bill_to/);
  await expect(page.locator(".dip-editor")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".dip-editor")).toContainText("extracted “Progress Software Corporation”");

  await page.goBack();
  await expect(page.locator(".dip-editor")).toHaveCount(0, { timeout: 20_000 });
});

test("a corrected value that is not in the document loses its quote and the score falls", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openRecord(page);
  await expect(page.locator(".dip-grounding__claim")).toContainText("12 of 12 fields carry a verified quote");

  await page.click("#field-bill_to .arag-menu .trigger");
  await page.click('[role="menuitem"]:has-text("Correct this value")');
  await page.fill("#correctValue", "NOT-IN-THIS-DOCUMENT");
  await page.selectOption("#correctReason", "The document itself is wrong");
  await page.click("#saveCorrect");

  // The corrected field is unverified now, so it is also pinned into "Check these first".
  const row = page.locator("#field-bill_to");
  await expect(row).toContainText("NOT-IN-THIS-DOCUMENT", { timeout: 20_000 });
  await expect(row.locator(".arag-chip.info")).toHaveText("Corrected");
  // The badge is what the corrected value actually earned — not a courtesy tick.
  await expect(row.locator(".arag-chip.danger")).toHaveText("No quote returned");
  await expect(row.locator(".arag-chip.ok")).toHaveCount(0);
  await expect(row).toContainText("was Progress Software Corporation");
  await expect(row).toContainText("The document itself is wrong");
  await expect(row).toContainText("no longer counts towards the grounding score");

  // The trust strip keeps the denominator and names the correction beside it.
  await expect(page.locator(".dip-grounding__claim")).toContainText(
    "11 of 12 fields carry a verified quote · 1 corrected by a reviewer",
  );
  // The Knowledge Box's filter index still matches the value this replaced, said plainly.
  await expect(row).toContainText("filter index also keeps the value this correction replaced");

  // Persisted: a reload is the same record, not a repaint of local state.
  await page.reload();
  await expect(page.locator("#field-bill_to")).toContainText("NOT-IN-THIS-DOCUMENT", { timeout: 20_000 });
  await expect(page.locator(".dip-grounding__claim")).toContainText("1 corrected by a reviewer");
});

test("the correction is in the record's own history and in the operator's audit log", async ({ page }) => {
  test.setTimeout(120_000);
  await openRecord(page);
  await page.click('a[role="tab"]:has-text("Pipeline")');
  await expect(page.locator("#tabPanel")).toContainText("Corrections (1)", { timeout: 20_000 });
  await expect(page.locator(".arag-timeline")).toContainText("Progress Software Corporation");
  await expect(page.locator(".arag-timeline")).toContainText("NOT-IN-THIS-DOCUMENT");
  await expect(page.locator(".arag-timeline")).toContainText("session");

  await page.goto("/admin/");
  await page.fill("#token", "e2e-admin-token");
  await page.press("#token", "Enter");
  await expect(page.locator(".arag-railnav")).toBeVisible({ timeout: 20_000 });
  await page.click('[data-nav="Audit"]');
  await expect(page.locator("#auditTable")).toContainText("document.field.correct", { timeout: 20_000 });
  await expect(page.locator("#auditTable")).toContainText("bill_to");
});

test("reverting restores the extracted value, its verification and the original score", async ({ page }) => {
  test.setTimeout(120_000);
  await openRecord(page);
  await page.click("#field-bill_to .arag-menu .trigger");
  await page.click('[role="menuitem"]:has-text("Revert to the extracted value")');
  await expect(page.locator(".arag-confirm")).toBeVisible();
  await page.click(".arag-confirm [data-ok]");

  const row = page.locator("#field-bill_to");
  await expect(row).toContainText("Progress Software Corporation", { timeout: 20_000 });
  await expect(row.locator(".arag-chip.ok")).toHaveText("Verified");
  await expect(page.locator(".dip-grounding__claim")).toContainText("12 of 12 fields carry a verified quote");
});

test("a corrected value that IS in the document earns a real, locatable quote", async ({ page }) => {
  test.setTimeout(120_000);
  await openRecord(page);
  await page.click("#field-vendor_name .arag-menu .trigger");
  await page.click('[role="menuitem"]:has-text("Correct this value")');
  // A value that appears in the document but is not already another field's quote — two
  // fields claiming the same span would collide in the source highlighter.
  await page.fill("#correctValue", "ACME ROBOTICS");
  await page.click("#saveCorrect");

  const row = page.locator("#field-vendor_name");
  await expect(row.locator(".arag-chip.info")).toHaveText("Corrected", { timeout: 20_000 });
  await expect(row.locator(".arag-chip.ok")).toHaveText("Verified");
  await expect(row).toContainText("This quote was found for the corrected value");
  // The score is where the evidence puts it, not where the reviewer wished it.
  await expect(page.locator(".dip-grounding__claim")).toContainText("12 of 12 fields carry a verified quote");
  await expect(page.locator(".dip-grounding__claim")).toContainText("corrected by a reviewer");

  // And the quote is locatable: the Source & evidence tab highlights it in the document.
  await page.click('a[role="tab"]:has-text("Source & evidence")');
  await page.click('.dip-source__item[data-ev="vendor_name"]');
  await expect(page.locator("mark.dip-hit.is-active")).toContainText("ACME ROBOTICS", {
    timeout: 20_000,
  });
});
