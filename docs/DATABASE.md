# Database Context — Stock Analyzer

> Agent context file. Read this before touching schema, models, or queries. Source of truth: `PLAN.md`.

## Choice

**SQLite** via SQLAlchemy 2.x ORM. File: `data/stockanalyzer.db` (gitignored, auto-created by `init_db()`).

Rationale: zero setup, zero cost, single-file backup. 500 stocks x 5yr daily prices = ~650k rows — trivial for SQLite.

**Hard rule: schema stays Postgres-compatible.** No SQLite-only column types, no SQLite-specific SQL. If scale ever demands it, swap = change connection string only. Mongo/NoSQL NOT used — documents live on the filesystem (`data/docs/{symbol}/`), their metadata + AI results in relational tables.

## Tables (8)

Defined in `backend/app/db/models.py`. SQLAlchemy 2.x typed mappings (`Mapped[...]`).

### stocks
Universe of Nifty-listed companies.
| Column | Type | Notes |
|---|---|---|
| symbol | String PK | NSE symbol, e.g. `RELIANCE` (yfinance uses `RELIANCE.NS` — store bare, suffix at provider layer) |
| name | String | |
| sector | String? | |
| market_cap | Float? | crore |

### fundamentals
Point-in-time ratios per stock. Composite PK enables daily re-runs with history.
| Column | Type | Notes |
|---|---|---|
| symbol | String PK | |
| date | String PK | ISO `YYYY-MM-DD` |
| pe, pb, roe, roce, debt_to_equity | Float? | NULL allowed — missing data must not crash the screen; engine skips NULL ratios per rule, flags stock |
| raw_json | Text? | full provider payload, for future ratios without re-fetch |

### screen_runs
Audit trail of every screen execution.
| Column | Type | Notes |
|---|---|---|
| id | Int PK autoincr | |
| run_date | String | ISO date |
| config_yaml | Text | snapshot of screening.yaml used — results reproducible |
| shortlisted_json | Text | JSON array of {symbol, ratios, rank} |

### documents
Filing metadata; files on disk.
| Column | Type | Notes |
|---|---|---|
| id | Int PK autoincr | |
| symbol | String | |
| type | String | `concall` \| `results` \| `presentation` \| `audit` |
| period | String? | e.g. `Q2FY26`, `FY25` |
| url | String? | source |
| local_path | String? | `data/docs/{symbol}/{file}.pdf` |
| parse_status | String | `pending` \| `parsed` \| `failed` |

### doc_analysis
AI output, 1:1 with documents.
| Column | Type | Notes |
|---|---|---|
| document_id | Int PK | FK to documents.id |
| method | String | `gemini` \| `fallback` — REQUIRED, tracks fallback rate |
| sentiment | Float? | -1.0..1.0 |
| guidance | Text? | forward-looking statements extracted |
| red_flags_json | Text? | JSON array: auditor remarks, promoter pledging, related-party txns |
| summary | Text? | |

### prices
Daily OHLCV. Composite PK = idempotent re-ingest (INSERT OR REPLACE / merge).
| Column | Type | Notes |
|---|---|---|
| symbol | String PK | |
| date | String PK | |
| open, high, low, close, volume | Float | NOT NULL |

### signals
Model outputs. Composite PK allows multiple models per stock/day.
| Column | Type | Notes |
|---|---|---|
| symbol | String PK | |
| date | String PK | |
| model | String PK | e.g. `xgboost-v1` |
| signal | String | `buy` \| `sell` \| `hold` |
| confidence | Float? | 0..1 |

### backtest_runs
| Column | Type | Notes |
|---|---|---|
| id | Int PK autoincr | |
| run_date | String | |
| params_json | Text | walk-forward config: train window, test window, date range, screen config ref |
| cagr, sharpe, max_drawdown | Float? | headline metrics |
| report_json | Text? | full equity curve, trades, per-period breakdown |

## Access Patterns

- All DB access through `SessionLocal()` sessions (FastAPI dependency or context manager)
- Engine/session/Base in `app/db/database.py`; `init_db()` creates tables — NO migrations tool for MVP (dev DB is disposable; delete file to reset)
- Dates as ISO strings — sortable, comparable, timezone-free (market data is date-granular)
- JSON-in-Text columns (`shortlisted_json`, `report_json`, `red_flags_json`) for variable-shape payloads; parse at service layer, never in SQL

## Rules

1. Composite PKs chosen for **idempotency** — re-running any pipeline stage same day must overwrite, not duplicate
2. Nullable ratio columns — missing fundamentals are normal for small caps; handle NULL, flag stock, continue
3. Never store absolute filesystem paths that break on machine change — store paths relative to project root
4. Adding a table/column = edit `models.py`, delete dev DB (or add ALTER manually), update this file
5. Query performance: add indexes if a query filters on a non-PK column repeatedly (e.g. `documents.symbol`, `signals.symbol`) — add when needed, not preemptively
