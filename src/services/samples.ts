/**
 * The bundled sample documents behind the first-run flow and “Try with a sample”.
 *
 * These are ordinary files served from `public/samples/`; nothing about them is
 * special-cased in the pipeline. The catalogue exists so the UI does not hard-code a list
 * of filenames, and so a partner embedding the product can discover what ships with it
 * from the API (`GET /api/v1/samples`) rather than from the repository.
 */
import type { DocType } from "../types.ts";

export interface Sample {
  id: string;
  title: string;
  description: string;
  filename: string;
  contentType: string;
  /** Static path the client fetches the bytes from before uploading them. */
  url: string;
  kind: "text" | "image";
  expectedDocType: DocType;
}

const text = (
  id: string,
  title: string,
  description: string,
  expectedDocType: DocType,
  file = `${id}.txt`,
): Sample => ({
  id,
  title,
  description,
  filename: file,
  contentType: "text/plain",
  url: `/samples/${file}`,
  kind: "text",
  expectedDocType,
});

const image = (
  id: string,
  title: string,
  description: string,
  expectedDocType: DocType,
  file = `${id}.png`,
): Sample => ({
  id,
  title,
  description,
  filename: file,
  contentType: "image/png",
  url: `/samples/images/${file}`,
  kind: "image",
  expectedDocType,
});

export const SAMPLES: readonly Sample[] = [
  text(
    "invoice",
    "Supplier invoice",
    "A clean tax invoice: supplier, invoice number, dates, line items, subtotal, tax and total.",
    "invoice",
  ),
  text(
    "purchase-order",
    "Purchase order",
    "Buyer, supplier, PO number and an item table — the other half of a three-way match.",
    "purchase_order",
  ),
  text(
    "contract",
    "Services agreement",
    "Parties, term, value, governing law and termination provisions. Good for the ask panel.",
    "contract",
  ),
  text(
    "bank-statement",
    "Bank statement",
    "Account holder, statement period, opening and closing balances and a transaction list.",
    "bank_statement",
  ),
  text("receipt", "Retail receipt", "A short till receipt: merchant, items, tax and total.", "receipt"),
  text("resume", "Résumé", "Candidate, contact details, skills and employment history.", "resume"),
  image(
    "invoice-image",
    "Scanned invoice",
    "A photographed invoice — the visual path, read as an image rather than as text.",
    "invoice",
    "invoice.png",
  ),
  image(
    "purchase-order-image",
    "Scanned purchase order",
    "A photographed purchase order for the visual extraction path.",
    "purchase_order",
    "purchase-order.png",
  ),
  image(
    "preauth-form-image",
    "Pre-authorisation form",
    "A scanned hospital pre-authorisation request with boxed form fields.",
    "preauthorisation",
    "preauth-form.png",
  ),
  image(
    "remittance-statement-image",
    "Remittance statement",
    "A scanned remittance advice — a dense, tabular document with no dedicated schema.",
    "generic",
    "remittance-statement.png",
  ),
];
