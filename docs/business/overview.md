# Overview

## What it does

Document Processing turns an unstructured document — an invoice, a receipt, a contract, a
résumé, a medical claim, a bank statement, a form, or almost anything else on paper or in a
PDF — into a structured, validated record your systems can actually use. Drop in a file (or
a photo of one), and within about a minute you get back:

- **Typed fields** relevant to that kind of document (vendor name, invoice total, claim
  number, patient name — whatever applies), each with a confidence score and a note of
  where a value was normalised (an amount, a date) from what the source actually said.
- **Named entities** — people, organisations, dates, amounts, locations — surfaced
  automatically, without anyone defining them ahead of time.
- **A plain-language summary and topic tags.**
- **Validation issues** — a required field that wasn't found, an invoice whose subtotal and
  tax don't add up to its total, a date that couldn't be confidently parsed — flagged for a
  human to check rather than silently accepted or silently dropped.
- **The record in whatever format your next system needs** — JSON, XML, or CSV — plus the
  ability to ask the document a direct question in plain English and get a grounded answer.

## Why it matters

Most organisations still have people doing this by hand: reading an invoice and typing the
total into a finance system, reading a claim form and keying the diagnosis code, reading a
résumé and copying the candidate's details into an applicant tracker. That work is slow,
inconsistent between people, and doesn't scale with volume. Generic OCR gets you text; it
doesn't get you a validated `total: 116160` you can post to a ledger with confidence.

Document Processing closes that gap without asking anyone to train a model, build a
template library, or hand-write extraction rules per document type. It ships with eleven
common document types already defined, and any organisation can describe a new one — "read
these five fields off this kind of form" — in a single request, with no engineering
involved beyond having someone able to call an API.

## How it's different from "just OCR"

OCR (optical character recognition) answers "what text is on this page?" Document
Processing answers "what does this document *mean*, and is it internally consistent?" It
reads the whole document with a multimodal model — so it understands layout, tables, and
handwriting-adjacent scans, not just character shapes — extracts exactly the fields you
care about, cross-checks arithmetic where that's meaningful (does the invoice add up?),
and normalises messy real-world formatting (dates in three different styles, currency
written five different ways) into one consistent shape. The output is something a
downstream system can consume directly, not a wall of text someone still has to parse by
hand.

## How it's built

Document Processing is built on Progress Agentic RAG (ARAG), the same knowledge-and-agent
platform used for retrieval-augmented generation. Every extraction is grounded in the
actual uploaded document — the model is never asked to recall facts from memory, only to
read and structure what's in front of it — which is what makes the results trustworthy
enough to route into a business process rather than just interesting to look at. It's
released as an open, self-hostable API-first product: every capability in the operator app
and the admin app is also a documented `/api/v1` endpoint, so it's straightforward to fold
into an existing workflow rather than being a standalone tool people copy-paste in and out
of.

## Where to go next

- [`when-to-use.md`](when-to-use.md) — good fits, poor fits, and honest alternatives.
- [`walkthrough-demo.md`](walkthrough-demo.md) — a guided tour of the operator app, for a first look.
- [`walkthrough-admin.md`](walkthrough-admin.md) — the operator's view: health, jobs, retention.
- [`faq.md`](faq.md) — the questions an evaluator usually asks next.
