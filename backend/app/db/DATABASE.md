# Database Context — Stock Analyzer

> Agent context file. Read this before touching schema, models, or queries. Source of truth: `PLAN.md`.

## Choice

**SQLite** via SQLAlchemy 2.x ORM. File: `data/stockanalyzer.db` (gitignored, auto-created by `init_db()`).

Rationale: zero setup, zero cost, single-file backup. 500 stocks x 5yr daily prices = ~650k rows — trivial for SQLite.

**Hard rule: schema stays Postgres-compatible.** No SQLite-only column types, no SQLite-specific SQL. If scale ever demands it, swap = change connection string only. Mongo/NoSQL NOT used — documents live on the filesystem (`data/docs/{symbol}/`), their metadata + AI results in relational tables.

**Fundamentals provider chain (Phase 1.8, no schema change):** OHLC lives in
`data/prices/{SYMBOL}.csv` per symbol and statements in
`data/statements/{SYMBOL}.json` (30d TTL) — both outside SQLite. The
`fundamentals`/`company_profiles` write paths are unchanged; only the provider
behind them swapped (composite: Stooq + screener + math).

**SQLite pragmas (Phase 1.8):** every connection on the SQLite engine sets `PRAGMA journal_mode=WAL` + `PRAGMA busy_timeout=5000` via a `connect` event listener (`configure_sqlite` in `database.py`). Connection-level only — no schema change; the listener is skipped for non-SQLite dialects, so the Postgres swap stays a connection-string change. WAL keeps readers unblocked while a background job writes; busy_timeout waits out short writer locks instead of raising `database is locked`.

## Tables (14)

Defined in `backend/app/db/models.py`. SQLAlchemy 2.x typed mappings (`Mapped[...]`).

### users (Phase 1.5)
Single account in practice; multi-user-ready schema.
| Column | Type | Notes |
|---|---|---|
| id | Int PK autoincr | |
| username | String unique, NOT NULL | trimmed, 3–32 chars, stored lowercase |
| password_hash | String NOT NULL | `scrypt$n$r$p$salt$hash` (stdlib hashlib.scrypt) |
| created_at | String NOT NULL | ISO date-time |

### auth_sessions (Phase 1.8)
One row per issued refresh token. The row *is* the revocation mechanism: without it a refresh
token could only be invalidated by rotating a secret, which logs out everyone rather than one
session. Only the SHA-256 of the token is stored, so a database leak yields no usable credential.
| Column | Type | Notes |
|---|---|---|
| id | Int PK autoincr | |
| user_id | Int NOT NULL, indexed, FK → `users.id` | |
| token_hash | String NOT NULL, unique | `sha256(token)` hex; the raw token exists only in the cookie |
| created_at | String NOT NULL | ISO date-time |
| last_seen_at | String NOT NULL | ISO; slides on every refresh, drives the 3h idle logout |
| revoked_at | String NULL | set by logout, or when an idle/ownerless session is refused |

No `expires_at`: the policy is sliding 3h with no absolute ceiling, so a second expiry rule would
be invented complexity. `sweep_sessions` runs on login and deletes rows that are revoked or idle
past the window — unreachable by policy anyway — which is what keeps the table bounded.

### screening_sets (Phase 1.7)
Named screening criteria per user — the retired `user_criteria`, multiplied. Exactly one row
per user is active; service code enforces the invariant.
| Column | Type | Notes |
|---|---|---|
| id | Int PK autoincr | |
| user_id | Int NOT NULL, indexed, FK → users.id | |
| name | String NOT NULL | 1–60 chars, trimmed; unique per user (`uq_screening_sets_user_name`; case-insensitive enforced in service) |
| criteria_json | Text NOT NULL | JSON array `[{key, enabled, value, bookmarked?}]` (bookmark flag since Phase 1.7 addendum); keys owned by `screener/catalog.py` |
| thesis | Text? | free-text note per screen, ≤ 500 chars |
| shortlist_size | Int NOT NULL default 10 | server-set; engine clamps to `min(value, 10)` |
| is_active | Boolean NOT NULL default false | exactly one active per user (service-enforced) |
| updated_at | String NOT NULL | ISO date-time |

