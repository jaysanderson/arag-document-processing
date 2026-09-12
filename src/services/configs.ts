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
 * Every config is backed by a stored ARAG **search configuration** (`dip_<schema>`,
 * kind `ask`) that pins the generative model, the `full_resource` RAG strategy, the
 * reranker, the grounding prompt and the `answer_json_schema`. Creating a custom
 * config provisions it; `provisionAll()` re-provisions everything (admin endpoint).
 */
import { randomUUID } from "node:crypto";
import type { Collection, Logger, Store, StoredDoc } from "../../vendor/arag-platform/src/index.ts";
import type { DocType } from "../types.ts";
import { type Agents, aragConfigName, type ProvisionResult } from "./agents.ts";
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
  fields: ConfigField[];
  createdAt: string;
  updatedAt: string;
}

export interface ConfigsDeps {
  store: Store;
  agents: Agents;
  log: Logger;
}

/** Resolution of the `config` upload parameter. */
export interface ResolvedConfig {
  schema: ExtractionSchema;
  label: string;
  configId: string;
}

const BOOT = new Date().toISOString();

export class ConfigsService {
  private readonly d: ConfigsDeps;
  private readonly col: Collection<StoredConfig>;
  /** aragConfig name → last provisioning outcome. */
  private readonly provisionState = new Map<string, ProvisionResult>();

  constructor(deps: ConfigsDeps) {
    this.d = deps;
    this.col = deps.store.collection<StoredConfig>("extraction-configs");
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
    });
    return this.summarise(id, schema, stored.name, false, stored.createdAt, stored.updatedAt);
  }

  /** Delete a custom config (and its ARAG search configuration). Built-ins are not deletable. */
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
    this.col.delete(id);
    this.d.log.info("config.delete", { id, aragConfig: name });
    return "deleted";
  }

  /** Re-provision every config's ARAG search configuration. Returns a per-config result. */
  async provisionAll(): Promise<ProvisionResult[]> {
    this.d.agents.resetProvisionCache();
    const results = await this.d.agents.provision(this.schemas(), { force: true });
    for (const r of results) this.provisionState.set(r.aragConfig, r);
    return results;
  }

  /** Provisioning outcomes recorded so far (admin panel). */
  provisionStatus(): ProvisionResult[] {
    return [...this.provisionState.values()];
  }

  private async provisionOne(schema: ExtractionSchema): Promise<void> {
    const [result] = await this.d.agents.provision([schema]);
    if (result) this.provisionState.set(result.aragConfig, result);
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
    return {
      id,
      name,
      docType: schema.docType,
      description: schema.description,
      builtin,
      aragConfig,
      provisioned: this.provisionState.get(aragConfig)?.ok ?? false,
      fields: schemaToFields(schema),
      createdAt,
      updatedAt,
    };
  }
}

function randomId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}
