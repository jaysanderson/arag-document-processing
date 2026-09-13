/**
 * Extraction-config store.
 *
 * A "config" is what the caller selects when uploading a document: it decides which
 * fields the visual LLM is forced to return. There are two kinds:
 *
 *   built-in  — one per document type (11 of them), derived from `SCHEMAS`
 *   custom    — user-defined field lists, persisted under DATA_DIR so they survive
 *               restarts (the prototype kept them in browser localStorage)
 *
 * Every config is backed by **two** things in the Knowledge Box, provisioned together:
 *
 *   - a stored ARAG **search configuration** (`dip_<schema>`, kind `ask`) that pins the
 *     generative model, the `full_resource` RAG strategy, the reranker, the grounding
 *     prompt and the `answer_json_schema` — this is how a document is read; and
 *   - a **key-value schema** (`dip_<schema>` again, in the kv namespace) declaring the same
 *     fields as typed, filterable metadata — this is how the result is kept and queried.
 *     Field types come from the config's JSON schema unless a field overrides them
 *     (`JsonProp.kv`), and every field `description` is carried across verbatim because it
 *     is what steers a Data Augmentation generator agent.
 *
 * Creating a custom config provisions both; editing it updates both; deleting it removes
 * both; `provisionAll()` re-provisions everything (admin endpoint). The Knowledge Box's own
 * ceilings — 50 fields per kv schema, 20 kv schemas per KB — are checked here so an
 * operator gets a sentence rather than an upstream 422.
 */
import { randomUUID } from "node:crypto";
import type { Collection, Logger, Store, StoredDoc } from "../../vendor/arag-platform/src/index.ts";
import type { DocType } from "../types.ts";
import { type Agents, aragConfigName, type ProvisionResult } from "./agents.ts";
import {
  type KvSchema,
  type KvSchemaMapping,
  type KvService,
  KvValidationError,
  MAX_KV_SCHEMAS_PER_KB,
  schemaToKvSchema,
  toKvFieldKey,
} from "./kv.ts";
import {
  buildCustomSchema,
  type ConfigField,
  type CustomConfigInput,
  DOC_TYPES,
  type ExtractionSchema,
  SCHEMAS,
  schemaToFields,
} from "./schemas.ts";

/** A stored custom config (the built-ins are computed, never persisted). */
interface StoredConfig extends StoredDoc {
  name: string;
  description: string;
  schema: ExtractionSchema;
}

/** Whether a Knowledge Box object backing a config is in place. */
export type ProvisioningState = "provisioned" | "failed" | "not provisioned";

/** Provisioning outcome for one of the two Knowledge Box objects a config needs. */
export interface ProvisioningStatus {
  state: ProvisioningState;
  /** Why it failed, in a sentence an operator can act on. Present only when `failed`. */
  error?: string;
  /** When the outcome was recorded. */
  at?: string;
}

/** Everything the Configs screen needs to say what this config has in the Knowledge Box. */
export interface ConfigProvisioning {
  /** `failed` if either object failed, `provisioned` only when both are in place. */
  state: ProvisioningState;
  searchConfiguration: ProvisioningStatus & { name: string };
  keyValueSchema: ProvisioningStatus & {
    /** kv schema id this config's values are written under. */
    schemaId: string;
    /** Field count declared in the kv schema. */
    fields: number;
  };
}

/** Public shape returned by `/api/v1/extraction-configs`. */
export interface ExtractionConfigSummary {
  id: string;
  name: string;
  docType: string;
  description: string;
  builtin: boolean;
  /** Name of the stored ARAG search configuration backing this config. */
  aragConfig: string;
  /** Whether that ARAG search configuration has been provisioned in this process. */
  provisioned: boolean;
  /** kv schema id the extracted record is written into. */
  kvSchemaId: string;
  /** Property name → kv field key, so a caller can map a record onto the kv field. */
  kvFields: Record<string, string>;
  /** Per-object provisioning state, which the Configs screen renders. */
  provisioning: ConfigProvisioning;
  fields: ConfigField[];
  createdAt: string;
  updatedAt: string;
}

export interface ConfigsDeps {
  store: Store;
  agents: Agents;
  kv: KvService;
  log: Logger;
}