First read with no sets seeds `"Default"` (Phase-1 defaults, active). Runs execute the
active set; `/stocks` verdicts and the stock report read its criteria.

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
| data_status | String | `ok` \| `failed`. NOT NULL, default `ok`. `failed` = fetch failed (ratios NULL, `raw_json` holds the error) |
| raw_json | Text? | whitelisted provider payload (catalog raw fields + digest fact fields — see `app/stock/store.py`), for ratios without re-fetch; `{"error": ...}` when `data_status=failed` |

**Stock detail write path (Phase 1.6):** the stock page serves the newest `ok` row
per symbol to every user (shared data); first view of a symbol with no row lazily
fetches and `merge`s a `(symbol, today)` snapshot, and Refresh does the same on
demand. A failed fetch writes a `failed` row **only when no `ok` row exists for
that symbol+day** — a good same-day snapshot is never clobbered. The report/verdict
on top is computed per request from the active `screening_sets` row and is **never persisted**.
Daily bars are **never stored**: `/stock/{symbol}/ohlc` fetches 5y of daily bars
through a process-memory TTL cache (900 s) and slices/aggregates on the way out
(no `prices` writes in Phase 1.6).

**Universe + profile write path (Phase 1.6b; refresh moved to the background job in Phase 1.8):**
the run job refreshes fundamentals for **every** universe symbol whose newest `ok` row is not
from today (plus symbols with no row) — one job fills the shared DB for all users, and a
same-day rerun costs zero network calls. The synchronous `POST /screen/run` itself makes zero
`fundamentals()` calls (Phase 1.8) and returns the stored snapshot immediately. `GET /stocks`
seeds `stocks` from the provider only when the table is empty (identity only — no fundamentals
fetch). Every successful fundamentals write also upserts `company_profiles` (below) in the
same transaction.

### company_profiles (Phase 1.6b)
Slow-moving company identity, one row per symbol — the fields the detail page
repeats on every view. Ratios stay in dated `fundamentals` rows.
| Column | Type | Notes |
|---|---|---|
| symbol | String PK | |
| industry | String? | yfinance `industry` |
| sector | String? | yfinance `sector` (may differ from the CSV `stocks.sector`) |
| description | Text? | `longBusinessSummary` |
| website | String? | |
| employees | Int? | `fullTimeEmployees`, coerced; non-numeric → NULL |
| hq | Text? | `city, state, country` joined, skipping missing parts |
| updated_at | String NOT NULL | ISO date of the fetch that wrote it |

Upsert via `merge` on `symbol`; a failed fetch leaves the previous profile intact.

### screen_runs
Audit trail of every screen execution, per user, attributed to the screen it ran (Phase 1.7).
| Column | Type | Notes |
|---|---|---|
| id | Int PK autoincr | |
| run_date | String | ISO date |
| user_id | Int NOT NULL, indexed, FK → users.id | run owner |
| set_id | Int?, indexed, FK → screening_sets.id | screen executed; NULLed when that screen is deleted (runs are kept) |
| triggered_by | String NOT NULL default `manual` | `manual` = the user's Run Screen on the active set; `auto` = the batch's extra most-used screens (Phase 1.8). Auto runs never count toward the most-used measure |
| criteria_json | Text | verbatim criteria used — results reproducible |
| shortlisted_json | Text | JSON array of {symbol, ratios, rank} |

