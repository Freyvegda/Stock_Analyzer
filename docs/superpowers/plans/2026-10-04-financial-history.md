# Financial History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stock detail gains an 8-quarter / 5-year full-P&L history section backed by screener.in scrape + file cache.

**Architecture:** Extend `screener_statements.py` with a pure `parse_history` plus history in the existing statements file cache; serve via `CompositeProvider.financials` + thin `GET /stock/{symbol}/financials`; render with a new `Financials.tsx` toggle table + recharts bars below `FundamentalsPanel`.

**Tech Stack:** Python (BeautifulSoup, httpx, pytest), FastAPI, React + TypeScript, recharts, vitest.

**Spec:** `docs/superpowers/specs/2026-10-04-financial-history-design.md`

## Global Constraints

- DataProvider interface is the boundary for ALL external data; consumers never import yfinance/screener/stooq directly.
- Composite PKs = idempotent reruns everywhere.
- Per-stock failure isolation — one failure never kills a batch.
- Tests run offline; mock all network.
- Tests + build green before committing.
- Frontend: call via `api.get('/stock/...')`, never hardcode `localhost:8000`; semantic tokens only, never hardcoded palette/hex; `Num` for numbers; `npm run build` (tsc -b && vite build) must pass.
- Backend pip on this machine: ALWAYS `pip install --isolated <pkg>`.
- Dates as ISO strings; money in Rs cr, shares in cr shares; EPS in Rs unscaled.

## Review Focus

- Quarterly table with TTM/9m stub columns mixed in: TTM/partial columns must be skipped, only true quarters kept.
- Sep/Dec fiscal year-end company (non-Mar): annual detection must not pin a single Mar stub column.
- Screener page in lakh (small-cap): all money rows scaled ×0.01, EPS never scaled.
- First-ever history fetch while screener 429s with no cache: API 502s, ratios/detail still paint, UI shows history-unavailable not a page crash.
- Negative PAT quarter: table shows red loss value, bar renders below axis, never sakura-colored for polarity.

---

### Task 1: `parse_history` pure parser

**Files:**
- Modify: `backend/app/data/screener_statements.py`
- Test: `backend/tests/test_financial_history.py`

**Interfaces:**
- Consumes: `_LABEL_MAP`, `_to_float`, `_lakh_scale`, `_annual_indexes`, `_PARTIAL_RE`, `_NON_ANNUAL_RE`, `_YEAR_RE`, `_month_of` (existing, same module).
- Produces: `parse_history(html: str) -> dict` returning `{quarterly: list[FinancialPeriod], annual: list[FinancialPeriod]}` where each period is `{period, sales, expenses, operating_profit, other_income, interest, depreciation, pbt, tax, pat, eps}` (floats or None; money Rs cr, eps Rs). Later tasks use this exact name/shape.

- [ ] **Step 1: Write failing tests for quarterly + annual parse**

```python
def test_parse_history_quarterly_keeps_8_quarters_skips_ttm():
    out = parse_history(QUARTERLY_HTML_WITH_TTM)
    assert [p["period"] for p in out["quarterly"]] == ["Q1FY24", ..., "Q4FY25"]  # 8 labels
    assert out["quarterly"][-1]["sales"] == 100.0
    assert out["quarterly"][-1]["pat"] == 15.0

def test_parse_history_annual_keeps_5_years_bank_synonyms():
    out = parse_history(ANNUAL_HTML)
    assert [p["period"] for p in out["annual"]] == ["FY21", ..., "FY25"]
    assert out["annual"][-1]["operating_profit"] == 350.0  # Financing Profit synonym
    assert out["annual"][-1]["eps"] == 12.5  # unscaled Rs

def test_parse_history_september_yearend_annuals_not_stubbed():
    out = parse_history(SEP_YEAREND_HTML)  # Sep annuals + lone Mar stub col
    assert [p["period"] for p in out["annual"]] == ["FY23", "FY24", "FY25"]
    assert out["annual"][-1]["sales"] == 200.0

def test_parse_history_lakh_scales_money_not_eps():
    out = parse_history(LAKH_HTML)
    assert out["annual"][-1]["sales"] == 10.0  # 1000 lakh -> 10 cr
    assert out["annual"][-1]["eps"] == 5.0

def test_parse_history_missing_cells_are_none():
    out = parse_history(SPARSE_HTML)
    assert out["quarterly"][-1]["interest"] is None

def test_parse_history_quarterly_table_skipped_for_annuals_regression():
    # existing parse_statements behavior unchanged; history annual still reads Mar cols
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/Scripts/python.exe -m pytest backend/tests/test_financial_history.py -q` (from repo root; pytest config uses `pythonpath=.`? check `backend/pyproject.toml` — run from `backend/`: `.venv/Scripts/python.exe -m pytest tests/test_financial_history.py -q`)
Expected: FAIL (parse_history not defined).

