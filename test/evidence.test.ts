/** Unit tests for the verified-evidence contract: quote checking, location and scoring. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groundingScore,
  normaliseQuote,
  paragraphsFromRetrieval,
  verifyEvidence,
} from "../src/services/agents.ts";
import { evidenceFor, quoteFor } from "../src/services/mock-evidence.ts";
import { SCHEMAS, toAnswerJsonSchema } from "../src/services/schemas.ts";
import type { ExtractedField } from "../src/types.ts";

const SOURCE = [
  "ACME ROBOTICS PTY LTD",
  "Invoice Number: INV-2026-0042",
  "Invoice Date: 15/06/2026",
  "TOTAL DUE: $116,160.00 AUD",
].join("\n");

const fieldKeys = new Set(["vendor_name", "invoice_number", "invoice_date", "total"]);

test("every extraction schema asks the model for evidence", () => {
  for (const schema of Object.values(SCHEMAS)) {
    const ajs = toAnswerJsonSchema(schema) as {
      parameters: { properties: Record<string, { type: string; items?: unknown }>; required: string[] };
    };
    const evidence = ajs.parameters.properties.evidence;
    assert.ok(evidence, `${schema.name} is missing the evidence property`);
    assert.equal(evidence.type, "array");
    // Evidence must never be required: a model that cannot quote should omit it, not invent.
    assert.ok(!ajs.parameters.required.includes("evidence"));
    // …and the schema's own fields must survive alongside it.
    for (const key of Object.keys(schema.properties)) assert.ok(key in ajs.parameters.properties);
  }
});

test("an exact quote verifies and carries its offsets", () => {
  const [item] = verifyEvidence([{ field: "invoice_number", quote: "Invoice Number: INV-2026-0042" }], {
    sourceText: SOURCE,
    fieldKeys,
  });
  assert.equal(item!.verified, "exact");
  assert.equal(SOURCE.slice(item!.start, item!.end), "Invoice Number: INV-2026-0042");
});

test("a quote the model tidied still verifies, as normalised", () => {
  // Curly quotes, collapsed whitespace, a added full stop, different case — all things a
  // model does to a quote it believes it is copying verbatim.
  const [item] = verifyEvidence([{ field: "vendor_name", quote: "acme   robotics pty ltd." }], {
    sourceText: SOURCE,
    fieldKeys,
  });
  assert.equal(item!.verified, "normalised");
  assert.equal(item!.start, undefined, "a normalised match has no reliable offset");
});

test("a paraphrased or invented quote is unverified", () => {
  const [item] = verifyEvidence(
    [{ field: "total", quote: "The grand total came to one hundred and sixteen thousand dollars" }],
    { sourceText: SOURCE, fieldKeys },
  );
  assert.equal(item!.verified, "unverified");
});

test("numbers are never normalised away", () => {
  // $116,160.00 vs $116,180.00 must not be treated as the same quote.
  const [item] = verifyEvidence([{ field: "total", quote: "TOTAL DUE: $116,180.00 AUD" }], {
    sourceText: SOURCE,
    fieldKeys,
  });
  assert.equal(item!.verified, "unverified");
});

test("evidence for a field that was not extracted is dropped", () => {
  const out = verifyEvidence(
    [
      { field: "not_a_field", quote: "ACME ROBOTICS PTY LTD" },
      { field: "vendor_name", quote: "ACME ROBOTICS PTY LTD" },
      { field: "vendor_name", quote: "ACME ROBOTICS PTY LTD" }, // duplicate
      { field: "", quote: "x" },
      "nonsense",
      null,
    ],
    { sourceText: SOURCE, fieldKeys },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.field, "vendor_name");
});

test("a quote is pinned to the retrieval paragraph that contains it", () => {
  const retrieval = {
    resources: {
      res1: {
        fields: {
          "/f/file": {
            paragraphs: {
              "res1/f/file/0-22": { text: "ACME ROBOTICS PTY LTD", position: { start: 0, end: 22 } },
              "res1/f/file/22-52": {
                text: "Invoice Number: INV-2026-0042",
                position: { start: 22, end: 52 },
              },
            },
          },
        },
      },
      other: { fields: {} },
    },
  };
  const paragraphs = paragraphsFromRetrieval(retrieval, "res1");
  assert.equal(paragraphs.length, 2);
  const [item] = verifyEvidence([{ field: "invoice_number", quote: "Invoice Number: INV-2026-0042" }], {
    sourceText: SOURCE,
    fieldKeys,
    paragraphs,
  });
  assert.equal(item!.paragraphId, "res1/f/file/22-52");
});

test("a normalised match still finds its paragraph by text", () => {
  const paragraphs = [{ id: "p1", text: "ACME ROBOTICS PTY LTD" }];
  const [item] = verifyEvidence([{ field: "vendor_name", quote: "acme robotics pty ltd" }], {
    sourceText: SOURCE,
    fieldKeys,
    paragraphs,
  });
  assert.equal(item!.verified, "normalised");
  assert.equal(item!.paragraphId, "p1");
});

test("groundingScore is verified fields over extracted fields", () => {
  const fields: ExtractedField[] = [
    { key: "vendor_name", label: "Vendor", value: "ACME" },
    { key: "invoice_number", label: "Invoice #", value: "INV-1" },
    { key: "total", label: "Total", value: 1 },
    { key: "currency", label: "Currency", value: "AUD" },
  ];
  const score = groundingScore(fields, [
    { field: "vendor_name", quote: "a", verified: "exact" },
    { field: "invoice_number", quote: "b", verified: "normalised" },
    { field: "total", quote: "c", verified: "unverified" },
  ]);
  assert.equal(score, 0.5); // 2 of 4
  assert.equal(groundingScore([], []), undefined);
  assert.equal(groundingScore(fields, []), 0);
});

test("normaliseQuote folds typography but keeps the words", () => {
  assert.equal(normaliseQuote("  “Net 30”,  please. "), "net 30 please");
  assert.equal(normaliseQuote("A—B"), "a-b");
  assert.notEqual(normaliseQuote("116,160"), normaliseQuote("116,180"));
});

// ─── the mock's evidence hook (bootstrap code, not a vendored file) ────────────

test("quoteFor returns the whole line containing a value", () => {
  assert.equal(quoteFor(SOURCE, "INV-2026-0042"), "Invoice Number: INV-2026-0042");
  assert.equal(quoteFor(SOURCE, "nothing here"), undefined);
  assert.equal(quoteFor(SOURCE, "x"), undefined, "too short to be evidence");
});

test("evidenceFor quotes only schema fields it can find in the text", () => {
  const out = evidenceFor(
    {
      vendor_name: "ACME ROBOTICS PTY LTD",
      invoice_number: "INV-2026-0042",
      missing: "not in the document",
      not_in_schema: "ACME ROBOTICS PTY LTD",
      line_items: ["TOTAL DUE: $116,160.00 AUD"],
    },
    { vendor_name: {}, invoice_number: {}, missing: {}, line_items: {} },
    SOURCE,
  );
  const byField = Object.fromEntries(out.map((e) => [e.field, e.quote]));
  assert.equal(byField.vendor_name, "ACME ROBOTICS PTY LTD");
  assert.equal(byField.invoice_number, "Invoice Number: INV-2026-0042");
  assert.equal(byField.line_items, "TOTAL DUE: $116,160.00 AUD", "arrays quote their first item");
  assert.equal(byField.missing, undefined);
  assert.equal(byField.not_in_schema, undefined);
  // Everything it produces must verify against the same text — that is the point.
  for (const e of out) assert.ok(SOURCE.includes(e.quote), e.quote);
});
