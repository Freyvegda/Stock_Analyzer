# Phase 1.8 Fundamentals (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace yFinance hot path with Stooq CSV OHLC + screener.in statements + math engine + file cache, keeping DB lean and maximizing catalog ratio coverage.

**Architecture:** New pure math engine plus three data-layer modules behind the existing DataProvider ABC; a CompositeProvider chains Stooq → file cache → NSE-bhav delta → yFinance-disabled fallback. Prices live in `data/prices/*.csv` and statements in `data/statements/*.json`; SQLite schema unchanged.

**Tech Stack:** Python 3.10, FastAPI, SQLAlchemy 2.x, httpx, pandas (existing), beautifulsoup4 + lxml (new, `--isolated` install), pytest offline with mocked network.

**Spec:** Chat-approved Plan B design 2026-10-04 (Stooq + screener + file cache, max ratios) + `backend/app/screener/catalog.py` (30-ratio source of truth) + `plan/phase-1.8/` + `backend/BACKEND.md` + `backend/app/db/DATABASE.md`.

## Global Constraints

- Work dir `backend/` with venv active; tests `.\.venv\Scripts\python.exe -m pytest tests -q` stay green offline (mock all network).
- BACKEND.md rules binding: DataProvider boundary (no yfinance/screener/stooq imports outside `app/data/`), thin API routers, per-stock failure isolation (one bad stock never kills batch), composite-PK idempotency.
- Schema stays Postgres-compatible; no migration tool (dev DB disposable); dates ISO `YYYY-MM-DD`; JSON-in-Text parsed at service layer.
- pip on this machine: ALWAYS `pip install --isolated <pkg>`.
- Stay on existing `phase-1.8` branch; no new branch.
- Type hints everywhere (`str | None` style); SQLAlchemy 2.x typed mappings where touched.
- `shortlist_size` server-owned; valid criteria keys owned by `screener/catalog.py`.

## Review Focus

- Stooq CSV shape drift (extra columns, dividend-split rows, `.NS` vs `.BO` suffix) still yields ascending clean daily bars.
- screener.in HTML redesign or rate-limit block degrades to cached statements + honest nulls instead of crashing the screen run.
- Statements units (₹ cr vs ₹ lakh) mis-scaled by 100x silently passing screens.
- File-cache stampede on first 500-stock run (500 concurrent writes, partial CSVs read as complete).
- yFinance fallback accidentally re-enabled on hot path and rate-limiting the batch again.

---

### Task 1: ratios_math pure engine

**Files:**
- Create: `backend/app/data/ratios_math.py`
- Test: `backend/tests/test_ratios_math.py`

**Interfaces:**
- Consumes: catalog keys in `backend/app/screener/catalog.py`; statement dict shape produced by Task 3 (`{revenue, net_income, ebit, ebitda, equity, total_assets, current_assets, current_liabilities, inventory, total_debt, cash, shares_outstanding, operating_cashflow, capex, dividends_paid, revenue_prev, earnings_prev, cogs, price}` — all floats or None, money in ₹ cr except per-share inputs).
- Produces: `compute_ratios(base: dict) -> dict` returning `{pe, pb, roe, roce, debt_to_equity, market_cap, raw: dict}` where `raw` holds catalog/raw + digest fact fields for `store.trim_raw`; `BASE_FIELDS: frozenset[str]`.