- [ ] **Step 3: Implement `parse_history(html)` in `backend/app/data/screener_statements.py`**

Add `_LABEL_MAP` entries: `"total expenses" -> "expenses"`, `"expenses" -> "expenses"`, `"eps" -> "_eps"`, `"eps in rs" -> "_eps"`, `"adjusted eps" -> "_eps"`. Parser walks every `<table>`: header months/years classify as quarterly-series (mixed Jun/Sep/Dec/Mar with overlapping years, or `len(_annual_indexes)<=1` with quarterly markers) vs annual-series (`_annual_indexes`). Quarterly columns filter `_PARTIAL_RE`/`_NON_ANNUAL_RE` (drop TTM/9m/half). Collect per-field value lists oldest-first; `latest` = last 8 quarterly / last 5 annual with period labels (`Q{N}FY{yy}` via month map Jun=1,Sep=2,Dec=3,Mar=4; annual `FY{yy}`). Derive `expenses = sales − operating_profit` when row absent but both present; `pbt = op + other − interest − depreciation` when parts present; `tax = pbt − pat` when both present. Scale money × `_lakh_scale`, never scale `_eps`. Return `{quarterly, annual}`; empty tables → `[]`.

- [ ] **Step 4: Run tests green + no regression**

Run: `.venv/Scripts/python.exe -m pytest tests/test_financial_history.py tests/test_screener_statements.py -q` (from `backend/`)
Expected: PASS all.

- [ ] **Step 5: Commit**

```bash
git add backend/app/data/screener_statements.py backend/tests/test_financial_history.py
git commit -m "feat: parse 8-quarter and 5-year P&L history from screener HTML"
```

### Task 2: History in statements file cache

**Files:**
- Modify: `backend/app/data/screener_statements.py` (`fetch_statements`)
- Test: `backend/tests/test_financial_history.py` (append)

**Interfaces:**
- Consumes: `parse_history` (Task 1), `parse_identity`, `_read_cache`, `_cache_path`.
- Produces: `fetch_statements(symbol, cache_dir, ttl_days, client)` returns fields dict now including `history: {quarterly, annual}`. Task 3 reads `fields["history"]`.

- [ ] **Step 1: Write failing cache tests**

```python
def test_fetch_statements_writes_history(tmp_path):
    out = fetch_statements("AAA", cache_dir=str(tmp_path), client=lambda s: FULL_HTML)
    assert len(out["history"]["quarterly"]) == 8
    assert len(out["history"]["annual"]) == 5

def test_fetch_statements_backfills_history_on_fresh_cache(tmp_path):
    # seed fresh cache without history, expect one download fills it
    assert out["history"]["quarterly"] != []

def test_fetch_statements_merges_stale_history_on_partial_page(tmp_path):
    # stale cache has 8 quarters; fresh page parses 2; merged keeps 8 with fresh winning
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_financial_history.py -q` (from `backend/`)
Expected: FAIL (no `history` key).

- [ ] **Step 3: Implement history in `fetch_statements`**

On fresh-cache serve path: if `history` missing/empty, best-effort `_download` (or `client`) + `parse_history` + merge + atomic rewrite (mirror identity-backfill pattern; never raise). On fresh-download path: `fields["history"] = parse_history(html)` (try/except → stale history or `{quarterly: [], annual: []}`); merge stale per-period (fresh non-None wins; stale fills gaps; cap 8/5). Identity merge unchanged.

- [ ] **Step 4: Run tests green**

