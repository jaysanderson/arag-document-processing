/**
 * Jobs are the async view of the pipeline. The SSE stream is a *view* of a job, not the
 * work itself: a client that disconnects stops receiving events, but the pipeline keeps
 * running and the finished record is still available at `/api/v1/documents/{id}`.
 */
import {
  type App,
  conflict,
  type Job,
  type JobManager,
  type JobStatus,
  notFound,
  operationSchemas,
} from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import { requireWriter } from "./guards.ts";

const TERMINAL = ["succeeded", "failed", "cancelled"];

/** How long a job ran (or has been running) — what "sort by duration" means. */
function elapsed(j: Job): number {
  return (j.finishedAt ? Date.parse(j.finishedAt) : Date.now()) - Date.parse(j.createdAt);
}

function compareJobs(key: string, a: Job, b: Job): number {
  if (key === "duration") return elapsed(a) - elapsed(b);
  if (key === "status") return a.status.localeCompare(b.status) || a.createdAt.localeCompare(b.createdAt);
  return a.createdAt.localeCompare(b.createdAt);
}

export function registerJobRoutes(app: App, deps: { jobs: JobManager }): void {
  app.get(
    "/api/v1/jobs",
    (ctx) => {
      // `limit` stays for compatibility; `page`/`page_size` is what a jobs screen needs —
      // without paging, a deployment that has run 200 documents shows 50 jobs and no way to
      // reach the rest.
      const pageSize = Number(ctx.queryObj.page_size ?? ctx.queryObj.limit ?? 50);
      const page = Number(ctx.queryObj.page ?? 1);
      const q = String(ctx.queryObj.q ?? "")
        .trim()
        .toLowerCase();
      const all = deps.jobs
        .list({ status: ctx.queryObj.status as JobStatus | undefined, ref: ctx.queryObj.ref as string })
        .filter((j) => !q || `${j.id} ${j.kind} ${j.ref ?? ""}`.toLowerCase().includes(q));
      const dir = ctx.queryObj.order === "asc" ? 1 : -1;
      const sort = String(ctx.queryObj.sort ?? "created_at");
      all.sort((a, b) => dir * compareJobs(sort, a, b));
      return {
        items: all.slice((page - 1) * pageSize, page * pageSize),
        page,
        page_size: pageSize,
        total: all.length,
        next_page: page * pageSize < all.length,
      };
    },
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
      requireWriter(ctx);
      const job = deps.jobs.get(ctx.params.id!);
      if (!job) throw notFound("Job");
      // `cancel()` is a no-op on a finished job; say so rather than report success for
      // something that did not happen.
      if (!deps.jobs.cancel(job.id)) {
        throw conflict(`Job ${job.id} already ${job.status} and cannot be cancelled`);
      }
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
    // An SSE *open* costs a token from its own generous bucket (the stream itself is never
    // throttled): a demo that watches several pipelines at once must not trip the shared
    // public limit, but an anonymous client still cannot hold unbounded concurrent streams.
    { auth: "api", rateLimit: { rps: 2, burst: 30 }, operationId: "jobEvents" },
  );
}
