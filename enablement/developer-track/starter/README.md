# Lab starter files

This lab does not use a separate sandbox project — you extend the real
`arag-doc-processing` codebase, running against the mock ARAG (`ARAG_MOCK=1`), exactly
as described in [`../LAB.md`](../LAB.md). These two files are **stubs to copy from**, not files you
run directly:

| File | Copy the finished version into | Used by |
|---|---|---|
| [`insurance-card.schema.ts`](insurance-card.schema.ts) | `src/services/schemas.ts` (the `SCHEMAS` object) | Exercise 2 / Section 2 |
| [`markdown-export.snippet.ts`](markdown-export.snippet.ts) | `src/services/formats.ts` | Exercise 4 / Section 4 |

Each has `TODO` markers where you fill something in. Neither file is imported by the
product or picked up by `tsc`/Biome (this directory sits outside `tsconfig.json`'s
`include` and `biome.json`'s `files.includes`) — they exist purely as a starting point
to paste from, so you never start Section 2 or 4 from a blank file.

The finished, working versions — the exact code you should end up with — are in
[`../solutions/02-add-a-document-type.md`](../solutions/02-add-a-document-type.md) and
[`../solutions/04-add-an-export-format.md`](../solutions/04-add-an-export-format.md),
each with an explanation of the choices made. Try the stub first; check the solution
when you're stuck or want to compare notes.

## Why a stub and not a full skeleton project

Document Processing has zero runtime dependencies, no build step, and one process that
serves the API, the hash-routed workspace (`/`) and the admin panel (`/admin/`)
together — there is no meaningful smaller
"starter project" to extract without either duplicating the whole repository (which
drifts out of sync immediately) or hiding the real file layout you need to learn. The
stub files here are small on purpose: enough shape to orient you, nothing you wouldn't
also see by opening `src/services/schemas.ts` or `src/services/formats.ts` directly.
