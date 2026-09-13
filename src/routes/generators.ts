/**
 * HTTP surface for Data Augmentation generator agents — the alternative extraction path —
 * and for the comparison the record view renders against this product's own pipeline.
 *
 * Thin, like every route module here: everything that decides anything lives in
 * `services/generators.ts`.
 */
import { type App, notFound, operationSchemas } from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import type { GeneratorsService } from "../services/generators.ts";
import { requireWriter } from "./guards.ts";

export function registerGeneratorRoutes(app: App, deps: { generators: GeneratorsService }): void {
  /**
   * Start (or replace) the agent for a configuration. A writer credential, like every other
   * operation that provisions something in the Knowledge Box: an agent is a task ARAG will
   * schedule and bill for, not a read.
   */
  app.post(
    "/api/v1/extraction-configs/:id/generator",
    async (ctx) => {
      requireWriter(ctx);
      const { model } = (ctx.body ?? {}) as { model?: string };
      const agent = await deps.generators.start(ctx.params.id!, { model });
      ctx.json(202, agent);
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/extraction-configs/{id}/generator", "post"),
      operationId: "startConfigGenerator",
    },
  );

  app.get(
    "/api/v1/extraction-configs/:id/generator",
    async (ctx) => ({ agent: await deps.generators.status(ctx.params.id!) }),
    { auth: "api", operationId: "getConfigGenerator" },
  );

  app.post(
    "/api/v1/extraction-configs/:id/generator/stop",
    async (ctx) => {
      requireWriter(ctx);
      const agent = await deps.generators.stop(ctx.params.id!);
      if (!agent) throw notFound("Generator agent");
      return agent;
    },
    { auth: "api", operationId: "stopConfigGenerator" },
  );

  app.delete(
    "/api/v1/extraction-configs/:id/generator",
    async (ctx) => {
      requireWriter(ctx);
      if (!(await deps.generators.delete(ctx.params.id!))) throw notFound("Generator agent");
      ctx.noContent();
    },
    { auth: "api", operationId: "deleteConfigGenerator" },
  );

  /**
   * Run the agent over one document. Its own rate-limit bucket for the same reason `/ask`
   * has one: this starts real model work in the Knowledge Box.
   */
  app.post(
    "/api/v1/documents/:id/generator-run",
    async (ctx) => {
      requireWriter(ctx);
      const { model } = (ctx.body ?? {}) as { model?: string };
      const agent = await deps.generators.runForDocument(ctx.params.id!, { model });
      ctx.json(202, agent);
    },
    {
      auth: "api",
      rateLimit: { rps: 1, burst: 6 },
      validate: operationSchemas(openapi, "/api/v1/documents/{id}/generator-run", "post"),
      operationId: "runDocumentGenerator",
    },
  );

  app.get(
    "/api/v1/documents/:id/generator-comparison",
    async (ctx) => await deps.generators.compare(ctx.params.id!),
    { auth: "api", operationId: "compareDocumentGenerator" },
  );
}
