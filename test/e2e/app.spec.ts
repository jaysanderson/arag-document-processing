import { expect, test } from "@playwright/test";

/**
 * The operator app end to end: first run → guided sample → the queue → the record and its
 * verified evidence → source → exports → ask → configs → settings.
 *
 * Selectors are the ones the showcase recording also uses, so a change that breaks the
 * walkthrough breaks this suite first.
 */
test.describe.configure({ mode: "serial" });

test("first run offers the guided sample and is honest about the mock Knowledge Box", async ({ page }) => {
  await page.goto("/#/welcome");
  await expect(page.locator("h1")).toContainText("Read every document the first time");
  await expect(page.locator(".arag-alert.warn")).toContainText("mock Knowledge Box");
  await expect(page.locator(".dip-sidenav a")).toHaveCount(5);
  await expect(page.locator('[data-nav="documents"]')).toContainText("Documents");
  // The Progress wordmark is the default, non-white-labelled brand.
  await expect(page.locator(".dip-bandmark img")).toHaveAttribute("src", "/brand/arag-logo-alt.svg");
  await expect(page.locator(".dip-brandmark img")).toHaveAttribute("src", "/brand/arag-logo.svg");
});

test("the guided sample processes a document and lands in the queue", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/#/welcome");
  await page.click("#startSample");
  await expect(page).toHaveURL(/#\/documents/, { timeout: 20_000 });
  // The tour is advisory, not a cage: the screen underneath stays usable.
  await expect(page.locator(".dip-tour__card")).toBeVisible();
  await page.click("[data-tour-end]");
  await expect(page.locator(".dip-tour__card")).toHaveCount(0);

  await expect(page.locator("#docsTable tbody tr")).not.toHaveCount(0, { timeout: 30_000 });
  const row = page.locator("#docsTable tbody tr").first();
  await expect(row).toContainText("invoice.txt");
  await expect(row.locator(".arag-chip")).toContainText("Ready", { timeout: 60_000 });
  // The row carries the document's own identity, not just the filename it arrived under.
  await expect(row.locator(".dip-datatable__sub")).toContainText("INV-2026-0042");
  await expect(page.locator("#strip .arag-kpi").first()).toContainText("Documents");
});

test("the record shows verified evidence, and the source tab locates every quote", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/#/documents?q=invoice.txt");
  await page.click("#docsTable .dip-datatable__primary >> nth=0");
  await expect(page.locator(".dip-grounding")).toBeVisible({ timeout: 20_000 });

  // Grounding is a claim with a denominator, never a bare percentage.
  await expect(page.locator(".dip-grounding__claim")).toContainText("of 12 fields carry a quote");
  await expect(page.locator(".dip-grounding__breakdown")).toContainText("exact");
  await expect(page.locator(".dip-grounding")).toHaveAttribute("data-band", "strong");

  // Field rows carry value, confidence and verification as three separate things.
  await expect(page.locator(".dip-field")).not.toHaveCount(0);
  await expect(page.locator("#field-invoice_number .dip-field__value")).toContainText("INV-2026-0042");
  await expect(
    page.locator("#field-invoice_number .dip-field__verify, #field-invoice_number .arag-chip"),
  ).toContainText("Verified");
  await page.click("#field-invoice_number .dip-field__evidence summary");
  await expect(page.locator("#field-invoice_number blockquote")).toContainText("INV-2026-0042");
  // Normalisation is shown, not hidden: the raw value sits beside the normalised one.
  await expect(page.locator("#field-invoice_date .dip-field__raw")).toContainText("raw");

  // Source & evidence: the quote is highlighted inside the document's own extracted text.
  await page.click('a[role="tab"]:has-text("Source & evidence")');
  await expect(page.locator(".dip-source__text")).toContainText("TAX INVOICE", { timeout: 20_000 });
  await expect(page.locator("mark.dip-hit")).not.toHaveCount(0);
  await page.click('.dip-source__item[data-ev="invoice_number"]');
  await expect(page.locator("mark.dip-hit.is-active")).toContainText("INV-2026-0042");

  // Pipeline: every stage, with a real duration.
  await page.click('a[role="tab"]:has-text("Pipeline")');
  for (const stage of ["process", "classify", "extract", "entities", "summary", "validate", "standardize"]) {
    await expect(page.locator("#tabPanel")).toContainText(stage);
  }
  await expect(page.locator("#tabPanel")).toContainText("Total");
});

