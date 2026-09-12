/**
 * STARTER STUB — Exercise 4 / LAB.md Section 4.
 *
 * Not a file the product imports. Fill in the TODOs, then merge the finished function
 * into `src/services/formats.ts` alongside `toJson`/`toXml`/`toCsv`, and wire it up:
 *   1. `Format` type            add "markdown"
 *   2. `MIME` map               add markdown: "text/markdown; charset=utf-8"
 *   3. `serialize()` switch     add a "markdown" case
 *   4. src/routes/documents.ts  add "markdown" to the `FORMATS` Set
 *   5. src/openapi.ts           add "markdown" to the export operation's format enum
 *                                and its 200 response content map
 * See solutions/04-add-an-export-format.md for the finished, wired-up version.
 */
import type { DocumentRecord, ExtractedField } from "../../../src/types.ts";

// formats.ts already has a private `flatValue()` helper that does exactly this
// (arrays -> "; "-joined, null -> "", everything else -> String(value)) — reuse it
// rather than duplicating it once this lives in formats.ts.
function flatValue(value: ExtractedField["value"]): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join("; ");
  if (value === null) return "";
  return String(value);
}

// TODO: a Markdown table cell must not contain a literal "|" or a newline — escape or
// strip them. (Every other format function in formats.ts has its own escaping helper:
// `escapeXml` for XML, `csvCell` for CSV. This one needs the Markdown equivalent.)
function mdCell(value: string): string {
  // TODO
  return value;
}

/**
 * TODO: produce a single Markdown document:
 *   - a level-1 heading with the filename
 *   - doc type and status
 *   - the summary paragraph, if present
 *   - a two-column table of extracted fields (label, value — a confidence column is a
 *     nice bonus but not required)
 *   - an "## Entities" section (bulleted, one per entity — skip the heading entirely if
 *     there are none, same pattern as toXml's `if (rec.entities.length)`)
 *   - an "## Issues" section, same rule
 *
 * Keep it a pure function — no I/O, like every other function in this file. That's what
 * makes it trivially unit-testable (see LAB.md Section 5).
 */
export function toMarkdown(rec: DocumentRecord): string {
  // TODO
  return "";
}
