# Phase 1.6 — Backend (stock detail, report, candles)

> **For agentic workers:** part of the Phase 1.6 plan. Required sub-skill when executing:
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use
> checkbox (`- [ ]`) syntax.
>
> **Spec:** `docs/superpowers/specs/2026-09-27-phase-1.6-stock-detail-design.md`.
> Storage policy: `plan/phase-1.6-stock-detail/database.md`.
> Frontend contract: `plan/phase-1.6-stock-detail/frontend.md`.

**Goal:** `GET/POST /stock/{symbol}` serving a stored-first shared snapshot plus a
per-user computed report, and `GET /stock/{symbol}/ohlc` serving sliced/aggregated
daily candles from a process-memory TTL cache — never from the database.

**Architecture:** new `app/stock/` package (`candles.py` pure helpers + cache,
`report.py` pure report builder, `service.py` orchestration) and a thin
`app/api/stock.py` router. `engine.resolve_value` / `engine.enabled_criteria` /
`engine.score_row` become public and are shared with the report builder.
`YFinanceProvider.ohlc` is implemented here (Phase 3 reuses it).

**Tech stack:** FastAPI, SQLAlchemy 2.x, pydantic v2, pandas + yfinance (provider,
mocked in tests), stdlib only for the cache.

## Global Constraints

- Work dir: `backend/` (venv active). Tests: `.\.venv\Scripts\python.exe -m pytest tests -q`.
- Tests run OFFLINE; mock all network. TestClient + temp SQLite, mirroring
  `tests/test_screen_api.py` (`test_db` fixture patch pattern).
- BACKEND.md rules stay binding: DataProvider boundary, thin API layer, per-stock
  failure isolation, composite-PK idempotency, no new tables, no price storage.
- `app/stock/service.py` takes `session_factory` + `provider` + `cache` as parameters
  (testable without monkeypatching); only the API module holds module-level
  `get_provider()` / `SessionLocal` / `default_cache`.
- Never write daily bars to the DB. Never clobber a same-day `ok` fundamentals row
  with a `failed` one.
- Report is computed on read against the caller's saved criteria; never persisted.
- Do not touch `frontend/` in this plan; it has its own plan file.

## Review Focus

Failure modes the spec implies; each gets a test in the task named here.

1. Same-day refresh failure must not overwrite a good `ok` row — Task B4
   (`test_refresh_failure_keeps_same_day_ok_row`).
2. Two users see identical stock data but different verdicts — Task B5
   (`test_snapshot_shared_verdict_per_user`).
3. Second viewer must cost zero fundamentals network calls — Task B4
   (`test_stored_snapshot_never_calls_provider`).
4. `/ohlc` must never write to the DB — Task B5 (`test_ohlc_writes_nothing`).
5. 15d/monthly buckets must not drop or reorder the series — Task B1
   (`test_aggregate_preserves_extremes_and_order`).
6. Unknown symbol on any stock route is 404, never a 500 — Task B5
   (`test_unknown_symbol_is_404`).

---

### Task B1: Pure candle helpers + TTL cache

**Files:**
- Create: `backend/app/stock/__init__.py` (empty), `backend/app/stock/candles.py`
- Test: `backend/tests/test_candles.py`

**Interfaces:**
- Produces:
  - `candles.RANGES: dict[str, int]` — `{"6m": 182, "1y": 365, "2y": 730, "5y": 1825}`
  - `candles.INTERVALS: tuple[str, ...]` — `("1d", "15d", "1mo")`
  - `candles.slice_range(rows: list[dict], range_key: str) -> list[dict]`
  - `candles.aggregate_candles(rows: list[dict], interval: str) -> list[dict]`
  - `candles.CandleCache(ttl_seconds: float = 900.0, clock=time.monotonic)` with
    `get_or_fetch(symbol: str, loader: Callable[[], list[dict]]) -> list[dict]`,
    `invalidate(symbol: str) -> None`
  - `candles.default_cache = CandleCache()`
- Candle row shape everywhere: `{time: "YYYY-MM-DD", open, high, low, close, volume}`,
  ascending by `time`.

- [ ] **Step 1: Write the failing tests — `backend/tests/test_candles.py`**

