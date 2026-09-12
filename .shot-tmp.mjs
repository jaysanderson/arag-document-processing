import { chromium } from "@playwright/test";
const b = await chromium.launch({ channel: "chrome" });
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
await p.addInitScript(() => {
  window.addEventListener("unhandledrejection", (e) => console.log("UNHANDLED:", e.reason?.message ?? String(e.reason)));
});
p.on("console", (m) => console.log("C:", m.text()));
await p.goto("http://127.0.0.1:8499/admin/", { waitUntil: "networkidle" });
await p.fill("#token", "e2e-admin-token");
await p.press("#token", "Enter");
await p.waitForSelector(".dip-sidenav");
await p.click('[data-nav="configs"]');
await p.waitForSelector("#provAll");
await p.waitForTimeout(400);
await p.evaluate(() => document.querySelector("#provAll").click());
await p.waitForTimeout(6000);
console.log("provResult:", JSON.stringify(await p.locator("#provResult").innerHTML()));
await b.close();
