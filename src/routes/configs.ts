/** HTTP surface for extraction configurations and the schema catalogue. */
import { type App, conflict, notFound, operationSchemas } from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import type { ConfigsService } from "../services/configs.ts";
import type { CustomConfigInput } from "../services/schemas.ts";
import { DOC_TYPES, SCHEMAS, schemaToFields } from "../services/schemas.ts";
import { requireWriter } from "./guards.ts";

export function registerConfigRoutes(app: App, deps: { configs: ConfigsService }): void {
  app.get("/api/v1/extraction-configs", () => ({ items: deps.configs.list() }), {
    auth: "api",
    operationId: "listExtractionConfigs",
  });

  app.post(
    "/api/v1/extraction-configs",
    async (ctx) => {
      // Creating a config provisions a stored search configuration in the Knowledge Box —
      // a write to shared state, so it needs the same credential as the deletes.
      requireWriter(ctx);
      const created = await deps.configs.create(ctx.body as CustomConfigInput);
      ctx.json(201, created, { Location: `/api/v1/extraction-configs/${created.id}` });
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/extraction-configs", "post"),
      operationId: "createExtractionConfig",
    },
  );

  app.get(
    "/api/v1/extraction-configs/:id",
    (ctx) => {
      const cfg = deps.configs.get(ctx.params.id!);
      if (!cfg) throw notFound("Extraction config");
      return cfg;
    },
    { auth: "api", operationId: "getExtractionConfig" },
  );

  app.delete(
    "/api/v1/extraction-configs/:id",
    async (ctx) => {
      requireWriter(ctx);
      const outcome = await deps.configs.delete(ctx.params.id!);
      if (outcome === "not-found") throw notFound("Extraction config");
      if (outcome === "builtin") throw conflict("Built-in extraction configurations cannot be deleted");
      ctx.noContent();
    },
    { auth: "api", operationId: "deleteExtractionConfig" },
  );

  // The schema catalogue is the "what can this product extract?" answer: every document
  // type with the fields its built-in extraction schema captures.
  app.get(
    "/api/v1/schemas",
    () => ({
      items: DOC_TYPES.map((dt) => {
        const schema = SCHEMAS[dt];
        return {
          name: schema.name,
          docType: schema.docType,
          description: schema.description,
          required: schema.required,
          fields: schemaToFields(schema),
        };
      }),
    }),
    { auth: "api", operationId: "listSchemas" },
  );
}