```python
def rows_from(dates: list[str], close: float = 10.0):  # helper in the test file
    # one row per date: open=close-0.5, high=close+1, low=close-1, close, volume=100

def test_slice_range_keeps_cutoff_and_drops_older():
    # 500 rows ending 2026-09-25; "6m" -> first kept date == last - 182 days

def test_slice_range_empty_input_is_empty(): ...

def test_aggregate_daily_is_identity():
    # aggregate_candles(rows, "1d") == rows

def test_aggregate_15d_buckets_by_fixed_window():
    # dates 2026-01-01, 2026-01-02, 2026-01-16, 2026-01-17 -> 2 buckets
    # bucket 0 open == first open, close == second close, high == max, low == min, volume == sum

def test_aggregate_monthly_buckets_by_calendar_month():
    # 2026-01-05, 2026-01-20, 2026-02-02 -> times ["2026-01-05", "2026-02-02"]

def test_aggregate_preserves_extremes_and_order():
    # result times strictly ascending; overall max high and min low survive the fold

def test_cache_serves_within_ttl_and_refetches_after():
    # fake clock; loader call count 1 then 2 after advancing past 900s

def test_cache_is_per_symbol_and_invalidate_forces_refetch(): ...

def test_cache_does_not_cache_failures():
    # loader raising once then succeeding -> second call retries (count 2)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_candles.py -q`
Expected: FAIL — `app.stock.candles` does not exist.

- [ ] **Step 3: Implement `backend/app/stock/candles.py`**

- `slice_range`: empty → `[]`; cutoff = `date.fromisoformat(rows[-1]["time"]) - timedelta(days=RANGES[range_key])`; keep `row["time"] >= cutoff.isoformat()`.
- `aggregate_candles`: `"1d"` → `list(rows)`. Otherwise group by bucket key
  (`date.fromisoformat(t).toordinal() // 15` for `"15d"`, `t[:7]` for `"1mo"`) in a
  single ordered pass; per bucket emit `{"time": first_time, "open": first_open,
  "close": last_close, "high": max, "low": min, "volume": sum}`.
- `CandleCache`: `_entries: dict[str, tuple[float, list[dict]]]`; `get_or_fetch`
  returns a cached copy when `clock() - stored_at < ttl_seconds`, else calls
  `loader()` and stores the result (only when truthy); failures propagate untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_candles.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/stock/__init__.py backend/app/stock/candles.py backend/tests/test_candles.py
git commit -m "feat: candle range slicing, interval aggregation, TTL cache (memory only)"
```

---

### Task B2: `YFinanceProvider.ohlc`

**Files:**
- Modify: `backend/app/data/yfinance_impl.py`
- Test: `backend/tests/test_provider.py` (replace `test_ohlc_and_filings_are_not_implemented`)

**Interfaces:**
- Produces: `YFinanceProvider.ohlc(symbol: str, years: int = 5) -> list[dict]` —
  ascending `{time, open, high, low, close, volume}` rows; rows with NaN close are
  dropped; empty frame → `[]`; yfinance errors propagate.

- [ ] **Step 1: Replace the placeholder test with failing tests**

```python
def fake_history_class(frame):  # extends fake_ticker_class with .history(**kwargs)
    # records kwargs; returns the frame

def test_ohlc_maps_history_rows(monkeypatch): ...   # 2 rows -> both mapped, right values, ascending
def test_ohlc_drops_nan_close_and_empty_frame(monkeypatch): ...  # one NaN close row dropped; empty frame -> []
def test_ohlc_requests_daily_history_for_period(monkeypatch): ...  # period == "5y", interval == "1d"
```

Keep the remaining `filings` NotImplementedError assertion as its own test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_provider.py -q`
Expected: FAIL — `ohlc` still raises `NotImplementedError`.

- [ ] **Step 3: Implement**

```python
def ohlc(self, symbol: str, years: int = 5) -> list[dict]:
    frame = yf.Ticker(f"{symbol}.NS").history(period=f"{years}y", interval="1d", auto_adjust=False)
    ...
```

Iterate `frame.itertuples()`; skip rows where `pd.isna(close)`; emit floats and
`index.date().isoformat()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_provider.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/data/yfinance_impl.py backend/tests/test_provider.py
git commit -m "feat: YFinanceProvider.ohlc daily history mapping"
```

---

### Task B3: Report builder (pure) + public engine helpers

**Files:**
- Modify: `backend/app/screener/engine.py` (`_resolve` → `resolve_value`,
  `_enabled_criteria` → `enabled_criteria`, extract `score_row`)
- Create: `backend/app/stock/report.py`
- Test: `backend/tests/test_stock_report.py`

