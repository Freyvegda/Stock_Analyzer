# Backend Context — Stock Analyzer

> Agent context file. Read this before touching `backend/`. Source of truth: `PLAN.md`.

## Purpose

Python + FastAPI service. Runs 4-stage pipeline for Indian-market (Nifty 500) analysis:
1. **Screen** — `POST /screen/run` instantly gates the stored snapshot (newest ok row per symbol + `stocks.market_cap`) with the active screen's DB-stored criteria and returns ~10 rows (zero `fundamentals()` calls); a background job then refreshes every stale symbol from yfinance and re-runs all saved screens, active last (Phase 1.8; YAML retired in Phase 1.5)
2. **Docs** — fetch + parse PDFs (concalls, quarterly results, investor presentations, audit reports) for shortlisted stocks only, analyze with Gemini Flash (free tier) with keyword fallback
3. **Model** — XGBoost on 5yr daily OHLC features -> buy/sell/hold signals per shortlisted stock
4. **Backtest** — walk-forward (3y train / 1q test, rolling 2019-2024), report CAGR/Sharpe/max-drawdown vs Nifty 500

Budget: 0 INR. All data sources free. Signals only — no auto-trading.

## Stack

- Python 3.10, FastAPI, uvicorn
- SQLAlchemy 2.x + SQLite (`data/stockanalyzer.db`) — schema must stay Postgres-compatible (no SQLite-only types); engine sets WAL + `busy_timeout` pragmas on connect (Phase 1.8)
- yfinance (prices + some fundamentals, `.NS` tickers), screener.in (fundamentals/doc links), NSE/BSE announcement endpoints (PDFs)
- pdfplumber (PDF text), google-generativeai (Gemini Flash), xgboost + scikit-learn, pandas, pyyaml, httpx
- pytest (tests must run OFFLINE — mock all network)

## Structure

```
backend/
├── app/
│   ├── main.py            # FastAPI app, CORS (localhost:5173), session middleware, router mounts, /health
│   ├── api/
│   │   ├── auth.py        # /auth/state, /auth/setup, /auth/login, /auth/logout, /auth/me
│   │   ├── screen.py      # /screen/ratios, /screen/sets CRUD + activate, POST /screen/run, GET /screen/jobs/latest, GET /screen/latest
│   │   ├── stock.py       # GET /stock/{symbol}, POST /stock/{symbol}/refresh, GET /stock/{symbol}/ohlc
│   │   ├── stocks.py      # GET /stocks — universe list with per-user verdicts
│   │   ├── docs.py        # POST /docs/fetch, POST /docs/analyze, GET /docs/{symbol}
│   │   ├── signals.py     # POST /model/train, POST /model/predict, GET /model/signals
│   │   └── backtest.py    # POST /backtest/run, GET /backtest/{id}
│   ├── auth/              # scrypt hashing, user service, current_user dependency
│   │   ├── security.py
│   │   ├── service.py
│   │   └── deps.py
│   ├── data/
│   │   ├── provider.py    # DataProvider ABC — THE extension point
│   │   ├── yfinance_impl.py
│   │   ├── screener_impl.py
│   │   └── nse_impl.py
│   ├── screener/
│   │   ├── catalog.py     # RATIO_CATALOG — source of truth for valid criteria keys
│   │   ├── criteria.py    # pydantic screening-set + criteria models, defaults, validation (ConfigError)
│   │   ├── engine.py      # criteria filtering + ranking -> shortlist (pure)
│   │   ├── service.py     # stored-snapshot run, job create/prune/project, screening-set CRUD (rule 6)
│   │   └── runner.py      # background job worker: stale-universe refresh + all-screens rerun (Phase 1.8)
│   ├── stock/             # stock detail + universe (Phase 1.6/1.6b)
│   │   ├── candles.py     # pure range slicing + 15d/1mo aggregation + in-memory TTL cache
│   │   ├── digest.py      # pure detail sections: main ratios, balance, performance, other
│   │   ├── report.py      # pure per-user report builder (verdict/score/criteria/groups)
│   │   ├── store.py       # raw_json whitelist + company_profiles upsert/read
│   │   ├── universe.py    # GET /stocks rows: shared snapshot + per-user verdict
│   │   └── service.py     # stored-first snapshot, refresh fallback, cached candles
│   ├── docs/
│   │   ├── fetcher.py     # PDF download -> data/docs/{symbol}/
│   │   ├── parser.py      # pdfplumber extraction
│   │   └── analyzer.py    # Gemini client + keyword fallback
│   ├── models/
│   │   ├── base.py        # Model ABC: train(), predict()
│   │   ├── features.py    # technical indicators, momentum, volatility
│   │   ├── xgboost_model.py
│   │   └── lstm_model.py  # OPTIONAL experiment only
│   ├── backtest/
│   │   └── walkforward.py
│   └── db/
│       ├── database.py    # engine, SessionLocal, Base, init_db()
│       └── models.py      # 13 tables — see DATABASE.md
├── scripts/               # manual, online-only checks (verify_catalog.py)
├── tests/
├── requirements.txt
└── pyproject.toml         # pytest config: testpaths, pythonpath=.
```

