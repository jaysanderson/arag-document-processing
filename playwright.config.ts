import { defineConfig } from "@playwright/test";

const port = Number(process.env.PW_PORT ?? 8181);
const showcase = Boolean(process.env.SHOWCASE);

export default defineConfig({
  testDir: showcase ? "showcase" : "test/e2e",
  timeout: 120_000,
  retries: 0,
  // The demo and admin specs share one mock-backed server (jobs, documents, configs are
  // global state, and the admin spec purges them), so they must not run in parallel.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.PW_CHANNEL ?? (process.env.CI ? undefined : "chrome"),
    video: showcase ? { mode: "on", size: { width: 1280, height: 800 } } : "retain-on-failure",
    screenshot: showcase ? "off" : "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
  },
  outputDir: showcase ? "showcase/out" : "test-results",
  webServer: {
    // Mock ARAG: deterministic, no credentials, no LLM spend. A short processing delay
    // makes the live pipeline visible (and recordable) rather than instantaneous.
    // ENV_FILE=/dev/null: never read the developer's .env. Without it a local run would
    // inherit real credentials and DIP_EXTRACT_STRATEGY, so the recording would differ
    // between machines and could put a real strategy id on screen.
    command:
      `ENV_FILE=/dev/null ARAG_MOCK=1 ADMIN_TOKEN=e2e-admin-token ` +
      `DATA_DIR=./data/${showcase ? "showcase" : "e2e"} ` +
      `LOG_LEVEL=info RATE_LIMIT_RPS=0 PORT=${port} node src/index.ts`,
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
