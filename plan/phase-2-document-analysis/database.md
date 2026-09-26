# Phase 2 — Document Analysis (Database)

> Full schema reference: `backend/app/db/DATABASE.md`. Phase 2 deltas only.

## Tables Used

### documents — write path
- Insert on fetch: `(symbol, type, period, url, local_path, parse_status=pending)`.
- Idempotency: unique by `(symbol, type, period)` in practice — enforce via lookup-before-insert in fetcher (no DB constraint change; note in code).
- `parse_status` transitions: `pending → parsed | failed`. Set by parser stage, not fetcher.

### doc_analysis — write path
- PK `document_id` = 1:1 with documents. Insert only after successful analyze call (either method).
- `method`: `gemini` | `fallback` — REQUIRED. Track fallback rate: if >50% fallback across a run, surface warning in API response (`fallback_used` count).
- `red_flags_json`: JSON array of strings; empty array `[]` when none — never NULL (simplifies UI).

## Read Patterns

- UI per stock: `SELECT d.*, a.* FROM documents d LEFT JOIN doc_analysis a ON a.document_id = d.id WHERE d.symbol = ?`
- Pipeline: `SELECT * FROM documents WHERE parse_status='parsed' AND id NOT IN (SELECT document_id FROM doc_analysis)` → unanalyzed queue.

## Rules

- `local_path` relative to project root (`data/docs/RELIANCE/concall_Q2FY26.pdf`) — portable.
- PDF bytes NEVER in DB — filesystem only.
- Deleting a document row should delete its doc_analysis row — add FK with `ondelete="CASCADE"` if touching models.py; otherwise delete both in service layer. Pick service-layer for MVP (no FK change).

## Acceptance

- Re-running `POST /docs/fetch` twice → no duplicate rows.
- Every `parsed` document eventually gets exactly one `doc_analysis` row.
