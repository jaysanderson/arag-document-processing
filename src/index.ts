/** Entrypoint: load env, build the app, listen, shut down cleanly. */
import { assertAragEnv, loadDotEnv, log, readEnv } from "../vendor/arag-platform/src/index.ts";
import { createProduct } from "./server.ts";

loadDotEnv();
const env = readEnv();
log.level = env.logLevel;
assertAragEnv(env);

const product = await createProduct(env);
await product.app.listen();
log.info("product.started", {
  name: product.name,
  version: product.version,
  mock: env.arag.mock,
  port: env.port,
  dataDir: env.dataDir,
});

// A second SIGTERM while the first shutdown is draining must not start a second one:
// `product.close()` flushes stores and closes the server, and running it twice can truncate
// a half-written store file.
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  log.info("product.stopping");
  await product.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Node's default for either of these is to print and exit non-zero with nothing in the
// product's own log — so a crash in production would leave no record of itself where an
// operator looks. Log first, then let the platform restart the process.
process.on("unhandledRejection", (reason) => {
  log.error("process.unhandledRejection", { message: String((reason as Error)?.message ?? reason) });
});
process.on("uncaughtException", (err) => {
  log.error("process.uncaughtException", { message: err.message, stack: err.stack });
  void shutdown();
});