test("exports download in three formats and the document answers a question", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/#/documents?q=invoice.txt");
  await page.click("#docsTable .dip-datatable__primary >> nth=0");
  await expect(page.locator(".dip-grounding")).toBeVisible({ timeout: 20_000 });

  const csv = page.waitForEvent("download");
  await page.click("#exportCsv");
  expect((await csv).suggestedFilename()).toBe("invoice.csv");

  await page.click('a[role="tab"]:has-text("Ask")');
  await page.fill("#askInput", "What is the total due?");
  await page.click("#askBtn");
  await expect(page.locator(".arag-bubble.assistant").last()).not.toContainText("Thinking", {
    timeout: 30_000,
  });
});

test("the list searches, filters, sorts and exports a selection in bulk", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/#/documents");
  await expect(page.locator("#docsTable tbody tr")).not.toHaveCount(0);

  // Search matches a value printed on the document, not only its filename.
  await page.fill("#q", "INV-2026-0042");
  await expect(page).toHaveURL(/q=INV-2026-0042/, { timeout: 10_000 });
  await expect(page.locator("#docsTable tbody tr")).not.toHaveCount(0);
  await expect(page.locator("#docsTable")).toContainText("invoice.txt");

  await page.fill("#q", "nothing-matches-this");
  await expect(page.locator(".dip-emptystate")).toContainText("No documents match these filters", {
    timeout: 10_000,
  });
  await page.click(".dip-emptystate button");
  await expect(page.locator("#docsTable tbody tr")).not.toHaveCount(0);

  // Sorting is a real query parameter, so a sorted queue is a shareable link.
  await page.click('[data-sort="grounding"]');
  await expect(page).toHaveURL(/sort=grounding/);

  // Bulk export of a selection.
  await page.click("#selectAll");
  await expect(page.locator("#bulkbar")).toBeVisible();
  await expect(page.locator("#docsTable tbody tr").first()).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".dip-bulkbar__count")).toContainText("selected");
  const bulk = page.waitForEvent("download");
  await page.click('[data-bulk="csv"]');
  expect((await bulk).suggestedFilename()).toMatch(/^documents-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("the upload drawer publishes the accepted types from the API and is a route", async ({ page }) => {
  await page.goto("/#/documents");
  await page.click("#uploadBtn");
  await expect(page.locator(".dip-drawer")).toBeVisible();
  await expect(page).toHaveURL(/#\/documents\/upload/);
  await expect(page.locator(".dip-drawer .arag-help").first()).toContainText("PDF");
  await expect(page.locator(".dip-drawer .arag-help").first()).toContainText("MB each");
  await expect(page.locator("#cfg option")).not.toHaveCount(0);
  await page.click(".dip-drawer [data-close]");
  await expect(page.locator(".dip-drawer")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/documents/);
});

test("configs list the built-ins and the field builder creates a custom config", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/#/configs");
  await expect(page.locator("h2").first()).toContainText("Built in");
  await expect(page.locator("table")).toContainText("dip_invoice_extraction");
  // documentCount answers "is anything using this?" before a delete.
  await expect(page.locator("tr[data-cfg='invoice'] .num").last()).not.toHaveText("0");

  await page.click('a[href="#/configs/new"]');
  await expect(page.locator("h1")).toContainText("New extraction config");
  await page.fill("#cfgName", "E2E Insurance Card");
  await page.fill(".dip-fieldrow .fld-label", "Policy Number");
  await page.click("#addField");
  await page.fill(".dip-fieldrow:nth-child(2) .fld-label", "Insurer");
  await expect(page.locator("#keyPreview")).toContainText("policy_number, insurer");
  await page.click("#saveCfg");

  await expect(page).toHaveURL(/#\/configs\/cfg_/, { timeout: 20_000 });
  await expect(page.locator("h1")).toContainText("E2E Insurance Card");
  await expect(page.locator(".arag-chip.ok")).toContainText("Ready");

  // Editing keeps the id, so meta.config on processed documents keeps resolving.
  const id = new URL(page.url()).hash.split("/").pop();
  await page.click(`a[href="#/configs/${id}/edit"]`);
  await page.fill("#cfgDesc", "Edited by the e2e suite");
  await page.click("#saveCfg");
  await expect(page).toHaveURL(new RegExp(`#/configs/${id}$`), { timeout: 20_000 });

  await page.click("#delCfg");
  await page.click(".dip-confirm [data-ok]");
  await expect(page).toHaveURL(/#\/configs$/, { timeout: 20_000 });
  await expect(page.locator("body")).not.toContainText("E2E Insurance Card");
});

test("settings answer what this deployment is connected to, without an admin token", async ({ page }) => {
  await page.goto("/#/settings/connection");
  await expect(page.locator("#panel")).toContainText("Knowledge Box");
  await expect(page.locator(".arag-alert.warn")).toContainText("mock Knowledge Box");
  await page.click('a[role="tab"]:has-text("Extraction")');
  await expect(page.locator("#panel")).toContainText("PDF");
  await page.click('a[role="tab"]:has-text("Branding")');
  await expect(page.locator("#panel")).toContainText("BRAND_PRODUCT_NAME");
  await expect(page.locator("#panel")).toContainText("never branded");
  await page.click('a[role="tab"]:has-text("API")');
  await expect(page.locator("#panel")).toContainText("openapi.json");
});

test("jobs are listed and a finished job explains itself in a drawer", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/#/jobs");
  await expect(page.locator("table tbody tr")).not.toHaveCount(0, { timeout: 20_000 });
  await page.uncheck("#auto");
  await page.click("table tbody tr");
  await expect(page.locator(".dip-drawer")).toBeVisible();
  await expect(page.locator(".dip-drawer")).toContainText("process-document");
  await expect(page.locator(".dip-drawer .arag-steps li").first()).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(page.locator(".dip-drawer")).toHaveCount(0);
});

test("ask is reachable on its own and scoped to one document", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/#/ask");
  await expect(page.locator("#docPick option")).not.toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".dip-pagehead__sub")).toContainText("no cross-document search");
  await page.click(".dip-suggestions button >> nth=0");
  await expect(page.locator(".arag-bubble.assistant").last()).not.toContainText("Thinking", {
    timeout: 30_000,
  });
});

