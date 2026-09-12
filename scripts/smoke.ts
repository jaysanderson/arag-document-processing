/**
 * OPT-IN live end-to-end smoke test against the real Knowledge Box.
 *
 *   make smoke                       # uses public/samples/invoice.txt
 *   node scripts/smoke.ts <file>     # any allowed document
 *
 * Boots the product in-process against the LIVE KB (never the mock), uploads the sample,
 * runs the full pipeline through a real job, prints the canonical record plus the JSON /
 * XML / CSV exports, then DELETES the resource so the demo KB stays clean (hard rule 6).
 *
 * Requires ARAG_KB_ID / ARAG_API_KEY / ARAG_REGION in the gitignored `.env`.
 * Never prints credentials.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createProduct } from "../src/server.ts";
import { serialize } from "../src/services/formats.ts";
import { assertAragEnv, Logger, loadDotEnv, readEnv } from "../vendor/arag-platform/src/index.ts";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

loadDotEnv();
process.env.ARAG_MOCK = "0";
const env = readEnv();
try {
  assertAragEnv(env);
} catch (err) {
  console.error(`\n✗ ${(err as Error).message}\n`);
  process.exit(2);
}

const file = resolve(process.argv[2] ?? "public/samples/invoice.txt");
if (!existsSync(file)) {
  console.error(`✗ file not found: ${file}`);
  process.exit(2);
}
const bytes = readFileSync(file);
const filename = basename(file);
const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

console.log(`ARAG KB   ${env.arag.kbId}`);
console.log(`endpoint  ${env.arag.baseUrl || `region ${env.arag.region}`}`);
console.log(`↑ upload  ${filename} (${bytes.length} bytes, ${contentType})\n`);

const product = await createProduct(env, {
  log: new Logger({ level: "warn" }),
  persist: false,
  provisionAtBoot: false,
});

let documentId: string | undefined;
let failed = false;
try {
  const health = await product.arag.health();
  if (!health.ok) throw new Error(`KB unreachable: ${health.error}`);
  console.log(`✓ KB connected in ${health.ms} ms · ${health.resources ?? "?"} resources\n`);

  console.log("· provisioning extraction configs as ARAG search configurations…");
  const provisioned = await product.provision();
  const failedCfgs = (provisioned as Array<{ ok: boolean }>).filter((p) => !p.ok).length;
  console.log(`  ${(provisioned as unknown[]).length} configs, ${failedCfgs} failed\n`);

  const { document, job } = await product.documents.create({
    bytes,
    filename,
    contentType,
    config: "auto",
  });
  documentId = document.id;
  console.log(`  resource ${document.resourceId}`);
  console.log(`  job      ${job.id}\n`);

  const unsub = product.jobs.subscribe(job.id, (e) => {
    if (e.stage === "job") return;
    const ev = e as { stage: string; status: string; ms?: number; message?: string };
    const tag = ev.status === "ok" ? "✓" : ev.status === "error" ? "✗" : ev.status === "skip" ? "–" : "·";
    const ms = ev.ms !== undefined ? ` (${ev.ms} ms)` : "";
    console.log(`  ${tag} ${ev.stage}${ms} ${ev.message ?? ""}`.trimEnd());
  });

  const finished = await waitForJob(job.id, 5 * 60_000);
  unsub();
  console.log(`\njob ${finished.status}`);
  if (finished.status !== "succeeded") {
    failed = true;
    console.error(`  ${finished.error?.message ?? "unknown error"}`);
  }

  const record = product.documents.get(document.id);
  if (!record) throw new Error("record vanished");
  console.log("\n=== CANONICAL RECORD (JSON) ===");
  console.log(serialize(record, "json"));
  console.log("\n=== XML ===");
  console.log(serialize(record, "xml"));
  console.log("\n=== CSV ===");
  console.log(serialize(record, "csv"));

  const answer = await product.documents.ask(document.id, "What is this document about?");
  console.log(`\n=== ASK ===\n${answer.answer}\n(${answer.ms} ms, sources: ${answer.sources.join(", ")})`);

  if (record.fields.length === 0) {
    failed = true;
    console.error("\n✗ no fields were extracted");
  }
} catch (err) {
  failed = true;
  console.error(`\n✗ smoke failed: ${(err as Error).message}`);
} finally {
  if (documentId) {
    await product.documents.delete(documentId);
    console.log(`\n🗑  deleted document + KB resource ${documentId}`);
  }
  await product.close();
}
process.exit(failed ? 1 : 0);

async function waitForJob(id: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = product.jobs.get(id);
    if (job && ["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("job did not finish within the smoke-test deadline");
}
