# Solution 4 — Add a `markdown` export format

## 1. `src/services/formats.ts`

Add near the CSV section (after `toCsv`, before `serialize`):

```ts
// ─── Markdown ─────────────────────────────────────────────────────────────────

/** A "|" or a newline breaks a Markdown table cell — escape both. */
function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Human-readable Markdown projection: a heading, a field table, entities, issues. */
export function toMarkdown(rec: DocumentRecord): string {
  const lines: string[] = [];
  lines.push(`# ${rec.filename}`);
  lines.push("");
  lines.push(`**Type:** ${rec.docType}  `);
  lines.push(`**Status:** ${rec.status}  `);
  if (rec.summary) {
    lines.push("");
    lines.push(rec.summary);
  }

  lines.push("");
  lines.push("| Field | Value | Confidence |");
  lines.push("|---|---|---|");
  for (const f of rec.fields) {
    lines.push(
      `| ${mdCell(f.label)} | ${mdCell(flatValue(f.value))} | ${
        f.confidence !== undefined ? f.confidence.toFixed(2) : ""
      } |`,
    );
  }

  if (rec.entities.length) {
    lines.push("");
    lines.push("## Entities");
    for (const e of rec.entities) lines.push(`- **${e.type}**: ${e.text}`);
  }

  if (rec.issues.length) {
    lines.push("");
    lines.push("## Issues");
    for (const i of rec.issues) lines.push(`- [${i.severity}] ${i.field}: ${i.message}`);
  }

  return lines.join("\n");
}
```

`flatValue()` already exists in this file (used by `toCsv`) — reuse it as-is; do not
duplicate it under a different name.

Update the `Format` type, `MIME` map, and `serialize()`:

```ts
export type Format = "json" | "xml" | "csv" | "markdown";

export const MIME: Record<Format, string> = {
  json: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
};

export function serialize(rec: DocumentRecord, format: Format): string {
  switch (format) {
    case "json":
      return toJson(rec);
    case "xml":
      return toXml(rec);
    case "csv":
      return toCsv(rec);
    case "markdown":
      return toMarkdown(rec);
  }
}
```

(Keeping `serialize()` a `switch` with no `default` case means TypeScript's exhaustiveness
checking — `Format` is a closed union — would itself flag a missing case if you forgot
one; you don't need a `default: throw` to get that safety.)

### The second switch

Run `bunx tsc --noEmit -p tsconfig.json` now and it fails, in a file you have not
touched a second time:

```
src/services/formats.ts(255,72): error TS2366: Function lacks ending return statement
and return type does not include 'undefined'.
```

That is `serializeMany()` — the bulk projection `POST /api/v1/documents/bulk-export`
calls. It switches on the same `Format` union, so widening the union broke it too. The
exhaustiveness check found it for you; nothing about the error message says "markdown",
which is why the exercise asks you to read it rather than telling you where to look.

Decide what a bulk Markdown export *should* be before writing the case. Each of the
other three keeps the single-record projection recognisable — an array, one `<documents>`
root, one header then every record's rows. The Markdown equivalent is the documents one
after another with a horizontal rule between them, which is exactly what someone pasting
a batch into a ticket wants:

```ts
    case "markdown":
      return recs.map((r) => toMarkdown(r)).join("\n\n---\n\n");
