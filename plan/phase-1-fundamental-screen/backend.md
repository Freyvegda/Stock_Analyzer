# Phase 1 — Fundamental Screener (Backend)

> Read `backend/BACKEND.md` first. DB details: `plan/phase-1-fundamental-screen/database.md`.

## Goal

Nifty 500 list → fetch fundamentals → apply `config/screening.yaml` ratios → ranked shortlist (~10) → stored in `screen_runs`, exposed via API.

## Tasks

1. **`data/yfinance_impl.py`** — implement `DataProvider`:
   - `list_stocks()`: download Nifty 500 constituent CSV from `https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv` (httpx, timeout 30s). Parse `Symbol`, `Company Name`, `Industry`. Cache CSV to `data/nifty500.csv`; if fetch fails and cache exists, use cache and set `provider.stale = True` (surfaced as `stale` by `/screen/run`).
   - `fundamentals(symbol)`: `yfinance.Ticker(f"{symbol}.NS").info` → extract `trailingPE`, `priceToBook`, `returnOnEquity` (×100), `returnOnCapitalEmployed` if present else None, `debtToEquity` (÷100 to ratio), `marketCap` (÷1e7 → crore). Missing key → None, never raise. Store full dict in `raw_json`.
   - `ohlc()` / `filings()`: leave `NotImplementedError` (Phases 2–3).

2. **`screener/engine.py`**:
   - `evaluate_screen(rows, config) -> (shortlist, rejected)`; `apply_screen(rows, config)` returns the shortlist only.
   - Rule: stock passes if every configured criterion passes. NULL ratio → criterion fails; the rejected entry records `{symbol, failed: [criteria]}`.
   - Rank survivors: score = roe + roce − (debt_to_equity × 20); sort desc; cut at `shortlist_size`.
   - Return `[{rank, symbol, score, ratios: {...}, failed: []}]`.

3. **`screener/service.py` + `api/screen.py`** — logic in service (BACKEND.md rule 6), routers thin:
   - `POST /screen/run`: sync stocks; fetch `fundamentals()` per stock with per-stock try/except (fetch failure → `fundamentals` row with `data_status=failed`, NULL ratios, error in `raw_json`); upsert `fundamentals` (`data_status=ok`); evaluate; insert `screen_runs` row (verbatim YAML snapshot + shortlist JSON). Return `{run_id, shortlisted, failed_count, failed_symbols, failed_details, stale, total}`.
   - `GET /screen/latest`: latest `screen_runs` row, parsed JSON, joined with stocks name/sector/market_cap.
   - `GET /screen/config`: validated YAML as JSON. `POST /screen/config/reload`: `reload_config()`, return new config. Validation via pydantic `ScreenConfig` in `screener/config.py`: criteria required, keys must be known, `shortlist_size` int ≥ 1 (default 10). Invalid file → `ConfigError` → HTTP 422 (handler in `app/main.py`).

4. **Performance**: 500 sequential yfinance calls too slow — use `concurrent.futures.ThreadPoolExecutor(max_workers=8)`. Still expect minutes; run synchronously in endpoint for MVP (UI shows spinner). Note in code comment: async job queue is a later optimization.

## Tests

- `tests/test_screener.py`: engine pass/fail incl. NULL ratio; ranking; shortlist cut; unknown criterion; `evaluate_screen` rejected split.
- `tests/test_config.py`: invalid value / unknown key / missing criteria / bad syntax → `ConfigError`; endpoints return 422.
- `tests/test_provider.py`: CSV download + cache + stale fallback; yfinance field mapping/scaling; missing keys → None.
- `tests/test_screen_api.py`: mocked provider (3 stocks, 1 fetch failure) → response shape, rejected details, `data_status` persistence, market-cap preservation, run-twice idempotency (2 `screen_runs`, stable `fundamentals` count).
- All offline — network mocked.

## Acceptance

- `POST /screen/run` against live yfinance shortlists real Nifty stocks.
- pytest green offline (all network mocked).
- `GET /screen/latest` returns shortlist with ratios within 1s from DB.
- Bad screening.yaml → 422, never a 500 traceback.
