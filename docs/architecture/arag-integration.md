# ARAG integration

Everything this product does with Progress Agentic RAG goes through the shared platform
client (`vendor/arag-platform/src/arag/client.ts`). No product file knows an ARAG URL.

## Endpoints used

| Call | Where | Why |
|---|---|---|
| `POST /kb/{kb}/upload` (`X-FILENAME` base64, optional `?extract_strategy=`) | `services/documents.ts` | Ingest the document. Images and PDFs get the ingestion-time visual-LLM **extract strategy** when `DIP_EXTRACT_STRATEGY` is set. |
| `GET /kb/{kb}/resource/{rid}?show=basic` | `waitProcessed` | Poll `PENDING → PROCESSED`. |
| `POST /kb/{kb}/find` (`resource_filters`) | `waitSearchable`, `isSearchable` | Cheap "is it retrievable yet?" gate. |
| `GET /kb/{kb}/resource/{rid}?show=extracted&extracted=text` | `extractedText`, `readPersistedFields` | Processed text (for the query seed) and Data-Augmentation-agent output. |
| `POST /kb/{kb}/ask` (NDJSON) | every agent, `documents.ask` | Grounded generation, with `answer_json_schema` for structured extraction. |
| `POST /kb/{kb}/search_configurations/{name}` (`kind: "ask"`) | `services/configs.ts` | One stored configuration per extraction schema (`dip_<schema>`). |
| `DELETE /kb/{kb}/resource/{rid}` | delete, purge, `make smoke` | Data retention. |
| `GET /kb/{kb}/catalog`, `GET /kb/{kb}/configuration` | `admin/health` | Connection test and the KB's generative model. |

## Key ARAG mechanics

These are hard-won behaviours verified against the live `DocumentProcessing` Knowledge
Box. Each one is the difference between a reliable demo and a flaky one, and each is
repeated verbatim as a comment next to the code that depends on it.

1. **Structured extraction via `answer_json_schema`.** Passing an OpenAI-function-style
   schema forces ARAG to return a validated object in `answer_json`. This is the
   "custom visual-LLM extraction" layer — the multimodal model fills the schema from the
   document. (`src/services/schemas.ts`, `src/services/agents.ts`)

2. **`full_resource` grounding.** Plain `/ask` only puts the *retrieved paragraphs* in
   the model's context, so a value in a non-matching paragraph (e.g. an invoice total)
   is missed. The `rag_strategies: [{ name: "full_resource" }]` strategy puts the **whole
   document** in context. Essential for extraction and summarization.

3. **Seed the retrieval query with real document text.** Even with `full_resource`,
   retrieval runs *first* to locate the resource; an instruction-style query
   ("list the entities") can share no vocabulary with the document and return
   `no_retrieval_data`. We fetch the processed text (`extractedText`) and use its opening
   as the query seed (`buildQuerySeed`) so retrieval always hits.

4. **`PROCESSED` ≠ searchable.** A resource's status flips to `PROCESSED` a few seconds
   before it becomes retrievable. Extracting too early yields empty results, so the
   pipeline gates on `waitSearchable` (a cheap `/find` poll) after `waitProcessed`.
   Probe it with the document's *own* opening words, not a generic query: against the live
   KB a generic probe took about twenty polls (≈ 38 s) to register a hit on the same
   resource that a seeded probe found on the first attempt (≈ 7 s end to end for the whole
   process stage). Same reasoning as mechanic 3, applied to the readiness gate.

5. **Scope with `resource_filters` on `/ask`, never `POST /resource/{id}/ask`.** The
   per-resource ask endpoint rejects `rag_strategies: [{ name: "full_resource" }]`
   upstream — it answers HTTP 500 (or 503 "connection termination") for exactly the
   payload that `/ask` + `resource_filters: [rid]` accepts and answers correctly. Since
   full_resource grounding is the whole point of the extraction agents, `resource_filters`
   is the only usable shape. Discovered by `make smoke` and isolated with a live A/B probe.

