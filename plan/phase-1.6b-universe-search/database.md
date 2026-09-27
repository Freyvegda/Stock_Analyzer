# Phase 1.6b — Database (shared universe + profile store)

> **For agentic workers:** part of the Phase 1.6b plan. Backend tasks:
> `plan/phase-1.6b-universe-search/backend.md`; frontend tasks:
> `plan/phase-1.6b-universe-search/frontend.md`.
>
> **Spec:** `docs/superpowers/specs/2026-09-27-phase-1.6b-universe-search-design.md` §4.
> `backend/app/db/DATABASE.md` is binding; updated in backend Task B6.

**Goal:** one new table (`company_profiles`) plus tightened payload policy; no
migration rig — `Base.metadata.create_all` adds the table on startup.

## What changes

| Concern | Decision |
|---|---|
| New table | `company_profiles(symbol PK, industry, sector, description, website, employees, hq, updated_at)` — one row per symbol, never dated |
| Profile writes | `session.merge` on every successful fundamentals fetch (screen run + detail lazy fetch + refresh); caller commits; failed fetches leave the old profile intact |
| `fundamentals` schema | unchanged (6 derived columns + `raw_json`) |
| `raw_json` policy | whitelist only: every `RATIO_CATALOG` raw `yf_field` ∪ every digest fact `yf_field`; `None`/empty values dropped (`store.trim_raw`) |
| Universe rows | `stocks` seeded lazily by `GET /stocks` when empty (identity only, no fundamentals fetch) |
| Refresh scope | one `ok` row per symbol per day for the whole reachable universe; same-day rerun writes/dials nothing new (stale-symbol skip) |
| Failed fetch rule | unchanged: `failed` row only when no same-day `ok` row exists |
| Prices | unchanged: `prices` stays empty until Phase 3; candles memory-cached only |

## Enforcement

- `test_stock_store.py::test_trim_raw_keeps_whitelist_drops_the_rest` — description
  and unknown keys never reach `raw_json`.
- `test_stock_store.py::test_upsert_profile_twice_keeps_one_row` — merge idempotency.
- `test_screen_api.py::test_screen_rerun_same_day_makes_no_fundamentals_calls` —
  no repeat network, no repeat writes.
- `test_screen_api.py::test_failed_refresh_keeps_same_day_ok_row` — failed rule.
- `test_stock_api.py::test_ohlc_writes_nothing` — unchanged gate.

## Acceptance

- No changes to existing tables/columns; existing DBs keep working (new table only).
- Every write path is a `merge` on a composite/primary key; reruns are idempotent.
- Reading `/stocks` or `/stock/{symbol}` with stored data performs zero network
  calls and zero writes (except the one-time lazy universe seed).
