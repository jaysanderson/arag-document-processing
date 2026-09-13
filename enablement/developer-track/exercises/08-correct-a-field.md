# Exercise 8 — Correct a field, and read the audit trail

**Time budget:** 25 minutes.
**Matches:** LAB.md Section 8. Needs a session cookie and the `ADMIN_TOKEN`.

A human typing a value does not make it grounded. This exercise is about what the product
does instead: it records a correction rather than performing a silent overwrite, keeps
the model's original value and the reviewer's reason forever, re-checks the new value
against the document's own text, lets the grounding score **fall** if that is the honest
outcome, writes the corrected record back into the Knowledge Box, and reports the one
consequence of that write it cannot fix (DP-49, DP-51).

## Task

1. **Get a record with a grounding score of 1.** Upload `public/samples/invoice.txt`
   with `?config=auto`, wait for the job, and confirm `meta.groundingScore` is `1` and
   `meta.correctedFields` is absent or `0`.
2. **Correct a field.** `PUT /api/v1/documents/{id}/fields/po_number` with a value the
   document does *not* contain (e.g. `"PO-88422"` where the document reads `PO-88421`)
   and a `reason` in a reviewer's own words. Before you look at the response, predict
   three things: what happens to the field's `confidence`, what `verified` will say, and
   which direction `meta.groundingScore` will move.
3. **Read the correction record.** Confirm it kept `previousValue`, `reason`, `actor`
   and `at`, and that the model's confidence for that field is gone rather than reused.
4. **Read the grounding consequence.** Compare `meta.groundingScore` before and after,
   and find `meta.correctedFields`. Answer: why is a corrected field still counted in the
   denominator instead of being excluded from the score?
5. **Find the trap.** Look at `meta.kv.writes`, `meta.kv.filterIndexStale` and
   `meta.kv.superseded`. Then *prove* the trap: run a `kv=` filter on the value you
   replaced (the **old** one) and confirm the document still comes back. Then run one on
   the new value and confirm it comes back too.
6. **Read the record's own review history.** `GET /api/v1/documents/{id}/corrections`,
   and find the same list on the record itself. Note which order each is in and why.
7. **Read the operator's audit trail.** `GET /api/v1/admin/audit?action=document.field.correct`,
   and then the same query filtered by `target`. Note what the audit entry carries that
   the correction record does not, and vice versa.
8. **Undo it.** `DELETE /api/v1/documents/{id}/fields/po_number`. Confirm the value, the
   `verified` state and the grounding score all return — then find the three things that
   do **not** return to their original state, and be able to say why each one is right.
9. **Clean up.** Delete the document.

## Acceptance criteria

- [ ] Before the correction, `meta.groundingScore` is `1`.
- [ ] The correction response's `correction` object carries `previousValue`, `value`,
      `reason`, `actor` and `at`, and `verified` is `"unverified"` — because the value you
      typed is not in the document.
- [ ] `meta.groundingScore` **falls** (to `0.92` for a twelve-field invoice with one
      unverified field) and `meta.correctedFields` is `1`.
- [ ] You can explain why the score falls rather than staying flat, and why the product
      reports `correctedFields` alongside it rather than hiding the human's hand.
- [ ] `meta.kv.writes` is `2`, `meta.kv.filterIndexStale` is `true`, and
      `meta.kv.superseded` names the field and the value it replaced.
- [ ] A `kv=` filter on the **superseded** value still returns the document — and you can
      say why this is reported rather than fixed.
- [ ] `GET /api/v1/documents/{id}/corrections` returns the correction newest-first, and
      the record's own `corrections` array has it oldest-first.
- [ ] The audit log has a `document.field.correct` entry whose `target` is
      `<documentId>#<fieldKey>` with a `before` and an `after`.
- [ ] After the undo: the value is restored, `verified` is `"exact"` again and
      `meta.groundingScore` is back to `1` — while `meta.correctedFields` is still `1`,
      `meta.kv.writes` is `3`, and `meta.kv.superseded` now lists **both** values.
- [ ] You tried the undo a second time and can explain why it does not answer 400.

## Hints

- `PUT`/`DELETE` on a field are writes against shared state: they need a writer
  credential (an API key, the admin token, or a session cookie), and they write to the
  Knowledge Box as well as to the local record.
- Predicting before reading is the point of step 2. The three answers are all in DP-49 in
  `DECISIONS.md`, and all three are choices that could defensibly have gone the other way.
- A grounding score is "the share of fields carrying a verified quote". Think about what
  each of the three possible policies — exclude corrected fields, keep the model's old
  confidence, or re-check the new value — would do to that sentence's truthfulness.
- For step 5, the schema id and field you need are on the record: `meta.kv.schemaId` and
  the key you corrected.
- A key-value write is a **full replace** of the schema's data on that resource, which is
  why the whole current record is sent for a one-field change. The filter index is a
  separate structure and there is no call that purges it.
- For step 8, look at `correctedFields`, `kv.writes` and `kv.superseded` — and at whether
  the correction *history* shrank.
- If you would rather do this in the workspace: the record view's field rows are editable
  in place, and the Pipeline tab carries the Corrections timeline. The operator's view is
  `http://localhost:8080/admin/#/audit`.

If you get stuck, [`solutions/08-correct-a-field.md`](../solutions/08-correct-a-field.md)
has the full transcript with real output.