6. **Verified evidence, because citations are unavailable to structured extraction.** ARAG
   rejects `citations` alongside `answer_json_schema` — the live KB answers HTTP 500 — so
   the usual citation machinery cannot annotate an extraction. A schema-only `/ask` *does*
   still return the retrieval item with paragraph ids and character offsets, and a model
   asked for verbatim quotes *inside* the schema fills them accurately. So every extraction
   schema carries an `evidence` array of `{field, quote}`, and the service then checks each
   quote against the document's own extracted text: an exact substring is `exact` (offsets
   recorded), a match after normalising case, whitespace and punctuation is `normalised`,
   anything else is `unverified` and raises a validation warning. Verified quotes are
   pinned to the retrieval paragraph that contains them. The share of extracted fields with
   a verified quote is `meta.groundingScore`. A model that paraphrases instead of quoting
   is therefore visible rather than silently trusted. (`src/services/agents.ts`
   — `verifyEvidence`, `groundingScore`; `src/services/schemas.ts` — `EVIDENCE_PROPERTY`)

   Measured on the live Knowledge Box (`make smoke`, sample invoice, `chatgpt-azure-4o`):
   12 fields extracted, 11 quotes returned — 10 `exact`, 1 `normalised`, 0 `unverified` —
   for a grounding score of **0.92**, with every quote pinned to a retrieval paragraph.
   The one field with no quote is visible in the record rather than quietly presented as
   grounded, which is the whole point of the contract.

Plus two robustness choices:

- **Amounts are extracted as strings, then normalized to numbers.** Forcing the model to
  emit a JSON `number` for `"$96,000.00"` frequently returns `0`. Schemas declare amounts
  as strings (`money()` in `schemas.ts`); `validateNormalize` parses them to numbers and
  keeps the raw value in `field.raw`. It also checks `subtotal + tax ≈ total` and
  required-field presence.
- **Token budgets are generous.** A truncated structured response is *invalid* JSON and
  yields no `answer_json` at all (not a partial), so under-budgeting drops every field.
  The classifier, entity and summary agents all budget well above their expected output.

A further constraint the client handles for you: ARAG rejects `citations` together with
`answer_json_schema`. `AragClient.askStream` drops `citations` automatically when a schema
is present, so extraction and Q&A can share one code path — and the evidence contract
(mechanic 6) gives structured extraction the grounding that citations would otherwise
provide. Plain text `/ask` (`POST /api/v1/documents/{id}/ask`) still uses real citations.

## Stored search configurations

Every extraction config — the 11 built-ins and every custom one — is provisioned as a
stored ARAG search configuration named `dip_<schema name>`:

```jsonc
{
  "kind": "ask",
  "config": {
    "generative_model": "chatgpt-azure-4o",   // the multimodal/visual LLM
    "reranker": "predict",
    "rag_strategies": [{ "name": "full_resource" }],
    "prompt": { "system": "You are a precise document-data extraction engine. …" },
    "answer_json_schema": {
      "name": "invoice_extraction",
      "parameters": {
        "properties": { "…": "…", "evidence": { "type": "array", "items": { "…": "…" } } }
      }
    }
  }
}
```

Extraction then calls `/ask` with `search_configuration: "dip_invoice_extraction"` and only
the per-request bits (`query`, `resource_filters`, `max_tokens`, `temperature`). The model,
the grounding rules and the schema live **server-side in the Knowledge Box**, not in this
service — so they can be inspected and tuned in the ARAG dashboard, and every client of the
KB gets the same extraction contract.

Provisioning is idempotent (`POST`, falling back to `PATCH` on 409) and runs at boot, on
custom-config creation, and on demand via `POST /api/v1/admin/provision`. **Changing an
extraction schema — including adding the `evidence` property — only takes effect after a
re-provision**, because the schema lives in the stored configuration, not in the request.
Those 409s are expected and are counted separately from real errors in
`GET /api/v1/admin/usage` (`aragConflicts`), so a re-provision does not read as an outage.

## Data Augmentation agents

`config=agent` skips live extraction and reads fields an ARAG **Data Augmentation "ask"
agent** already persisted on the resource — either a JSON text field or a key-value field
written by the agent configured in the ARAG dashboard (`readPersistedFields`). Keys are
user-defined, so labels are derived from the key and values are normalised by heuristics
(`fieldsFromObject`: amounts → numbers, dates → ISO, sentinels like "N/A" dropped). When the
resource carries no agent output the pipeline says so in a `classify` `skip` event and falls
back to live extraction.

## Failure handling

`AragError` carries `kind` (`timeout | http | network | aborted | protocol`) and is mapped
to RFC 9457 problems by the platform: timeouts → 504, upstream failures → 502, 401 → a 502
that names `ARAG_API_KEY` without leaking it. Pipeline stages are `soft`: a failing stage is
recorded as a stage error and the run continues with the best record it has, so one flaky
agent never loses the whole extraction.

## Further reading

For the system-level view (module map, request lifecycle, job/SSE model), a document's
end-to-end journey, and real-world throughput built on the timings above, see
[`architecture.md`](architecture.md), [`data-flow.md`](data-flow.md) and
[`scaling.md`](scaling.md).
