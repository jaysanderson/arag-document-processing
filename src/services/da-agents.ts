/**
 * Data Augmentation generator agents that write key-value fields.
 *
 * `services/agents.ts` runs the product's *synchronous* extraction: a `/ask` call per
 * document, answered by the visual LLM against `answer_json_schema`, returned inline. This
 * module is the asynchronous counterpart — an ARAG-side **task** that the platform schedules
 * and runs on its own, extracting structured values out of resources and persisting them as
 * kv fields on those resources. Nothing has to be asked for a second time afterwards: the
 * values live on the resource and are filterable (see `kvFilter` in `services/kv.ts`).
 *
 * The generator agent is the task named `ask`. It becomes a *key-value* generator — rather
 * than one that writes a JSON text field — by setting `store_as_key_value: true` and naming
 * the kv schema in `kv_schema_id`. The kv schema's own `description` and its per-field
 * `description` values are what steer the extraction, so `schemaToKvSchema()` carrying the
 * product's field descriptions across is what makes the agent useful.
 *
 * Live lifecycle, verified against the Knowledge Box on 2026-09-13 (captures in
 * docs/architecture/arag-integration.md):
 *
 *   POST /kb/{kb}/task/start   → { name, status: "started", id }
 *   GET  /kb/{kb}/tasks        → { tasks[], configs[], running[], done[] }
 *   DELETE /kb/{kb}/task/{id}  → removes the task
 *
 * Two sharp edges the public docs do not mention, both verified:
 *   - with `json: true` the `question` must itself BE the JSON schema, serialised as a
 *     string. A plain-English question returns
 *     `422 {"detail": "Invalid JSON schema. Reason: Expecting value…"}`.
 *   - `GET /kb/{kb}/task/{id}` is 405; a single task is inspected by finding its id in the
 *     buckets of `GET /kb/{kb}/tasks`.
 */
import type { AragClient, HttpError, Logger } from "../../vendor/arag-platform/src/index.ts";
import { AragError, conflict } from "../../vendor/arag-platform/src/index.ts";
import type { KvData, KvSchemaMapping, KvService, KvValue } from "./kv.ts";
import type { ExtractionSchema } from "./schemas.ts";

/** `ApplyTo`: 0 = text blocks (paragraphs), 1 = whole fields. `ask` supports only 1. */
export const APPLY_TO_FIELD = 1;
export const APPLY_TO_TEXT_BLOCK = 0;

/** Narrows which resources/fields a task touches. An empty filter sweeps the whole KB. */
export interface DaFilter {
  /** Only these resource ids. The safest way to keep a task from sweeping the KB. */
  rids?: string[];
  /** Only fields of these types, e.g. `["text"]`, `["file"]`. */
  field_types?: string[];
  not_field_types?: string[];
  /** Only fields whose text contains these strings. */
  contains?: string[];
  resource_type?: string[];
  fields?: string[];
  labels?: string[];
  /** Also process fields written by other DA agents (default false). */
  apply_to_agent_generated_fields?: boolean;
}

/**
 * Which resources a task is applied to. **A query parameter, not a body field** — sending it
 * in `parameters` is silently ignored, which is the difference between a run that reads the
 * document and one that does nothing at all.
 *
 *   - `EXISTING` — resources already in the Knowledge Box. What a run over an uploaded
 *     document needs, and the value captured in the verified request.
 *   - `NEW` — only resources ingested after the task starts. The platform default, and the
 *     reason an un-parameterised run over an existing rid is a no-op.
 *   - `ALL` — both.
 */
export type DaApplyTo = "EXISTING" | "NEW" | "ALL";

export interface GeneratorTaskOptions {
  /** Task name as it appears in the ARAG dashboard. */
  name: string;
  /** kv schema id the generated JSON must conform to, and the field it is written into. */
  kvSchemaId: string;
  /** The JSON schema the model is forced to fill — serialised into `question`. */
  jsonSchema: unknown;
  filter?: DaFilter;
  /** Generative model, e.g. `chatgpt-azure-4o`. Defaults to the configured one. */
  model?: string;
  /** Field id the output is written to. Defaults to `kvSchemaId`. */
  destination?: string;
  /**
   * Which resources to apply to. Defaults to `EXISTING`, because every run this product
   * starts is over documents it has already ingested; the platform's own default is `NEW`,
   * which would make such a run a silent no-op. Pass `ALL` for a standing agent that should
   * also pick up documents uploaded after it started.
   */
  apply?: DaApplyTo;
}