/** Resolution of the `config` upload parameter. */
export interface ResolvedConfig {
  schema: ExtractionSchema;
  label: string;
  configId: string;
}

const BOOT = new Date().toISOString();

/**
 * kv schema id for a config's extraction schema.
 *
 * Deliberately the same string as the stored search configuration's name: one config, one
 * name, in both Knowledge Box namespaces, so an operator reading the ARAG dashboard sees
 * the pair. Truncated to the 64 characters ARAG's `^[^/.]{1,64}$` allows.
 */
export function kvSchemaIdFor(schema: ExtractionSchema): string {
  return toKvFieldKey(aragConfigName(schema));
}

/**
 * The kv schema as this product provisions it: **nothing is marked required.**
 *
 * A config's `required` list is an instruction to the model ("this field matters, find it"),
 * not a guarantee about the document — a faded scan really can arrive without a total. ARAG
 * refuses an entire key-value write when a `required` key is absent, and a key-value write
 * is a full replace, so one un-extracted required field would cost the resource *every*
 * value it did extract, and a generator agent's own writes would fail the same way.
 * Filterable values for four fields out of five beat filterable values for none.
 *
 * The requirement is therefore kept where it is useful and dropped where it is ruinous: the
 * extraction schema still lists them (the visual LLM is still asked for them, and they still
 * drive the record's confidence), and `writeRecordKv` still reports "required but not
 * extracted" on the record. The Knowledge Box simply is not asked to enforce it.
 */
function provisionable(schema: KvSchema): KvSchema {
  return { ...schema, fields: schema.fields.map((f) => ({ ...f, required: false })) };
}

/** The kv projection of one config: what would be (or has been) provisioned for it. */
export interface ConfigKv {
  configId: string;
  schema: ExtractionSchema;
  mapping: KvSchemaMapping;
  status: ProvisioningStatus;
}

export class ConfigsService {
  private readonly d: ConfigsDeps;
  private readonly col: Collection<StoredConfig>;
  /** aragConfig name → last provisioning outcome. */
  private readonly provisionState = new Map<string, ProvisionResult>();
  /** kv schema id → last kv provisioning outcome. */
  private readonly kvState = new Map<string, ProvisioningStatus>();

  constructor(deps: ConfigsDeps) {
    this.d = deps;
    this.col = deps.store.collection<StoredConfig>("extraction-configs");
  }

  // ─── key-value schemas ──────────────────────────────────────────────────────

  /**
   * The kv projection of one config, by config id. The mapping is derived, not stored, so
   * it is always in step with the config's fields; only the provisioning *outcome* is kept.
   * Returns undefined for an unknown config, or when the config's fields cannot be
   * represented as a kv schema at all (the reason is then on the status of `list()`).
   */
  kvFor(configId: string): ConfigKv | undefined {
    const schema = this.schemaOf(configId);
    return schema ? this.kvForSchema(schema, configId) : undefined;
  }

  /**
   * The kv projection for an extraction schema. The pipeline resolves by schema rather than
   * by config id, because auto-classification picks a schema without a config id ever being
   * named. Returns undefined when the schema cannot be projected (too many fields, a
   * modifier ARAG refuses) — which is a provisioning failure, not a pipeline failure.
   */
  kvForSchema(schema: ExtractionSchema, configId: string = schema.docType): ConfigKv | undefined {
    const schemaId = kvSchemaIdFor(schema);
    let mapping: KvSchemaMapping;
    try {
      mapping = schemaToKvSchema(schema, { id: schemaId, description: schema.description });
    } catch (err) {
      this.kvState.set(schemaId, {
        state: "failed",
        error: (err as Error).message,
        at: new Date().toISOString(),
      });
      return undefined;
    }
    return {
      configId,
      schema,
      // One shape, everywhere: what the pipeline writes against, what a generator agent is
      // bound to and what is actually in the Knowledge Box are the same object, so nothing
      // downstream can quietly re-tighten the schema underneath the others.
      mapping: { ...mapping, schema: provisionable(mapping.schema) },
      status: this.kvState.get(schemaId) ?? { state: "not provisioned" },
    };
  }

