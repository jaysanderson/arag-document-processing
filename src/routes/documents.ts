/** HTTP surface for documents. Thin: all logic lives in `services/documents.ts`. */
import {
  type App,
  badRequest,
  HttpError,
  notFound,
  operationSchemas,
  parseMultipart,
  type UploadedFile,
} from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import type { DocumentsService } from "../services/documents.ts";
import type { Format } from "../services/formats.ts";
import { requireWriter } from "./guards.ts";

const FORMATS = new Set(["json", "xml", "csv"]);

export function registerDocumentRoutes(app: App, deps: { documents: DocumentsService }): void {
  app.get(
    "/api/v1/documents",
    (ctx) =>
      deps.documents.list({
        page: Number(ctx.queryObj.page ?? 1),
        pageSize: Number(ctx.queryObj.page_size ?? 50),
        status: ctx.queryObj.status as string | undefined,
        docType: ctx.queryObj.doc_type as string | undefined,
      }),
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/documents", "get"),
      operationId: "listDocuments",
    },
  );

  app.post(
    "/api/v1/documents",
    async (ctx) => {
      // Two accepted shapes: multipart/form-data with a `file` part, or a raw body with an
      // X-Filename header (what `curl --data-binary` and the demo's dropzone send).
      //
      // The multipart body is parsed here rather than by the platform's `body: "auto"`
      // path: that path lowercases the Content-Type before handing it to `parseMultipart`,
      // which destroys mixed-case boundaries (`----WebKitFormBoundaryAbC…`) and silently
      // yields zero parts for every browser upload. Platform bug — reported upstream.
      const contentType = ctx.header("content-type") ?? "";
      let fields: Record<string, string> = {};
      let file: UploadedFile | undefined;
      if (contentType.toLowerCase().startsWith("multipart/form-data")) {
        try {
          const parsed = parseMultipart(ctx.rawBody ?? Buffer.alloc(0), contentType);
          fields = parsed.fields;
          file = parsed.files.find((f) => f.field === "file") ?? parsed.files[0];
        } catch (err) {
          // The platform's parser calls decodeURIComponent on the part filename without a
          // guard, so `filename="100%"` throws a raw URIError that would surface as a 500.
          if (err instanceof HttpError) throw err;
          throw badRequest(`Could not parse the multipart body: ${(err as Error).message}`);
        }
      }
      const bytes = file ? file.data : ctx.rawBody;
      if (!bytes || bytes.length === 0) {
        throw badRequest(
          "Send a multipart/form-data body with a `file` part, or a raw body with an X-Filename header.",
        );
      }
      const config = String(ctx.query.get("config") ?? fields.config ?? "auto");
      const out = await deps.documents.create({
        bytes,
        filename: file?.filename ?? ctx.header("x-filename"),
        contentType: file?.contentType ?? contentType,
        config,
      });
      ctx.json(202, out, { Location: `/api/v1/documents/${out.document.id}` });
    },
    {
      auth: "api",
      body: "raw",
      validate: operationSchemas(openapi, "/api/v1/documents", "post"),
      operationId: "createDocument",
    },
  );

  app.get("/api/v1/documents/:id", (ctx) => deps.documents.require(ctx.params.id!), {
    auth: "api",
    operationId: "getDocument",
  });

  app.get(
    "/api/v1/documents/:id/export",
    (ctx) => {
      const format = String(ctx.queryObj.format ?? "json");
      if (!FORMATS.has(format)) throw badRequest(`format must be one of ${[...FORMATS].join(", ")}`);
      const out = deps.documents.export(ctx.params.id!, format as Format);
      ctx.text(200, out.body, out.contentType, {
        "Content-Disposition": `attachment; filename="${out.filename}"`,
      });
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/documents/{id}/export", "get"),
      operationId: "exportDocument",
    },
  );

  app.post(
    "/api/v1/documents/:id/ask",
    (ctx) => {
      const { question } = ctx.body as { question: string };
      return deps.documents.ask(ctx.params.id!, question.trim());
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/documents/{id}/ask", "post"),
      operationId: "askDocument",
    },
  );

  app.delete(
    "/api/v1/documents/:id",
    async (ctx) => {
      requireWriter(ctx);
      if (!(await deps.documents.delete(ctx.params.id!))) throw notFound("Document");
      ctx.noContent();
    },
    { auth: "api", operationId: "deleteDocument" },
  );
}