- [ ] **Step 1: Write the failing tests** in `backend/tests/test_ratios_math.py`: core-6 from hand-computed RELIANCE-like fixture; margins/roa/liquidity/eps/bvps/div/payout/ps/ev/ebitda/fcf/growth; zero/negative equity and zero shares yield None not crash; unknown extra keys ignored.
- [ ] **Step 2: Run to verify failure** — `.\.venv\Scripts\python.exe -m pytest tests/test_ratios_math.py -q` — Expected: FAIL (`ratios_math` missing).
- [ ] **Step 3: Implement** `compute_ratios(base) -> dict` pure, no network/DB; formulas: pe=price/eps, pb=price/bvps, roe=ni/equity*100, roce=ebit/(assets-currLiab)*100, de=debt/equity, mcap=price*shares/1e7, roa=ni/assets*100, margins vs revenue, current=ca/cl, quick=(ca-inv)/cl, eps=ni/shares, bvps=equity/shares, revPerShare, divYield, payout, ps=mcap/revenue, ev=mcap+debt-cash, evRev, evEbitda, pFcf, revGrowth, earnGrowth; guard div-by-zero and negative capital employed → None.
- [ ] **Step 4: Run to verify pass** — `.\.venv\Scripts\python.exe -m pytest tests/test_ratios_math.py tests/test_screener.py -q` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend/app/data/ratios_math.py backend/tests/test_ratios_math.py` + `git commit -m "feat: pure math engine deriving ratios from scraped statements"`.

### Task 2: Stooq OHLC + price

**Files:**
- Create: `backend/app/data/stooq_impl.py`
- Test: `backend/tests/test_stooq.py`

**Interfaces:**
- Consumes: `DataProvider.ohlc` shape (`[{time, open, high, low, close, volume}]` ascending, NaN-close dropped).
- Produces: `StooqProvider(DataProvider)` with `ohlc(symbol, years=5) -> list[dict]`; `stooq_symbol(symbol) -> str` (`{SYM}.NS`, strip `.NS` input); `parse_stooq_csv(text) -> list[dict]` pure.

- [ ] **Step 1: Write the failing tests** — fixture CSV with split/dividend row + NaN close + unsorted row; URL asserted via mocked httpx (`https://stooq.com/q/d/l/?s=RELIANCE.NS&d1=...&d2=...&i=d`); empty CSV → `[]`; HTTP error propagates (caller maps to 502/failed row).
- [ ] **Step 2: Run to verify failure** — `.\.venv\Scripts\python.exe -m pytest tests/test_stooq.py -q` — Expected: FAIL.
- [ ] **Step 3: Implement** `parse_stooq_csv` (csv stdlib, Date/Open/High/Low/Close/Volume, drop NaN-close, ascending) + `StooqProvider.ohlc` (httpx 20s timeout, retry 3x backoff+jitter); `fundamentals/list_stocks/filings` raise NotImplementedError.
- [ ] **Step 4: Run to verify pass** — `.\.venv\Scripts\python.exe -m pytest tests/test_stooq.py tests/test_provider.py -q` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend/app/data/stooq_impl.py backend/tests/test_stooq.py` + `git commit -m "feat: stooq daily CSV provider for 5y OHLC"`.

### Task 3: Screener statements scraper + cache

**Files:**
- Create: `backend/app/data/screener_statements.py`
- Test: `backend/tests/test_screener_statements.py` + fixture `backend/tests/fixtures/screener_reliance.html`

**Interfaces:**
- Consumes: raw HTML from `https://www.screener.in/company/{SYM}/`.
- Produces: `fetch_statements(symbol, cache_dir, ttl_days=30, client=None) -> dict` (base fields for Task 1 + `as_of`, `source="screener"`); `parse_statements(html) -> dict` pure; `STATEMENT_FIELDS: frozenset[str]`; units normalized to ₹ cr.

- [ ] **Step 1: Write the failing tests** — parse saved HTML fixture to expected P&L/BS/CF numbers; units (lakh→cr) scaled; missing table → Nones not crash; cache hit costs zero network (assert client not called); stale cache refetches.
- [ ] **Step 2: Run to verify failure** — `.\.venv\Scripts\python.exe -m pytest tests/test_screener_statements.py -q` — Expected: FAIL.
- [ ] **Step 3: Implement** with beautifulsoup4+lxml, polite UA, 20s timeout, retry 3x; file cache `data/statements/{SYM}.json` (`{as_of, fields}`); on HTTP 403/429 raise `ScreenerBlockedError`; add `beautifulsoup4`, `lxml` to requirements via `pip install --isolated`.
- [ ] **Step 4: Run to verify pass** — `.\.venv\Scripts\python.exe -m pytest tests/test_screener_statements.py -q` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend/app/data/screener_statements.py backend/tests/test_screener_statements.py backend/tests/fixtures/screener_reliance.html backend/requirements.txt` + `git commit -m "feat: screener statements scraper with file cache"`.

### Task 4: Price file cache

**Files:**
- Create: `backend/app/data/price_cache.py`
- Test: `backend/tests/test_price_cache.py`

**Interfaces:**
- Consumes: `StooqProvider.ohlc` rows.
- Produces: `read_cached(symbol, cache_dir) -> list[dict] | None`; `write_cached(symbol, rows, cache_dir) -> None`; `get_or_fetch(symbol, loader, cache_dir, ttl_hours=24) -> list[dict]`; manifest `{as_of, rows}` JSON sidecar or CSV mtime; corrupt file → None (refetch), never crash.

- [ ] **Step 1: Write the failing tests** — miss → loader called + file written; hit within TTL → loader not called; stale → refetch + overwrite; corrupt CSV → refetch; concurrent writes leave valid CSV.
- [ ] **Step 2: Run to verify failure** — `.\.venv\Scripts\python.exe -m pytest tests/test_price_cache.py -q` — Expected: FAIL.
- [ ] **Step 3: Implement** stdlib csv + os, atomic write (tmp + rename), `data/prices/{SYM}.csv`.
- [ ] **Step 4: Run to verify pass** — `.\.venv\Scripts\python.exe -m pytest tests/test_price_cache.py tests/test_candles.py -q` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend/app/data/price_cache.py backend/tests/test_price_cache.py` + `git commit -m "feat: per-symbol OHLC file cache"`.

### Task 5: Composite provider + router swap

