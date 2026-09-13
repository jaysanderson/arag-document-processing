/**
 * Capture the documentation screenshots at 1440 px, plus one 390 px responsive proof.
 *
 *   make shots          # boots a mock-backed server, seeds it, writes docs/screenshots/
 *   make shots SHOT=api # just the shots whose name contains "api"
 *
 * Deliberately a script and not a Playwright spec: these are documentation artefacts, not
 * assertions, and a failed screenshot must not read as a failing test suite. It is kept in
 * the repo (the previous pass used a throwaway `.shot-*.mjs`) so the next pass re-runs it
 * instead of rewriting it.
 *
 * Everything runs against the in-process mock Knowledge Box — no credentials, no LLM spend,
 * and the same fixtures every time, so a re-run produces the same pictures.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const PORT = Number(process.env.SHOT_PORT ?? 8499);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "docs/screenshots";
const DATA = "./data/shots";
const ADMIN_TOKEN = "shots-admin-token";
const ONLY = process.env.SHOT ?? "";

/** Documents seeded before anything is captured, in the order they should appear. */
const SEEDS: Array<[path: string, filename: string, contentType: string, config: string]> = [
  // The fixture whose subtotal and tax deliberately do not reconcile with the printed
  // total, so the validation, evidence and correction surfaces all have something real.
  ["showcase/fixtures/invoice-review.txt", "invoice-review.txt", "text/plain", "invoice"],
  ["public/samples/invoice.txt", "invoice.txt", "text/plain", "auto"],
  ["public/samples/contract.txt", "contract.txt", "text/plain", "auto"],
  ["public/samples/purchase-order.txt", "purchase-order.txt", "text/plain", "auto"],
  ["public/samples/bank-statement.txt", "bank-statement.txt", "text/plain", "auto"],
  ["public/samples/receipt.txt", "receipt.txt", "text/plain", "auto"],
  ["public/samples/resume.txt", "resume.txt", "text/plain", "auto"],
];

/**
 * Chromium composites `position: sticky` oddly in a full-page screenshot once the page is
 * taller than the viewport: the band can be painted twice and the rail's contents can
 * vanish. Pin both for the instant of the capture — the column keeps its background, so the
 * still looks exactly like the live screen.
 */
const PIN_STICKY =
  ".arag-appband{position:static!important}" + ".arag-rail{position:static!important;height:auto!important}";

async function wait(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await wait(150);
  }
  throw new Error(`server did not start on ${BASE}`);
}

async function seed(): Promise<void> {
  for (const [path, filename, contentType, config] of SEEDS) {
    const res = await fetch(`${BASE}/api/v1/documents?config=${config}`, {
      method: "POST",
      headers: { "Content-Type": contentType, "X-Filename": filename },
      body: new Uint8Array(readFileSync(path)),
    });
    if (!res.ok) throw new Error(`seed ${filename} failed: ${res.status}`);
    await wait(350);
  }
  // One image, so the visual-extraction path appears in the queue as well.
  await fetch(`${BASE}/api/v1/documents?config=preauthorisation`, {
    method: "POST",
    headers: { "Content-Type": "image/png", "X-Filename": "preauth-form.png" },
    body: new Uint8Array(readFileSync("public/samples/images/preauth-form.png")),
  });
  // Let the pipeline finish for every seed before anything is photographed: a record
  // caught mid-processing makes a screenshot that does not match its caption.
  for (let i = 0; i < 120; i++) {
    const stats = (await (await fetch(`${BASE}/api/v1/stats`)).json()) as {
      jobs?: Record<string, number>;
    };
    if ((stats.jobs?.queued ?? 0) + (stats.jobs?.running ?? 0) === 0) break;
    await wait(500);
  }
}

