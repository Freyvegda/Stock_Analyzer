# Phase 1.6b — Backend (universe list, profile store, richer detail)

> **For agentic workers:** part of the Phase 1.6b plan. Required sub-skill when
> executing: `superpowers:subagent-driven-development` or
> `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.
>
> **Spec:** `docs/superpowers/specs/2026-09-27-phase-1.6b-universe-search-design.md`.
> Storage policy: `plan/phase-1.6b-universe-search/database.md`.
> Frontend contract: `plan/phase-1.6b-universe-search/frontend.md`.

**Goal:** `GET /stocks` lists the whole stored Nifty 500 universe with per-user
verdicts; the screen run refreshes every stale symbol (shared DB); `GET /stock/{symbol}`
returns profile + `main_ratios` / `has` / `done` / `other_groups`; `raw_json` is
whitelisted and company profiles persist in a new `company_profiles` table.

**Architecture:** pure `app/stock/digest.py` (sections) + `app/stock/store.py`
(whitelist, profile upsert) + `app/stock/universe.py` (list orchestration); thin
`app/api/stocks.py` router. `screener/service.py` drops survivor-only fetching;
`stock/service.py` composes the richer payload. No provider changes — yfinance
`.info` already carries every field.

**Tech stack:** FastAPI, SQLAlchemy 2.x, pydantic v2, stdlib only for new logic.

## Global Constraints

- Work dir: `backend/` (venv active). Tests: `.\.venv\Scripts\python.exe -m pytest tests -q`.
- Tests run OFFLINE; mock all network (TestClient + temp SQLite via existing `test_db`).
- `BACKEND.md` rules stay binding: DataProvider boundary, thin API layer, per-stock
  failure isolation, composite-PK idempotency, no price storage.
- Never write daily bars to the DB. Never clobber a same-day `ok` fundamentals row
  with a `failed` one. Report/verdict never persisted.
- New logic is pure and unit-tested; `app/stock/store.py` helpers never commit —
  the caller owns the transaction.
- Reuse `engine.resolve_value` for fact resolution (duck-typed specs: it reads
  `.source`, `.key`, `.yf_field`, `.scale` only).
- Do not touch `frontend/` in this plan; it has its own plan file.

## Review Focus

Failure modes this spec implies; each gets a test in the task named here.

1. Same-day rerun must cost zero fundamentals calls — Task B3
   (`test_screen_rerun_same_day_makes_no_fundamentals_calls`).
2. A same-day `ok` row must survive a failed refresh even now that the whole
   universe refreshes — Task B3 (`test_failed_refresh_keeps_same_day_ok_row`,
   updated expected failure counts).
3. `raw_json` must not bloat: description/unknown keys dropped, catalog fields kept —
   Task B2 (`test_trim_raw_keeps_whitelist_drops_the_rest`).
4. Profile upsert must be idempotent (`merge`, one row) — Task B2
   (`test_upsert_profile_twice_keeps_one_row`).
5. A stock with no stored snapshot shows `no_data`, never a crash or a fake verdict —
   Task B5 (`test_no_data_verdict`).
6. Verdicts differ per user on identical stored data — Task B5
   (`test_universe_verdict_is_per_user`).

---

### Task B1: Section builder (pure) + public engine `passes`

**Files:**
- Create: `backend/app/stock/digest.py`
- Modify: `backend/app/screener/engine.py` (`_passes` → `passes`),
  `backend/app/stock/report.py` (extract `build_catalog_groups`)
- Test: `backend/tests/test_stock_digest.py`

**Interfaces:**
- Produces:
  - `digest.FactSpec(key, label, unit, source, yf_field=None, scale=1.0)` — frozen dataclass.
  - `digest.MAIN_FACTS`: pe (P/E, ×), pb (P/B, ×), roe (ROE, %), roce (ROCE, %),
    debt_to_equity (Debt/Equity, ×), dividendYield (Dividend Yield, %, raw, scale 1.0).
  - `digest.BALANCE_FACTS`: market_cap (Market Cap, ₹ cr, derived);
    totalRevenue, ebitda, netIncomeToCommon, operatingCashflow, freeCashflow,
    totalCash, totalDebt (labels "Revenue", "EBITDA", "Net Income",
    "Operating Cash Flow", "Free Cash Flow", "Total Cash", "Total Debt"; ₹ cr; raw,
    scale 1e-7); bookValue (Book Value, ₹, raw); currentRatio, quickRatio
    (Current/Quick Ratio, ×, raw).
  - `digest.PERFORMANCE_FACTS`: revenueGrowth (Revenue Growth), earningsGrowth
    (Earnings Growth), earningsQuarterlyGrowth (Quarterly Earnings Growth),
    grossMargins (Gross Margin), operatingMargins (Operating Margin), ebitdaMargins
    (EBITDA Margin), profitMargins (Net Margin), returnOnAssets (ROA), payoutRatio
    (Payout Ratio) — all %, raw, scale 100; fiveYearAvgDividendYield
    (5y Avg Dividend Yield, %, raw, scale 1.0).
  - `digest.build_sections(row: dict) -> dict` — keys `main_ratios`, `has`, `done`
    (`[{key,label,unit,value}]`, catalog/fact order, `None`/NaN/inf skipped),
    `other_groups` (`[{category, metrics}]`, catalog order).
  - `engine.passes(value: float | None, limit: float, direction: str) -> bool`
    (was `_passes`; `screen_rows` uses it).
  - `report.build_catalog_groups(row: dict, skip_keys: frozenset[str] = frozenset())
    -> list[dict]` — catalog grouped by category, `None` skipped, keys in
    `skip_keys` omitted; `build_report` delegates (behavior unchanged).

- [ ] **Step 1: Write the failing tests — `backend/tests/test_stock_digest.py`**

```python
ROW = {"pe": 20.0, "pb": 3.0, "roe": 25.0, "roce": 20.0, "debt_to_equity": 0.2,
       "market_cap": 5000.0,
       "raw": {"totalRevenue": 9.3e12, "revenueGrowth": 0.112, "currentRatio": 1.8,
               "longBusinessSummary": "…"}}

