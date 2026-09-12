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

const shutdown = async () => {
  log.info("product.stopping");
  await product.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
