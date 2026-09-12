/**
 * Dependency audit gate for CI.
 *
 * `bun audit` exits non-zero for any advisory, but this repo pins `@playwright/test` to
 * 1.52.0 by organisation policy (the corporate registry blocks releases newer than about
 * two weeks), so a known dev-only advisory would permanently red the build. This script
 * fails on every high/critical advisory EXCEPT the ones explicitly accepted below, each
 * with a reason and an expiry — so an accepted risk is a visible, dated decision rather
 * than a silent `|| true`.
 *
 *   node scripts/audit.ts
 */
import { spawnSync } from "node:child_process";

interface Advisory {
  id: number;
  url?: string;
  title?: string;
  severity?: string;
  vulnerable_versions?: string;
}

/** package name → why the advisory is accepted, and when the decision must be revisited. */
const ACCEPTED: Record<string, { reason: string; review: string }> = {
  playwright: {
    reason:
      "CVE-2025-59288: `curl -k` in playwright-core's local browser-reinstall shell scripts. " +
      "Dev-only dependency; those scripts never run in CI or in the published image (which " +
      "has zero runtime dependencies). @playwright/test is pinned to 1.52.0 by org policy; " +
      "the fix lands in 1.55.1, which the corporate registry blocks.",
    review: "2026-12-01",
  },
};

const res = spawnSync("bun", ["audit", "--json"], { encoding: "utf8" });
const raw = (res.stdout ?? "").trim();
if (!raw) {
  console.log("bun audit: no advisories");
  process.exit(0);
}

let report: Record<string, Advisory[]>;
try {
  report = JSON.parse(raw) as Record<string, Advisory[]>;
} catch {
  console.error("bun audit produced output that is not JSON:\n", raw.slice(0, 2000));
  process.exit(1);
}

let failed = false;
for (const [pkg, advisories] of Object.entries(report)) {
  const accepted = ACCEPTED[pkg];
  for (const a of advisories) {
    const line = `${pkg}: ${a.url ?? a.id} (${a.severity ?? "unknown"})`;
    if (accepted) {
      console.log(`accepted  ${line}\n          ${accepted.reason}\n          review by ${accepted.review}`);
      if (Date.parse(accepted.review) < Date.now()) {
        console.error(`          EXPIRED — this acceptance was due for review on ${accepted.review}`);
        failed = true;
      }
    } else {
      console.error(`FAIL      ${line}\n          ${String(a.title ?? "").split("\n")[0]}`);
      failed = true;
    }
  }
}
process.exit(failed ? 1 : 0);