**Interfaces:**
- Consumes: `catalog.CATALOG_BY_KEY`, `catalog.RATIO_CATALOG`, `criteria.ConfigError`.
- Produces:
  - `engine.resolve_value(row: dict, spec: RatioSpec) -> float | None`
  - `engine.enabled_criteria(criteria: list[dict]) -> list[tuple[RatioSpec, float]]`
  - `engine.score_row(row: dict) -> float` — `roe + roce − 20 × debt_to_equity`,
    missing → 0 (raw sum, not rounded); `rank_shortlist` keeps `round(..., 2)`.
  - `report.build_report(snapshot: dict, criteria: list[dict]) -> dict` with keys
    `verdict` (`"pass"|"fail"`), `score`, `passed`, `enabled`, `criteria`, `notes`, `groups`.
    - `criteria` item: `{key, label, unit, direction, threshold, value, passed, delta}`
      (`delta = value - threshold`, `None` when value is `None`; enabled items in order).
    - `notes` (failed only): `"{label} {value}{unit} is above your limit of {threshold}{unit}"`,
      `"… is below your minimum of …"`, `"{label} has no stored data — counts as a fail"`.
      Format numbers with `f"{v:g}"`.
    - `groups`: `[{category, metrics: [{key, label, unit, value}]}]` — catalog order,
      `None` skipped; `value = engine.resolve_value(snapshot, spec)`.
- Unknown criteria key raises `ConfigError` (via `enabled_criteria`) — unchanged behavior.

- [ ] **Step 1: Write the failing tests — `backend/tests/test_stock_report.py`**

```python
SNAPSHOT = {"pe": 20.0, "pb": 3.0, "roe": 25.0, "roce": 20.0, "debt_to_equity": 0.2,
            "market_cap": 5000.0, "raw": {"returnOnAssets": 0.08, "currentRatio": 2.0}}

def test_all_enabled_pass_gives_pass_verdict(): ...     # passed == enabled, notes == []
def test_failed_criterion_flips_verdict_and_notes(): ...  # pe 30 > limit 25 -> "is above your limit"
def test_missing_value_fails_and_notes_no_data(): ...   # snapshot pe None -> passed False + "no stored data"
def test_score_matches_engine_formula(): ...            # 25 + 20 - 20*0.2 = 41.0
def test_disabled_criteria_are_skipped(): ...           # disabled pe not in criteria list
def test_groups_are_catalog_order_scaled_and_skip_none(): ...  # ROA 8.0 present; missing keys absent
def test_unknown_key_raises_config_error(): ...
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stock_report.py tests/test_screener.py -q`
Expected: FAIL for the report tests; screener tests still PASS after the engine rename
(run both to catch accidental behavior changes).

- [ ] **Step 3: Implement the engine rename/extraction + `report.py`**

- `engine.py`: rename without behavior change; `rank_shortlist` uses
  `round(score_row(row), 2)`.
- `report.py`: iterate `enabled_criteria(criteria)`; build criteria rows, notes,
  counts, and `groups` by iterating `RATIO_CATALOG` once, appending to the
  category group of the last seen category (catalog is already grouped by block).
- `build_report` computes `score` via `round(score_row(snapshot), 2)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stock_report.py tests/test_screener.py tests/test_catalog.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/screener/engine.py backend/app/stock/report.py backend/tests/test_stock_report.py
git commit -m "feat: pure per-user stock report builder; public engine resolve/score helpers"
```

---

### Task B4: Stock service (stored-first snapshot, refresh, ohlc)

**Files:**
- Create: `backend/app/stock/service.py`
- Test: `backend/tests/test_stock_service.py`

**Interfaces:**
- Consumes: B1 `candles`, B3 `report.build_report`, `screener.service.get_criteria`,
  `db.models.Stock/Fundamental/ScreenRun`.
- Produces:
  - `service.StockNotFound(Exception)`, `service.StockDataUnavailable(Exception)`,
    `service.PriceDataUnavailable(Exception)`
  - `service.get_stock_detail(session_factory, provider, user_id: int, symbol: str) -> dict`
  - `service.refresh_stock(session_factory, provider, user_id: int, symbol: str) -> dict`
  - `service.get_ohlc(session_factory, provider, symbol: str, range_key: str, interval: str, cache) -> dict`
  - Response keys exactly as the spec §3.2 (GET has `refreshed: None`; refresh sets the bool).
  - `_snapshot` dict (internal, for the report): derived columns + `market_cap` +
    parsed `raw` from `raw_json` (corrupt JSON → `{}`), plus `date`/`data_status`.

- [ ] **Step 1: Write the failing tests — `backend/tests/test_stock_service.py`**

