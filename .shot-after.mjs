import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
const BASE = "http://127.0.0.1:8499";
const OUT = "docs/screenshots";

// Seed a workspace that looks like a working queue, including the invoice whose totals
// deliberately do not reconcile so the validation and evidence surfaces have something to show.
const seeds = [
  ["showcase/fixtures/invoice-review.txt", "invoice-review.txt", "text/plain", "invoice"],
  ["public/samples/invoice.txt", "invoice.txt", "text/plain", "auto"],
  ["public/samples/contract.txt", "contract.txt", "text/plain", "auto"],
  ["public/samples/purchase-order.txt", "purchase-order.txt", "text/plain", "auto"],
  ["public/samples/bank-statement.txt", "bank-statement.txt", "text/plain", "auto"],
  ["public/samples/receipt.txt", "receipt.txt", "text/plain", "auto"],
];
for (const [path, name, ct, cfg] of seeds) {
  await fetch(`${BASE}/api/v1/documents?config=${cfg}`, {
    method: "POST",
    headers: { "Content-Type": ct, "X-Filename": name },
    body: readFileSync(path),
  });
  await new Promise((r) => setTimeout(r, 400));
}
const png = readFileSync("public/samples/images/preauth-form.png");
await fetch(`${BASE}/api/v1/documents?config=preauthorisation`, {
  method: "POST",
  headers: { "Content-Type": "image/png", "X-Filename": "preauth-form.png" },
  body: png,
});
await new Promise((r) => setTimeout(r, 9000));

const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));

const shot = async (name, full = true) => {
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("shot", name);
};

// 1. welcome (reachable any time from Settings → API)
await p.goto(`${BASE}/#/welcome`, { waitUntil: "networkidle" });
await shot("after-00-welcome");

// 2. documents queue
await p.goto(`${BASE}/#/documents`, { waitUntil: "networkidle" });
await p.waitForSelector("#docsTable tbody tr");
await shot("after-01-documents");

// 3. upload drawer
await p.click("#uploadBtn");
await p.waitForSelector(".dip-drawer");
await shot("after-02-upload-drawer", false);
await p.click(".dip-drawer [data-close]");

// 4. record
await p.goto(`${BASE}/#/documents?q=invoice-review`, { waitUntil: "networkidle" });
await p.click("#docsTable .dip-datatable__primary >> nth=0");
await p.waitForSelector(".dip-grounding");
await p.click("#field-total .dip-field__evidence summary").catch(() => {});
await shot("after-03-document-record");

// 5. source & evidence
await p.click('a[role="tab"]:has-text("Source & evidence")');
await p.waitForSelector(".dip-source__text");
await p.click('.dip-source__item[data-ev="total"]').catch(() => {});
await shot("after-04-document-source");

// 6. pipeline
await p.click('a[role="tab"]:has-text("Pipeline")');
await p.waitForSelector("#tabPanel table");
await shot("after-05-document-pipeline");

// 7. ask
await p.click('a[role="tab"]:has-text("Ask")');
await p.waitForSelector("#askInput");
await p.click(".dip-suggestions button >> nth=0");
await p.waitForTimeout(3500);
await shot("after-06-document-ask");

// 8. configs + builder
await p.goto(`${BASE}/#/configs`, { waitUntil: "networkidle" });
await p.waitForSelector("table");
await shot("after-07-configs");
await p.goto(`${BASE}/#/configs/new`, { waitUntil: "networkidle" });
await p.fill("#cfgName", "Insurance Card");
await p.fill(".dip-fieldrow .fld-label", "Insurer");
await p.click("#addField");
await p.fill(".dip-fieldrow:nth-child(2) .fld-label", "Member number");
await shot("after-08-config-builder");

// 9. jobs
await p.goto(`${BASE}/#/jobs`, { waitUntil: "networkidle" });
await p.waitForSelector("table tbody tr");
await p.uncheck("#auto");
await shot("after-09-jobs");

// 10. settings
await p.goto(`${BASE}/#/settings/connection`, { waitUntil: "networkidle" });
await p.waitForSelector("#panel .arag-kv");
await shot("after-10-settings-connection");
await p.goto(`${BASE}/#/settings/branding`, { waitUntil: "networkidle" });
await p.waitForSelector("#panel");
await shot("after-11-settings-branding");

// 11. admin
await p.goto(`${BASE}/admin/`, { waitUntil: "networkidle" });
await shot("after-12-admin-signin");
await p.fill("#token", "e2e-admin-token");
await p.press("#token", "Enter");
await p.waitForSelector(".dip-sidenav");
await p.waitForTimeout(2000);
await shot("after-13-admin-overview");
await p.click('[data-nav="connection"]');
await p.waitForSelector("table");
await shot("after-14-admin-connection");
await p.click('[data-nav="logs"]');
await p.waitForSelector("tr[data-line]");
await shot("after-15-admin-logs");
await p.click('[data-nav="security"]');
await p.waitForSelector("#days");
await shot("after-16-admin-security");

// 12. responsive proof at 600 px
const mobile = await (await b.newContext({ viewport: { width: 600, height: 900 } })).newPage();
await mobile.goto(`${BASE}/#/documents`, { waitUntil: "networkidle" });
await mobile.waitForTimeout(1500);
await mobile.screenshot({ path: `${OUT}/after-17-documents-600px.png`, fullPage: true });
console.log("shot after-17-documents-600px");

await b.close();
