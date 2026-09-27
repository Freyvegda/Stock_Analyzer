# Stock Analyzer — Implementation Plan

**Date:** 2026-09-26
**Status:** Approved design, pending implementation
**Project root:** `D:\CODES\Projects\stock-analyzer`

## 1. Goal

Personal tool for Indian markets (Nifty 500). Pipeline:

1. **Fundamental screen** — filter ~500 stocks to ~10 fundamentally strong via configurable ratios
2. **Document analysis** — AI reads concalls, quarterly results, investor presentations, audit reports for shortlisted stocks only
3. **Price model** — ML model on 5yr daily data generates buy/sell signals for shortlisted stocks
4. **Backtest** — walk-forward validation of whole strategy vs Nifty 500 benchmark

Long holding horizon (fundamental-driven). Signals only — no auto-trading. Budget: 0 INR.

## 2. Locked Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend | Python + FastAPI | Data/ML ecosystem (pandas, yfinance, PyTorch, PDF libs) |
| Frontend | React + TypeScript + Vite + shadcn/ui + Tailwind | Fast dashboards; shadcn/ui confirmed (user "ShareJS" was a mixup) |
| Charts | TradingView lightweight-charts (candles) + recharts (metrics) | User said "graphify" — old dead package; these are maintained standard |
| SQL DB | SQLite + SQLAlchemy | Zero setup; Postgres-swappable schema |
| Doc store | Filesystem (`data/docs/`) + JSON index in SQLite | Zero cost |
| Fundamentals/prices | yfinance (`.NS` tickers) + screener.in | Free |
| Filings/PDFs | NSE/BSE announcement endpoints | Free, official |
| Doc AI | Gemini Flash free tier; keyword-based fallback | 0 INR at 10 stocks/quarter volume |
| Price model | XGBoost primary, LSTM optional experiment, behind `Model` interface | Custom transformer = overfit on ~1250 rows; dropped |
| Screener config | DB-backed per-user criteria (`user_criteria` + `screener/catalog.py`); `screening.yaml` retired in Phase 1.5 | changeable ratios per user, no file edits or restarts |
| Pipeline trigger | Manual UI buttons now; scheduler later | MVP scope |
| Testing | pytest + vitest (unit/integration) + walk-forward backtest (strategy) | Backtest = real validation |

## 3. Repo Layout

```
D:\CODES\Projects\stock-analyzer\
├── backend/
│   ├── app/
│   │   ├── main.py                # FastAPI app, CORS, router mount
│   │   ├── api/
│   │   │   ├── screen.py          # POST /screen/run, GET /screen/latest
│   │   │   ├── docs.py            # POST /docs/fetch, POST /docs/analyze, GET /docs/{symbol}
│   │   │   ├── signals.py         # POST /model/train, POST /model/predict, GET /signals
│   │   │   └── backtest.py        # POST /backtest/run, GET /backtest/{id}
│   │   ├── data/
│   │   │   ├── provider.py        # DataProvider ABC: list_stocks, fundamentals, ohlc, filings
│   │   │   ├── yfinance_impl.py
│   │   │   ├── screener_impl.py
│   │   │   └── nse_impl.py
│   │   ├── screener/
│   │   │   ├── catalog.py         # RATIO_CATALOG — valid criteria keys
│   │   │   ├── criteria.py        # pydantic criteria models + defaults
│   │   │   ├── engine.py          # apply ratios -> shortlist
│   │   │   └── service.py         # fetch + persist + evaluate orchestration
│   │   ├── docs/
│   │   │   ├── fetcher.py         # download PDFs -> data/docs/{symbol}/
│   │   │   ├── parser.py          # pdfplumber text extraction
│   │   │   └── analyzer.py        # Gemini client + fallback keyword scorer
│   │   ├── models/
│   │   │   ├── base.py            # Model ABC: train, predict
│   │   │   ├── features.py        # technical indicators, momentum, volatility
│   │   │   ├── xgboost_model.py
│   │   │   └── lstm_model.py      # phase 3 optional
│   │   ├── backtest/
│   │   │   └── walkforward.py     # train 3y -> test 1q, roll; CAGR/Sharpe/drawdown
│   │   └── db/
│   │       ├── database.py        # SQLAlchemy engine/session
│   │       └── models.py          # tables below
│   ├── tests/                     # pytest, fixtures, offline
│   ├── requirements.txt
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/ui/...      # shadcn/ui
│   │   ├── pages/
│   │   │   ├── Fundamentals.tsx   # run screen, criteria view, shortlist table
│   │   │   ├── Documents.tsx      # per-stock docs + AI summary cards
│   │   │   └── Backtest.tsx       # signals chart + backtest report
│   │   ├── api/client.ts          # fetch wrappers
│   │   └── components/StockChart.tsx
│   ├── package.json
│   └── vite.config.ts
├── data/                          # gitignored: stockanalyzer.db, docs/, price caches
└── README.md
```

## 4. Database Schema (SQLite)

