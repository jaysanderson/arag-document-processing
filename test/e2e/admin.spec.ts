import { expect, test } from "@playwright/test";
import { DOC_TYPE_VALUES } from "../../src/types.ts";

const TOKEN = "e2e-admin-token";

test.describe.configure({ mode: "serial" });

test("admin: the sign-in is a door, and a wrong token says so plainly", async ({ page }) => {
  await page.goto("/admin/");
  await expect(page.locator(".arag-signin")).toBeVisible();
  // No navigation before sign-in: a nav the visitor cannot use is noise.
  await expect(page.locator(".arag-railnav")).toHaveCount(0);
  // The sign-in card is a door into a different product, so it keeps the wordmark.
  await expect(page.locator(".arag-signin .card img.wordmark")).toHaveAttribute(
    "src",
    "/ui/brand/arag-logo.svg",
  );

  await page.fill("#token", "nope");
  await page.click("#signin");
  await expect(page.locator(".arag-signin .error-slot")).toContainText("That token was not accepted.");

  // Enter must submit: a lone password input does not do this reliably without a form.
  await page.fill("#token", TOKEN);
  await page.press("#token", "Enter");
  await expect(page.locator(".arag-railnav")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".arag-railnav a")).toHaveCount(9);
  // Signed in, the wordmark is in the band only; the sidebar head is the operator identity.
  await expect(page.locator(".arag-rail .ident img")).toBeHidden();
  await expect(page.locator(".arag-rail .ident .name")).toHaveText("Operations");
  await expect(page.locator(".arag-rail .ident .tag")).toHaveText("Document Processing");
  expect(await page.locator('img[src*="arag-logo"]').count()).toBe(1);
});

test("admin: overview, connection and configs are an operator product", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/admin/");
  await page.fill("#token", TOKEN);
  await page.press("#token", "Enter");
  await expect(page.locator("h1")).toContainText("Overview", { timeout: 20_000 });
  await expect(page.locator(".arag-statstrip > *")).toHaveCount(6);
  await expect(page.locator(".arag-statstrip")).toContainText("Grounding");
  // Expected provisioning conflicts must never read as failures.
  await expect(page.locator(".arag-statstrip")).toContainText("expected conflicts");
  await expect(page.locator("body")).toContainText("Needs attention");

  await page.click('[data-nav="Connection"]');
  await expect(page.locator("h1")).toContainText("Connection");
  await expect(page.locator("table")).toContainText("dip_invoice_extraction");
  await page.click("#test");
  await expect(page.locator(".arag-toast")).toContainText("KB connected");
  // The stored configuration is readable without opening the ARAG dashboard.
  await page.click("tr[data-cfg] >> nth=0");
  await expect(page.locator(".arag-drawer")).toContainText("full_resource", { timeout: 20_000 });
  await expect(page.locator(".arag-drawer")).toContainText("answer_json_schema");
  await page.keyboard.press("Escape");

  await page.click('[data-nav="Configs"]');
  await expect(page.locator("table tbody tr")).toHaveCount(DOC_TYPE_VALUES.length);
  await page.click("#provAll");
  await expect(page.locator("#provResult")).toContainText("provisioned", { timeout: 30_000 });
  await expect(page.locator("#provResult")).toContainText("0 failed");
});