Run: `.venv/Scripts/python.exe -m pytest tests/test_financial_history.py tests/test_screener_statements.py -q` (from `backend/`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/data/screener_statements.py backend/tests/test_financial_history.py
git commit -m "feat: cache P&L history in statements file with lazy backfill"
```

### Task 3: Provider + service + `GET /financials` API

**Files:**
- Modify: `backend/app/data/composite_impl.py`, `backend/app/stock/service.py`, `backend/app/api/stock.py`
- Test: `backend/tests/test_financial_history.py` (provider/service), `backend/tests/test_stock_api.py` (append route tests or new `test_financials_api.py`)

**Interfaces:**
- Consumes: `fetch_statements` fields `history` (Task 2).
- Produces: `CompositeProvider.financials(symbol: str) -> {quarterly, annual, as_of, stale}`; `service.get_financials(session_factory, provider, symbol: str) -> {symbol, quarterly, annual, as_of, stale}`; `GET /stock/{symbol}/financials -> FinancialsResponse`.

- [ ] **Step 1: Write failing provider/service/API tests**

```python
def test_composite_financials_serves_cached_history(tmp_path):
    provider = CompositeProvider(statements_dir=str(tmp_path))
    out = provider.financials("AAA")
    assert len(out["quarterly"]) == 8 and out["as_of"] == "2026-10-04"

def test_get_financials_unknown_symbol_raises(test_db):
    with pytest.raises(StockNotFound): get_financials(...)

def test_financials_route_200_404_502(test_db, monkeypatch):
    # 200 shape {symbol, quarterly, annual, as_of, stale}
    # 404 unknown symbol; 502 when provider raises
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_financial_history.py -q` (from `backend/`)
Expected: FAIL (no `financials` method).

- [ ] **Step 3: Implement `CompositeProvider.financials`, `service.get_financials`, route**

`financials`: `fetch_statements(symbol, statements_dir, ttl)` → `{quarterly, annual}` from `fields.get("history", ...)` (default empty lists); `as_of` = cache file `as_of` or today; `stale` = age > `statements_ttl_days`. Exceptions propagate (service maps to 502). `service.get_financials`: `_load_stock` then `provider.financials` inside try (log + raise `StockDataUnavailable`); no DB writes. Route `GET /{symbol}/financials` with `current_user`, `_normalize`, 404 `StockNotFound`, 502 `StockDataUnavailable`.

- [ ] **Step 4: Run backend suite green**

Run: `.venv/Scripts/python.exe -m pytest tests -q` (from `backend/`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/data/composite_impl.py backend/app/stock/service.py backend/app/api/stock.py backend/tests/test_financial_history.py backend/tests/test_stock_api.py
git commit -m "feat: GET /stock/{symbol}/financials serves cached P&L history"
```

### Task 4: `Financials.tsx` + detail wiring + types

**Files:**
- Create: `frontend/src/components/Financials.tsx`
- Create: `frontend/src/components/__tests__/Financials.test.tsx`
- Modify: `frontend/src/api/types.ts`, `frontend/src/pages/StockDetail.tsx`

**Interfaces:**
- Consumes: `GET /stock/{symbol}/financials -> FinancialsResponse {symbol, quarterly: FinancialPeriod[], annual: FinancialPeriod[], as_of: string|null, stale: boolean}`.
- Produces: `<Financials symbol={symbol} />` rendered below `<FundamentalsPanel>` on stock detail.

- [ ] **Step 1: Write failing component tests**

```tsx
// Financials.test.tsx: mock api.get for /financials
it('toggles quarterly/annual columns', ...)
it('renders — for nulls and red class for negative PAT', ...)
it('shows skeleton, error+retry, stale badge, empty state', ...)
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test -- Financials` (from `frontend/`)
Expected: FAIL (component missing).

- [ ] **Step 3: Implement types + `Financials.tsx` + mount in `StockDetail.tsx`**

Types: `FinancialPeriod {period: string; sales: number|null; expenses: number|null; operating_profit: number|null; other_income: number|null; interest: number|null; depreciation: number|null; pbt: number|null; tax: number|null; pat: number|null; eps: number|null}`, `FinancialsResponse`. Component: fetch-once per symbol (`api.get`), Quarterly|Annual toggle (default quarterly), shadcn table (rows P&L lines, cols periods oldest→latest, `Num` formatting, `—` nulls, `text-loss` negative PAT), recharts BarChart sales+PAT (negative below axis), skeleton/error-retry/stale/empty states, `BlurFade` wrapper `data-testid="financials"`. Mount below `<FundamentalsPanel>` in `StockDetail.tsx`.

- [ ] **Step 4: Run frontend tests + build green**

Run: `npm run test -- Financials` then `npm run build` (from `frontend/`)
Expected: PASS tests; `tsc -b && vite build` clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Financials.tsx frontend/src/components/__tests__/Financials.test.tsx frontend/src/api/types.ts frontend/src/pages/StockDetail.tsx
git commit -m "feat: financial history section with quarterly/annual toggle on stock detail"
```

### Task 5: Full verification + graph refresh

**Files:** none (verification only).

- [ ] **Step 1: Run full backend suite**

Run: `.venv/Scripts/python.exe -m pytest tests -q` (from `backend/`)
Expected: PASS.

- [ ] **Step 2: Run full frontend suite + build**

Run: `npm run test` then `npm run build` (from `frontend/`)
Expected: PASS + clean build.

- [ ] **Step 3: Refresh knowledge graph**

Run: `graphify update .` (from repo root)
Expected: exit 0.