def test_main_ratios_resolve_derived_and_raw(): ...   # pe 20.0; dividendYield raw 1.2 stays 1.2
def test_has_scales_currency_to_crore(): ...          # totalRevenue 9.3e12 -> 930000.0
def test_done_scales_fractions_to_percent(): ...      # revenueGrowth 0.112 -> 11.2
def test_nan_and_missing_are_skipped(): ...           # raw {"pe": nan, "beta": 1.1} -> pe absent, no crash
def test_other_groups_exclude_used_keys(): ...        # "pe" not in any other_groups metric; "beta" is
def test_missing_raw_still_builds(): ...              # raw {} -> arrays exist, currency facts absent
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stock_digest.py -q`
Expected: FAIL — `app.stock.digest` missing.

- [ ] **Step 3: Implement**

- `digest.py`: `build_sections` resolves each spec via
  `engine.resolve_value(row, spec)`; appends when not `None`. `used = {pe, pb, roe,
  roce, debt_to_equity, dividendYield, market_cap, bookValue, currentRatio,
  quickRatio, returnOnAssets, profitMargins, operatingMargins, grossMargins,
  ebitdaMargins, revenueGrowth, earningsGrowth, earningsQuarterlyGrowth,
  payoutRatio, fiveYearAvgDividendYield}` (compute as the set of fact keys that
  exist in the catalog) → `report.build_catalog_groups(row, skip_keys=used)`.
- `report.py`: move the existing group loop into `build_catalog_groups`; call it
  with no skip from `build_report`.
- `engine.py`: rename `_passes` → `passes`; keep call sites updated.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stock_digest.py tests/test_stock_report.py tests/test_screener.py -q`
Expected: PASS (report/screener suites are the rename regression gate).

- [ ] **Step 5: Commit**

```bash
git add backend/app/stock/digest.py backend/app/screener/engine.py backend/app/stock/report.py backend/tests/test_stock_digest.py
git commit -m "feat: stock detail digest sections and public engine passes helper"
```

---

### Task B2: `company_profiles` model + storage helpers

**Files:**
- Modify: `backend/app/db/models.py` (new `CompanyProfile`)
- Create: `backend/app/stock/store.py`
- Test: `backend/tests/test_stock_store.py`

**Interfaces:**
- Produces:
  - `models.CompanyProfile(symbol PK, industry, sector, description, website,
    employees: int | None, hq, updated_at, all nullable except symbol/updated_at)`.
  - `store.RAW_FIELDS: frozenset[str]` — every `RATIO_CATALOG` raw `yf_field`
    ∪ every `digest.*_FACTS` `yf_field` (non-None).
  - `store.trim_raw(info: dict) -> dict` — whitelisted keys with non-`None` values only.
  - `store.upsert_profile(session, symbol: str, info: dict, updated_at: str) -> None`
    — `session.merge(CompanyProfile(...))`, no commit.
  - `store.read_profile(session, symbol: str) -> dict` — keys `description`,
    `industry`, `sector`, `website`, `employees`, `hq`; all `None` when no row.
    `hq` = `", ".join` of present `city`, `state`, `country`; `employees` coerced
    with `int()` when numeric else `None`.