**Files:**
- Create: `backend/app/data/composite_impl.py`
- Modify: `backend/app/api/screen.py`, `backend/app/api/stock.py`, `backend/app/api/stocks.py` (`get_provider` only)
- Test: `backend/tests/test_composite.py`

**Interfaces:**
- Consumes: Tasks 1–4 (`StooqProvider`, `fetch_statements`, `compute_ratios`, `price_cache`); existing `YFinanceProvider`, `NSEProvider` stub.
- Produces: `CompositeProvider(DataProvider)`; `build_default_provider() -> DataProvider` reading `ENABLE_YFINANCE` (default off); `list_stocks()` = Nifty CSV logic moved from `yfinance_impl` (cache + stale flag preserved); `fundamentals(symbol)` = price (Stooq last close) + statements + `compute_ratios`; `ohlc(symbol, years)` = `price_cache.get_or_fetch` over Stooq.

- [ ] **Step 1: Write the failing tests** — fundamentals merges price+statements+math with mocked Stooq/statements (no network); ohlc serves file cache without calling Stooq; Stooq fail → cached file served; statements blocked → last cache + partial ratios + no crash; `ENABLE_YFINANCE=1` adds yFinance tail, default off.
- [ ] **Step 2: Run to verify failure** — `.\.venv\Scripts\python.exe -m pytest tests/test_composite.py -q` — Expected: FAIL.
- [ ] **Step 3: Implement** composite with per-stock isolation (raise only after all sources exhausted); move Nifty CSV list logic to shared helper without behavior change; routers' `get_provider` return `build_default_provider()`; keep `YFinanceProvider` class untouched for fallback.
- [ ] **Step 4: Run to verify pass** — `.\.venv\Scripts\python.exe -m pytest tests/test_composite.py tests/test_provider.py tests/test_screen_api.py tests/test_stock_api.py tests/test_stocks_api.py -q` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend/app/data/composite_impl.py backend/app/api/screen.py backend/app/api/stock.py backend/app/api/stocks.py backend/tests/test_composite.py` + `git commit -m "feat: composite provider kills yfinance hot path"`.

### Task 6: Store whitelist + service wiring + integration

**Files:**
- Modify: `backend/app/stock/store.py` (`RAW_FIELDS`), `backend/app/screener/service.py` (workers/polite), `backend/app/stock/service.py` (profile fallback)
- Test: extend `backend/tests/test_stock_store.py`; integration `backend/tests/test_fundamentals_pipeline.py`

**Interfaces:**
- Consumes: Tasks 1–5 outputs.
- Produces: `RAW_FIELDS` covering new math raw keys + digest facts; screener `_fetch_all` with `WORKERS=4` + per-host politeness; profile upsert tolerates screener-shaped info (description/industry/website/employees/hq keys); integration proves screen run + detail + candles offline on 3 fixture symbols.

- [ ] **Step 1: Write the failing tests** — `trim_raw` keeps new math keys and drops junk; 3-symbol pipeline (mocked composite) yields ranked shortlist + detail reports + sliced candles; one symbol failing leaves other two intact.
- [ ] **Step 2: Run to verify failure** — `.\.venv\Scripts\python.exe -m pytest tests/test_fundamentals_pipeline.py tests/test_stock_store.py -q` — Expected: FAIL.
- [ ] **Step 3: Implement** whitelist extension, worker/politeness tweak, profile key mapping; no schema change; `fundamentals` write path unchanged (`pe/pb/roe/roce/de` + `trim_raw(raw)`).
- [ ] **Step 4: Run to verify pass** — `.\.venv\Scripts\python.exe -m pytest tests -q` — Expected: full suite PASS.
- [ ] **Step 5: Commit** — `git add backend/app/stock/store.py backend/app/screener/service.py backend/app/stock/service.py backend/tests/test_stock_store.py backend/tests/test_fundamentals_pipeline.py` + `git commit -m "feat: wire composite fundamentals through screen and detail"`.

### Task 7: Docs, full suite, graph

**Files:**
- Modify: `backend/BACKEND.md`, `backend/app/db/DATABASE.md` (read patterns only, no schema change), `PLAN.md` (Phase 1.8 fundamentals note), `AGENTS.md` if plan list changes
- Test: full suite + `npm run build` untouched (no frontend changes)

- [ ] **Step 1: Docs** — BACKEND.md data-flow + provider chain + file-cache layout; DATABASE.md note (no schema change, files outside DB); PLAN.md Phase 1.8 fundamentals paragraph.
- [ ] **Step 2: Full verification** — `.\.venv\Scripts\python.exe -m pytest tests -q` PASS + `graphify update .` clean, no cycles.
- [ ] **Step 3: Commit** — `git add backend/BACKEND.md backend/app/db/DATABASE.md PLAN.md` + `git commit -m "docs: plan B fundamentals provider chain and file cache"`.
