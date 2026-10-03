# Run performance — cached-first runs + background job (Design)

**Date:** 2026-10-03 · **Status:** approved by owner (2026-10-03 conversation); this document
pending owner review.

**Plans:** `plan/phase-1.8-run-performance/{backend,frontend,database}.md` (next step:
writing-plans).

## Why

A cold-day screen run takes 5–30 minutes and blocks the UI the whole time:

1. **Sync run over ~500 symbols** — `WORKERS = 8` fixed (`screener/service.py:37`), 1–3
   yfinance HTTP calls per symbol (`data/yfinance_impl.py:100-136`: `ticker.info` plus
   `financials`/`balance_sheet` when ROE/ROCE are missing — common on NSE), no per-call
   timeout, no retry. Expect 500–1500 calls per cold run (`service.py:146-148` refreshes
   **every** stale symbol by design since Phase 1.6b).
2. **Write transaction held open across the fetch** — transaction opened before
   `_fetch_all` and committed after (~1500–2500 statements, `service.py:124` →
   `150` → `213`), SQLite without WAL or busy timeout (`db/database.py:11`), so every
   other endpoint locks/serializes for minutes.
3. **UI blocks on the whole run** — single awaited `POST /screen/run`
   (`frontend/src/pages/fundamentals/FundamentalsLayout.tsx:171-216`), no job id, no
   progress, no partial results; proxy/browser can kill multi-minute requests.
4. **Per-row `session.merge` writes** (~2–4 statements per symbol) and
   `latest_ok_fundamentals` hydrating full history rows (`service.py:74-79`) — history
   grows ~500 rows/day, months in = 100k+ rows per run.

## Owner decisions (Q&A, 2026-10-03)

- **Cached-first runs.** Hitting Run shows the shortlist in seconds from the stored
  snapshot (stale data acceptable and flagged), while a background job refreshes data.
- **Background scope = both:** the job refreshes the remaining stale universe symbols
  **and** computes/persists shortlists for the other saved screens.
- **Progress display:** per-screen status chips (`queued → running → done/failed` with
  elapsed) plus one universe-refresh symbol counter (done / failed / total). No
  per-criteria gate details (gates are pure-CPU ms over cached rows).
- **Approach A — in-process job runner** (single worker thread, DB-persisted progress,
  polling). No resumable queue (Approach B); no external scheduler (Approach C, stays
  a future phase).
- **Optimizations accepted** (all listed below).

## Data model (delta)

Two append-only tables in `app/db/models.py` (Postgres-compatible, plain types):

```sql
run_jobs(
  id             INTEGER PK AUTOINCREMENT,
  user_id        INTEGER NOT NULL FK -> users.id,      -- run owner
  set_id         INTEGER NOT NULL FK -> screening_sets.id,  -- active screen that triggered
  started_at     TEXT NOT NULL,                        -- ISO date-time
  finished_at    TEXT NULL,
  status         TEXT NOT NULL,                        -- running|done|failed|interrupted
  universe_total INTEGER NOT NULL DEFAULT 0,           -- stale symbols planned for refresh
  universe_done  INTEGER NOT NULL DEFAULT 0,           -- successful fetches
  universe_failed INTEGER NOT NULL DEFAULT 0,          -- data_status=failed fetches
  error          TEXT NULL                             -- job-level failure message
)

run_job_items(
  id          INTEGER PK AUTOINCREMENT,
  job_id      INTEGER NOT NULL FK -> run_jobs.id (indexed),
  set_id      INTEGER NOT NULL FK -> screening_sets.id,
  status      TEXT NOT NULL,                           -- queued|running|done|failed
  started_at  TEXT NULL,
  finished_at TEXT NULL,
  error       TEXT NULL,
  run_id      INTEGER NULL FK -> screen_runs.id        -- persisted run once done
)
```

Rules:

- **Counters on `run_jobs`, not per-symbol rows** — symbol-level detail already lives
  in `fundamentals.data_status`; 500 job-item rows per run would be pure churn.
- **One item per saved screen** (active included, ordered active first in API output).
- **Pruning:** keep the latest 20 jobs per user; older `run_jobs` + their
  `run_job_items` are deleted when a new job is created. `screen_runs` audit trail
  untouched.
- **`interrupted`:** uvicorn restart kills the in-process worker. On `init_db()`/first
  jobs read, any job still marked `running` (its worker died with the previous process)
  is marked `interrupted` (UI offers rerun; same-day stored rows make rerun cheap).
