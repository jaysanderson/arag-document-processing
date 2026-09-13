import { expect, test } from "@playwright/test";

/**
 * The in-product API explorer.
 *
 * The brief's bar #2 is that every `/api/v1` capability is visible and exercisable in the
 * UI. The assertion that actually holds that bar is the first test here: the explorer's
 * operation list is compared against the server's own OpenAPI document, so an operation
 * that exists and is not reachable fails the suite rather than quietly becoming a gap.
 */
test.describe.configure({ mode: "serial" });

async function operationIds(page: import("@playwright/test").Page): Promise<string[]> {
  const doc = await page.evaluate(async () => {
    const res = await fetch("/api/v1/openapi.json");
    return (await res.json()) as { paths: Record<string, Record<string, { operationId?: string }>> };
  });
  const ids: string[] = [];
  for (const item of Object.values(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (method === "parameters" || !op || typeof op !== "object") continue;
      if (op.operationId) ids.push(op.operationId);
    }
  }
  return ids.sort();
}

test("every operation in the OpenAPI document is listed in the explorer", async ({ page }) => {
  await page.goto("/#/api");
  await expect(page.locator("#apiList [data-op]").first()).toBeVisible({ timeout: 20_000 });

  const expected = await operationIds(page);
  const listed = (
    await page
      .locator("#apiList [data-op]")
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.op ?? ""))
  ).sort();

  expect(listed).toEqual(expected);
  expect(expected.length).toBeGreaterThan(20);
});

test("operations are grouped by tag and every entry carries a summary", async ({ page }) => {
  await page.goto("/#/api");
  await expect(page.locator(".dip-opgroup").first()).toBeVisible({ timeout: 20_000 });
  expect(await page.locator(".dip-opgroup__head").count()).toBeGreaterThan(3);
  for (const text of await page.locator("#apiList .dip-opsum").allTextContents()) {
    expect(text.trim().length, "every listed operation needs a summary").toBeGreaterThan(0);
  }
});

test("search narrows the list and the count says so", async ({ page }) => {
  await page.goto("/#/api");
  await expect(page.locator("#apiList [data-op]").first()).toBeVisible({ timeout: 20_000 });
  const total = await page.locator("#apiList [data-op]").count();
  await page.fill("#apiSearch", "jobs");
  await expect(page.locator("#apiCount")).toContainText("of", { timeout: 5_000 });
  const narrowed = await page.locator("#apiList [data-op]").count();
  expect(narrowed).toBeGreaterThan(0);
  expect(narrowed).toBeLessThan(total);
  // The filter is in the hash, so a filtered explorer is a link a colleague can be sent.
  await expect(page).toHaveURL(/q=jobs/);
});

test("a read-only operation can be tried against the live deployment", async ({ page }) => {
  await page.goto("/#/api?op=listDocuments");
  await expect(page.locator("#tryForm")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".dip-opdetail__title .arag-chip")).toHaveText("Read-only");

  await page.fill('[name="query:page_size"]', "5");
  await page.click('#tryForm button[type="submit"]');

  await expect(page.locator("#responseOut .arag-chip")).toContainText("200", { timeout: 20_000 });
  await expect(page.locator("#responseOut .arag-json")).toContainText("items");
});

test("a parameterised operation reports what it is missing instead of sending a broken call", async ({
  page,
}) => {
  await page.goto("/#/api?op=getDocument");
  await expect(page.locator("#tryForm")).toBeVisible({ timeout: 20_000 });
  await page.click('#tryForm button[type="submit"]');
  await expect(page.locator(".arag-toast")).toContainText("id", { timeout: 5_000 });
  await expect(page.locator("#responseOut")).toBeEmpty();
});

test("the curl updates as the form is filled and never contains a credential", async ({ page }) => {
  await page.goto("/#/api?op=listDocuments");
  await expect(page.locator("#curlOut")).toContainText("curl -i -X GET", { timeout: 20_000 });
  await page.fill('[name="query:q"]', "invoice");
  await expect(page.locator("#curlOut")).toContainText("q=invoice");

  await page.selectOption("#credMode", "apiKey");
  await page.fill("#credValue", "super-secret-key");
  await expect(page.locator("#curlOut")).toContainText("$API_KEY");
  await expect(page.locator("#curlOut")).not.toContainText("super-secret-key");
});

test("a destructive operation is confirmed before it is sent", async ({ page }) => {
  await page.goto("/#/api?op=deleteDocument");
  await expect(page.locator("#tryForm")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".dip-opdetail__title .arag-chip")).toHaveText("Destructive");
  await page.fill('[name="path:id"]', "does-not-exist");
  await page.click('#tryForm button[type="submit"]');

  const confirm = page.locator(".arag-confirm");
  await expect(confirm).toBeVisible({ timeout: 5_000 });
  // role="alertdialog" with focus on Cancel — the kit's behaviour, asserted here because
  // this is the one place the explorer can destroy data.
  await expect(confirm).toHaveAttribute("role", "alertdialog");
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(page.locator("#responseOut")).toBeEmpty();
});

test("the documented responses table is rendered from the spec", async ({ page }) => {
  await page.goto("/#/api?op=createDocument");
  await expect(page.locator(".dip-opdetail__responses tbody tr").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".dip-opdetail__responses")).toContainText("202");
});

test("the explorer is usable at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/api?op=listDocuments");
  await expect(page.locator("#tryForm")).toBeVisible({ timeout: 20_000 });
  // No horizontal overflow: the split stacks rather than scrolling the page sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
