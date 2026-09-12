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

  medical_claim: {
    name: "medical_claim_extraction",
    docType: "medical_claim",
    description: "Structured fields from a medical/health insurance claim or claims remittance advice.",
    properties: {
      claim_number: s("Claim number or identifier"),
      scheme: s("Medical scheme / insurer name"),
      member_number: s("Member / policy number"),
      patient_name: s("Patient name"),
      provider: s("Treating provider or facility that rendered the service"),
      service_date: s("Date of service in ISO 8601 if determinable"),
      diagnosis_code: s("Primary diagnosis code (e.g. ICD-10)"),
      procedure_code: s("Procedure / tariff code (e.g. CPT)"),
      currency: s("ISO 4217 currency code"),
      amount_claimed: money("Total amount claimed"),
      amount_paid: money("Total amount paid"),
      member_liability: money("Amount for the member's account / co-payment"),
      status: s("Claim status, e.g. paid in full, partially paid, rejected"),
    },
    required: ["provider"],
    labels: {
      claim_number: "Claim #",
      scheme: "Scheme / Insurer",
      member_number: "Member #",
      patient_name: "Patient",
      provider: "Provider",
      service_date: "Service Date",
      diagnosis_code: "Diagnosis (ICD-10)",
      procedure_code: "Procedure / Tariff",
      currency: "Currency",
      amount_claimed: "Amount Claimed",
      amount_paid: "Amount Paid",
      member_liability: "Member Liability",
      status: "Status",
    },
  },

  preauthorisation: {
    name: "preauthorisation_extraction",
    docType: "preauthorisation",
    description: "Structured fields from a hospital/medical pre-authorisation request or outcome.",
    properties: {
      authorisation_number: s("Authorisation number, if issued"),
      reference: s("Form / request reference number"),
      scheme: s("Medical scheme name"),
      benefit_option: s("Benefit option / plan"),
      member_number: s("Membership number"),
      patient_name: s("Patient name"),
      provider: s("Treating provider / practitioner"),
      facility: s("Hospital / facility name"),
      admission_date: s("Proposed admission date in ISO 8601 if determinable"),
      length_of_stay: s("Approved or requested length of stay"),
      procedure: s("Procedure description and/or code"),
      diagnosis_code: s("Primary diagnosis code (e.g. ICD-10)"),
      status: s("Authorisation status, e.g. approved, declined, pending"),
      co_payment: s("Co-payment applicable, if any"),
    },
    required: ["member_number"],
    labels: {
      authorisation_number: "Authorisation #",
      reference: "Reference",
      scheme: "Scheme",
      benefit_option: "Benefit Option",
      member_number: "Member #",
      patient_name: "Patient",
      provider: "Provider",
      facility: "Facility",
      admission_date: "Admission Date",
      length_of_stay: "Length of Stay",
      procedure: "Procedure",
      diagnosis_code: "Diagnosis (ICD-10)",
      status: "Status",
      co_payment: "Co-payment",
    },
  },

  bank_statement: {
    name: "bank_statement_extraction",
    docType: "bank_statement",
    description: "Header/summary fields from a bank or financial account statement.",
    properties: {
      bank_name: s("Bank / financial institution name"),
      account_holder: s("Account holder name"),
      account_number: s("Account number (may be masked)"),
      statement_period: s("Statement period / date range"),
      currency: s("ISO 4217 currency code"),
      opening_balance: money("Opening balance"),
      closing_balance: money("Closing balance"),
      transactions: arr("Notable transactions, one per entry as 'date — description — amount'"),
    },
    required: ["bank_name", "account_holder"],
    labels: {
      bank_name: "Bank",
      account_holder: "Account Holder",
      account_number: "Account #",
      statement_period: "Statement Period",
      currency: "Currency",
      opening_balance: "Opening Balance",
      closing_balance: "Closing Balance",
      transactions: "Transactions",
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

// ─── Config catalog (for the UI selector / manager) ────────────────────────────

export interface ConfigField {
  key: string;
  label: string;
  type: "string" | "number" | "array";
  description?: string;
  required?: boolean;
}

export interface ConfigSummary {
  id: string; // built-in: the docType; custom: a generated id
  name: string; // human label
  docType: string;
  description: string;
  builtin: boolean;
  /** Name of the stored ARAG search_configuration backing this config. */
  aragConfig: string;
  fields: ConfigField[];
}

/** Project a schema to the flat field list the UI shows in the config manager. */
export function schemaToFields(schema: ExtractionSchema): ConfigField[] {
  return Object.entries(schema.properties).map(([key, prop]) => ({
    key,
    label: schema.labels[key] ?? key,
    type: prop.type === "boolean" ? "string" : prop.type,
    description: prop.description,
    required: schema.required.includes(key),
  }));
}

/** The built-in configs, as summaries for the UI. */
export function builtinConfigs(): ConfigSummary[] {
  return DOC_TYPES.map((dt) => {
    const schema = SCHEMAS[dt];
    return {
      id: dt,
      name: dt.replace(/_/g, " "),
      docType: dt,
      description: schema.description,
      builtin: true,
      aragConfig: `dip_${schema.name}`,
      fields: schemaToFields(schema),
    };
  });
}

/** Sanitize an arbitrary label into a stable machine key. */
function toKey(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field"
  );
}

export interface CustomConfigInput {
  name: string;
  description?: string;
  fields: Array<{ key?: string; label: string; type?: "string" | "number" | "array"; description?: string; required?: boolean }>;
}

/**
 * Build a valid ExtractionSchema from a user-defined config. Money/number fields are
 * declared as strings + normalized downstream, consistent with the built-in schemas;
 * here a "number" field is captured as a string and parsed by validateNormalize only if
 * its key is a known amount key, so custom numbers stay literal unless clearly monetary.
 */
export function buildCustomSchema(input: CustomConfigInput): ExtractionSchema {
  const properties: Record<string, JsonProp> = {};
  const labels: Record<string, string> = {};
  const required: string[] = [];
  const usedKeys = new Set<string>();

  for (const f of input.fields) {
    if (!f.label?.trim()) continue;
    let key = (f.key && f.key.trim()) || toKey(f.label);
    while (usedKeys.has(key)) key = `${key}_2`;
    usedKeys.add(key);
    const type = f.type === "number" ? "number" : f.type === "array" ? "array" : "string";
    properties[key] =
      type === "array"
        ? { type: "array", description: f.description, items: { type: "string" } }
        : { type, description: f.description };
    labels[key] = f.label.trim();
    if (f.required) required.push(key);
  }

  const safeName = toKey(input.name) || "custom";
  return {
    name: `custom_${safeName}`,
    docType: "generic",
    description: input.description?.trim() || `Custom extraction config: ${input.name}`,
    properties,
    required,
    labels,
  };
}