test("admin: jobs, logs, usage and branding", async ({ page }) => {
  test.setTimeout(120_000);
  // A job to look at, created through the public API so this spec stands alone.
  const upload = await page.request.post("/api/v1/documents?config=invoice", {
    headers: { "Content-Type": "text/plain", "X-Filename": "admin-e2e.txt" },
    data: "TAX INVOICE\nInvoice Number: INV-ADMIN-1\nTOTAL DUE: $10.00 AUD\n",
  });
  expect(upload.status()).toBe(202);

  await page.goto("/admin/");
  await page.fill("#token", TOKEN);
  await page.press("#token", "Enter");
  await expect(page.locator(".arag-railnav")).toBeVisible({ timeout: 20_000 });

  await page.click('[data-nav="Jobs"]');
  await expect(page.locator("tr[data-job]").first()).toBeVisible({ timeout: 20_000 });
  await page.click("tr[data-job] >> nth=0");
  await expect(page.locator(".arag-drawer .arag-steps li").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".arag-drawer")).toContainText("process-document");
  await page.keyboard.press("Escape");

  await page.click('[data-nav="Logs"]');
  await expect(page.locator("#logPane .line").first()).toBeVisible({ timeout: 20_000 });
  await page.click("#logPane .line >> nth=0");
  await expect(page.locator(".arag-drawer")).toContainText("level");
  await page.keyboard.press("Escape");
  // Cursor paging, not a tail: the range line is real and Newer is off at the head.
  await expect(page.locator(".arag-pagination .range")).toContainText("lines");
  await expect(page.locator("#logNewer")).toBeDisabled();
  await expect(page.locator("#logOlder")).toHaveAttribute("aria-label", "Show older log lines");

  // The contract the two buttons ride on, at a page size small enough to guarantee paging:
  // Older then Newer returns to exactly the window it came from, not to a re-query that
  // could land somewhere else because records arrived at the head meanwhile.
  const head = await (await page.request.get("/api/v1/admin/logs?limit=5")).json();
  expect(head.items.length).toBe(5);
  const older = await (
    await page.request.get(
      `/api/v1/admin/logs?limit=5&cursor=${encodeURIComponent(head.prevCursor)}&direction=older`,
    )
  ).json();
  expect(older.items.map((l: { ts: string }) => l.ts)).not.toEqual(
    head.items.map((l: { ts: string }) => l.ts),
  );
  const backAgain = await (
    await page.request.get(
      `/api/v1/admin/logs?limit=5&cursor=${encodeURIComponent(older.nextCursor)}&direction=newer`,
    )
  ).json();
  expect(backAgain.items.map((l: { ts: string }) => l.ts)).toEqual(
    head.items.map((l: { ts: string }) => l.ts),
  );

  await page.click('#logLevel button[data-value="warn"]');
  await expect(page).toHaveURL(/level=warn/);

  await page.click('[data-nav="Usage"]');
  await expect(page.locator(".arag-statstrip")).toContainText("ARAG calls");
  await expect(page.locator("body")).toContainText("Documents processed, last 14 days");
  await expect(page.locator(".dip-bar")).toHaveCount(14);

  await page.click('[data-nav="Branding"]');
  await expect(page.locator("body")).toContainText("BRAND_PRODUCT_NAME");
  await expect(page.locator("body")).toContainText("Document Processing");
  await expect(page.locator("body")).toContainText("never branded");
});

test("admin: security states the posture and purge is previewed before it is confirmed", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/admin/");
  await page.fill("#token", TOKEN);
  await page.press("#token", "Enter");
  await expect(page.locator(".arag-railnav")).toBeVisible({ timeout: 20_000 });
  await page.click('[data-nav="Security"]');

  await expect(page.locator("body")).toContainText("Always require a credential", { timeout: 20_000 });
  await expect(page.locator("body")).toContainText("API_KEYS");
  // The token is never echoed back to the panel that asked for it, and the admin-token row is
  // a write-only secret rather than a value.
  await expect(page.locator("body")).not.toContainText(TOKEN);
  await expect(page.locator('[data-key="security.adminToken"]')).toContainText("never shown");
  // Delete does not exist until a preview has stated the blast radius.
  await expect(page.locator("#purgeGo")).toHaveCount(0);

  await page.fill("#purgeDays", "0");
  await page.click("#purgePreview");
  await expect(page.locator("#purgeResult")).toContainText("would be deleted", { timeout: 20_000 });
  await expect(page.locator("#purgeResult")).toContainText("Nothing has been deleted");

  await page.click("#purgeGo");
  await expect(page.locator(".arag-confirm")).toBeVisible();
  // The confirm button stays disabled until the word is typed.
  await expect(page.locator(".arag-confirm [data-ok]")).toBeDisabled();
  await page.fill("#aragTyped", "DELETE");
  await expect(page.locator(".arag-confirm [data-ok]")).toBeEnabled();
  await page.click(".arag-confirm [data-ok]");
  await expect(page.locator("#purgeResult")).toContainText("Deleted", { timeout: 30_000 });
});

test("admin: the audit log names who changed what", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/admin/");
  await page.fill("#token", TOKEN);
  await page.press("#token", "Enter");
  await expect(page.locator(".arag-railnav")).toBeVisible({ timeout: 20_000 });
  await page.click('[data-nav="Audit"]');
  await expect(page.locator("h1")).toContainText("Audit", { timeout: 20_000 });
  // The purge above is a change, so the log is not empty and names the actor that made it.
  await expect(page.locator("#auditTable tbody tr").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#auditTable")).toContainText("admin token");
  await page.click("#auditTable tbody tr >> nth=0");
  await expect(page.locator(".arag-drawer")).toContainText("requestId");
  await page.keyboard.press("Escape");
  // Cursor paging, not a tail: the directional buttons are real, and at the head there is
  // nothing newer to show.
  await expect(page.locator("#auditNewer")).toBeDisabled();
});

test("admin: API docs are served (Redoc + Swagger + raw spec)", async ({ page }) => {
  const spec = await page.request.get("/api/v1/openapi.json");
  expect(spec.ok()).toBeTruthy();
  const doc = await spec.json();
  expect(doc.info.title).toBe("Document Processing API");
  expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(25);

  await page.goto("/api/v1/docs");
  await expect(page).toHaveTitle(/API reference/);
  await page.goto("/api/v1/swagger");
  await expect(page).toHaveTitle(/Swagger/i);
});