- **Pragmas, not schema:** `PRAGMA journal_mode=WAL` + `busy_timeout=5000` at engine
  connect for SQLite only (`db/database.py`) — skipped for other dialects, no schema
  change, Postgres swap unaffected.
- **Run semantics:** the sync part persists the cached shortlist as one `screen_runs`
  row; after the universe refresh finishes, the active screen re-evaluates on fresh
  data and persists a second row (same `criteria_json`, same day). `GET /screen/latest`
  keeps `ORDER BY id DESC LIMIT 1` → picks the refined run. Both rows stay visible in
  the audit trail.
- Dev DB reset (delete `data/stockanalyzer.db`) is the migration, per repo rule.

## Run flow

New `app/screener/runner.py`: module-level single worker
(`ThreadPoolExecutor(max_workers=1)`) + current job id. One job at a time; a second
`POST /screen/run` while a job is `running` → 409. Single writer keeps SQLite happy.

Worker logic is a plain function `execute_job(job_id, provider, session_factory)`; the
thread pool only wraps it (`runner.py`), so tests can call it synchronously — no
thread races, no sleeps.

**Sync part of `POST /screen/run` (< ~2 s, no provider calls):**

1. Reject when a job is already `running` (409). Create `run_jobs` + one
   `run_job_items` row per saved screen (all `queued`); commit.
2. Stock upserts + `latest_ok_fundamentals` read + commit — **write transaction closed
   before any network work**.
3. Compute the active screen's shortlist from the stored snapshot; persist
   `screen_runs`; mark the active item `done`; commit.
4. Return `{ run, job }` — Top 10 renders immediately with the existing `stale` flag.
5. Kick the background worker.

**Background part (`execute_job`):**

6. Compute stale symbols (`refresh_symbols` from `service.py:146-148`), store
   `universe_total`, status stays `running`.
7. **Fetch stage:** `WORKERS` 8 → 16; per-call timeout 15 s + 2 retries with jitter
   (`yfinance_impl.py`); **skip `_statements()` when the cached `raw_json` already
   yields ROE/ROCE** (cuts ~1500 calls to ~500). Order: active-screen gate survivors
   first, then the rest by descending market cap (relevant symbols refine earliest).
   Per-stock failure isolation unchanged: `data_status=failed` row + counter, continue.
   Counters flushed every 25 symbols (small transactions; WAL keeps readers unblocked).
8. **Write stage:** bulk persist — two existence queries + `add_all`/attribute updates
   instead of per-row `session.merge`; same treatment for `company_profiles`. Semantics
   unchanged: same-day overwrite, failed never clobbers a same-day `ok` row.
9. **Screen stage:** every `queued` item → `running` → engine over the fresh snapshot →
   `screen_runs` row → `done` (`failed` + `error` on engine error). Screens execute
   active last (API display order stays active-first) — that run is the fresh-data
   refinement of step 3, and the active item's `run_id` updates to the refined
   `screen_runs` row. Per-screen isolation: one failing screen never stops the job or
   the other screens.
10. Job `done` (+`finished_at`). Global fetch-stage explosion → job `failed` with
    `error`; cached results stay served. Per-stock failures never fail the job.

## Optimizations (accepted)

1. **Close the write transaction before fetching** (sync step 2) + WAL/busy_timeout
   pragmas — no more DB-wide lock during runs.
2. **Statement skip:** `_statements()` only when cached `raw_json` lacks the needed
   fields.
3. **Timeout + retry:** 15 s per yfinance call, 2 retries with jitter — no unbounded
   hangs (BACKEND.md:112 promise, finally implemented).
4. **Workers 8 → 16** + relevance-ordered fetch (survivors first, then market cap
   desc). `WORKERS` stays a module constant (value 16); no config surface.
5. **Bulk writes** replacing per-row `merge` (~1500–2500 statements → constant number
   of statements).
6. **`latest_ok_fundamentals` query rewrite:** `MAX(date)` grouped subquery per symbol
   instead of hydrating full history; same fix benefits `/stocks` and stock detail.