Test-file fixtures: a temp `sessionmaker` engine (`Base.metadata.create_all`) and a
`FakeProvider` with `fundamentals()`/`ohlc()` call counters and configurable failures.
Seed `Stock(symbol="AAA", name="Alpha Ltd", sector="IT", market_cap=...)` + `User`.

```python
def test_stored_snapshot_never_calls_provider(): ...        # seed ok row -> calls == 0, stale True
def test_missing_snapshot_lazy_fetches_and_stores(): ...    # calls == 1, row date == today, market_cap updated
def test_lazy_fetch_failure_writes_failed_row_and_raises(): ...  # StockDataUnavailable + failed row
def test_unknown_symbol_raises_stock_not_found(): ...
def test_refresh_success_overwrites_today_and_sets_refreshed(): ...
def test_refresh_failure_serves_stored_with_warning(): ...  # refreshed False, warning set, snapshot == stored
def test_refresh_failure_keeps_same_day_ok_row(): ...       # no failed row written when today ok exists; ok still served
def test_refresh_failure_without_stored_raises(): ...
def test_verdict_uses_callers_criteria(): ...               # user A pe<=25 pass, user B pe<=5 fail, same snapshot
def test_run_context_from_latest_run(): ...                 # ScreenRun with symbol -> rank/score; other user None
def test_ohlc_slices_and_aggregates(): ...                  # 400 daily rows -> 1y + 15d response rows
def test_ohlc_empty_provider_raises_price_unavailable(): ...
def test_ohlc_uses_cache(): ...                             # two calls -> provider.ohlc calls == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stock_service.py -q`
Expected: FAIL — `app.stock.service` does not exist.

- [ ] **Step 3: Implement `backend/app/stock/service.py`**

- `_load_stock(session, symbol)` → `session.get(Stock, symbol)`; `None` → `StockNotFound`.
- `_latest_ok(session, symbol)` → newest `data_status="ok"` row
  (`order_by(Fundamental.date.desc()).first()`).
- `_store_ok(session, stock, f, today)`: `session.merge(Fundamental(symbol, date=today,
  pe=…, …, data_status="ok", raw_json=json.dumps(f["raw"], default=str)))`; update
  `stock.market_cap` when `f.get("market_cap") is not None`; `commit`.
- `_store_failure(session, symbol, today, error)`: write a `failed` row **only if**
  `_latest_ok_for_day(session, symbol, today)` is `None`; then `commit`.
- `get_stock_detail`: stock → latest ok → serve; else fetch (isolated try/except →
  `_store_failure` + `StockDataUnavailable(str(e))`), store, serve. Assemble:
  criteria from `screener.service.get_criteria(session_factory, user_id)`, report from
  B3, `run` from the caller's latest `ScreenRun` entry for the symbol, `stale`.
- `refresh_stock`: same but always fetch; failure with stored → `refreshed=False`,
  `warning`, serve stored; failure without → `_store_failure` + `StockDataUnavailable`.
- `get_ohlc`: `_load_stock`; `rows = cache.get_or_fetch(symbol, lambda: provider.ohlc(symbol, years=5))`;
  empty → `PriceDataUnavailable("no daily bars")`; `as_of = rows[-1]["time"]`;
  `candles = aggregate_candles(slice_range(rows, range_key), interval)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stock_service.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/stock/service.py backend/tests/test_stock_service.py
git commit -m "feat: stored-first stock snapshot service with refresh and cached candles"
```

---

### Task B5: `/stock` router + mount + endpoint tests

**Files:**
- Create: `backend/app/api/stock.py`
- Modify: `backend/app/main.py`, `backend/tests/conftest.py` (patch `stock_api` module
  fixtures in `test_db`)
- Test: `backend/tests/test_stock_api.py`

**Interfaces:**
- Consumes: B4 service, `auth.deps.current_user`, `candles.CandleCache`.
- Produces (all mounted under `prefix="/stock"`, `dependencies=[Depends(current_user)]`):
  - `GET /stock/{symbol}` → 200 detail; `StockNotFound` → 404
    `{"detail": "Unknown symbol XXX"}`; `StockDataUnavailable` → 502.
  - `POST /stock/{symbol}/refresh` → same shape + `refreshed`.
  - `GET /stock/{symbol}/ohlc` with `range: Literal["6m","1y","2y","5y"] = "1y"` and
    `interval: Literal["1d","15d","1mo"] = "1d"` → 200; `PriceDataUnavailable` → 502.
  - Module-level `get_provider()` and `default_cache` (monkeypatched in tests).
  - Symbol normalisation: `symbol.strip().upper()` inside every handler.

