import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewedRecord } from "../src/services/review.ts";
import { applyCorrection, paragraphsByResource, verifyValue } from "../src/services/review.ts";

const TEXT = [
  "INVOICE",
  "Supplier: Northwind Traders Pty Ltd",
  "Invoice number: INV-2026-0142",
  "Total due: $12,480.00",
  "Line items: widgets, flanges, gaskets",
].join("\n");

function record(): ReviewedRecord {
  return {
    id: "doc-1",
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
    resourceId: "res-1",
    filename: "scan-0041.pdf",
    contentType: "application/pdf",
    bytes: 1024,
    status: "ready",
    docType: "invoice",
    fields: [
      {
        key: "invoice_number",
        label: "Invoice Number",
        value: "INV-2026-0141",
        confidence: 0.61,
        raw: "INV 2026 0141",
      },
      { key: "supplier", label: "Supplier", value: "Northwind Traders Pty Ltd", confidence: 0.94 },
    ],
    entities: [],
    tags: [],
    issues: [],
    evidence: [
      { field: "invoice_number", quote: "INV-2026-0141", verified: "unverified" },
      { field: "supplier", quote: "Northwind Traders Pty Ltd", verified: "exact", start: 27, end: 52 },
    ],
    meta: {
      processedAt: "2026-09-13T00:00:00.000Z",
      schema: "invoice_extraction",
      model: "test",
      durationsMs: {},
      groundingScore: 0.5,
    },
  };
}

// ── verifyValue: the evidence contract applied to a human-entered value ──────────────

test("verifyValue: a corrected value present verbatim is exact and carries offsets", () => {
  const out = verifyValue("INV-2026-0142", TEXT);
  assert.equal(out.verified, "exact");
  assert.equal(TEXT.slice(out.start, out.end), "INV-2026-0142");
});

test("verifyValue: a value that only matches once normalised is normalised, with no offsets", () => {
  const out = verifyValue("total due $12,480.00", TEXT);
  assert.equal(out.verified, "normalised");
  assert.equal(out.start, undefined);
});

test("verifyValue: a value that is not in the document is unverified", () => {
  assert.equal(verifyValue("INV-9999-0001", TEXT).verified, "unverified");
});

test("verifyValue: numbers and booleans are compared as printed", () => {
  assert.equal(verifyValue(12480, TEXT).verified, "unverified");
  assert.equal(verifyValue(true, TEXT).verified, "unverified");
});

test("verifyValue: a repeated value is grounded only when every element is present", () => {
  assert.equal(verifyValue(["widgets", "flanges", "gaskets"], TEXT).verified, "exact");
  assert.equal(verifyValue(["widgets", "sprockets"], TEXT).verified, "unverified");
  // No single span to highlight across several elements, so no offsets are claimed.
  assert.equal(verifyValue(["widgets", "flanges"], TEXT).start, undefined);
});

test("verifyValue: an empty value or empty source text is unverified", () => {
  assert.equal(verifyValue(null, TEXT).verified, "unverified");
  assert.equal(verifyValue("INV-2026-0142", "").verified, "unverified");
});

// ── applyCorrection ─────────────────────────────────────────────────────────────────

test("applyCorrection replaces the value and keeps the previous one on the correction", () => {
  const { record: next, correction } = applyCorrection(
    record(),
    { field: "invoice_number", value: "INV-2026-0142", reason: "OCR dropped a digit", actor: "reviewer" },
    { sourceText: TEXT, now: "2026-09-13T10:00:00.000Z" },
  );
  assert.equal(next.fields[0]!.value, "INV-2026-0142");
  assert.equal(correction.previousValue, "INV-2026-0141");
  assert.equal(correction.actor, "reviewer");
  assert.equal(correction.reason, "OCR dropped a digit");
  assert.equal(correction.at, "2026-09-13T10:00:00.000Z");
});