- `stocks(symbol PK, name, sector, market_cap)`
- `fundamentals(symbol, date, pe, pb, roe, roce, debt_to_equity, raw_json, PK(symbol,date))`
- `users(id PK, username unique, password_hash, created_at)` — Phase 1.5
- `user_criteria(user_id PK/FK, criteria_json, thesis, shortlist_size, updated_at)` — Phase 1.5
- `screen_runs(id PK, run_date, user_id FK, criteria_json, shortlisted_json)` — per-user since Phase 1.5
- `documents(id PK, symbol, type[concall|results|presentation|audit], period, url, local_path, parse_status)`
- `doc_analysis(document_id PK, method[gemini|fallback], sentiment, guidance, red_flags_json, summary)`
- `prices(symbol, date, open, high, low, close, volume, PK(symbol,date))`
- `signals(symbol, date, model, signal[buy|sell|hold], confidence, PK(symbol,date,model))`
- `backtest_runs(id PK, run_date, params_json, cagr, sharpe, max_drawdown, report_json)`

## 5. Phases

### Phase 0 — Scaffold (boilerplate)
- Create folder tree, git init
- Backend: venv, requirements (fastapi, uvicorn, sqlalchemy, pydantic, pyyaml, yfinance, pandas, httpx, pdfplumber, xgboost, pytest), FastAPI hello + health endpoint
- Frontend: `npm create vite@latest` (react-ts), Tailwind, shadcn/ui init, lightweight-charts + recharts, 3-page nav shell
- README with run instructions

### Phase 1 — MVP screener
- Nifty 500 list fetch -> `stocks`
- yfinance fundamentals -> `fundamentals`
- YAML ratio engine -> `screen_runs`
- API: POST /screen/run, GET /screen/latest
- UI Fundamentals page: run button + shortlist table
- Unit tests: ratio math vs hand-computed fixtures; YAML validation

### Phase 1.5 — Authorization + DB-driven screener
- Login-gated app: scrypt passwords, signed `sa_session` cookie, first-run setup card
- Per-user criteria in `user_criteria` (JSON) + thesis; `config/screening.yaml` retired
- Dynamic ratio catalog (`app/screener/catalog.py`) with on/off toggles and thresholds; unknown keys → 422
- Runs are user-scoped (`screen_runs.user_id` + criteria snapshot); fixed top-10 clamp
- Backend: `plan/phase-1.5/{backend,database}.md`; spec `docs/superpowers/specs/2026-09-26-phase-1.5-...md`

### Phase 1.6 — Stock detail page
- Click a shortlisted symbol -> `/stock/{symbol}`: computed report card (per-user verdict from `user_criteria`), catalog fundamentals grid, daily chart
- Stock data shared across users: stored-first snapshot, lazy first fetch, manual Refresh; report never persisted
- Candles 6m/1y/2y/5y × 1d/15d/1mo from a process-memory TTL cache; daily bars never written to the DB
- 3D Candle Ridge hero (lazy, WebGL-gated, reduced-motion static) fed by the stock's own closes
- Spec `docs/superpowers/specs/2026-09-27-phase-1.6-stock-detail-design.md`; plans `plan/phase-1.6-stock-detail/`

### Phase 2 — Document analysis
- NSE/BSE filing fetch -> `documents` + PDFs to disk
- pdfplumber extraction
- Gemini Flash analyzer + keyword fallback, `analysis_method` flag
- API + Documents page (summary cards)
- Tests: parser on fixture PDF; analyzer with mocked Gemini

### Phase 3 — Price model
- 5yr daily OHLC ingest -> `prices`
- features.py indicators
- XGBoost train/predict -> `signals`
- Signals chart page (lightweight-charts + markers)
- Tests: feature calc fixtures; model trains on synthetic data

### Phase 4 — Backtest
- walkforward.py: 3y train / 1q test rolling 2019-2024
- Metrics: CAGR, Sharpe, max drawdown, win rate vs Nifty 500 buy-hold
- Backtest page report
- Integration test: full pipeline on 3 fixture stocks, mocked providers, offline

### Later (not in plan)
Scheduler (Task Scheduler/cron), settings UI page, LSTM experiment, Postgres swap, VPS hosting

## 6. Error Handling Rules

- Per-stock failure -> `data_status=failed`, continue run; UI shows fail count
- Gemini rate limit -> backoff queue -> keyword fallback, flagged
- PDF parse fail -> log, skip, UI shows "n/m docs parsed"
- yfinance down -> serve cached data + staleness warning

## 7. Test Plan

| Layer | Tool | Covers |
|---|---|---|
| Unit backend | pytest | ratio engine, YAML validation, features, backtest math |
| Unit frontend | vitest | table/sort logic, API client |
| Integration | pytest + mocked providers | full pipeline offline, 3 fixture stocks |
| Strategy | walk-forward backtest | CAGR/Sharpe/drawdown vs Nifty — go/no-go on usefulness |

## 8. Cost

0 INR. All data free, Gemini Flash free tier, SQLite, runs local.

## 9. Next Step

Switch out of Plan agent -> run Phase 0 scaffold (folder, backend + frontend boilerplate, chart libs installed).
