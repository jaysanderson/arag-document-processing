# Exercise 6 — Write and filter a key-value field through the Knowledge Box

**Time budget:** 30 minutes.
**Matches:** LAB.md Section 6. Needs a writer credential for the four write calls in
steps 7 and 8 — a session cookie is the lowest-friction one.

This is the exercise for the capability the product is built around: extracted values do
not only land in this workspace's JSON store, they are written into the Knowledge Box as
typed, validated, **filterable** data under a key-value schema that belongs to the
extraction config. You will watch a write happen, filter on it, break the filter on
purpose, and then fix a config so that a value that was unfilterable becomes filterable.

## Task

1. **Read what a config declares.** `GET /api/v1/extraction-configs/invoice`. Find
   `kvSchemaId`, `kvFields`, and the `provisioning` block. Answer for yourself: how many
   Knowledge Box objects does one extraction config own, and what is each one for?
2. **Find the fields whose Knowledge Box type is not the type the model was asked for.**
   Still in that response, look at `total` and `invoice_date`: each reports a `type` and
   a `kvType`, and they disagree. Work out why before reading on — `money()` and `date()`
   in `src/services/schemas.ts` each explain themselves in a docstring.
3. **Watch a write.** Upload `public/samples/invoice.txt` with `?config=auto`, wait for
   the job, then read `meta.kv` on the finished record. Confirm `written: true` and note
   `fields` and `writes`. Then compare three renderings of the same two values: the
   model's original in `fields[].raw`, the normalised record value in `fields[].value`,
   and what actually reached the Knowledge Box in `meta.kv.values`.
4. **See it in the workspace.** Open `#/documents/<id>/json?view=kv` and read the
   Key-value view. It shows what reached the Knowledge Box, what was skipped and why.
5. **Filter on it.** Using `GET /api/v1/documents?kv=<schemaId>:<field>:<op>:<value>`:
   - find the document with `total` at or above `10000`
   - confirm it is *not* returned when the threshold is `200000`
   - filter on a date with `gte` and an RFC 3339 value
   - filter on `line_items` (a repeated field) with `contains`
   - combine two `kv=` parameters and confirm they are ANDed
   - combine a `kv=` filter with `status=ready&doc_type=invoice` and read the response's
     `filters` block: which parameters were answered by the Knowledge Box and which by
     this workspace's own store?
6. **Break it on purpose.** Ask for `gte` on a text field, and for a field the schema
   does not have. Read both 400s — they are written to tell you what you *can* ask for.
7. **Make an unfilterable value filterable.** Create a custom config with an amount
   field and no type override, confirm the Knowledge Box treats it as text and refuses
   `gte`, then `PUT` the config with `kvType: "float"` on that field and confirm `gte` is
   now accepted.
8. **Clean up.** Delete the document and the custom config.

## Acceptance criteria

- [ ] You can state, from the `provisioning` block, the two Knowledge Box objects an
      extraction config owns and what each is for — and that `state` is `provisioned`
      only when both are in place.
- [ ] `GET /api/v1/extraction-configs/invoice` shows `total` with `"type": "string"` and
      `"kvType": "float"`, and `invoice_date` with `"type": "string"` and
      `"kvType": "date"` — and you can explain why each pair is right rather than a
      contradiction.
- [ ] The finished record's `meta.kv` has `written: true`, `fields: 12` and `writes: 1`.
- [ ] For `total` you can point at all three values: `raw: "$116,160.00"` (what the model
      returned), `value: 116160` (normalised on the record), and
      `meta.kv.values.total: 116160` (a float in the Knowledge Box).
- [ ] For `invoice_date` the record says `"2026-06-15"` and the Knowledge Box holds
      `"2026-06-15T00:00:00Z"` — you can say which one a `gte` filter has to be phrased
      against, and why.
- [ ] `kv=dip_invoice_extraction:total:gte:10000` returns the document;
      `…:total:gte:200000` returns none.
- [ ] A date filter with an RFC 3339 value (which contains colons) parses correctly —
      you did not have to escape anything, because only the **first three** colons
      separate.
- [ ] Two `kv=` parameters narrow rather than widen the result.
- [ ] The response's `filters.knowledgeBox.applied` lists your `kv` filters and
      `filters.local` lists `status` and `doc_type` — you can say why the product reports
      them separately instead of as one list.
- [ ] `…:vendor_name:gte:5` answers **400** naming the operators that field does accept;
      a filter on an unknown field answers **400** listing the fields the schema has.
- [ ] After the `PUT`, the custom config's `provisioning.keyValueSchema.state` is
      `provisioned` again and a `gte` filter on the amount field answers **200** instead
      of 400.
- [ ] The document and the custom config are both deleted at the end.

## Hints

- The whole exercise is anonymous-friendly except the config create/update/delete and
  the document delete. One `POST /api/v1/session` cookie covers all four.
- `curl --get --data-urlencode 'kv=…'` is easier than hand-escaping spaces and `$`
  characters in a filter value.
- A repeated field's `contains` asks "is this value a member of the list?", so it needs
  a whole list entry, not a substring of one.
- The Knowledge Box has a hard ceiling of **20 key-value schemas**, and each extraction
  config consumes one. Eleven built-ins ship. That is worth knowing before you create a
  dozen custom configs — the architect track's
  [`key-value-schema-design.md`](../../architect-track/key-value-schema-design.md) works
  through the arithmetic.
- Against the mock, a key-value write is readable by a filter immediately. **Against a
  live Knowledge Box it is not** — see the same architect-track document, and DP-55 in
  `DECISIONS.md`. Do not carry the mock's timing into a customer conversation.
- If you want to see a value the Knowledge Box *refused*, force a document through a
  config whose fields the document does not contain: `meta.kv.skipped[]` names each one
  and the reason.

If you get stuck, [`solutions/06-key-value-fields.md`](../solutions/06-key-value-fields.md)
has the full transcript with real output.