## Architectural Rules (do not break)

1. **DataProvider interface** (`app/data/provider.py`) is the boundary for ALL external data. Consumers never import yfinance/screener/nse directly. Methods: `list_stocks()`, `fundamentals(symbol, cached=None)`, `ohlc(symbol, years=5)`, `filings(symbol)`. `cached` is the previously stored payload; providers may reuse its statement-derived ROE/ROCE instead of refetching annual statements (Phase 1.8).
2. **Model interface** (`app/models/base.py`) — `train(symbol, rows)`, `predict(symbol, rows) -> signal`. XGBoost is primary; LSTM is an optional experiment behind the same interface. NO custom transformer (overfits ~1250 daily rows).
3. **Pipeline stages are independent endpoints**, triggered manually from UI buttons. Each stage idempotent: same-day rerun overwrites, never duplicates (composite PKs).
4. **Per-stock failure isolation**: one bad stock sets `data_status=failed` and the run continues. Never let 1 failure kill a 500-stock job.
5. **Gemini fallback**: on rate limit/error, queue with exponential backoff, then keyword-based sentiment; always record `method = gemini|fallback` in `doc_analysis`.
6. **Thin API layer**: routers validate input and call services. Business logic lives in `screener/`, `docs/`, `models/`, `backtest/` — not in `api/`.
7. **Screening criteria live in the database, per user, as named screens** (Phase 1.7; Phase 1.5 retired `config/screening.yaml`). `screening_sets` rows own `criteria_json` + a per-screen `thesis`; exactly one is active per user and drives `POST /screen/run`, `GET /screen/latest`, `/stocks` verdicts and the stock report. Valid keys are owned by `screener/catalog.py`; validation/defaults by `screener/criteria.py`; the engine reads only enabled criteria and clamps every run to 10 rows. `shortlist_size` is server-owned and never accepted from clients.
8. **Auth**: scrypt password hashing + signed `sa_session` cookie (Starlette `SessionMiddleware`, secret at `data/.session_secret`). Every route except `/health` and public `/auth` state/login/setup requires `current_user` (401 `Not authenticated`).

## Data Flow

```
Nifty 500 list -> stocks table (also lazily seeded by GET /stocks)
  -> newest ok fundamentals row per symbol + stocks.market_cap = stored snapshot
  -> POST /screen/run: engine.py gates the snapshot (zero fundamentals calls) -> screen_runs row
     + run_jobs row (one queued run_job_items per saved screen, triggering item done) -> 200 {run, job}
  -> background runner: fundamentals(symbol, cached=stored row) for EVERY symbol whose snapshot is
     not from today -> fundamentals (ok|failed) + company_profiles upsert; gate survivors ordered
     first, counters flushed every 25 fetches; a failed fetch keeps the stored row
  -> every saved screen re-evaluated on the fresh snapshot (active last) -> one screen_runs row each
  -> GET /screen/jobs/latest: status + universe counters + per-screen items; stale running jobs swept
     to interrupted on read
  -> GET /stocks: whole stored universe + caller's verdict (pass|fail|no_data), computed on read
  -> /stock/{symbol}: newest ok snapshot row (lazy-fetched + stored on first view) + report
     + profile + digest sections (main_ratios | has | done | other_groups), computed per caller
  -> /stock/{symbol}/ohlc: 5y daily bars via provider -> memory TTL cache (900 s) -> slice + aggregate
     (1d/15d/1mo). Daily bars are NEVER written to the DB.
  -> filings(symbol) + fetcher -> documents table + PDFs on disk
  -> parser + analyzer -> doc_analysis (sentiment, guidance, red_flags, summary)
  -> ohlc(symbol, 5y) -> prices table
  -> features.py -> Model.train/predict -> signals table
  -> walkforward.py -> backtest_runs (cagr, sharpe, max_drawdown, report_json)
```

