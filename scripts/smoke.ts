/**
 * End-to-end smoke test against the live KB.
 *
 *   make smoke                 # uses the bundled sample invoice
 *   make smoke ARGS=path.pdf   # not wired through make; run node directly for a custom file:
 *   node --experimental-transform-types scripts/smoke.ts [path-to-file]
 *
 * Uploads a document, runs the full pipeline, prints the canonical record plus the
 * JSON / XML / CSV exports, then deletes the resource to keep the demo KB clean.
 */

import { readFileSync, existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { assertConfig } from "../bridge/src/config.ts";
import { upload, deleteResource } from "../bridge/src/arag.ts";
import { runPipeline } from "../bridge/src/pipeline.ts";
import { serialize } from "../bridge/src/formats.ts";
import type { StageEvent } from "../bridge/src/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function guessType(name: string): string {
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

async function main(): Promise<void> {
  assertConfig();
  const arg = process.argv[2];
  const filePath = arg
    ? resolve(arg)
    : resolve(__dirname, "..", "samples", "sample-invoice.txt");
  if (!existsSync(filePath)) throw new Error(`file not found: ${filePath}`);

  const bytes = readFileSync(filePath);
  const filename = basename(filePath);
  const contentType = guessType(filename);
  console.log(`↑ uploading ${filename} (${bytes.length} bytes, ${contentType})`);

  const { resourceId } = await upload(new Uint8Array(bytes), filename, contentType);
  console.log(`  resource: ${resourceId}`);

  const emit = (e: StageEvent) => {
    const tag = e.status === "ok" ? "✓" : e.status === "error" ? "✗" : "·";
    const ms = e.ms !== undefined ? ` (${e.ms}ms)` : "";
    console.log(`  ${tag} ${e.stage}${ms} ${e.message ?? ""}`);
  };

  try {
    const record = await runPipeline({ resourceId, filename, contentType }, emit);
    console.log("\n=== CANONICAL RECORD (JSON) ===");
    console.log(serialize(record, "json"));
    console.log("\n=== XML ===");
    console.log(serialize(record, "xml"));
    console.log("\n=== CSV ===");
    console.log(serialize(record, "csv"));
  } finally {
    await deleteResource(resourceId);
    console.log(`\n🗑  deleted resource ${resourceId}`);
  }
}

main().catch((err) => {
  console.error("smoke failed:", (err as Error).message);
  process.exit(1);
});