  /**
   * The kv schema a caller named in a `kv=` filter, looked up across every config this
   * product declares. Filtering is only offered on schemas the product itself provisions:
   * a caller cannot aim a filter at an arbitrary Knowledge Box schema and have the product
   * vouch for the operator rules, and a typo gets a list of the ids that do exist.
   */
  kvSchemaById(schemaId: string): KvSchemaMapping | undefined {
    for (const schema of this.schemas()) {
      if (kvSchemaIdFor(schema) !== schemaId) continue;
      return this.kvForSchema(schema)?.mapping;
    }
    return undefined;
  }

  /** Every kv schema id this product provisions, for a "did you mean" on a bad filter. */
  kvSchemaIds(): string[] {
    return this.schemas().map((s) => kvSchemaIdFor(s));
  }

  /** The extraction schema behind a config id, built-in or custom. */
  private schemaOf(configId: string): ExtractionSchema | undefined {
    if ((DOC_TYPES as string[]).includes(configId)) return SCHEMAS[configId as DocType];
    return this.col.get(configId)?.schema;
  }

  /**
   * Create or update one config's kv schema, recording the outcome either way.
   *
   * The two ceilings are checked before the call rather than after the 422: a kv schema
   * holds at most 50 fields and a Knowledge Box at most 20 schemas, and "this config
   * declares 63 fields; a Knowledge Box key-value schema holds at most 50" is an answer,
   * where `{"detail":[{"loc":["body","fields"],…}]}` is not. Never throws: a config whose
   * kv schema cannot be provisioned is still a usable extraction config, it just cannot
   * write filterable values, and the Configs screen says so.
   */
  private async provisionKv(
    schema: ExtractionSchema,
    opts: { existingIds?: Set<string> } = {},
  ): Promise<ProvisioningStatus> {
    const schemaId = kvSchemaIdFor(schema);
    const at = new Date().toISOString();
    const fail = (error: string): ProvisioningStatus => {
      const status: ProvisioningStatus = { state: "failed", error, at };
      this.kvState.set(schemaId, status);
      this.d.log.warn("config.kv.provision.fail", { schemaId, message: error });
      return status;
    };
    try {
      const mapping = this.kvForSchema(schema)?.mapping;
      if (!mapping) return this.kvState.get(schemaId) ?? fail(`"${schema.name}" has no key-value projection`);
      const existing = opts.existingIds ?? new Set(Object.keys(await this.d.kv.listKvSchemas()));
      if (!existing.has(schemaId) && existing.size >= MAX_KV_SCHEMAS_PER_KB) {
        return fail(
          `The Knowledge Box already holds ${existing.size} key-value schemas and the limit is ` +
            `${MAX_KV_SCHEMAS_PER_KB}. Delete an unused extraction configuration before provisioning "${schemaId}".`,
        );
      }
      await this.d.kv.ensureKvSchema(mapping.schema);
      existing.add(schemaId);
      const status: ProvisioningStatus = { state: "provisioned", at };
      this.kvState.set(schemaId, status);
      return status;
    } catch (err) {
      return fail(
        err instanceof KvValidationError
          ? `${err.message}${err.field ? ` (field "${err.field}")` : ""}`
          : (err as Error).message,
      );
    }
  }

  /** Forget a kv schema for good: remove it from the Knowledge Box and from the state map. */
  private async deprovisionKv(schema: ExtractionSchema): Promise<void> {
    const schemaId = kvSchemaIdFor(schema);
    try {
      await this.d.kv.deleteKvSchema(schemaId);
    } catch (err) {
      this.d.log.warn("config.kv.delete.fail", { schemaId, message: (err as Error).message });
    }
    this.kvState.delete(schemaId);
  }

  /** Built-in configs, as summaries. */
  builtins(): ExtractionConfigSummary[] {
    return DOC_TYPES.map((dt) => this.summarise(dt, SCHEMAS[dt], dt.replace(/_/g, " "), true, BOOT, BOOT));
  }

  /** Persisted custom configs, as summaries. */
  customs(): ExtractionConfigSummary[] {
    return this.col
      .list({ sort: (a, b) => a.createdAt.localeCompare(b.createdAt) })
      .map((c) => this.summarise(c.id, c.schema, c.name, false, c.createdAt, c.updatedAt));
  }

  /** Built-in + custom, built-ins first. */
  list(): ExtractionConfigSummary[] {
    return [...this.builtins(), ...this.customs()];
  }