- [ ] **Step 1: Write the failing tests — `backend/tests/test_stock_store.py`**

Temp `sessionmaker` engine fixture (`Base.metadata.create_all`).

```python
INFO = {"pe": 20.0, "longBusinessSummary": "Makes things", "sector": "Energy",
        "industry": "Oil & Gas", "website": "https://x.test", "fullTimeEmployees": 350000,
        "city": "Mumbai", "state": "Maharashtra", "country": "India",
        "totalRevenue": 9.3e12, "junkField": "drop me"}

def test_trim_raw_keeps_whitelist_drops_the_rest(): ...  # pe + totalRevenue kept; description/junk dropped
def test_upsert_profile_twice_keeps_one_row(): ...       # merge on symbol; second upsert updates industry
def test_read_profile_joins_hq_and_coerces_employees(): ...  # "Mumbai, Maharashtra, India"; 350000
def test_read_profile_absent_returns_nulls(): ...        # all six keys present, all None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stock_store.py -q`
Expected: FAIL — `CompanyProfile`/`store` missing.

- [ ] **Step 3: Implement**

Add the model to `models.py` (`Text` for description/hq; `Integer` employees).
`RAW_FIELDS` is computed from the catalog + digest fact tuples at import time.
`trim_raw` skips empty-string values too (`v is not None and v != ""`).
`upsert_profile` maps missing keys to `None` (never raises on odd `.info` values).

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stock_store.py tests/test_db_models.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/db/models.py backend/app/stock/store.py backend/tests/test_stock_store.py
git commit -m "feat: company_profiles table and whitelist/profile storage helpers"
```

---

### Task B3: Screen run refreshes the whole stale universe

**Files:**
- Modify: `backend/app/screener/service.py`
- Test: `backend/tests/test_screen_api.py` (update two existing tests, add two)

**Interfaces:**
- Consumes: B2 `store.trim_raw` / `store.upsert_profile`.
- Produces: `screener.service.latest_ok_fundamentals(session, symbols)` (public,
  same behavior as the old `_latest_ok_fundamentals`); stale-symbol refresh set:
  `refresh_symbols = [s for s in symbols if s not in latest or latest[s].date != today]`;
  final candidates = `fresh_rows.get(s) or stored_rows[s]` for every symbol that
  has either; fresh writes trim raw and upsert the profile.

- [ ] **Step 1: Update/add the failing tests**

In `backend/tests/test_screen_api.py`:

- **Replace** `test_run_fetches_only_stored_gate_passers` with
  `test_screen_run_refreshes_every_stale_symbol` — seed stored rows for
  AAA/BBB/CCC dated `STORED_DATE`, criteria default; assert
  `sorted(p.calls) == ["AAA", "BBB", "CCC"]` and shortlist still `["AAA"]`.
- **Update** `test_stored_snapshot_keeps_screen_alive_when_refresh_fails` — every
  symbol is refreshed now: `failed_count == 3`, `failed_symbols == [AAA, BBB, CCC]`
  (sorted), shortlist still `["AAA"]` with `data_date == STORED_DATE`, `stale is True`.
- **Add** `test_screen_rerun_same_day_makes_no_fundamentals_calls` — run once
  (`MapProvider`, calls recorded), clear `p.calls`, run again; assert `p.calls == []`.
- **Add** `test_screen_run_writes_company_profiles` — after a run, every fetched
  symbol has a `CompanyProfile` row (`MapProvider` raw includes
  `longBusinessSummary`/`industry`/`employees`).

- [ ] **Step 2: Run tests to verify failures**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_screen_api.py -q`
Expected: the new/changed tests FAIL against survivor-only logic.

- [ ] **Step 3: Implement `backend/app/screener/service.py`**

Rename `_latest_ok_fundamentals` → `latest_ok_fundamentals` (module docstring line
update). Stage 2 refresh set per the Interfaces block. Keep stage-1 stored gate
evaluation only if it still feeds `stored_rows` (it does); final candidates cover
every symbol with fresh or stored data. Fresh write path:

```python
if f.get("market_cap") is not None:
    existing[symbol].market_cap = f["market_cap"]
session.merge(Fundamental(..., raw_json=json.dumps(trim_raw(f["raw"]), default=str)))
upsert_profile(session, symbol, f["raw"], today)
```

