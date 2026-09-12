/**
 * Pure value-normalization helpers used by the validator/normalizer agent.
 * Deterministic and unit-tested — no model calls here.
 */

/** Parse a money-ish string into a number, or null. Handles $, commas, parentheses (negatives). */
export function parseAmount(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "");
  // strip currency symbols/codes and spaces, keep digits, separators, sign
  s = s.replace(/[^0-9.,-]/g, "");
  if (!s) return null;
  // If both separators present, assume comma = thousands, dot = decimal.
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/,/g, "");
  } else if (s.includes(",") && !s.includes(".")) {
    // comma could be decimal (european) or thousands. Treat as thousands if it
    // groups 3 digits, else as decimal.
    s = /,\d{3}(\D|$)/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Normalize a date-ish string to ISO YYYY-MM-DD, or null if not confidently parseable. */
export function parseDateISO(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s) return null;

  // Already ISO.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // D/M/Y or M/D/Y or D-M-Y. Ambiguous day/month: prefer D/M/Y when day>12.
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (dmy) {
    const [, a, b, y] = dmy as unknown as [string, string, string, string];
    let year = Number(y);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    let day = Number(a);
    let month = Number(b);
    if (day <= 12 && month <= 12) {
      // ambiguous — default to D/M/Y (most of the world / AU)
    } else if (month > 12 && day <= 12) {
      [day, month] = [month, day];
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // "15 June 2026" / "June 15, 2026"
  const MONTHS: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  const text = s.toLowerCase();
  const mName = text.match(/([a-z]{3,9})/);
  const dayM = text.match(/\b(\d{1,2})\b/);
  const yearM = text.match(/\b(\d{4})\b/);
  if (mName && dayM && yearM) {
    const mo = MONTHS[mName[1]!.slice(0, 3)];
    if (mo) {
      const day = Number(dayM[1]);
      if (day >= 1 && day <= 31) {
        return `${yearM[1]}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }
  return null;
}

/** Uppercase a currency-ish token to an ISO-4217-looking code, or null. */
export function normalizeCurrency(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const map: Record<string, string> = { $: "USD", "£": "GBP", "€": "EUR", "¥": "JPY", a$: "AUD" };
  const s = input.trim().toLowerCase();
  if (map[s]) return map[s];
  const code = s.match(/\b([a-z]{3})\b/);
  return code ? code[1]!.toUpperCase() : null;
}
