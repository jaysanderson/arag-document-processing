/**
 * STARTER STUB — Exercise 2 / LAB.md Section 2.
 *
 * This is not a file the product imports. Fill in the TODOs, then paste the finished
 * `insurance_card` entry into the `SCHEMAS` object in `src/services/schemas.ts` (the
 * file's own `s()`, `date()`, `money()`, `n()` and `arr()` helpers are private to that
 * module — once you paste this in, use them directly rather than re-importing
 * anything).
 *
 * Don't forget the other edit Section 2 walks through first:
 *   1. src/types.ts — add "insurance_card" to `DOC_TYPE_VALUES` (the single source of
 *      truth `DocType` is derived from — `src/openapi.ts` builds its enums from the
 *      same array, so there is no separate spec-side list to edit, and no test count to
 *      update either: the suite asserts against `DOC_TYPE_VALUES.length`, not a
 *      literal number).
 * Do step 1 on its own first and run `tsc --noEmit` — it will fail with a missing-key
 * error on `SCHEMAS` until you also do step 2 below. That failure is the point.
 *
 * Every extraction config now provisions TWO Knowledge Box objects (DP-46): a search
 * configuration (what the model is grounded against) and a key-value schema (what makes
 * a field filterable via `GET /api/v1/documents?kv=...`). `s()`, `date()` and `money()`
 * each build the same `JsonProp` shape but differ in the `kv` hint they attach — see
 * `KvHint`, `s()`, `date()`, `money()`, `n()` and `arr()` in `src/services/schemas.ts`
 * (roughly lines 35–100) for the real docstrings before you decide per field.
 */
import type { DocType } from "../../../src/types.ts";

// The real ExtractionSchema/JsonProp/KvHint shapes, for reference (defined in
// schemas.ts, not re-exported — this is just so this stub type-checks on its own).
type KvTypeHint = "text" | "integer" | "float" | "boolean" | "date";
interface KvHint {
  /** Knowledge Box field type. Overrides the type derived from the JSON-Schema type. */
  type?: KvTypeHint;
  /** Store a list of values. ARAG accepts `repeated` on `text` only. */
  repeated?: boolean;
  /** Store an interval (`{lower, upper}`). ARAG accepts `range` on integer/float/date only. */
  range?: boolean;
}
interface JsonProp {
  type: "string" | "number" | "boolean" | "array";
  description?: string;
  items?: { type: "string" | "number" };
  /** Key-value field override; not part of the JSON Schema sent to the model. */
  kv?: KvHint;
}
interface ExtractionSchema {
  name: string;
  docType: DocType;
  description: string;
  properties: Record<string, JsonProp>;
  required: string[];
  labels: Record<string, string>;
}

// TODO: think about which fields a health/medical insurance membership card actually
// carries. Some candidates, to get you started — add, remove, or rename as you see fit:
//   scheme          the insurer / medical scheme name
//   member_name     principal member's name as printed on the card
//   member_number   membership / policy number
//   plan_name       plan / benefit option
//   dependant_code  dependant code, if the card is for a dependant rather than the
//                   principal member
//   valid_from      a date field — use `date()`, not `s()`, once pasted into
//   valid_to        schemas.ts, so `gte`/`lte` filtering works on it later (`s()` would
//                   make it kv `text`, where only `eq` is legal)
//   (an amount, if the card prints one, e.g. a co-payment) — use `money()`, not `s()`,
//   so the Knowledge Box gets a `float` projection while the record keeps the string
//   exactly as printed
//
// TODO: which of these fields, if any, need a `kv` type override at all? Most string
// fields need none — `jsonPropToKvType()` defaults a plain string to kv `text`, which is
// correct for a name or an id. Only dates and amounts need `date()`/`money()` instead of
// `s()`. Get this wrong and the field still extracts fine — it just can't be filtered
// with `gte`/`lte` the way a date or amount should be.
export const insuranceCard: ExtractionSchema = {
  name: "insurance_card_extraction",
  docType: "insurance_card", // TODO this will not type-check until you've done step 1 above
  description: "TODO: one sentence describing what this schema captures",
  properties: {
    // TODO: fill in using s(...) / date(...) / money(...) / n(...) / arr(...) once
    // pasted into schemas.ts. Each property here is a placeholder — replace the whole
    // object.
    scheme: { type: "string", description: "TODO" },
  },
  required: [
    // TODO: which fields, if missing, should raise a validation issue? Look at how
    // `validateNormalize` in agents.ts uses `schema.required` before choosing. Note
    // (DP-47): whatever you list here is NOT enforced by the provisioned kv schema —
    // the product strips `required` before provisioning, because ARAG refuses the
    // entire key-value write when a required key is absent. `required` here still
    // drives the record's own validation issues; it just isn't a kv-side constraint.
  ],
  labels: {
    // TODO: a human label for every key in `properties`, above — `agents.test.ts`'s
    // "every schema is internally consistent" test checks this for every schema,
    // including yours, once it's registered.
    scheme: "TODO",
  },
};