7. **Frontend:** Run returns instantly with cached Top 10 + stale badge + progress
   panel; poll `GET /screen/jobs/latest` every 2 s; auto-refresh `/screen/latest` when
   the job finishes.

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/screen/run` | sync part only; `200 {run, job}`; `409 {detail, job_id}` when a job runs |
| GET | `/screen/jobs/latest` | caller's most recent job: counters + `items[] {set_id, name, status, run_id, error, started_at, finished_at}`; `{job: null}` when none |
| PUT | `/screen/sets/{id}` | + `409 "Screen is mid-run"` when target screen's latest-job item is `queued\|running` |
| DELETE | `/screen/sets/{id}` | + same 409 |
| POST | `/screen/sets/{id}/activate` | + 409 only when the **target** screen is busy; activating a non-busy screen while others run is allowed (job items snapshot at enqueue; refinement stays bound to `job.set_id`) |

Not added (YAGNI): websocket/SSE (2 s polling is fine locally), cancel endpoint, job
history endpoint, `/screen/jobs/{id}` (single user, one job at a time).
`GET /screen/latest`, `/screen/sets`, `/screen/ratios` unchanged.

## Frontend

- `FundamentalsLayout.tsx`: `runScreen()` stores `run` + `job`; poll
  `GET /screen/jobs/latest` every 2 s while `running`; stop on
  `done|failed|interrupted`; clear on unmount/`auth:unauthorized`. On `done` → one
  `GET /screen/latest` refresh (Top 10 swaps to the refined shortlist). On
  `failed|interrupted` → cached results stay + Chakra toast warning.
- New `components/RunProgress.tsx` (on the Run card and Top 10 header while active,
  last-run summary afterwards): per-screen chips (`queued` muted → `running` pulse +
  elapsed → `done` pass tone / `failed` fail tone + error tooltip), active screen
  first; universe counter `done+failed / total` in `Num` (Geist Mono) + fail count +
  thin progress bar. No new motion loops (DESIGN.md whitelist, `vault-rules` test).
- Stale indication: existing `stale` flag + `data_date` per row; badge near the run
  summary ("cached — refreshing in background") disappears after refinement.
- Validation UX mirrors backend 409s: busy screen → editor disabled, tab shows a small
  running dot, rename/close/save blocked; Run button disabled while a job is active
  (driven by job state). `api/client.ts` 409s surface as typed `ApiError.detail`
  inline — no crash, no client timeout added.
- Types in `api/types.ts`: `RunJob`, `RunJobItem`, updated run response.

## Testing

Worker invoked synchronously in tests (`execute_job` direct call) — all offline,
FakeProvider/fakes as in `tests/test_screen_api.py`.

- Sync part: `POST /screen/run` returns cached shortlist + stale universe with **zero**
  provider fundamentals calls; `execute_job` refreshes exactly the stale symbols.
- Active screen persists a second (refined) `screen_runs` row; `ORDER BY id DESC` picks
  it. Same-day rerun remains zero-call.
- Statement-skip: provider call log asserts `financials`/`balance_sheet` not called
  when cached `raw_json` suffices; called when missing.
- Transitions: counters mirror outcomes; items `queued → running → done/failed`; one
  failing screen does not stop others; one failing symbol does not stop the run.
- 409s: second Run mid-job; PUT/DELETE/activate on busy screen; non-busy activate fine.
- Interrupted: seeded `running` job → marked `interrupted` at boot.
- Bulk-write equivalence: same-day overwrite, failed never clobbers same-day `ok`.
- `latest_ok_fundamentals`: newest-ok-per-symbol identical to current behavior on a
  multi-day fixture history (characterization).
- Retry/timeout: flaky fake (fail twice, succeed) retried with backoff; always-fail
  lands `data_status=failed` and the run continues.
- No timing assertions (flaky) — speed is proven by call-count/statement-count
  assertions.

## Non-goals

Resumable jobs (Approach B), external scheduler (Approach C), websocket/SSE, job
history UI, cancel endpoint, per-criteria progress detail, multi-process deployment,
Postgres migration.

## Acceptance

- Cold-day Run: Top 10 paints in seconds from cached data (stale badge visible, zero
  provider calls in the sync path); background job refreshes staled universe and runs
  all saved screens; per-screen chips + symbol counter track progress live through
  reloads.
- On job completion, Top 10 auto-refreshes to the fresh-data refined shortlist.
- Run/Save/Delete/Activate blocked with 409 + disabled UI for busy screens.
- Rerun same day after job completion: zero fundamentals calls.
- No `database is locked` errors from other endpoints during a run.
- Backend pytest green offline; `npm run test` + `npm run build` clean;
  `graphify update .` refreshed.
