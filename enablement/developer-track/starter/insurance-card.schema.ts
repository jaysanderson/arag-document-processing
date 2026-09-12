/**
 * STARTER STUB — Exercise 2 / LAB.md Section 2.
 *
 * This is not a file the product imports. Fill in the TODOs, then paste the finished
 * `insurance_card` entry into the `SCHEMAS` object in `src/services/schemas.ts` (the
 * file's own `s()`, `money()`, `n()` and `arr()` helpers are private to that module —
 * once you paste this in, use them directly rather than re-importing anything).
 *
 * Don't forget the other edit Section 2 walks through first:
 *   1. src/types.ts — add "insurance_card" to `DOC_TYPE_VALUES` (the single source of
 *      truth `DocType` is derived from — `src/openapi.ts` builds its enums from the
 *      same array, so there is no separate spec-side list to edit, and no test count to
 *      update either: the suite asserts against `DOC_TYPE_VALUES.length`, not a
 *      literal number).
 * Do step 1 on its own first and run `tsc --noEmit` — it will fail with a missing-key
 * error on `SCHEMAS` until you also do step 2 below. That failure is the point.
 */
import type { DocType } from "../../../src/types.ts";

// The real ExtractionSchema/JsonProp shapes, for reference (defined in schemas.ts,
// not re-exported — this is just so this stub type-checks on its own).
interface JsonProp {
  type: "string" | "number" | "boolean" | "array";
  description?: string;
  items?: { type: "string" | "number" };
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
//   valid_from      TODO: what format should dates be captured in? (hint: look at how
//                   every other schema in schemas.ts declares a date field, and why —
//                   see the `s()` helper's docstring for `invoice_date`)
//   valid_to
export const insuranceCard: ExtractionSchema = {
  name: "insurance_card_extraction",
  docType: "insurance_card", // TODO this will not type-check until you've done step 1 above
  description: "TODO: one sentence describing what this schema captures",
  properties: {
    // TODO: fill in using s(...) / money(...) / n(...) / arr(...) once pasted into
    // schemas.ts. Each property here is a placeholder — replace the whole object.
    scheme: { type: "string", description: "TODO" },
  },
  required: [
    // TODO: which fields, if missing, should raise a validation issue? Look at how
    // `validateNormalize` in agents.ts uses `schema.required` before choosing.
  ],
  labels: {
    // TODO: a human label for every key in `properties`, above — `agents.test.ts`'s
    // "every schema is internally consistent" test checks this for every schema,
    // including yours, once it's registered.
    scheme: "TODO",
  },
};