test("extracted values are escaped before they reach the page", async ({ page }) => {
  // Field values, summaries and entity text are an LLM's reading of a document somebody
  // uploaded, so they are attacker-controlled. The list's subline renders the identifier
  // and the counterparty, which makes it the place an injection would land. The response
  // is stubbed rather than uploaded because the mock ARAG synthesises its own field values
  // from the fixture text and will not echo a payload back.
  const payload = '<img src=x onerror="window.__xss = true">';
  const now = new Date().toISOString();
  const doc = {
    id: "xss-probe",
    resourceId: "xss-probe",
    filename: "probe.txt",
    contentType: "text/plain",
    bytes: 10,
    status: "ready",
    docType: "invoice",
    fields: [
      { key: "vendor_name", label: "Vendor", value: payload, confidence: 0.9 },
      { key: "invoice_number", label: "Invoice #", value: payload, confidence: 0.9 },
    ],
    entities: [],
    tags: [],
    issues: [],
    evidence: [],
    meta: { processedAt: now, schema: "invoice_extraction", model: "test", durationsMs: {} },
    createdAt: now,
    updatedAt: now,
  };
  await page.route("**/api/v1/documents?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [doc],
        page: 1,
        page_size: 20,
        total: 1,
        next_page: false,
        facets: { total: 1, status: { ready: 1 }, docType: { invoice: 1 }, degraded: 0, needsReview: 0 },
      }),
    }),
  );
  await page.goto("/#/documents");
  await expect(page.locator("#docsTable tbody tr")).toHaveCount(1);
  // The payload is text, not markup: it is visible verbatim and no element was created.
  await expect(page.locator(".dip-datatable__sub").first()).toContainText(payload);
  expect(await page.locator("#docsTable img").count()).toBe(0);
  expect(await page.evaluate(() => "__xss" in window)).toBe(false);
});
