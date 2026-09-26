# Phase 1 — Fundamental Screener (Database)

> Full schema reference: `backend/app/db/DATABASE.md`. This file = only Phase 1 deltas.

## Tables Used

### stocks — write path
- Upsert from `list_stocks()` on every screen run: INSERT new symbols, UPDATE name/sector/market_cap for existing.
- Never delete — delisted stocks stay (history).

### fundamentals — write path
- Composite PK `(symbol, date)` → one row per stock per day. Re-run same day = REPLACE (merge), not duplicate.
- Ratio columns nullable: `pe, pb, roe, roce, debt_to_equity`. yfinance gaps are normal — store NULL, store full payload in `raw_json`.

### screen_runs — write path
- One row per `POST /screen/run`: `run_date`, `config_yaml` (verbatim file contents — reproducibility), `shortlisted_json`:
```json
[
  {"symbol": "TCS", "rank": 1, "score": 38.2,
   "ratios": {"pe": 22.1, "pb": 4.1, "roe": 41.0, "roce": 50.2, "debt_to_equity": 0.09},
   "failed": []}
]
```

## Read Patterns

- Latest screen: `SELECT * FROM screen_runs ORDER BY id DESC LIMIT 1`
- Latest fundamentals per symbol: `WHERE symbol = ? ORDER BY date DESC LIMIT 1`
- Frontend table needs: screen_runs join stocks on symbol (name, sector, market_cap).

## Rules

- All writes via SQLAlchemy `SessionLocal()`; use `session.merge()` for composite-PK upserts.
- `init_db()` already creates these tables — no migration needed; delete `data/stockanalyzer.db` to reset during dev.

## Acceptance

- After 2 same-day runs: `fundamentals` row count unchanged, `screen_runs` = 2 rows.
- `raw_json` present for every fetched symbol (even when ratios NULL).
