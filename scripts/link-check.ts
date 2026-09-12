/**
 * Check every relative Markdown link in the repo's documentation.
 *
 *   node scripts/link-check.ts
 *
 * Only relative targets are checked — external URLs are not fetched (CI must not depend on
 * the network, and a link checker that hits the internet is a flaky test). Anchors are
 * stripped: this verifies that the file exists, not that the heading does.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const DIRS = ["docs", "enablement", "showcase"];
const ROOT_FILES = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "DECISIONS.md",
  "AUDIT.md",
  "CODE_OF_CONDUCT.md",
];
const SKIP_DIR = /^(node_modules|\.git|out|data)$/;
const EXTERNAL = /^(https?:|mailto:|tel:|#|data:)/;
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR.test(entry.name)) walk(p, out);
    } else if (entry.name.endsWith(".md")) {
      out.push(p);
    }
  }
}

const files: string[] = [];
for (const d of DIRS) if (existsSync(d)) walk(d, files);
for (const f of ROOT_FILES) if (existsSync(f)) files.push(f);

let checked = 0;
const broken: string[] = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(LINK)) {
    const href = match[1]!;
    if (EXTERNAL.test(href)) continue;
    const target = href.split("#")[0];
    if (!target) continue;
    checked++;
    if (!existsSync(resolve(dirname(file), decodeURIComponent(target)))) {
      broken.push(`${file} -> ${href}`);
    }
  }
}

for (const b of broken) console.error(`BROKEN  ${b}`);
console.log(`${files.length} markdown files, ${checked} relative links, ${broken.length} broken`);
process.exit(broken.length ? 1 : 0);
