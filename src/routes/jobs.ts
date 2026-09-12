/**
 * Jobs are the async view of the pipeline. The SSE stream is a *view* of a job, not the
 * work itself: a client that disconnects stops receiving events, but the pipeline keeps
 * running and the finished record is still available at `/api/v1/documents/{id}`.
 */
import {
  type App,
  type JobManager,
  type JobStatus,
  notFound,
  operationSchemas,
} from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";

const TERMINAL = ["succeeded", "failed", "cancelled"];

export function registerJobRoutes(app: App, deps: { jobs: JobManager }): void {
  app.get(
    "/api/v1/jobs",
    (ctx) => ({
      items: deps.jobs.list({
        status: ctx.queryObj.status as JobStatus | undefined,
        ref: ctx.queryObj.ref as string | undefined,
        limit: Number(ctx.queryObj.limit ?? 50),
      }),
    }),
    { auth: "api", validate: operationSchemas(openapi, "/api/v1/jobs", "get"), operationId: "listJobs" },
  );

  app.get(
    "/api/v1/jobs/:id",
    (ctx) => {
      const job = deps.jobs.get(ctx.params.id!);
      if (!job) throw notFound("Job");
      return job;
    },
    { auth: "api", operationId: "getJob" },
  );

  app.delete(
    "/api/v1/jobs/:id",
    (ctx) => {
      if (!deps.jobs.get(ctx.params.id!)) throw notFound("Job");
      deps.jobs.cancel(ctx.params.id!);
      ctx.noContent();
    },
    { auth: "api", operationId: "cancelJob" },
  );

  app.get(
    "/api/v1/jobs/:id/events",
    (ctx) => {
      const job = deps.jobs.get(ctx.params.id!);
      if (!job) throw notFound("Job");
      const sse = ctx.sse();
      // Replay what already happened so a late subscriber still sees the whole pipeline.
      for (const e of job.events) sse.send("event", e);
      if (TERMINAL.includes(job.status)) {
        sse.send("job", { job });
        sse.close();
        return;
      }
      sse.send("job", { job });
      const unsub = deps.jobs.subscribe(job.id, (e) => {
        if (e.stage === "job") {
          sse.send("job", e);
          if (TERMINAL.includes((e as { status: string }).status)) sse.close();
        } else {
          sse.send("event", e);
        }
      });
      sse.onClose(unsub);
    },
    { auth: "api", noRateLimit: true, operationId: "jobEvents" },
  );
}