test("applyCorrection drops the model's confidence and raw value — a human value has neither", () => {
  const { record: next } = applyCorrection(
    record(),
    { field: "invoice_number", value: "INV-2026-0142", actor: "reviewer" },
    { sourceText: TEXT },
  );
  assert.equal(next.fields[0]!.confidence, undefined);
  assert.equal(next.fields[0]!.raw, undefined);
});

test("applyCorrection replaces the stale quote with one that supports the new value", () => {
  const { record: next, correction } = applyCorrection(
    record(),
    { field: "invoice_number", value: "INV-2026-0142", actor: "reviewer" },
    { sourceText: TEXT },
  );
  const ev = next.evidence.filter((e) => e.field === "invoice_number");
  assert.equal(ev.length, 1);
  assert.equal(ev[0]!.quote, "INV-2026-0142");
  assert.equal(ev[0]!.verified, "exact");
  assert.equal(correction.verified, "exact");
  // The invariant the whole Source & evidence tab rests on (DP-36).
  assert.equal(TEXT.slice(ev[0]!.start, ev[0]!.end), ev[0]!.quote);
});

test("applyCorrection leaves a field with no quote when the corrected value is not in the document", () => {
  const { record: next, correction } = applyCorrection(
    record(),
    { field: "invoice_number", value: "INV-9999-0001", actor: "reviewer" },
    { sourceText: TEXT },
  );
  assert.equal(
    next.evidence.some((e) => e.field === "invoice_number"),
    false,
  );
  assert.equal(correction.verified, "unverified");
  // The other field's evidence is untouched.
  assert.equal(next.evidence.filter((e) => e.field === "supplier").length, 1);
});

test("applyCorrection appends to the correction history rather than overwriting it", () => {
  const first = applyCorrection(
    record(),
    { field: "invoice_number", value: "INV-2026-0142", actor: "a" },
    { sourceText: TEXT },
  ).record;
  const second = applyCorrection(
    first,
    { field: "invoice_number", value: "INV-2026-0143", actor: "b" },
    { sourceText: TEXT },
  ).record;
  assert.equal(second.corrections?.length, 2);
  assert.equal(second.corrections?.[0]!.previousValue, "INV-2026-0141");
  assert.equal(second.corrections?.[1]!.previousValue, "INV-2026-0142");
});

test("applyCorrection does not mutate the record it was given", () => {
  const original = record();
  applyCorrection(original, { field: "invoice_number", value: "X", actor: "a" }, { sourceText: TEXT });
  assert.equal(original.fields[0]!.value, "INV-2026-0141");
  assert.equal(original.corrections, undefined);
});

test("applyCorrection rejects a field the record does not have", () => {
  assert.throws(
    () => applyCorrection(record(), { field: "nope", value: "x", actor: "a" }, { sourceText: TEXT }),
    /unknown field: nope/,
  );
});

// ── paragraphsByResource: cross-document citations keep their resource ───────────────

test("paragraphsByResource keeps the resource id each paragraph came from", () => {
  const out = paragraphsByResource({
    resources: {
      "res-1": {
        fields: {
          "/a/title": {
            paragraphs: { "res-1/a/title/0-10": { text: "one", position: { start: 0, end: 10 } } },
          },
        },
      },
      "res-2": {
        fields: {
          "/a/title": {
            paragraphs: { "res-2/a/title/5-9": { text: "two", position: { start: 5, end: 9 } } },
          },
        },
      },
    },
  });
  assert.deepEqual(
    out.map((p) => [p.resourceId, p.id, p.text, p.start, p.end]),
    [
      ["res-1", "res-1/a/title/0-10", "one", 0, 10],
      ["res-2", "res-2/a/title/5-9", "two", 5, 9],
    ],
  );
});

test("paragraphsByResource tolerates an empty or malformed retrieval payload", () => {
  assert.deepEqual(paragraphsByResource(undefined), []);
  assert.deepEqual(paragraphsByResource({}), []);
  assert.deepEqual(paragraphsByResource({ resources: { "res-1": {} } }), []);
});
