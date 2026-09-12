/**
 * Regenerate `docs/developer/api-reference.md` from `src/openapi.ts` — no running server
 * needed, so `make docs` is deterministic and works in CI.
 *
 *   node scripts/gen-api-reference.ts [out.md]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openapi } from "../src/openapi.ts";

const out = resolve(process.argv[2] ?? "docs/developer/api-reference.md");
const tmp = resolve(dirname(out), ".openapi.generated.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(tmp, JSON.stringify(openapi, null, 2));

const { spawnSync } = await import("node:child_process");
const gen = resolve(import.meta.dirname ?? ".", "..", "vendor/arag-platform/scripts/openapi-to-md.ts");
const res = spawnSync(process.execPath, [gen, tmp, out], { stdio: "inherit" });
if (res.status !== 0) process.exit(res.status ?? 1);

const { unlinkSync } = await import("node:fs");
unlinkSync(tmp);
console.log(`wrote ${out}`);
