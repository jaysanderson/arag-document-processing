/**
 * The Data Augmentation **generator agent** as an alternative extraction path.
 *
 * The product's own path is synchronous: one `/ask` per document against the config's
 * stored search configuration, answered inline, every value carrying a quote that is then
 * checked against the document's own text (the evidence contract). The generator agent is
 * the platform's answer to the same question — an ARAG-side task that sweeps resources on
 * its own schedule and writes the values it extracts straight into the resource's key-value
 * field, using the config's kv schema and its field descriptions as the instructions.
 *
 * This service runs both and puts them side by side, because "which one should I use?" is a
 * question a buyer will ask and the honest answer is a comparison rather than a claim.
 *
 * ### What the comparison must never imply
 *
 * The evidence contract applies to **the product's path only**. A generator agent returns
 * values, not quotes: there is no supporting text to check, so nothing it produces can be
 * verified against the document. The payload says so on every generator value
 * (`evidence: null`, `evidenceAvailable: false`) and in the payload's own
 * `evidenceContract` block, rather than leaving a reader to infer parity from two columns
 * that look alike.
 *
 * ### What was not verified
 *
 * End-to-end write latency was **not observed live**: every generator run started against
 * the real Knowledge Box on 2026-09-13 was still `scheduled` after 20 minutes, so the
 * provisioning, lifecycle and read-back shapes here are verified and the time from starting
 * a run to values appearing on the resource is not. `runForDocument` therefore returns as
 * soon as the task is accepted and the caller polls, instead of pretending to await a
 * completion this product has never seen.
 */
import { badRequest, type Logger, notFound } from "../../vendor/arag-platform/src/index.ts";
import type { DocumentRecord, Evidence, ExtractedField } from "../types.ts";
import type { ConfigsService } from "./configs.ts";
import type { DaAgents, DaTaskState } from "./da-agents.ts";
import type { DocumentsService } from "./documents.ts";
import type { KvService, KvValue } from "./kv.ts";

/** A generator agent this product started, remembered so it can be inspected and removed. */
export interface GeneratorAgent {
  /** Extraction config the agent extracts for. */
  configId: string;
  /** kv schema the agent writes into. */
  kvSchemaId: string;
  /** ARAG task id. */
  taskId: string;
  /** Task name as it appears in the ARAG dashboard. */
  name: string;
  /** Resource the run was scoped to, when it was started for one document. */
  resourceId?: string;
  startedAt: string;
  /** Where the run is, as of the last poll. */
  state: DaTaskState;
}

/** How one field's two answers relate. */
export type Agreement = "agree" | "differ" | "pipeline-only" | "generator-only" | "neither";

export interface ComparisonRow {
  field: string;
  label: string;
  pipeline: {
    present: boolean;
    value: ExtractedField["value"] | null;
    confidence?: number;
    /** The verified quote behind this value. The generator has no counterpart. */
    evidence: { quote: string; verified: Evidence["verified"] } | null;
  };
  generator: {
    present: boolean;
    value: KvValue | null;
    /** Always null: a generator agent returns values, never a quote to check. */
    evidence: null;
  };
  agreement: Agreement;
}

export interface GeneratorComparison {
  documentId: string;
  resourceId: string;
  configId: string;
  kvSchemaId: string;
  /** The agent this product started for the config, when there is one. */
  agent: GeneratorAgent | null;
  /** True once the agent has written anything at all onto the resource. */
  generatorHasWritten: boolean;
  fields: ComparisonRow[];
  summary: Record<Agreement, number>;
  /**
   * The asymmetry, in the payload rather than only in the docs: the product's values carry
   * a quote checked against the document; the generator's carry nothing to check.
   */
  evidenceContract: {
    pipeline: string;
    generator: string;
  };
  /** What this product has and has not observed of the generator path, stated plainly. */
  observed: {
    provisioning: boolean;
    lifecycle: boolean;
    readBack: boolean;
    endToEndLatency: boolean;
    note: string;
  };
}

const EVIDENCE_PIPELINE =
  "Every value carries a verbatim quote checked against the document's own extracted text " +
  "(`exact`, `normalised` or `unverified`), and the record's grounding score is the share " +
  "of fields that check out.";
const EVIDENCE_GENERATOR =
  "No evidence. A Data Augmentation generator agent writes values into the key-value field " +
  "and returns no supporting quote, so there is nothing to verify against the document. " +
  "These values are NOT grounded to the same standard as the pipeline's and must not be " +
  "read as if they were.";
