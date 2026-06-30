/**
 * Extraction schema library.
 *
 * Each schema is an OpenAI-function-style JSON Schema passed to ARAG `/ask` as
 * `answer_json_schema`. ARAG forces the (multimodal) generative model to return a
 * structured object matching it — this is the "custom visual-LLM extraction" layer:
 * the model reads the processed document (text + page images/layout) and fills the
 * schema, grounded in the actual file.
 *
 * Schemas are intentionally flat and demo-legible. `field()` keeps them terse.
 */

import type { DocType } from "./types.ts";

export interface ExtractionSchema {
  /** Schema name (also used as answer_json_schema.name). */
  name: string;
  /** Doc type this schema targets. */
  docType: DocType;
  /** Human description shown in the UI and sent to the model. */
  description: string;
  /** JSON Schema "properties" for the extraction object. */
  properties: Record<string, JsonProp>;
  /** Required property keys. */
  required: string[];
  /** Friendly labels for keys (UI + canonical record). */
  labels: Record<string, string>;
}

export interface JsonProp {
  type: "string" | "number" | "boolean" | "array";
  description?: string;
  items?: { type: "string" | "number" };
}

function s(description: string): JsonProp {
  return { type: "string", description };
}
/**
 * Money/amount fields are declared as STRINGS, not numbers. Forcing the model to emit
 * a JSON `number` for a currency-formatted value ("$96,000.00") is unreliable — it
 * frequently returns 0. Capturing the raw string and letting `validateNormalize`
 * deterministically parse it to a number is both robust and preserves the original.
 */
function money(description: string): JsonProp {
  return { type: "string", description: `${description} (capture exactly as written, including currency/symbols)` };
}
function n(description: string): JsonProp {
  return { type: "number", description };
}
function arr(description: string): JsonProp {
  return { type: "array", description, items: { type: "string" } };
}