  get(id: string): ExtractionConfigSummary | undefined {
    return this.list().find((c) => c.id === id);
  }

  /** Every schema this service knows about (built-in + custom). */
  schemas(): ExtractionSchema[] {
    return [...DOC_TYPES.map((dt) => SCHEMAS[dt]), ...this.col.list().map((c) => c.schema)];
  }

  /**
   * Resolve the `config` upload parameter to a forced schema, or null for auto-detect.
   * `auto` and `agent` are handled by the pipeline, not here.
   */
  resolve(configParam: string | null | undefined): ResolvedConfig | null {
    if (!configParam || configParam === "auto" || configParam === "agent") return null;
    if ((DOC_TYPES as string[]).includes(configParam)) {
      const dt = configParam as DocType;
      return { schema: SCHEMAS[dt], label: dt.replace(/_/g, " "), configId: dt };
    }
    const stored = this.col.get(configParam);
    if (!stored) return null;
    return { schema: stored.schema, label: stored.name, configId: stored.id };
  }

  /** Create a custom config and provision it in ARAG (provisioning failure is non-fatal). */
  async create(input: CustomConfigInput & { id?: string }): Promise<ExtractionConfigSummary> {
    const schema = buildCustomSchema(input);
    const id = input.id ?? `cfg_${randomId()}`;
    const stored = this.col.put({
      id,
      name: input.name.trim(),
      description: schema.description,
      schema,
    });
    await this.provisionOne(schema);
    this.d.log.info("config.create", {
      id,
      name: stored.name,
      fields: Object.keys(schema.properties).length,
      aragConfig: aragConfigName(schema),
      kvSchemaId: kvSchemaIdFor(schema),
    });
    return this.summarise(id, schema, stored.name, false, stored.createdAt, stored.updatedAt);
  }

  /**
   * Replace a custom config in place and re-provision it. The id survives, which is the
   * whole point: `meta.config` on every document already processed with this configuration
   * keeps resolving, where delete-and-recreate would orphan them.
   */
  async update(
    id: string,
    input: CustomConfigInput,
  ): Promise<ExtractionConfigSummary | "builtin" | "not-found"> {
    if ((DOC_TYPES as string[]).includes(id)) return "builtin";
    const stored = this.col.get(id);
    if (!stored) return "not-found";
    const schema = buildCustomSchema(input);
    const previous = aragConfigName(stored.schema);
    const next = aragConfigName(schema);
    // Renaming a config renames its ARAG search configuration; the old one would otherwise
    // be left behind in the Knowledge Box forever.
    if (previous !== next) {
      await this.d.agents.deleteSearchConfiguration(previous).catch((err) => {
        this.d.log.warn("config.update.arag.delete", { id, message: (err as Error).message });
      });
      this.provisionState.delete(previous);
      // The kv schema id is derived from the same name, so a rename orphans it too. A kv
      // schema id is immutable (PATCH cannot change it), so the old one has to go.
      await this.deprovisionKv(stored.schema);
    }
    const saved = this.col.put({
      ...stored,
      name: input.name.trim(),
      description: schema.description,
      schema,
    });
    await this.provisionOne(schema);
    this.d.log.info("config.update", { id, name: saved.name, aragConfig: next });
    return this.summarise(id, schema, saved.name, false, saved.createdAt, saved.updatedAt);
  }

  /** Re-provision a single config's search configuration **and** its kv schema. */
  async provision(
    id: string,
  ): Promise<(ProvisionResult & { keyValueSchema: ProvisioningStatus }) | undefined> {
    const schema = this.schemaOf(id);
    if (!schema) return undefined;
    this.d.agents.resetProvisionCache();
    const [result] = await this.d.agents.provision([schema], { force: true });
    if (result) this.provisionState.set(result.aragConfig, result);
    const keyValueSchema = await this.provisionKv(schema);
    return result ? { ...result, keyValueSchema } : undefined;
  }