```

`bunx tsc --noEmit -p tsconfig.json` now passes.

## 2. `src/routes/documents.ts`

```ts
const FORMATS = new Set(["json", "xml", "csv", "markdown"]);
```

That's the only change this file needs — the handler already does
`out.contentType` / `out.body` generically from whatever `deps.documents.export()`
returns.

## 3. `src/openapi.ts`

Try the export first, without this edit:

```bash
curl -sS "http://localhost:8080/api/v1/documents/$ID/export?format=markdown" | jq -r .detail
```
```
Invalid query: /format must be one of ["json","xml","csv"]
```

**A 400, from a spec you have not updated — not from the `FORMATS` Set you just
widened.** `operationSchemas(...)` validates every `/api/v1` query parameter against the
OpenAPI document before the handler runs, so the spec's `enum` is the *first* gate a
request meets and the route's `FORMATS` Set is the second. Editing `openapi.ts` is
therefore not documentation housekeeping you can defer — it is part of making the feature
work. That is what "API-first" means concretely in this codebase (STANDARDS §2): the
contract is executable.

In the `/api/v1/documents/{id}/export` operation:

```ts
"/api/v1/documents/{id}/export": {
  parameters: [idParam],
  get: {
    operationId: "exportDocument",
    tags: ["documents"],
    summary: "Download the record as JSON, XML, CSV or Markdown",
    parameters: [
      {
        name: "format",
        in: "query",
        schema: { type: "string", enum: ["json", "xml", "csv", "markdown"], default: "json" },
      },
    ],
    responses: {
      200: {
        description: "Standardised export",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/Document" } },
          "application/xml": { schema: { type: "string" } },
          "text/csv": { schema: { type: "string" } },
          "text/markdown": { schema: { type: "string" } },
        },
      },
      ...standardResponses,
    },
    security: apiSecurity,
  },
},
```

(Also update the endpoint's one-line `summary` — "JSON, XML or CSV" → "JSON, XML, CSV or
Markdown" — and the product-level description string near the top of the file that
lists the same three formats, so the generated docs stay accurate.)

## 4. Verify

```bash
ID=$(curl -sS -X POST 'http://localhost:8080/api/v1/documents?config=auto' \
     -H 'Content-Type: text/plain' -H 'X-Filename: invoice.txt' \
     --data-binary @public/samples/invoice.txt | jq -r .document.id)
sleep 1
curl -sS -D - "http://localhost:8080/api/v1/documents/$ID/export?format=markdown"
```

```
HTTP/1.1 200 OK
Content-Type: text/markdown; charset=utf-8
Content-Length: 1104
Content-Disposition: attachment; filename="invoice.markdown"

# invoice.txt

**Type:** invoice  
**Status:** ready  

ACME ROBOTICS PTY LTD …

| Field | Value | Confidence |
|---|---|---|
| Vendor | ACME ROBOTICS PTY LTD | 0.95 |
| Invoice # | INV-2026-0042 | 0.95 |
| Total | 116160 | 0.95 |
…
```

Two details worth noticing in that response. The two trailing spaces after `**Type:**
invoice` and `**Status:** ready` are deliberate — they are Markdown's hard line break, so
the two lines render as two lines rather than one run-together paragraph. And the download
filename is `invoice.markdown`, not `invoice.md`: the route derives the extension from the
format name, so a new format gets its own name as its extension for free. If you want
`.md`, that is a change to the filename derivation in `src/routes/documents.ts`, not to
anything you wrote in `formats.ts` — and it is worth asking whether it is worth a special
case for one format.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "http://localhost:8080/api/v1/documents/$ID/export?format=bogus"
# 400 — the FORMATS Set in routes/documents.ts still rejects unknown values first
curl -sS -c /tmp/dip-cookies.txt -X POST http://localhost:8080/api/v1/session > /dev/null
curl -sS -b /tmp/dip-cookies.txt -o /dev/null -w '%{http_code}\n' -X DELETE "http://localhost:8080/api/v1/documents/$ID"
# 204 — DELETE needs a session/API-key/admin credential (requireWriter); everything above didn't
```

## Why these choices

- **Escaping only `|` and newlines, not `<`/`&`/etc.**: unlike XML, Markdown has no
  single universal escaping rule — the only character that structurally breaks *this
  specific* construct (a table cell) is a literal pipe, and a stray newline would split
  one logical row into two. Values already go through `flatValue()`, which is the same
  function `toCsv` uses, so arrays render the same way ("; "-joined) in both formats —
  consistency across export formats is worth more here than format-specific styling.
- **A long-format table (one row per field), not a nested structure**: this mirrors
  `toCsv`'s own choice for the same reason — different document types have wildly
  different field sets, and a flat table degrades gracefully for all of them without a
  format-specific template per doc type.
- **No dependency on a Markdown library**: like every other function in `formats.ts`,
  this is hand-rolled string building. The product has zero runtime dependencies by
  hard rule (STANDARDS-level, not a preference) — pulling in a Markdown table library
  for one function would violate that for no real benefit, since the output shape here
  is simple enough to build correctly by hand and cover with a direct test.