- [ ] **Step 1: Write the failing tests — `backend/tests/test_stock_api.py`**

Reuse the `client` / `sign_in` / `test_db` fixtures. Seed stocks with a helper
(`Stock` + optional `Fundamental` rows). FakeProvider also implements `ohlc`.

```python
def test_stock_routes_require_auth(client, test_db): ...          # 401 x3
def test_unknown_symbol_is_404(client, sign_in, provider, test_db): ...
def test_first_view_fetches_and_second_user_reads_db(client, sign_in, provider, test_db):
    # alice GET -> provider.fundamentals calls == 1; bob GET -> still 1, same pe/data_date
def test_verdict_is_per_user(client, sign_in, provider, test_db):
    # alice criteria pe<=25 -> "pass"; bob pe<=5 -> "fail"; snapshot identical
def test_refresh_returns_stored_with_warning_when_fetch_fails(client, sign_in, provider, test_db): ...
def test_502_when_nothing_stored_and_provider_dead(client, sign_in, provider, test_db): ...
def test_ohlc_range_and_interval_validation(client, sign_in, test_db): ...  # bad range/interval -> 422
def test_ohlc_slices_and_aggregates(client, sign_in, provider, test_db): ...
def test_ohlc_writes_nothing(client, sign_in, provider, test_db): ...      # Price count 0; fundamentals count unchanged
def test_ohlc_served_from_cache(client, sign_in, provider, test_db): ...   # two calls -> provider.ohlc calls == 1
```

Criteria seeding: `PUT /screen/criteria` (or direct `UserCriteria` rows — direct rows
match the existing test style).

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stock_api.py -q`
Expected: FAIL — `/stock/*` 404 (router not mounted).

- [ ] **Step 3: Implement**

- `app/api/stock.py`: three thin handlers wrapping the service in
  `try/except (StockNotFound, StockDataUnavailable, PriceDataUnavailable)` →
  `HTTPException`; `init_db()` per handler; both snapshot handlers pass `user["id"]`.
- `main.py`: import + `app.include_router(stock.router, prefix="/stock", tags=["stock"],
  dependencies=[Depends(current_user)])`.
- `conftest.py` `test_db`: monkeypatch `app.api.stock.SessionLocal` + `init_db`
  (same pattern as `screen_api`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stock_api.py tests/test_stock_service.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/stock.py backend/app/main.py backend/tests/conftest.py backend/tests/test_stock_api.py
git commit -m "feat: /stock detail, refresh and ohlc endpoints behind auth"
```

---

### Task B6: Docs, full suite, knowledge graph

**Files:**
- Modify: `backend/BACKEND.md`, `backend/app/db/DATABASE.md`, `PLAN.md`, `AGENTS.md`

- [ ] **Step 1: Update context docs**

- `BACKEND.md`: structure (`app/stock/{candles,report,service}.py`, `api/stock.py`),
  API list, Data Flow line (`/stock/{symbol}` stored-first → report → cached candles),
  Error Handling line (candles memory-cached; refresh failure serves stored + warning),
  Phase Gate row `1.6`.
- `DATABASE.md`: "Stock detail write path" section — shared snapshot, `merge` idempotency,
  failed-row-only-without-ok rule, candles never persisted (memory TTL 900 s), no schema change.
- `PLAN.md`: Phase 1.6 section; `AGENTS.md`: add `phase-1.6-stock-detail/` to the plan folder list.

- [ ] **Step 2: Full offline suite**

Run: `.\.venv\Scripts\python.exe -m pytest tests -q`
Expected: all green, zero network.

- [ ] **Step 3: Refresh the knowledge graph**

Run: `graphify update .` (from repo root). Expected: succeeds, no new cycles.

- [ ] **Step 4: Commit**

```bash
git add backend/BACKEND.md backend/app/db/DATABASE.md PLAN.md AGENTS.md
git commit -m "docs: backend context, storage policy and phase lists for Phase 1.6"
```

## Acceptance

- `pytest tests -q` green offline; no test touches the network.
- Stored-first contract: second viewer costs zero fundamentals calls and sees the
  same snapshot (`test_stock_api.py::test_first_view_fetches_and_second_user_reads_db`).
- Per-user verdict: identical snapshot, different verdicts
  (`test_stock_api.py::test_verdict_is_per_user`).
- No writes on the candle path; `prices` untouched
  (`test_stock_api.py::test_ohlc_writes_nothing`).
- 15d/1mo aggregation preserves extremes and ascending order (Task B1 tests).
- `engine` behavior unchanged: existing screener/catalog tests still pass.
