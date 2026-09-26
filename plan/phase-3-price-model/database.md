# Phase 3 — Price Model (Database)

> Full schema reference: `backend/app/db/DATABASE.md`. Phase 3 deltas only.

## Tables Used

### prices — write path
- Composite PK `(symbol, date)` → upsert via `session.merge()`; re-ingest overwrites.
- All OHLCV NOT NULL — drop bad rows at provider, never insert partial.
- Volume as Float (SQLite fine; note some NSE zeros on holidays — provider filters zero-volume rows).

### signals — write path
- Composite PK `(symbol, date, model)` → multiple models can coexist (`xgboost-v1`, later `lstm-v1`).
- `signal`: `buy|sell|hold`. `confidence` 0..1 nullable (rule-based future models may omit).

## Storage Outside DB

- Trained model binaries: `data/models/{symbol}_{model}.joblib` — filesystem, NOT DB. Path convention is derived, not stored (rebuildable from symbol+model name).

## Read Patterns

- Chart: `SELECT * FROM prices WHERE symbol=? ORDER BY date` (add index only if slow — PK prefix covers it).
- Latest signal per stock: `WHERE symbol=? AND model=? ORDER BY date DESC LIMIT 1`.
- Backtest joins prices+signals on (symbol, date).

## Data Volume Check

- 500 stocks × ~1250 rows = ~650k price rows — SQLite handles fine. If ingest all 500 ever needed, batch commits per 50 stocks (comment in ingest code).

## Acceptance

- Re-ingest same symbol twice → row count unchanged.
- `prices` has no NULL OHLCV, no zero-volume rows.