export interface DaTaskRun {
  id: string;
  name?: string;
  completed?: boolean;
  failed?: boolean;
  stopped?: boolean;
  scheduled?: boolean;
  retries?: number;
  scheduled_at?: string | null;
  completed_at?: string | null;
  parameters?: Record<string, unknown>;
}

export interface DaTasksSnapshot {
  /** Persistent task configurations. */
  configs: DaTaskRun[];
  /** Runs in flight. */
  running: DaTaskRun[];
  /** Finished runs. */
  done: DaTaskRun[];
}

/** Where a generator run got to. `absent` means the id is in no bucket (deleted or never was). */
export type DaTaskState = "running" | "done" | "failed" | "stopped" | "absent";

export interface DaAgentsDeps {
  arag: AragClient;
  kv: KvService;
  log: Logger;
  generativeModel: string;
  /** ARAG_MOCK=1 — the vendored mock has no task routes, so they are simulated in memory. */
  mock?: boolean;
}

/**
 * Build the `question` payload for a kv generator.
 *
 * `json: true` makes ARAG parse `question` as an OpenAI-function-style JSON schema, so the
 * schema is serialised into it. The kv schema's field descriptions should match this
 * schema's property descriptions — both are read by the model.
 */
export function generatorQuestion(jsonSchema: unknown): string {
  return JSON.stringify(jsonSchema);
}

/**
 * Body for `POST /kb/{kb}/task/start` that provisions a kv-writing generator agent.
 * Exported (and pure) so it can be asserted in tests without touching the network.
 */
export function toGeneratorTaskBody(
  opts: GeneratorTaskOptions,
  defaults: { model: string },
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(opts.filter ?? {})) {
    if (v !== undefined) filter[k] = v;
  }
  return {
    name: "ask",
    parameters: {
      name: opts.name,
      // `ask` agents only support ApplyTo.FIELD; the platform enforces this.
      on: APPLY_TO_FIELD,
      filter,
      operations: [
        {
          ask: {
            question: generatorQuestion(opts.jsonSchema),
            destination: opts.destination ?? opts.kvSchemaId,
            json: true,
            store_as_key_value: true,
            kv_schema_id: opts.kvSchemaId,
          },
        },
      ],
      llm: { model: opts.model || defaults.model },
    },
  };
}

/**
 * Derive the JSON schema a generator agent should be given from a kv schema mapping.
 * Descriptions are the whole point — they are the extraction instructions.
 */
export function mappingToJsonSchema(mapping: KvSchemaMapping, description?: string): unknown {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of mapping.schema.fields) {
    const prop: Record<string, unknown> = { type: jsonTypeFor(field.type, field.repeated === true) };
    if (field.repeated) prop.items = { type: "string" };
    if (field.description) prop.description = field.description;
    properties[field.key] = prop;
    if (field.required) required.push(field.key);
  }
  return {
    name: mapping.schema.id,
    description: description ?? mapping.schema.description ?? `Fields for ${mapping.schema.id}`,
    parameters: { type: "object", properties, required },
  };
}

function jsonTypeFor(type: string, repeated: boolean): string {
  if (repeated) return "array";
  switch (type) {
    case "integer":
      return "integer";
    case "float":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "string";
  }
}

export class DaAgents {
  private readonly d: DaAgentsDeps;
  /** Mock-mode only: task id → run record. */
  private readonly mockTasks = new Map<string, DaTaskRun>();

  constructor(deps: DaAgentsDeps) {
    this.d = deps;
  }