  /**
   * Delete a custom config, its ARAG search configuration and its kv schema. Built-ins are
   * not deletable. Deleting the kv schema is what keeps the 20-per-Knowledge-Box ceiling
   * from filling up with the leavings of configs nobody uses any more.
   */
  async delete(id: string): Promise<"deleted" | "not-found" | "builtin"> {
    if ((DOC_TYPES as string[]).includes(id)) return "builtin";
    const stored = this.col.get(id);
    if (!stored) return "not-found";
    const name = aragConfigName(stored.schema);
    try {
      await this.d.agents.deleteSearchConfiguration(name);
    } catch (err) {
      this.d.log.warn("config.delete.arag", { id, message: (err as Error).message });
    }
    this.provisionState.delete(name);
    await this.deprovisionKv(stored.schema);
    this.col.delete(id);
    this.d.log.info("config.delete", { id, aragConfig: name, kvSchemaId: kvSchemaIdFor(stored.schema) });
    return "deleted";
  }

  /**
   * Re-provision every config's search configuration and kv schema. Returns a per-config
   * result. The kv schema list is fetched once for the whole pass rather than once per
   * config, so the 20-schema ceiling is checked without 11 extra round trips.
   */
  async provisionAll(): Promise<Array<ProvisionResult & { keyValueSchema: ProvisioningStatus }>> {
    this.d.agents.resetProvisionCache();
    const schemas = this.schemas();
    const results = await this.d.agents.provision(schemas, { force: true });
    for (const r of results) this.provisionState.set(r.aragConfig, r);

    let existingIds: Set<string>;
    try {
      existingIds = new Set(Object.keys(await this.d.kv.listKvSchemas()));
    } catch (err) {
      // Without the list we cannot check the ceiling; provision anyway and let ARAG be the
      // authority, rather than refusing to provision because a read failed.
      this.d.log.warn("config.kv.list.fail", { message: (err as Error).message });
      existingIds = new Set();
    }
    const out: Array<ProvisionResult & { keyValueSchema: ProvisioningStatus }> = [];
    for (const schema of schemas) {
      const result = results.find((r) => r.schema === schema.name) ?? {
        schema: schema.name,
        aragConfig: aragConfigName(schema),
        ok: false,
      };
      out.push({ ...result, keyValueSchema: await this.provisionKv(schema, { existingIds }) });
    }
    this.d.log.info("config.kv.provision.done", {
      provisioned: out.filter((r) => r.keyValueSchema.state === "provisioned").length,
      failed: out.filter((r) => r.keyValueSchema.state === "failed").length,
    });
    return out;
  }

  /** Provisioning outcomes recorded so far (admin panel). */
  provisionStatus(): ProvisionResult[] {
    return [...this.provisionState.values()];
  }

  private async provisionOne(schema: ExtractionSchema): Promise<void> {
    const [result] = await this.d.agents.provision([schema]);
    if (result) this.provisionState.set(result.aragConfig, result);
    await this.provisionKv(schema);
  }

  private summarise(
    id: string,
    schema: ExtractionSchema,
    name: string,
    builtin: boolean,
    createdAt: string,
    updatedAt: string,
  ): ExtractionConfigSummary {
    const aragConfig = aragConfigName(schema);
    const result = this.provisionState.get(aragConfig);
    const schemaId = kvSchemaIdFor(schema);
    const kvStatus = this.kvState.get(schemaId) ?? { state: "not provisioned" as const };
    const kv = this.kvForSchema(schema, id);

    const searchConfiguration: ProvisioningStatus & { name: string } = {
      name: aragConfig,
      state: result ? (result.ok ? "provisioned" : "failed") : "not provisioned",
    };
    if (result && !result.ok && result.error) searchConfiguration.error = result.error;

    const keyValueSchema: ProvisioningStatus & { schemaId: string; fields: number } = {
      ...kvStatus,
      schemaId,
      fields: kv?.mapping.schema.fields.length ?? 0,
    };

    const states = [searchConfiguration.state, keyValueSchema.state];
    const state: ProvisioningState = states.includes("failed")
      ? "failed"
      : states.every((s) => s === "provisioned")
        ? "provisioned"
        : "not provisioned";

    return {
      id,
      name,
      docType: schema.docType,
      description: schema.description,
      builtin,
      aragConfig,
      provisioned: result?.ok ?? false,
      kvSchemaId: schemaId,
      kvFields: kv?.mapping.fieldIds ?? {},
      provisioning: { state, searchConfiguration, keyValueSchema },
      fields: schemaToFields(schema),
      createdAt,
      updatedAt,
    };
  }
}

function randomId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}