Read pattern: `WHERE user_id = ? AND set_id = ? ORDER BY id DESC LIMIT 1` (the active
screen's latest run). A Run Screen batch (Phase 1.8) writes one `manual` row for the active
set plus up to three `auto` rows for the most-used other screens; `most_used_sets` reads only
the last 10 `manual` rows, so auto-runs never feed the ranking.

### run_jobs (Phase 1.8)
Append-only background job behind a cached-first run — one row per `POST /screen/run`.
`screen_runs` stays the shortlist audit; this table tracks refresh progress + interruption.
| Column | Type | Notes |
|---|---|---|
| id | Int PK autoincr | |
| user_id | Int NOT NULL, indexed, FK → users.id | run owner |
| set_id | Int NOT NULL, FK → screening_sets.id | active screen that triggered the run; plain FK, no cascade — deleting the screen keeps job history (projection shows `name=""`) |
| started_at | String NOT NULL | ISO date-time |
| finished_at | String? | set on terminal status |
| status | String NOT NULL | `running` \| `done` \| `failed` \| `interrupted` |
| universe_total | Int NOT NULL default 0 | stale universe symbols planned for refresh |
| universe_done | Int NOT NULL default 0 | successful refreshes |
| universe_failed | Int NOT NULL default 0 | failed fetch attempts |
| error | Text? | job-level failure message |

Counters live here, not as per-symbol rows — symbol outcome already lives in
`fundamentals.data_status`.

### run_job_items (Phase 1.8)
One row per saved screen inside a job (active included; API orders active first).
| Column | Type | Notes |
|---|---|---|
| id | Int PK autoincr | |
| job_id | Int NOT NULL, indexed, FK → run_jobs.id | |
| set_id | Int NOT NULL, FK → screening_sets.id | plain FK, no cascade — history survives screen deletion |
| status | String NOT NULL | `queued` \| `running` \| `done` \| `failed` |
| started_at | String? | stamped when the screen starts |
| finished_at | String? | stamped on terminal status |
| error | Text? | per-screen failure message |
| run_id | Int?, FK → screen_runs.id | persisted shortlist once done; NULL when the job failed before writing one |

Rules: one running job per user; keep the latest 20 jobs **per user** — older `run_jobs` + their
`run_job_items` are pruned when a new job is created. Job-history survival after a screen delete
relies on SQLite not enforcing FKs by default (the plain no-cascade FKs would block that delete on
Postgres). A `running` job whose worker died with the process is swept to `interrupted` on the next
jobs read (live in-process jobs registered by the worker are skipped), and a rerun after
interruption is cheap thanks to same-day stored rows. Both tables are append-only job history;
`screen_runs` rows are never pruned.

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
- Screen run (Phase 1.8): `POST /screen/run` gates the stored snapshot synchronously (`latest_ok_fundamentals` = grouped `MAX(date)` subquery per symbol) and persists a `screen_runs` row + a `run_jobs` row with one queued item per saved screen — zero `fundamentals()` calls; the background worker then refreshes every symbol whose snapshot is not from today (active-gate survivors first, then descending `market_cap`), persists `fundamentals` + `company_profiles` every 25 fetches, and re-evaluates every saved screen (active last, one `screen_runs` row each); `GET /screen/jobs/latest` reads `run_jobs` + `run_job_items` (`WHERE user_id = ? ORDER BY id DESC LIMIT 1`)
- Universe list: `GET /stocks` reads `stocks` + the newest `ok` row per symbol, seeds `stocks` lazily when empty, and computes each row's verdict from the caller's criteria on read
- Stock detail: same newest-`ok` lookup per symbol; no stored row -> lazy fetch + `merge`; candles are cache-only (`app/stock/candles.py`) — the DB is not involved in `/stock/{symbol}/ohlc` writes
- Engine/session/Base in `app/db/database.py`; `init_db()` creates tables — NO migrations tool for MVP (dev DB is disposable; delete file to reset). **Adding a table needs no reset**: `create_all` creates tables that do not exist yet; it only never `ALTER`s existing ones. Deleting the file is only required when an *existing* column changes.
- Dates as ISO strings — sortable, comparable, timezone-free (market data is date-granular)
- JSON-in-Text columns (`shortlisted_json`, `criteria_json`, `report_json`, `red_flags_json`) for variable-shape payloads; parse at service layer, never in SQL
- Auth signing secret lives at `data/.auth_secret` (file, not a table; gitignored, delete/rotate = logout all)

## Rules

1. Composite PKs chosen for **idempotency** — re-running any pipeline stage same day must overwrite, not duplicate
2. Nullable ratio columns — missing fundamentals are normal for small caps; handle NULL, flag stock, continue
3. Never store absolute filesystem paths that break on machine change — store paths relative to project root
4. Adding a table/column = edit `models.py`, delete dev DB (or add ALTER manually), update this file
5. Query performance: add indexes if a query filters on a non-PK column repeatedly (e.g. `documents.symbol`, `signals.symbol`) — add when needed, not preemptively
