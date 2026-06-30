import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseDateISO, normalizeCurrency } from "../src/normalize.ts";

test("parseAmount handles currency symbols, commas, decimals", () => {
  assert.equal(parseAmount("$105,600"), 105600);
  assert.equal(parseAmount("105,600.00"), 105600);
  assert.equal(parseAmount("9600"), 9600);
  assert.equal(parseAmount("$1,234.50"), 1234.5);
  assert.equal(parseAmount(96000), 96000);
});

test("parseAmount handles parentheses as negative and junk as null", () => {
  assert.equal(parseAmount("($50.00)"), -50);
  assert.equal(parseAmount("n/a"), null);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount(null), null);
});

test("parseAmount: comma-decimal vs thousands", () => {
  assert.equal(parseAmount("1,50"), 1.5); // decimal comma
  assert.equal(parseAmount("1,500"), 1500); // thousands
});

test("parseDateISO normalizes common formats", () => {
  assert.equal(parseDateISO("2026-06-15"), "2026-06-15");
  assert.equal(parseDateISO("15/06/2026"), "2026-06-15"); // D/M/Y default
  assert.equal(parseDateISO("13/06/2026"), "2026-06-13"); // day>12 → unambiguous D/M/Y
  assert.equal(parseDateISO("15 June 2026"), "2026-06-15");
  assert.equal(parseDateISO("June 15, 2026"), "2026-06-15");
  assert.equal(parseDateISO("not a date"), null);
});

test("normalizeCurrency maps symbols and codes", () => {
  assert.equal(normalizeCurrency("$"), "USD");
  assert.equal(normalizeCurrency("AUD"), "AUD");
  assert.equal(normalizeCurrency("usd"), "USD");
  assert.equal(normalizeCurrency("€"), "EUR");
  assert.equal(normalizeCurrency("???"), null);
});