Failed-row rule, `stale` computation, shortlist and `ScreenRun` persistence unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_screen_api.py tests/test_screener.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/screener/service.py backend/tests/test_screen_api.py
git commit -m "feat: screen run refreshes every stale universe symbol into the shared DB"
```

---

### Task B4: Detail service — profile + sections

**Files:**
- Modify: `backend/app/stock/service.py`
- Test: `backend/tests/test_stock_service.py` (extend)

**Interfaces:**
- Consumes: B1 `digest.build_sections`, B2 `store.trim_raw` / `store.upsert_profile` /
  `store.read_profile`.
- Produces: `_store_ok` trims raw + upserts the profile; `_detail_payload` adds
  `profile`, `main_ratios`, `has`, `done`, `other_groups` (spec §3.4 shape). All
  existing keys unchanged.

- [ ] **Step 1: Write the failing tests (extend `backend/tests/test_stock_service.py`)**

Give `GOOD["raw"]` digest fields (`longBusinessSummary`, `industry`,
`revenueGrowth`, `totalRevenue`, `currentRatio`) in these tests' local fixture.

```python
def test_detail_includes_profile_and_sections(): ...   # stored row + profile row -> keys present, values right
def test_lazy_fetch_stores_profile(): ...              # first GET -> CompanyProfile row written
def test_refresh_updates_profile(): ...                # Refresh changes industry -> read back new value
def test_detail_without_profile_row_returns_nones(): ...  # profile keys all None, sections still built
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stock_service.py -q`
Expected: FAIL — response lacks the new keys.

- [ ] **Step 3: Implement `backend/app/stock/service.py`**

In `_store_ok`: `raw_json=json.dumps(trim_raw(payload.get("raw") or {}), default=str)`
and `upsert_profile(session, stock.symbol, payload.get("raw") or {}, today)` before
commit. In `_detail_payload`:

```python
"profile": store.read_profile(session, stock.symbol),
"main_ratios": sections["main_ratios"], "has": sections["has"],
"done": sections["done"], "other_groups": sections["other_groups"],
```

with `sections = digest.build_sections(snapshot)`. Keep `_snapshot`'s `raw` parse
defensive exactly as-is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stock_service.py tests/test_stock_report.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/stock/service.py backend/tests/test_stock_service.py
git commit -m "feat: stock detail serves profile and digest sections"
```

---

### Task B5: Universe service + `/stocks` router

**Files:**
- Create: `backend/app/stock/universe.py`, `backend/app/api/stocks.py`
- Modify: `backend/app/main.py`, `backend/tests/conftest.py`
- Test: `backend/tests/test_stocks_api.py`, extend `backend/tests/test_stock_api.py`

**Interfaces:**
- Consumes: B1 `engine.passes` / `resolve_value` / `enabled_criteria`,
  B3 `screener.service.latest_ok_fundamentals`, `screener.service.get_criteria`.
- Produces:
  - `universe.list_universe(session_factory, provider, user_id) -> dict` —
    `{as_of, total, rows}` exactly as spec §3.4. Seeds `stocks` with
    `provider.list_stocks()` + commit when the table is empty (no fundamentals
    fetch). `verdict = "no_data"` when the symbol has no `ok` row; else `"pass"`
    when `passes == enabled` (all enabled criteria pass; `enabled == 0` → every
    stock with data is `pass`), else `"fail"`. `as_of` = newest `data_date`
    (max over rows), `None` when no row has data.
  - `api/stocks.py` router: `GET ""` → `list_universe(SessionLocal, get_provider(), user["id"])`
    after `init_db()`; module-level `get_provider()` (YFinanceProvider) so tests
    monkeypatch it. Mount in `main.py`: `app.include_router(stocks.router,
    prefix="/stocks", tags=["stocks"], dependencies=[Depends(current_user)])`.
    Upstream seeding errors ride the existing global httpx → 502 handler.
- `conftest.py` `test_db` gains `from app.api import stocks as stocks_api`;
  patches `SessionLocal` and `init_db`.

- [ ] **Step 1: Write the failing tests — `backend/tests/test_stocks_api.py`**

Reuse `client` / `sign_in` / `test_db`. A `FakeUniverseProvider` with
`list_stocks()` (3 symbols) + `calls` counter; seed helpers for `Stock` /
`Fundamental` / `UserCriteria` (direct rows, matching `test_screen_api.py` style);
monkeypatch `app.api.stocks.get_provider`.