export const SCHEMAS: Record<DocType, ExtractionSchema> = {
  invoice: {
    name: "invoice_extraction",
    docType: "invoice",
    description: "Structured fields from a commercial invoice or bill.",
    properties: {
      vendor_name: s("Name of the vendor / supplier issuing the invoice"),
      vendor_address: s("Vendor postal address, if present"),
      bill_to: s("Customer / bill-to party"),
      invoice_number: s("Invoice number or identifier"),
      invoice_date: s("Invoice issue date in ISO 8601 (YYYY-MM-DD) if determinable"),
      due_date: s("Payment due date in ISO 8601 if determinable"),
      currency: s("ISO 4217 currency code, e.g. USD, AUD, EUR"),
      subtotal: money("Subtotal amount before tax"),
      tax: money("Total tax amount"),
      total: money("Grand total / amount due"),
      line_items: arr("One string per line item, e.g. 'Widget x2 @ $10 = $20'"),
      po_number: s("Referenced purchase-order number, if any"),
    },
    required: ["vendor_name", "invoice_number", "total"],
    labels: {
      vendor_name: "Vendor",
      vendor_address: "Vendor Address",
      bill_to: "Bill To",
      invoice_number: "Invoice #",
      invoice_date: "Invoice Date",
      due_date: "Due Date",
      currency: "Currency",
      subtotal: "Subtotal",
      tax: "Tax",
      total: "Total",
      line_items: "Line Items",
      po_number: "PO #",
    },
  },

  receipt: {
    name: "receipt_extraction",
    docType: "receipt",
    description: "Structured fields from a retail or expense receipt.",
    properties: {
      merchant: s("Merchant / store name"),
      transaction_date: s("Transaction date in ISO 8601 if determinable"),
      currency: s("ISO 4217 currency code"),
      subtotal: money("Subtotal before tax"),
      tax: money("Tax amount"),
      total: money("Total paid"),
      payment_method: s("Payment method, e.g. Visa, cash"),
      items: arr("Purchased items, one per entry"),
    },
    required: ["merchant", "total"],
    labels: {
      merchant: "Merchant",
      transaction_date: "Date",
      currency: "Currency",
      subtotal: "Subtotal",
      tax: "Tax",
      total: "Total",
      payment_method: "Payment Method",
      items: "Items",
    },
  },

  contract: {
    name: "contract_extraction",
    docType: "contract",
    description: "Key terms from a legal agreement or contract.",
    properties: {
      title: s("Contract title / type, e.g. 'Master Services Agreement'"),
      parties: arr("Names of the contracting parties"),
      effective_date: s("Effective date in ISO 8601 if determinable"),
      term: s("Contract term / duration"),
      governing_law: s("Governing law / jurisdiction"),
      total_value: s("Total contract value, with currency"),
      termination: s("Termination / notice provisions summary"),
      key_obligations: arr("Material obligations, one per entry"),
    },
    required: ["title", "parties"],
    labels: {
      title: "Title",
      parties: "Parties",
      effective_date: "Effective Date",
      term: "Term",
      governing_law: "Governing Law",
      total_value: "Total Value",
      termination: "Termination",
      key_obligations: "Key Obligations",
    },
  },

  resume: {
    name: "resume_extraction",
    docType: "resume",
    description: "Structured fields from a resume / CV.",
    properties: {
      full_name: s("Candidate full name"),
      email: s("Email address"),
      phone: s("Phone number"),
      location: s("Location / city"),
      headline: s("Professional headline or current title"),
      years_experience: n("Approximate total years of experience"),
      skills: arr("Notable skills / technologies"),
      employers: arr("Recent employers, one per entry"),
      education: arr("Degrees / institutions, one per entry"),
    },
    required: ["full_name"],
    labels: {
      full_name: "Name",
      email: "Email",
      phone: "Phone",
      location: "Location",
      headline: "Headline",
      years_experience: "Years Experience",
      skills: "Skills",
      employers: "Employers",
      education: "Education",
    },
  },

  purchase_order: {
    name: "purchase_order_extraction",
    docType: "purchase_order",
    description: "Structured fields from a purchase order.",
    properties: {
      po_number: s("Purchase order number"),
      buyer: s("Buyer / ordering organization"),
      supplier: s("Supplier / vendor"),
      order_date: s("Order date in ISO 8601 if determinable"),
      currency: s("ISO 4217 currency code"),
      total: money("Order total"),
      line_items: arr("Ordered items, one per entry"),
      ship_to: s("Ship-to address"),
    },
    required: ["po_number", "supplier"],
    labels: {
      po_number: "PO #",
      buyer: "Buyer",
      supplier: "Supplier",
      order_date: "Order Date",
      currency: "Currency",
      total: "Total",
      line_items: "Line Items",
      ship_to: "Ship To",
    },
  },

  form: {
    name: "form_extraction",
    docType: "form",
    description: "Field/value pairs from a structured form.",
    properties: {
      form_title: s("Title or type of the form"),
      reference: s("Reference / case / application number"),
      submitted_by: s("Person or entity who submitted the form"),
      submitted_date: s("Submission date in ISO 8601 if determinable"),
      fields: arr("All field:value pairs found, formatted as 'Label: Value'"),
    },
    required: ["form_title"],
    labels: {
      form_title: "Form Title",
      reference: "Reference",
      submitted_by: "Submitted By",
      submitted_date: "Submitted Date",
      fields: "Fields",
    },
  },

  report: {
    name: "report_extraction",
    docType: "report",
    description: "Key facts from a report or whitepaper.",
    properties: {
      title: s("Report title"),
      author: s("Author or publishing organization"),
      date: s("Publication date in ISO 8601 if determinable"),
      key_findings: arr("Key findings / takeaways, one per entry"),
      metrics: arr("Notable metrics or figures, one per entry"),
    },
    required: ["title"],
    labels: {
      title: "Title",
      author: "Author",
      date: "Date",
      key_findings: "Key Findings",
      metrics: "Metrics",
    },
  },

  generic: {
    name: "generic_extraction",
    docType: "generic",
    description: "Generic structured summary for an uncategorized document.",
    properties: {
      title: s("A concise title for the document"),
      document_kind: s("What kind of document this appears to be"),
      key_values: arr("Most important field:value pairs, formatted as 'Label: Value'"),
      dates: arr("Any significant dates found, ISO 8601 where possible"),
      amounts: arr("Any monetary amounts found, with currency"),
      people_orgs: arr("People and organizations mentioned"),
    },
    required: ["title"],
    labels: {
      title: "Title",
      document_kind: "Document Kind",
      key_values: "Key Values",
      dates: "Dates",
      amounts: "Amounts",
      people_orgs: "People & Orgs",
    },
  },
};

/** Build the answer_json_schema payload ARAG expects for a given schema. */
export function toAnswerJsonSchema(schema: ExtractionSchema): unknown {
  return {
    name: schema.name,
    description: schema.description,
    parameters: {
      type: "object",
      properties: schema.properties,
      required: schema.required,
    },
  };
}

export function schemaFor(docType: DocType): ExtractionSchema {
  return SCHEMAS[docType] ?? SCHEMAS.generic;
}

/** All doc types the classifier may choose from. */
export const DOC_TYPES: DocType[] = Object.keys(SCHEMAS) as DocType[];