const LATENCY_NOTE =
  "Provisioning, the start → stop → delete lifecycle and reading the generated values back " +
  "were all verified against the live Knowledge Box on 2026-09-13. End-to-end write latency " +
  "was NOT: every run started there was still `scheduled` after 20 minutes, so this product " +
  "has never observed the time from starting a generator to values appearing on a resource.";

export interface GeneratorsDeps {
  da: DaAgents;
  kv: KvService;
  configs: ConfigsService;
  documents: DocumentsService;
  log: Logger;
}

export class GeneratorsService {
  private readonly d: GeneratorsDeps;
  /** config id → the agent this product started for it. One per config, by design. */
  private readonly agents = new Map<string, GeneratorAgent>();

  constructor(deps: GeneratorsDeps) {
    this.d = deps;
  }

  /**
   * Provision and start a generator agent for one config.
   *
   * ARAG allows only one running `ask` task per `destination`, and the destination is the
   * kv schema id — so starting a second agent for the same config would be refused upstream.
   * An existing agent is torn down first (stop, then delete: a running task cannot be
   * deleted) so "start" is an operation an operator can repeat without reading the docs.
   */
  async start(configId: string, opts: { resourceId?: string; model?: string } = {}): Promise<GeneratorAgent> {
    const projection = this.d.configs.kvFor(configId);
    if (!projection) throw notFound("Extraction config");
    if (projection.status.state !== "provisioned") {
      throw badRequest(
        `The key-value schema for "${configId}" is ${projection.status.state}` +
          `${projection.status.error ? `: ${projection.status.error}` : ""}. ` +
          "A generator agent writes into that schema, so provision the configuration first.",
      );
    }
    await this.stopExisting(configId);

    const name = `dip_${projection.mapping.schema.id}_generator`;
    const { taskId, kvSchemaId } = opts.resourceId
      ? {
          taskId: await this.d.da.runOnResource(opts.resourceId, projection.mapping, {
            name,
            model: opts.model,
            description: projection.schema.description,
          }),
          kvSchemaId: projection.mapping.schema.id,
        }
      : await this.d.da.provisionGenerator(projection.schema, projection.mapping, {
          name,
          model: opts.model,
        });

    const agent: GeneratorAgent = {
      configId,
      kvSchemaId,
      taskId,
      name,
      startedAt: new Date().toISOString(),
      state: "running",
    };
    if (opts.resourceId) agent.resourceId = opts.resourceId;
    this.agents.set(configId, agent);
    this.d.log.info("generator.start", { configId, taskId, kvSchemaId, rid: opts.resourceId });
    return agent;
  }

  /** The agent for a config with its state refreshed from the Knowledge Box. */
  async status(configId: string): Promise<GeneratorAgent | null> {
    const agent = this.agents.get(configId);
    if (!agent) return null;
    const { state } = await this.d.da
      .taskState(agent.taskId)
      .catch(() => ({ state: "absent" as DaTaskState }));
    agent.state = state;
    return agent;
  }

  /** Stop a running agent without deleting it, so a half-finished sweep can be halted. */
  async stop(configId: string): Promise<GeneratorAgent | null> {
    const agent = this.agents.get(configId);
    if (!agent) return null;
    await this.d.da.stopTask(agent.taskId);
    agent.state = "stopped";
    this.d.log.info("generator.stop", { configId, taskId: agent.taskId });
    return agent;
  }

  /** Stop (a running task cannot be deleted) and then delete the agent. */
  async delete(configId: string): Promise<boolean> {
    const agent = this.agents.get(configId);
    if (!agent) return false;
    await this.d.da.stopAndDelete(agent.taskId);
    this.agents.delete(configId);
    this.d.log.info("generator.delete", { configId, taskId: agent.taskId });
    return true;
  }

  private async stopExisting(configId: string): Promise<void> {
    const agent = this.agents.get(configId);
    if (!agent) return;
    await this.d.da.stopAndDelete(agent.taskId).catch((err) => {
      this.d.log.warn("generator.replace.fail", { configId, message: (err as Error).message });
    });
    this.agents.delete(configId);
  }

  /**
   * Run the generator over one document's resource. This is a task filtered to a single
   * `rid` — ARAG has no "run this task on that document" call, and a filtered task is also
   * the only way to keep a run from sweeping the whole Knowledge Box.
   */
  async runForDocument(documentId: string, opts: { model?: string } = {}): Promise<GeneratorAgent> {
    const record = this.d.documents.require(documentId);
    const configId = this.configIdFor(record);
    return this.start(configId, { resourceId: record.resourceId, model: opts.model });
  }