```python
def test_stocks_require_auth(client, test_db): ...                 # 401
def test_universe_lazy_seeds_stocks_once(client, sign_in, provider, test_db):
    # empty DB -> rows from provider, stocks table has 3, second GET: list_stocks calls == 1
def test_universe_verdict_is_per_user(client, sign_in, provider, test_db):
    # alice pe<=25 -> "pass", bob pe<=5 -> "fail"; ratios identical in both payloads
def test_no_data_verdict(client, sign_in, provider, test_db): ...  # stock without fundamentals -> "no_data", passes 0
def test_passes_and_enabled_counts_and_as_of(client, sign_in, provider, test_db):
    # one criterion enabled, one stock passes -> passes 1/1; as_of == newest data_date
def test_universe_with_no_criteria_marks_data_rows_pass(client, sign_in, provider, test_db):
    # criteria all disabled -> enabled 0, verdict pass for rows with data
def test_stocks_list_includes_ratios(client, sign_in, provider, test_db): ...
```

Extend `backend/tests/test_stock_api.py`:

```python
def test_detail_has_profile_and_sections(client, sign_in, provider, test_db): ...
def test_refresh_keeps_sections_shape(client, sign_in, provider, test_db): ...
```

(The file's fake provider/detail fixtures already exist; add `.raw` digest fields
where the fixture is defined.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stocks_api.py -q`
Expected: FAIL — `/stocks` 404 (router not mounted).

- [ ] **Step 3: Implement `universe.py`, `stocks.py`, mount + conftest**

`universe.list_universe`:

```python
with session_factory() as session:
    if session.query(Stock).count() == 0:
        for data in provider.list_stocks():
            session.merge(Stock(symbol=data["symbol"], name=data["name"],
                                sector=data["sector"], market_cap=data.get("market_cap")))
        session.commit()
    stocks = session.query(Stock).order_by(Stock.symbol).all()
    latest = screener_service.latest_ok_fundamentals(session, [s.symbol for s in stocks])
    criteria = screener_service.get_criteria(session_factory, user_id)["criteria"]
    enabled = engine.enabled_criteria(criteria)
    rows = []
    for stock in stocks:
        row = engine row (derived columns + market_cap + parsed raw),
        passes = sum(engine.passes(engine.resolve_value(row, spec), limit, spec.direction)
                     for spec, limit in enabled)
        ...
```

`verdict`/`passes`/`enabled`/`data_date` per Interfaces. Reuse the `_stored_row`
shape from `screener.service` (import it or build locally — do not duplicate JSON
parsing logic twice; importing the private `_stored_row` is acceptable, or promote
it in B3 if cleaner).

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stocks_api.py tests/test_stock_api.py tests/test_screen_api.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/stock/universe.py backend/app/api/stocks.py backend/app/main.py backend/tests/conftest.py backend/tests/test_stocks_api.py backend/tests/test_stock_api.py
git commit -m "feat: /stocks universe endpoint with per-user verdicts"
```

---

### Task B6: Docs, full suite, knowledge graph

**Files:**
- Modify: `backend/BACKEND.md`, `backend/app/db/DATABASE.md`, `PLAN.md`, `AGENTS.md`

- [ ] **Step 1: Update context docs**

- `BACKEND.md`: structure (`app/stock/{digest,store,universe}.py`, `api/stocks.py`),
  API list (`GET /stocks`), data-flow line (universe list per-user verdicts;
  screen run refreshes every stale symbol), Phase Gate row `1.6b`.
- `DATABASE.md`: "Universe + profile write path" section — `company_profiles`
  (symbol PK, upsert, not dated), `raw_json` whitelist, refresh-all-stale rule,
  failed-row rule, prices still untouched.
- `PLAN.md`: Phase 1.6 bullet list gains the 1.6b continuation; `AGENTS.md` adds
  `phase-1.6b-universe-search/` to the plan folder list.

- [ ] **Step 2: Full offline suite**

Run: `.\.venv\Scripts\python.exe -m pytest tests -q`
Expected: all green, zero network.

- [ ] **Step 3: Refresh the knowledge graph**

Run: `graphify update .` (from repo root). Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add backend/BACKEND.md backend/app/db/DATABASE.md PLAN.md AGENTS.md
git commit -m "docs: backend context, storage policy and phase lists for Phase 1.6b"
```

## Acceptance

- `pytest tests -q` green offline.
- First run fetches the whole universe; same-day rerun makes zero fundamentals calls
  (`test_screen_rerun_same_day_makes_no_fundamentals_calls`).
- `/stocks` rows carry per-user verdicts on identical stored data
  (`test_universe_verdict_is_per_user`) and `no_data` for unseen symbols.
- Detail payload adds `profile` + four section arrays without breaking Phase 1.6
  keys (`test_stock_api.py` unchanged assertions still pass).
- `raw_json` whitelisted; `prices` untouched (`test_ohlc_writes_nothing` green).
