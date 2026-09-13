/**
 * Type declarations for the API explorer's model (`apispec.js`).
 *
 * The runtime stays plain browser JavaScript — it is linked straight from a
 * `<script type="module">` with no build step (STANDARDS § front end) — so these
 * declarations exist only so the unit tests and any TypeScript caller get a checked
 * surface. They double as the proposed contract for the kit component this module is a
 * candidate for (`arag-platform` v0.3.0, `apiExplorer()`).
 */

/** An OpenAPI document, as far as this module cares. */
export type OpenApiDoc = Record<string, unknown>;

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "head" | "options";

export interface ParameterModel {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  description: string;
  schema: SchemaNode;
}

export interface RequestBodyModel {
  required: boolean;
  description: string;
  /** The media type the form builds for — JSON when the operation offers it. */
  contentType: string;
  contentTypes: string[];
  /** Fully dereferenced: a form generator never meets a `$ref`. */
  schema: SchemaNode;
  example: unknown;
}

export interface ResponseModel {
  status: string;
  description: string;
  contentTypes: string[];
}

export interface OperationModel {
  /** `operationId`, or `"<method>:<path>"` when the spec omits one. */
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  tags: string[];
  deprecated: boolean;
  /** POST / PUT / PATCH / DELETE. */
  mutating: boolean;
  parameters: ParameterModel[];
  requestBody: RequestBodyModel | null;
  responses: ResponseModel[];
  security: unknown[];
}

export interface TagGroup {
  tag: string;
  description: string;
  operations: OperationModel[];
}

/** A flat form model keyed `"<in>:<name>"`, plus `body` and `file`. */
export type FormValues = Record<string, unknown>;

export interface BuiltRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  /** Required inputs the form has not supplied yet; empty means ready to send. */
  missing: string[];
  credentials: "same-origin" | "omit";
}

export interface RiskModel {
  writes: boolean;
  destructive: boolean;
  needsCredential: boolean;
  label: "Read-only" | "Changes data" | "Destructive";
}

export interface CoverageRow {
  id: string;
  method: string;
  path: string;
  tag: string;
  /** The product screen that exercises the operation, when one does. */
  screen: string | null;
  /**
   * Whether the explorer rendered this operation. `true` by assumption when no
   * `explorerIds` set is supplied — the check that actually proves it is the e2e spec.
   */
  explorer: boolean;
}

export const HTTP_METHODS: HttpMethod[];

/**
 * A JSON-Schema-ish node. Indexable with `any` on purpose: a form generator reaches into
 * arbitrary keywords (`enum`, `format`, `minimum`, vendor extensions) that no closed type
 * can enumerate, and narrowing each access at every call site would add noise, not safety.
 */
// biome-ignore lint/suspicious/noExplicitAny: open-world JSON Schema node — see above.
export type SchemaNode = { [keyword: string]: any };

export function resolveRef(doc: OpenApiDoc, node: unknown, seen?: Set<string>): SchemaNode;
export function deref(doc: OpenApiDoc, schema: unknown, depth?: number): SchemaNode;
export function operations(doc: OpenApiDoc): OperationModel[];
export function byTag(doc: OpenApiDoc, ops?: OperationModel[]): TagGroup[];
export function searchOperations(ops: OperationModel[], q: string | null | undefined): OperationModel[];
export function sampleBody(schema: unknown, depth?: number): unknown;
export function buildRequest(
  op: OperationModel,
  values?: FormValues,
  opts?: { apiKey?: string; adminToken?: string },
): BuiltRequest;
export function toCurl(req: BuiltRequest, opts?: { origin?: string; reveal?: boolean }): string;
export function operationRisk(op: OperationModel): RiskModel;
export function coverage(
  doc: OpenApiDoc,
  opts?: { screens?: Record<string, string>; explorerIds?: Iterable<string> | null },
): CoverageRow[];
