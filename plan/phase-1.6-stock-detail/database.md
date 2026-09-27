# Phase 1.6 — Database (stock detail storage policy)

> **For agentic workers:** part of the Phase 1.6 plan. Backend tasks:
> `plan/phase-1.6-stock-detail/backend.md`; frontend tasks:
> `plan/phase-1.6-stock-detail/frontend.md`.
>
> **Spec:** `docs/superpowers/specs/2026-09-27-phase-1.6-stock-detail-design.md` §4.
> `backend/app/db/DATABASE.md` is binding; updated in backend Task B6.

**Goal:** no schema change — document and enforce the storage policy for the stock
detail page.

## What changes

| Concern | Decision |
|---|---|
| Snapshot store | unchanged `fundamentals(symbol, date PK)` + `stocks`; global/shared across users |
| First view / Refresh | `session.merge(Fundamental(...))` on `(symbol, today)` — same-day reruns overwrite, never duplicate |
| Failed fetch | writes a `failed` row **only when no `ok` row exists for that symbol+day** (never clobbers a good same-day snapshot) |
| Report / verdict | computed on read from the stored snapshot + caller's criteria; **never persisted** |
| Daily candles | **never written to the DB** (no `prices` writes in Phase 1.6); served from a process-memory TTL cache (900 s) in `app/stock/candles.py` |
| New tables | none |

## Enforcement

- `test_stock_api.py::test_ohlc_writes_nothing` — after `/stock/{symbol}/ohlc`,
  `prices` count is 0 and `fundamentals` count is unchanged.
- `test_stock_service.py::test_refresh_failure_keeps_same_day_ok_row` — the
  failed-row rule.
- `DATABASE.md` gains a "Stock detail write path" section (Task B6).

## Acceptance

- No schema/model changes in this phase; `test_db_models.py` untouched.
- All stock-detail writes are `merge`-based upserts on composite keys.
- Reading the page (stored snapshot present) performs zero network calls and zero writes.
