import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * Key-value fields — the pass's headline capability, from the three places a person meets it.
 *
 * The claim is that the structured values live in the customer's own Knowledge Box as typed,
 * filterable fields, not only in this product's store. So: the record has to show what was
 * actually written (and what was not), the config has to show the schema it provisions and
 * the budget it spends, and the Documents list has to be able to filter through the Knowledge
 * Box and label that filter as the Knowledge Box's rather than its own.
 */
test.describe.configure({ mode: "serial" });

const FILE = "kv-e2e.txt";
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

test("the record shows the values actually written to the Knowledge Box", async ({ page }) => {
  test.setTimeout(120_000);
  await openRecord(page);
  await page.click('a[role="tab"]:has-text("JSON")');
  await expect(page.locator("#jsonView")).toBeVisible({ timeout: 20_000 });

  await page.click('#jsonView button[data-value="kv"]');
  await expect(page).toHaveURL(/view=kv/);
  await expect(page.locator("#jsonPane")).toContainText("dip_invoice_extraction", { timeout: 20_000 });
  await expect(page.locator("#jsonPane .arag-chip.ok")).toHaveText("Written");
  // Product property, the Knowledge Box key it was written under, and the value itself.
  await expect(page.locator("#jsonPane table")).toContainText("invoice_number");
  await expect(page.locator("#jsonPane table")).toContainText("INV-2026-0042");
  await expect(page.locator("#jsonPane table")).toContainText("Knowledge Box key");
  // Back to the canonical record, and the hash says which view is showing.
  await page.click('#jsonView button[data-value="record"]');
  await expect(page).not.toHaveURL(/view=kv/);
  await expect(page.locator("#jsonPane")).toContainText("canonical record");
});

test("a config states the Knowledge Box schema it provisions and the budget it spends", async ({ page }) => {
  await page.goto("/#/configs/invoice");
  await expect(page.locator("h1")).toContainText("invoice", { timeout: 20_000 });
  await expect(page.locator("#kvCard")).toContainText("Knowledge Box schema");
  await expect(page.locator("#kvCard")).toContainText("dip_invoice_extraction");
  await expect(page.locator("#kvCard")).toContainText("of 50 allowed in one schema");
  await expect(page.locator("#kvCard .head .arag-chip")).toHaveText("Provisioned");
  // The field table carries the Knowledge Box type each property is written as.
  await expect(page.locator("table")).toContainText("Knowledge Box type");
  // And the list says how much of the Knowledge Box's 20-schema budget is spent.
  await page.goto("/#/configs");
  await expect(page.locator(".arag-filterbar")).toContainText("of 20 Knowledge Box schemas", {
    timeout: 20_000,
  });
});

test("a Knowledge Box filter narrows the list and is labelled as the Knowledge Box's", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/#/documents");
  await expect(page.locator("#docsTable tbody tr")).not.toHaveCount(0, { timeout: 30_000 });

  await page.click("#addKv");
  await expect(page.locator("#kvForm")).toBeVisible();
  await page.selectOption("#kvSchema", "invoice");
  await page.selectOption("#kvField", "currency");
  await page.selectOption("#kvOp", "eq");
  await page.fill("#kvValue", "AUD");
  await page.click("#kvForm button[type=submit]");

  await expect(page).toHaveURL(/kv=dip_invoice_extraction/, { timeout: 20_000 });
  const chip = page.locator(".arag-filterchip").first();
  await expect(chip).toContainText("Knowledge Box:");
  await expect(chip).toContainText("currency is AUD");
  await expect(page.locator("#kvfilters")).toContainText("matched in the Knowledge Box");
  await expect(page.locator("#docsTable tbody tr")).not.toHaveCount(0);

  // A value nothing carries returns nothing — and says the Knowledge Box matched none,
  // rather than quietly falling back to the whole list.
  await page.goto("/#/documents?kv=dip_invoice_extraction%3Acurrency%3Aeq%3AZZZ");
  await expect(page.locator("#kvfilters")).toContainText("0 resources matched in the Knowledge Box", {
    timeout: 20_000,
  });

  // Removing the chip takes the filter out of the hash.
  await page.click("[data-kv-remove]");
  await expect(page).not.toHaveURL(/kv=/, { timeout: 20_000 });
});

test("a generator agent is provisioned on the config, and Compare renders the asymmetry", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/#/configs/invoice");
  await expect(page.locator("#genCard")).toContainText("Generator agent", { timeout: 20_000 });
  await expect(page.locator("#genCard")).toContainText("It returns no quote.");
  await page.click("#genProvision");
  await expect(page.locator("#genCard")).toContainText("Its own schema", { timeout: 20_000 });
  await expect(page.locator("#genCard")).toContainText("_gen");

  // The Compare tab is absent until an agent exists; now it is there.
  await openRecord(page);
  await expect(page.locator('a[role="tab"]:has-text("Compare")')).toBeVisible({ timeout: 20_000 });
  await page.click('a[role="tab"]:has-text("Compare")');
  await expect(page.locator("#tabPanel")).toContainText("These two columns are not the same kind of claim", {
    timeout: 20_000,
  });
  await expect(page.locator("#tabPanel")).toContainText("has not written anything to this resource yet");
  await expect(page.locator("#tabPanel table")).toContainText("Pipeline only");
  // The agent's column never carries a verification badge, because it returns nothing to verify.
  await expect(page.locator("#tabPanel table tbody tr").first()).toContainText("Not written");
  await expect(page.locator("#tabPanel")).toContainText("has not been observed");

  // Put the deployment back: the agent is a real object in the Knowledge Box.
  await page.goto("/#/configs/invoice");
  await expect(page.locator("#genDelete")).toBeVisible({ timeout: 20_000 });
  await page.click("#genDelete");
  await page.click(".arag-confirm [data-ok]");
  await expect(page.locator("#genCard")).toContainText("Not provisioned", { timeout: 20_000 });
});