  private get mocked(): boolean {
    return this.d.mock === true;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      const res = await this.d.arag.request(method, path, {
        body: body === undefined ? null : JSON.stringify(body),
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
      });
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    } catch (err) {
      throw asTaskConflict(err) ?? err;
    }
  }

  /**
   * Provision a generator agent for an extraction config: ensure the kv schema exists,
   * then start a task bound to it. Returns the task id and the mapping used, so the caller
   * can read values back under the product's own property names.
   */
  async provisionGenerator(
    schema: ExtractionSchema,
    mapping: KvSchemaMapping,
    opts: { name?: string; filter?: DaFilter; model?: string; apply?: DaApplyTo } = {},
  ): Promise<{ taskId: string; kvSchemaId: string; mapping: KvSchemaMapping }> {
    await this.d.kv.ensureKvSchema(mapping.schema);
    const taskId = await this.startGenerator({
      name: opts.name ?? `dip_${schema.name}_generator`,
      kvSchemaId: mapping.schema.id,
      jsonSchema: mappingToJsonSchema(mapping, schema.description),
      filter: opts.filter,
      model: opts.model,
      apply: opts.apply,
    });
    return { taskId, kvSchemaId: mapping.schema.id, mapping };
  }

  /** `POST /kb/{kb}/task/start` → the new task's id. */
  async startGenerator(opts: GeneratorTaskOptions): Promise<string> {
    const body = toGeneratorTaskBody(opts, { model: this.d.generativeModel });
    if (this.mocked) {
      const id = `mock-task-${this.mockTasks.size + 1}`;
      this.mockTasks.set(id, {
        id,
        name: "ask",
        completed: false,
        failed: false,
        stopped: false,
        scheduled: true,
        parameters: body.parameters as Record<string, unknown>,
      });
      return id;
    }
    // `apply` rides in the query string. In the body it is accepted and ignored, and the
    // task then runs with the platform default (`NEW`) — over no existing resource at all.
    const apply = opts.apply ?? "EXISTING";
    const res = await this.json<{ id?: string; name?: string; status?: string }>(
      "POST",
      `/task/start?apply=${apply}`,
      body,
    );
    if (!res.id) throw new AragError("task/start returned no id", "protocol", "POST /task/start");
    this.d.log.info("da.generator.start", {
      taskId: res.id,
      kvSchemaId: opts.kvSchemaId,
      status: res.status,
      apply,
      rids: opts.filter?.rids?.length ?? 0,
    });
    return res.id;
  }

  /**
   * Run a generator over exactly one resource. A DA task is the unit of work on ARAG — there
   * is no "run this task on that document" call — so a single-resource run is a task with
   * `filter.rids = [rid]`, which is also the only safe way to avoid sweeping the whole KB.
   * `apply` is necessarily `EXISTING`: the resource is already ingested, so the platform's
   * `NEW` default would match nothing. The caller is responsible for deleting the task.
   */
  async runOnResource(
    rid: string,
    mapping: KvSchemaMapping,
    opts: { name?: string; model?: string; description?: string } = {},
  ): Promise<string> {
    await this.d.kv.ensureKvSchema(mapping.schema);
    return this.startGenerator({
      name: opts.name ?? `dip_${mapping.schema.id}_${rid.slice(0, 8)}`,
      kvSchemaId: mapping.schema.id,
      jsonSchema: mappingToJsonSchema(mapping, opts.description),
      filter: { rids: [rid], field_types: ["text", "file"] },
      model: opts.model,
      apply: "EXISTING",
    });
  }

  /** `GET /kb/{kb}/tasks`, split into its buckets. */
  async listTasks(): Promise<DaTasksSnapshot> {
    if (this.mocked) {
      const all = [...this.mockTasks.values()];
      return {
        configs: all,
        running: all.filter((t) => !t.completed && !t.stopped),
        done: all.filter((t) => t.completed === true),
      };
    }
    const res = await this.json<{
      configs?: DaTaskRun[];
      running?: DaTaskRun[];
      done?: DaTaskRun[];
    }>("GET", "/tasks");
    return { configs: res.configs ?? [], running: res.running ?? [], done: res.done ?? [] };
  }

  /**
   * Where one task got to. There is no per-task GET (405 on the live platform), so this
   * scans the buckets of `GET /tasks`.
   */
  async taskState(taskId: string): Promise<{ state: DaTaskState; run?: DaTaskRun }> {
    const snap = await this.listTasks();
    const run =
      snap.running.find((t) => t.id === taskId) ??
      snap.done.find((t) => t.id === taskId) ??
      snap.configs.find((t) => t.id === taskId);
    if (!run) return { state: "absent" };
    if (run.failed) return { state: "failed", run };
    if (run.stopped) return { state: "stopped", run };
    if (run.completed) return { state: "done", run };
    return { state: "running", run };
  }

  /**
   * Read back what a generator produced on a resource, projected onto the product's own
   * property names. Returns undefined when the agent has not written the field yet.
   */
  async readGenerated(rid: string, mapping: KvSchemaMapping): Promise<Record<string, KvValue> | undefined> {
    const values = await this.d.kv.readResourceKeyValues(rid);
    const data: KvData | undefined = values[mapping.schema.id];
    if (!data || Object.keys(data).length === 0) return undefined;
    const out: Record<string, KvValue> = {};
    for (const [key, value] of Object.entries(data)) out[mapping.names[key] ?? key] = value;
    return out;
  }

  /**
   * `POST /kb/{kb}/task/{id}/stop`. The lifecycle is start → stop → delete: a **running**
   * task cannot be deleted, so anything that tears an agent down has to stop it first.
   * A task that is already stopped, or gone, is not an error — stopping is idempotent.
   */
  async stopTask(taskId: string): Promise<void> {
    if (this.mocked) {
      const run = this.mockTasks.get(taskId);
      if (run) {
        run.stopped = true;
        run.scheduled = false;
      }
      return;
    }
    try {
      await this.d.arag.request("POST", `/task/${encodeURIComponent(taskId)}/stop`);
      this.d.log.info("da.generator.stop", { taskId });
    } catch (err) {
      if (err instanceof AragError && (err.status === 404 || err.status === 409)) return;
      throw asTaskConflict(err) ?? err;
    }
  }

  /** Stop the task if it is running, then delete it. The safe teardown for one agent. */
  async stopAndDelete(taskId: string): Promise<void> {
    await this.stopTask(taskId).catch((err) => {
      this.d.log.warn("da.generator.stop.fail", { taskId, message: (err as Error).message });
    });
    await this.deleteTask(taskId);
  }

  /** `DELETE /kb/{kb}/task/{id}`. A missing task is not an error. */
  async deleteTask(taskId: string): Promise<void> {
    if (this.mocked) {
      this.mockTasks.delete(taskId);
      return;
    }
    try {
      await this.d.arag.request("DELETE", `/task/${encodeURIComponent(taskId)}`);
      this.d.log.info("da.generator.delete", { taskId });
    } catch (err) {
      if (err instanceof AragError && err.status === 404) return;
      throw asTaskConflict(err) ?? err;
    }
  }
}

/**
 * A 422 from a `/task` route is a lifecycle conflict, not a validation failure and not an
 * upstream outage: the platform says "Already running an operation of ask with destination X"
 * when a second agent is started for the same destination, and "Cannot delete a running job"
 * when a delete precedes a stop. The platform's default mapper turns a 422 into a 502 with
 * the upstream sentence in the body; both the status and the leaked wording are wrong
 * (STANDARDS §3), so they become a 409 in this product's own words.
 */
function asTaskConflict(err: unknown): HttpError | undefined {
  if (!(err instanceof AragError) || err.status !== 422 || !err.operation.includes("/task")) return undefined;
  const detail = err.detail ?? err.message;
  if (/already running an operation/i.test(detail)) {
    return conflict(
      "A generator agent is already running for this configuration. Stop and delete it before starting another — the platform allows only one running agent per key-value schema.",
    );
  }
  if (/cannot delete a running/i.test(detail)) {
    return conflict("That generator agent is still running. Stop it before deleting it.");
  }
  return conflict(
    "The generator agent could not be changed in its current state. Check its status and retry.",
  );
}