  /**
   * The record view's comparison: this product's extraction beside the generator agent's,
   * field by field, with agreement marked and the evidence asymmetry stated rather than
   * implied.
   */
  async compare(documentId: string): Promise<GeneratorComparison> {
    const record = this.d.documents.require(documentId);
    const configId = this.configIdFor(record);
    const projection = this.d.configs.kvFor(configId) ?? this.d.configs.kvFor(record.docType);
    if (!projection) throw notFound("Extraction config");
    const { mapping } = projection;

    // The generator writes into the kv field, so reading "what did the generator produce"
    // is reading the resource's kv values back under the product's own property names.
    const generated = await this.d.da.readGenerated(record.resourceId, mapping).catch((err) => {
      this.d.log.warn("generator.read.fail", { documentId, message: (err as Error).message });
      return undefined;
    });

    // Values this product wrote itself must not be mistaken for the agent's. When the
    // pipeline has written this resource's kv field, what is stored there is ours.
    const ours = record.meta.kv?.written === true;
    const generatorValues = ours ? {} : (generated ?? {});
    const generatorHasWritten = !ours && generated !== undefined && Object.keys(generated).length > 0;

    const byKey = new Map(record.fields.map((f) => [f.key, f]));
    const evidenceByField = new Map(record.evidence.map((e) => [e.field, e]));
    const names = new Set([...Object.keys(mapping.fieldIds), ...byKey.keys()]);

    const summary: Record<Agreement, number> = {
      agree: 0,
      differ: 0,
      "pipeline-only": 0,
      "generator-only": 0,
      neither: 0,
    };
    const fields: ComparisonRow[] = [];
    for (const name of names) {
      const mine = byKey.get(name);
      const theirs = generatorValues[name];
      const minePresent = mine !== undefined && mine.value !== null && mine.value !== "";
      const theirsPresent = theirs !== undefined && theirs !== null && theirs !== "";
      const agreement: Agreement =
        minePresent && theirsPresent
          ? sameValue(mine.value, theirs)
            ? "agree"
            : "differ"
          : minePresent
            ? "pipeline-only"
            : theirsPresent
              ? "generator-only"
              : "neither";
      summary[agreement]++;
      const quote = mine ? evidenceByField.get(mine.key) : undefined;
      fields.push({
        field: name,
        label: mine?.label ?? projection.schema.labels[name] ?? name,
        pipeline: {
          present: minePresent,
          value: minePresent ? (mine?.value ?? null) : null,
          confidence: mine?.confidence,
          evidence: quote ? { quote: quote.quote, verified: quote.verified } : null,
        },
        // Always null, always stated: a generator agent returns no quote, so there is
        // nothing to verify and no parity to imply.
        generator: { present: theirsPresent, value: theirsPresent ? (theirs ?? null) : null, evidence: null },
        agreement,
      });
    }
    fields.sort((a, b) => a.field.localeCompare(b.field));

    return {
      documentId: record.id,
      resourceId: record.resourceId,
      configId,
      kvSchemaId: mapping.schema.id,
      agent: (await this.status(configId)) ?? null,
      generatorHasWritten,
      fields,
      summary,
      evidenceContract: { pipeline: EVIDENCE_PIPELINE, generator: EVIDENCE_GENERATOR },
      observed: {
        provisioning: true,
        lifecycle: true,
        readBack: true,
        endToEndLatency: false,
        note: LATENCY_NOTE,
      },
    };
  }

  /** Every agent this process has started, for the admin view. */
  list(): GeneratorAgent[] {
    return [...this.agents.values()];
  }

  /**
   * Which config a record was extracted with. `meta.config` holds the config's *label* for
   * a custom config and the doc type for a built-in one, so fall back to the doc type —
   * which is exactly what a built-in config's id is.
   */
  private configIdFor(record: DocumentRecord): string {
    const label = record.meta.config;
    if (label) {
      const match = this.d.configs.list().find((c) => c.id === label || c.name === label);
      if (match) return match.id;
    }
    return record.docType;
  }
}

/** Loose equality for two answers to the same field: "1234.56" and 1234.56 agree. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = (Array.isArray(a) ? a : [a]).map((v) => normalise(v)).sort();
    const y = (Array.isArray(b) ? b : [b]).map((v) => normalise(v)).sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  const na = Number(String(a).replace(/[^0-9.-]/g, ""));
  const nb = Number(String(b).replace(/[^0-9.-]/g, ""));
  if (Number.isFinite(na) && Number.isFinite(nb) && /\d/.test(String(a)) && /\d/.test(String(b))) {
    if (na === nb) return true;
  }
  return normalise(a) === normalise(b);
}

function normalise(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s,]+/g, " ")
    .trim();
}
