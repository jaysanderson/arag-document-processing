import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("demo: sample → live pipeline → canonical record → exports → ask", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.locator("arag-shell .product")).toContainText("Document Processing");

  // Nothing that depends on a record is on screen yet (the UI kit sets an explicit
  // `display` on several classes, which used to defeat the `hidden` attribute).
  await expect(page.locator("#exports")).toBeHidden();
  await expect(page.locator("#resultBody")).toBeHidden();
  await expect(page.locator("#configModal")).toBeHidden();
  await expect(page.locator("#askBtn")).toBeDisabled();

  // The extraction-config selector is populated from /api/v1/extraction-configs.
  await expect(page.locator("#configSelect option")).not.toHaveCount(0);
  await expect(page.locator("#configSelect")).toHaveValue("auto");

  // One click on a sample runs the whole pipeline.
  await page.click('[data-sample="invoice"]');
  await expect(page.locator("#timeline .arag-steps li").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#preview pre")).toContainText("TAX INVOICE");

  // Canonical record.
  await expect(page.locator("#resultBody")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#docTypeBadge")).toContainText("invoice");
  await expect(page.locator("#fieldsTable tbody tr")).not.toHaveCount(0);
  await expect(page.locator("#fieldsTable")).toContainText("INV-2026-0042");
  await expect(page.locator("#fieldsTable .f-bar").first()).toBeVisible();
  await expect(page.locator("#entities .ent").first()).toBeVisible();
  await expect(page.locator("#timeline .arag-chip")).toContainText("succeeded");

  // Every stage reported.
  for (const stage of ["process", "classify", "extract", "entities", "summary", "validate", "standardize"]) {
    await expect(page.locator("#timeline .arag-steps")).toContainText(stage);
  }

  // Exports download.
  for (const fmt of ["json", "xml", "csv"]) {
    const download = page.waitForEvent("download");
    await page.click(`#exports [data-fmt="${fmt}"]`);
    expect((await download).suggestedFilename()).toBe(`invoice.${fmt}`);
  }

  // Ask this document.
  await page.fill("#askInput", "What is the total due?");
  await page.click("#askBtn");
  await expect(page.locator("#answer .arag-bubble.assistant").last()).not.toContainText("Thinking", {
    timeout: 30_000,
  });

  // The document appears in the recent list, ready.
  await page.click("#refreshDocs");
  await expect(page.locator("#docs tbody tr").first()).toContainText("invoice.txt");
  await expect(page.locator("#docs tbody .arag-chip").first()).toContainText("ready");
});

test("demo: image sample uses the visual path and a forced config skips classification", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.selectOption("#configSelect", "purchase_order");
  await page.click('[data-image="purchase-order"]');
  await expect(page.locator("#preview img")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#resultBody")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#docConf")).toContainText("auto-classification skipped");
  await expect(page.locator("#docTypeBadge")).toContainText("purchase order");
  await expect(page.locator("#fieldsTable")).toContainText("PO-55218");
});

test("demo: the extraction-config manager creates and deletes a custom config", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.click("#manageConfigs");
  await expect(page.locator("#configModal")).toBeVisible();
  await expect(page.locator("#cfgList")).toContainText("Built-in");
  await expect(page.locator("#cfgList")).toContainText("dip_invoice_extraction");

  await page.fill("#cfgName", "E2E Insurance Card");
  await page.fill("#cfgFields .fld-label", "Policy Number");
  await page.click("#addField");
  await page.fill("#cfgFields .cfg-field-row:nth-child(2) .fld-label", "Insurer");
  await page.click("#saveConfig");

  await expect(page.locator("#configSelect")).toHaveValue(/^cfg_/, { timeout: 20_000 });
  await expect(page.locator("#cfgList")).toContainText("E2E Insurance Card");
  await expect(page.locator("#cfgList")).toContainText("provisioned");

  await page.click("#cfgList .cfg-del");
  await expect(page.locator("#cfgList")).not.toContainText("E2E Insurance Card", { timeout: 20_000 });
});

test("demo: the prompt gallery offers copyable document-generation prompts", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#promptGrid .prompt-card")).toHaveCount(7);
  await expect(page.locator("#promptGrid")).toContainText("PURCHASE ORDER");
});
