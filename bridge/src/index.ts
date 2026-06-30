/**
 * Entrypoint. Validates config, starts the HTTP server.
 */

import { config, assertConfig, kbId } from "./config.ts";
import { buildServer } from "./server.ts";
import { log } from "./logger.ts";

function main(): void {
  assertConfig();
  const server = buildServer();
  server.listen(config.port, "0.0.0.0", () => {
    log.info("bridge.listening", {
      port: config.port,
      kb: kbId(),
      model: config.generativeModel,
      url: `http://localhost:${config.port}`,
    });
  });
}

try {
  main();
} catch (err) {
  log.error("bridge.fatal", { message: (err as Error).message });
  process.exit(1);
}