async function main(): Promise<void> {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const server = spawn(process.execPath, ["src/index.ts"], {
    env: {
      ...process.env,
      ENV_FILE: "/dev/null",
      ARAG_MOCK: "1",
      ADMIN_TOKEN,
      DATA_DIR: DATA,
      RATE_LIMIT_RPS: "0",
      LOG_LEVEL: "warn",
      PORT: String(PORT),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
  try {
    await waitForServer();
    await seed();

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

    const shotFor =
      (p: Page): Shot =>
      async (name: string, fullPage = true): Promise<void> => {
        if (ONLY && !name.includes(ONLY)) return;
        await p.waitForTimeout(600);
        const tag = await p.addStyleTag({ content: PIN_STICKY });
        await p.screenshot({ path: `${OUT}/${name}.png`, fullPage });
        await tag.evaluate((el) => (el as HTMLElement).remove());
        console.log("shot", name);
      };
    const shot = shotFor(page);

    const go = async (hash: string, ready: string): Promise<void> => {
      await page.goto(`${BASE}/${hash}`, { waitUntil: "networkidle" });
      await page.waitForSelector(ready, { timeout: 30_000 });
    };

    await captureApp(page, go, shot);

    // A fresh context for the operator console: the workspace capture above signs in as
    // operator, and that cookie would skip straight past the sign-in card this shot is of.
    const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const adminPage = await adminCtx.newPage();
    await captureAdmin(adminPage, shotFor(adminPage));
    await adminCtx.close();

    // The responsive proof: the rail collapses to a scrim drawer and the page never
    // scrolls sideways.
    const narrow = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const np = await narrow.newPage();
    await np.goto(`${BASE}/#/documents`, { waitUntil: "networkidle" });
    await np.waitForSelector("#docsTable tbody tr");
    if (!ONLY || "documents-390px".includes(ONLY)) {
      await np.screenshot({ path: `${OUT}/after-90-documents-390px.png`, fullPage: true });
      console.log("shot after-90-documents-390px");
    }
    await narrow.close();
  } finally {
    await browser.close();
    server.kill("SIGTERM");
    rmSync(DATA, { recursive: true, force: true });
  }
}

type Go = (hash: string, ready: string) => Promise<void>;
type Shot = (name: string, fullPage?: boolean) => Promise<void>;

async function captureApp(page: Page, go: Go, shot: Shot): Promise<void> {
  await go("#/welcome", "#startSample");
  await shot("after-00-welcome");

  await go("#/documents", "#docsTable tbody tr");
  await shot("after-01-documents");

  await page.click("#uploadBtn");
  await page.waitForSelector(".arag-drawer");
  await shot("after-02-upload-drawer", false);
  await page.keyboard.press("Escape");

  await go("#/documents?q=invoice-review", "#docsTable tbody tr");
  await page.click("#docsTable .cell-title >> nth=0");
  await page.waitForSelector(".dip-grounding", { timeout: 30_000 });
  await shot("after-03-document-record");

  const id = new URL(page.url()).hash.split("/")[2];
  await go(`#/documents/${id}/source`, ".dip-source");
  await shot("after-04-document-source");
  await go(`#/documents/${id}/pipeline`, "#tabPanel");
  await shot("after-05-document-pipeline");
  await go(`#/documents/${id}/ask`, "#askInput");
  await shot("after-06-document-ask");

  // The pass's headline capability: the values as the Knowledge Box now holds them.
  await go(`#/documents/${id}/json?view=kv`, "#jsonPane");
  await shot("after-07-document-keyvalues");
  await go(`#/documents/${id}/json`, "#jsonPane");
  await shot("after-08-document-json");

  await go("#/configs", ".arag-filterbar");
  await shot("after-09-configs");
  await go("#/configs/invoice", "#kvCard");
  await shot("after-10-config-keyvalue-schema");
  await go("#/configs/new", "#cfgName");
  await shot("after-11-config-builder");

  await go("#/jobs", ".arag-datatable tbody tr");
  await shot("after-12-jobs");

  await go("#/ask", "#askInput, form");
  await shot("after-13-ask");

  await go("#/api?op=listDocuments", "#tryForm");
  await shot("after-14-api-explorer");

  // Signed out first: the brief's rule is that a viewer can see every setting and where its
  // value came from, and only editing needs the operator.
  await go("#/settings/connection", "#panel");
  await shot("after-15-settings-locked");

  // Then signed in through the in-shell drawer, which is where the bar is actually met —
  // every setting editable, in place, in the same shell.
  await page.click("#signInTop");
  await page.waitForSelector(".arag-drawer");
  await page.fill("#opToken", ADMIN_TOKEN);
  await page.click("#opSubmit");
  await page.waitForSelector(".arag-drawer", { state: "detached", timeout: 30_000 });

  for (const [n, tab] of [
    ["16-settings-connection", "connection"],
    ["17-settings-branding", "branding"],
    ["18-settings-limits", "limits"],
    ["19-settings-keys", "keys"],
    ["20-settings-retention", "retention"],
  ] as const) {
    await go(`#/settings/${tab}`, "#panel");
    await shot(`after-${n}`);
  }
}

async function captureAdmin(page: Page, shot: Shot): Promise<void> {
  await page.goto(`${BASE}/admin/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".arag-signin");
  await shot("after-21-admin-signin", false);

  await page.fill("#token", ADMIN_TOKEN);
  await page.press("#token", "Enter");
  await page.waitForSelector(".arag-railnav", { timeout: 30_000 });
  await shot("after-22-admin-overview");

  for (const [n, nav] of [
    ["23-admin-connection", "Connection"],
    ["24-admin-configs", "Configs"],
    ["25-admin-logs", "Logs"],
    ["26-admin-audit", "Audit"],
    ["27-admin-security", "Security"],
  ] as const) {
    const item = page.locator(`[data-nav="${nav}"]`);
    if ((await item.count()) === 0) continue;
    await item.click();
    await page.waitForTimeout(900);
    await shot(`after-${n}`);
  }
}

await main();
