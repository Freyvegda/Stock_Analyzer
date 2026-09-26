# Phase 1 — Fundamental Screener (Backend)

> Read `backend/BACKEND.md` first. DB details: `plan/phase-1-fundamental-screen/database.md`.

## Goal

Nifty 500 list → fetch fundamentals → apply `config/screening.yaml` ratios → ranked shortlist (~10) → stored in `screen_runs`, exposed via API.

## Tasks

1. **`data/yfinance_impl.py`** — implement `DataProvider`:
   - `list_stocks()`: download Nifty 500 constituent CSV from `https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv` (httpx, timeout 30s, 1 retry). Parse `Symbol`, `Company Name`, `Industry`. Cache CSV to `data/nifty500.csv`; if fetch fails and cache exists, use cache with `stale=true` flag.
   - `fundamentals(symbol)`: `yfinance.Ticker(f"{symbol}.NS").info` → extract `trailingPE`, `priceToBook`, `returnOnEquity` (×100), `returnOnCapitalEmployed` if present else None, `debtToEquity` (÷100 to ratio), `marketCap` (÷1e7 → crore). Missing key → None, never raise. Store full dict in `raw_json`.
   - `ohlc()` / `filings()`: leave `NotImplementedError` (Phases 2–3).

2. **`screener/engine.py`**:
   - `apply_screen(rows: list[FundamentalRow], config: dict) -> list[dict]`
   - Rule: stock passes if every configured criterion passes. NULL ratio → criterion fails, record in `failed_criteria`.
   - Rank survivors: score = roe + roce − (debt_to_equity × 20); sort desc; cut at `shortlist_size`.
   - Return `[{symbol, rank, score, ratios: {...}, failed: []}]`.

3. **`api/screen.py`** — replace placeholders:
   - `POST /screen/run`: sync stocks table from `list_stocks()`; for each symbol fetch `fundamentals()` (try/except per stock → `data_status=failed` count); upsert `fundamentals`; run engine; insert `screen_runs` row (config snapshot + shortlist JSON). Return `{run_id, shortlisted: [...], failed_count, total}`.
   - `GET /screen/latest`: latest `screen_runs` row, parsed JSON, joined with stocks name/sector.
   - `GET /screen/config`: current YAML as JSON.
   - `POST /screen/config/reload`: call `reload_config()`, return new config.

4. **Performance**: 500 sequential yfinance calls too slow — use `concurrent.futures.ThreadPoolExecutor(max_workers=8)`. Still expect minutes; run synchronously in endpoint for MVP (UI shows spinner). Note in code comment: async job queue is a later optimization.

## Tests (`tests/test_screener.py`)

- Engine: 5 fixture stocks with hand-computed pass/fail, incl. one NULL-ratio stock → must fail + flag.
- Config: malformed YAML value (string where float expected) → clear validation error.
- `POST /screen/run` with mocked provider (3 stocks) → 200, shortlist JSON shape correct, DB row written.
- Idempotency: run twice same day → 2 screen_runs rows (history kept) but fundamentals upserted (no dup per symbol+date).

## Acceptance

- `POST /screen/run` against live yfinance shortlists real Nifty stocks.
- pytest green offline (all network mocked).
- `GET /screen/latest` returns shortlist with ratios within 1s from DB.