## Error Handling

- Network calls: httpx with timeouts + retry w/ backoff; yfinance `.info`/statements run through a 15 s watchdog + 3 attempts with jittered backoff (`FETCH_TIMEOUT_SECONDS`/`FETCH_ATTEMPTS`); per-stock failures fall back to the newest stored ok row; the run sets `stale` and each shortlist row carries `data_date`
- Run jobs: per-stock fetch failure increments `universe_failed` and continues; a per-screen failure marks only that item `failed` and never stops the job; a global failure marks the job `failed` with `error` and fails its queued/running items (already-served cached data stays intact); a `running` job whose worker died with the process is swept to `interrupted` on the next jobs read (in-process live jobs are registered and skipped)
- Run concurrency: one job per user — a second `POST /screen/run` returns 409 `Run already in progress` + `job_id`; PUT/DELETE/activate on a screen with queued/running items returns 409 `Screen is mid-run`
- Stock detail: stored-first (zero network when a snapshot exists); refresh failure serves the stored row with `warning` + `refreshed=false`; a failed fetch never overwrites a same-day ok row; candles fall back to the in-memory cache and are never persisted
- Universe: `GET /stocks` seeds `stocks` from the provider only when the table is empty; upstream seeding failures ride the global httpx → 502 handler; a stock with no stored row lists as `no_data`
- PDF parse failure: log, `parse_status=failed`, continue; UI shows "n/m docs parsed"
- Gemini: backoff queue -> keyword fallback, flagged in DB
- API errors: HTTP 422 for bad input, 502 for upstream data-source failures, 500 with structured `{"detail": ...}`; never raw tracebacks to frontend

## Conventions

- Type hints everywhere; `str | None` style (3.10+)
- SQLAlchemy 2.x typed `Mapped[...]` mappings (see `db/models.py`)
- Dates stored as ISO strings (`YYYY-MM-DD`) in SQLite
- Tests: `tests/` mirrors `app/` structure; fixtures in `tests/fixtures/`; all provider calls mocked; pipeline integration test uses 3 fixture stocks
- Run: `uvicorn app.main:app --reload` from `backend/` with venv active
- Test: `.venv/Scripts/python.exe -m pytest tests -q`
- **pip on this machine**: user pip.ini has broken NVIDIA extra-index (`pypi.ngc.nvidia.com` unresolvable). ALWAYS install with `--isolated` flag: `pip install --isolated <pkg>` — skips config files, uses pypi.org directly

## Phase Gates

| Phase | Deliverable | Done when |
|---|---|---|
| 1 | Screener | POST /screen/run shortlists from live yfinance data; ratio unit tests pass vs hand-computed fixtures |
| 1.5 | Auth + per-user DB screener | Login-gated app, criteria in `user_criteria` (superseded by `screening_sets` in 1.7), dynamic catalog, run clamped to 10; auth/criteria/screener tests green |
| 1.6 | Stock detail page | `/stock/{symbol}` serves shared stored snapshot + per-user report + cached candles (1d/15d/1mo, never persisted); tests green offline |
| 1.6b | Universe search + richer detail | `GET /stocks` lists the whole stored universe with per-user verdicts; screen run refreshes every stale symbol (moved to the Phase 1.8 background job); detail serves profile + digest sections; tests green offline |
| 1.7 | Saved screens + navbar search | `screening_sets` CRUD/activate; runs + latest scoped to the active screen; criteria page edits inline (no dialog); navbar glass search always visible; tests green offline |
| 1.8 | Instant cached run + background job | `POST /screen/run` returns the stored shortlist in seconds (zero `fundamentals()` calls) and queues a per-user job that refreshes stale symbols, re-runs all saved screens (active refined last); `GET /screen/jobs/latest` + busy-screen 409s; tests green offline |
| 2 | Doc analysis | PDFs fetched + summarized for a shortlist; fallback path tested with mocked Gemini failure |
| 3 | Price model | Signals generated for shortlist; model trains on synthetic data in tests |
| 4 | Backtest | Walk-forward report vs Nifty 500; offline integration test green |
