import assert from "node:assert/strict";
import { test } from "node:test";
import { serialize, toCsv, toJson, toXml } from "../src/services/formats.ts";
import type { DocumentRecord } from "../src/types.ts";

function sample(): DocumentRecord {
  return {
    id: "abc123",
    resourceId: "abc123",
    status: "ready",
    bytes: 2048,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:05.000Z",
    filename: "invoice.pdf",
    contentType: "application/pdf",
    docType: "invoice",
    docTypeConfidence: 0.97,
    fields: [
      { key: "vendor_name", label: "Vendor", value: "Acme Robotics <Pty> & Co", confidence: 0.95 },
      { key: "total", label: "Total", value: 105600, confidence: 0.95 },
      {
        key: "line_items",
        label: "Line Items",
        value: ["Printer x2 @ $48,000", 'Cable "premium"'],
        confidence: 0.85,
      },
    ],
    entities: [{ text: "Acme Robotics", type: "ORG" }],
    summary: "An invoice from Acme.",
    tags: ["invoice", "hardware"],
    issues: [{ field: "tax", severity: "warning", message: "subtotal + tax ≠ total" }],
    meta: {
      processedAt: "2026-06-30T00:00:00.000Z",
      schema: "invoice_extraction",
      model: "chatgpt-azure-4o",
      durationsMs: {},
    },
  };
}

test("toJson round-trips to the same object", () => {
  const rec = sample();
  const parsed = JSON.parse(toJson(rec));
  assert.deepEqual(parsed, rec);
});

test("toXml escapes special characters and is well-formed-ish", () => {
  const xml = toXml(sample());
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<document id="abc123" type="invoice">/);
  // angle brackets and ampersand escaped
  assert.match(xml, /Acme Robotics &lt;Pty&gt; &amp; Co/);
  assert.ok(!/<Pty>/.test(xml), "raw <Pty> must not appear unescaped");
  // array becomes <item> children
  assert.match(xml, /<item>Printer x2 @ \$48,000<\/item>/);
  // balanced root tag
  assert.match(xml, /<\/document>$/);
});

test("toCsv emits one row per field with a header and quotes risky cells", () => {
  const csv = toCsv(sample());
  const lines = csv.split("\n");
  assert.equal(lines[0], "document_id,filename,doc_type,field_key,field_label,value,confidence");
  assert.equal(lines.length, 1 + 3); // header + 3 fields
  // comma-containing array value must be quoted
  const itemsRow = lines.find((l) => l.startsWith("abc123,invoice.pdf,invoice,line_items"))!;
  assert.match(itemsRow, /"Printer x2 @ \$48,000; Cable ""premium"""/);
});

test("serialize dispatches by format", () => {
  const rec = sample();
  assert.equal(serialize(rec, "json"), toJson(rec));
  assert.equal(serialize(rec, "xml"), toXml(rec));
  assert.equal(serialize(rec, "csv"), toCsv(rec));
});
