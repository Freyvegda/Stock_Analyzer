# Phase 1.8 — Run performance (backend: cached-first run + background job)

> **For agentic workers:** part of the Phase 1.8 plan. Required sub-skill when executing:
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use
> checkbox (`- [ ]`) syntax.
>
> **Spec:** `docs/superpowers/specs/2026-10-03-run-performance-design.md`.
> Schema first: `plan/phase-1.8-run-performance/database.md` (Task D1). Frontend contract:
> `plan/phase-1.8-run-performance/frontend.md`.

**Goal:** `POST /screen/run` returns the stored-snapshot shortlist in seconds and enqueues a
single background job that refreshes stale universe symbols, runs every saved screen, and
refines the active screen's run on fresh data — with job progress exposed over HTTP.

**Architecture:** new `app/screener/runner.py` owns the in-process single worker
(`execute_job` plain function + `submit_job` thread kick) and the bulk fetch/persist stages;
`app/screener/service.py` keeps domain logic and gains the job CRUD/projection helpers and
`run_snapshot_screen` (stored-snapshot run, no fundamentals calls). `api/screen.py` stays
thin. Provider gains an optional `cached` payload so annual ROE/ROCE are reused instead of
refetching statements.

**Tech stack:** FastAPI, SQLAlchemy 2.x, pydantic v2, SQLite, stdlib `concurrent.futures` /
`threading`. No new dependencies.

## Global Constraints

- Work dir: `backend/` (venv active). Tests:
  `.\.venv\Scripts\python.exe -m pytest tests -q`; all offline, network mocked. Fixtures
  from `tests/conftest.py` (`client`, `test_db`, `sign_in`, `provider`).
- BACKEND.md rules stay: DataProvider boundary, thin API layer, per-stock AND per-screen
  failure isolation, composite-PK idempotency, no hardcoded ratios.
- DataProvider signature change: `fundamentals(self, symbol: str, cached: dict | None = None)`
  — every implementation and test fake accepts the optional kwarg.
- Worker in tests is invoked synchronously (`runner.execute_job(...)`); tests never spawn the
  worker thread. `test_db` monkeypatches `runner.submit_job` to a no-op.
- Job semantics from the spec: one running job per user; `interrupted` on boot for stale
  `running` rows; keep latest 20 jobs; counters on `run_jobs`; active screen re-run last.
- Response shapes: `POST /screen/run -> {"run": <old result payload>, "job": <projection>}`;
  `GET /screen/jobs/latest -> {"job": <projection> | null}`.
- Sync path makes **zero provider fundamentals calls** (only `list_stocks`, which is cached
  CSV on failure).

## Review Focus

Failure modes most likely to bite; each has a test in the task that owns the code.

1. A stale `running` job after a crash shows as `interrupted`, never blocking new runs —
   B3 `test_latest_job_marks_running_as_interrupted`.
2. Yahoo throttling one symbol (or all) never fails the job — B5
   `test_job_done_when_every_fetch_fails`, `test_failed_refresh_keeps_same_day_ok_row`.
3. Same-day rerun after a job costs zero fundamentals calls — B5
   `test_execute_job_same_day_rerun_makes_no_calls` (existing API test keeps covering the
   sync path).
4. Screen edits/deletes/activations during a run return 409, never mutate mid-job criteria —
   B6 `test_update_delete_activate_busy_screen_409`.
5. A hung yfinance call cannot stall a worker forever — B2 timeout + retry tests.

---

### Task B1: `latest_ok_fundamentals` — MAX(date) rewrite

**Files:**
- Modify: `backend/app/screener/service.py:70-83`
- Modify: `backend/tests/test_screener.py`

**Interfaces:**
- Produces: `latest_ok_fundamentals(session, symbols: list[str]) -> dict[str, Fundamental]`
  — unchanged signature and behavior (newest `data_status='ok'` row per symbol), implemented
  with a grouped `MAX(date)` subquery instead of loading all history rows. Used by
  `stock/universe.py` and `stock/service.py` without changes.

- [ ] **Step 1: Write the failing characterization test** — extend `backend/tests/test_screener.py`

```python
def test_latest_ok_ignores_failed_and_older_rows():
    # seed AAA @2026-09-01 ok, AAA @2026-09-02 failed, AAA @2026-09-03 ok, BBB @2026-09-01 ok
    # latest_ok_fundamentals(session, ["AAA", "BBB"]) -> AAA.date == "2026-09-03", BBB @09-01
def test_latest_ok_empty_symbols_returns_empty():
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_screener.py -q`
Expected: FAIL (new assertions fail or import error) — then implement.

- [ ] **Step 3: Implement the grouped subquery**

```python
from sqlalchemy import and_, func

newest = (
    session.query(Fundamental.symbol, func.max(Fundamental.date).label("date"))
    .filter(Fundamental.symbol.in_(symbols), Fundamental.data_status == "ok")
    .group_by(Fundamental.symbol)
    .subquery()
)
rows = (
    session.query(Fundamental)
    .join(newest, and_(Fundamental.symbol == newest.c.symbol, Fundamental.date == newest.c.date))
    .all()
)
return {row.symbol: row for row in rows}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_screener.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/screener/service.py backend/tests/test_screener.py
git commit -m "perf: latest_ok_fundamentals reads newest row only"
```

---

### Task B2: Provider hardening — cached ROE/ROCE reuse, timeout, retry

**Files:**
- Modify: `backend/app/data/provider.py`
- Modify: `backend/app/data/yfinance_impl.py`
- Modify: `backend/app/data/screener_impl.py` (signature only)
- Modify: `backend/tests/test_provider.py`

**Interfaces:**
- Produces:
  - `DataProvider.fundamentals(self, symbol: str, cached: dict | None = None) -> dict`
    — `cached` is the previous stored payload (`{pe, pb, roe, roce, debt_to_equity, raw,
    market_cap}`); providers may reuse it to avoid extra work. Default `None` keeps old
    callers working.
  - `YFinanceProvider` constants: `FETCH_TIMEOUT_SECONDS = 15.0`, `FETCH_ATTEMPTS = 3`,
    `RETRY_BASE_DELAY = 0.5`.
  - Helpers `_call_with_timeout(fn, timeout=FETCH_TIMEOUT_SECONDS)` (watchdog thread via
    `concurrent.futures`) and `_retry(fn, attempts=FETCH_ATTEMPTS)` (exponential backoff
    `RETRY_BASE_DELAY * 2**i` + jitter, re-raises the last error).
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests** — extend `backend/tests/test_provider.py`

```python
def test_cached_roe_roce_skip_statements():
    # fake ticker: .info lacks returnOnEquity/returnOnCapitalEmployed;
    # .financials/.balance_sheet raise AssertionError if touched.
    # provider.fundamentals("AAA", cached={"roe": 22.0, "roce": 30.0})
    # -> roe == 22.0, roce == 30.0, statement access never happened
def test_statements_fetched_without_cache():
    # same fake; cached=None -> statements touched, derived values returned
def test_retry_recovers_after_two_failures(monkeypatch):
    # _retry(fn that fails twice then returns 7) == 7; monkeypatch time.sleep no-op
def test_retry_reraises_after_attempts(monkeypatch):
    # always-failing fn -> raises; call count == FETCH_ATTEMPTS
def test_call_with_timeout_raises_on_hang():
    # _call_with_timeout(lambda: time.sleep(0.2), timeout=0.01) raises TimeoutError
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_provider.py -q`
Expected: FAIL — missing helpers / `cached` kwarg.

- [ ] **Step 3: Implement**

`provider.py` / `screener_impl.py`: add `cached: dict | None = None` to the abstract method
and the stub.

`yfinance_impl.py`:
- `fundamentals(symbol, cached=None)`: build the ticker once; fetch `.info` through
  `_retry(lambda: _call_with_timeout(lambda: ticker.info))`; derive `roe`/`roce` from
  `.info`; for each still missing value, use `cached.get("roe")` / `cached.get("roce")`
  when present (annual statement figures — reuse instead of refetching); only when a value
  is still missing, fetch statements once through the same retry/timeout wrappers.
- `_retry` catches `Exception`, logs once per retry at WARNING, sleeps with jitter
  (`random.uniform(0, RETRY_BASE_DELAY)` added), re-raises the final error.
- `_call_with_timeout` uses a module-level `ThreadPoolExecutor(max_workers=16)` (matches the
  worker count; timeouts never queue behind one another); on
  `concurrent.futures.TimeoutError` raises `TimeoutError(f"fetch timed out after {timeout}s")`.

- [ ] **Step 4: Update existing fakes for the new signature**

In `backend/tests/test_screen_api.py` (and any other fake provider): change
`def fundamentals(self, symbol)` to `def fundamentals(self, symbol, cached=None)`. Run the
full backend suite to prove nothing else assumed the old signature.

Run: `.\.venv\Scripts\python.exe -m pytest tests -q`
Expected: PASS (existing behavior preserved).

- [ ] **Step 5: Commit**

```bash
git add backend/app/data backend/tests
git commit -m "perf: yfinance timeout+retry and cached ROE/ROCE reuse"
```

---

### Task B3: Job service — create, prune, project, busy, interrupted

**Files:**
- Modify: `backend/app/screener/service.py`
- Create: `backend/tests/test_run_jobs.py`

**Interfaces:**
- Produces (exact names; used by B4–B6 and the API):
  - `now_iso() -> str` — `_now()` promoted to public (update internal callers).
  - `KEEP_JOBS = 20`.
  - `create_job(session_factory, user_id: int, set_id: int) -> dict` — marks stale runs
    interrupted, prunes to `KEEP_JOBS`, inserts one `run_jobs` row (`status="running"`) and
    one `run_job_items` row per user set (`status="queued"`), returns the projection.
  - `latest_job(session_factory, user_id: int) -> dict | None` — marks stale `running` jobs
    `interrupted` (`finished_at` stamped), returns the newest job projection or `None`.
  - `busy_set_ids(session_factory, user_id: int) -> set[int]` — sweeps stale `running` jobs
    to `interrupted` first, then returns `set_id`s with `queued|running` items in the newest
    job; empty when no running job.
  - `mark_interrupted_jobs(session_factory) -> None` — any `running` job **not registered as
    active** → `interrupted`.
  - `register_active_job(job_id: int) -> None` / `unregister_active_job(job_id: int) -> None`
    — module-level `_ACTIVE_JOB_IDS: set[int]`, mutated by the worker (B5). The sweep skips
    these ids so polling a live job never marks it interrupted.
  - `mark_item(session_factory, job_id: int, set_id: int, status: str, run_id: int | None = None, error: str | None = None) -> None`.
  - Job projection shape: `{id, set_id, status, started_at, finished_at, error,
    universe_total, universe_done, universe_failed, items: [{set_id, name, status, run_id,
    error, started_at, finished_at}]}` — items active-first, then by set id. Names come from
    `screening_sets`; a deleted set shows `name=""` (matching rows survive).

- [ ] **Step 1: Write the failing tests** — create `backend/tests/test_run_jobs.py`

```python
def test_create_job_creates_item_per_set_active_first(test_db, sign_in):
    # user with 2 sets, one active -> projection["items"][0]["set_id"] == active id,
    # all items status "queued", job status "running"
def test_create_job_prunes_to_keep_jobs(test_db, sign_in):
    # create 21 jobs -> only 20 remain; oldest id gone; its items gone too
def test_latest_job_marks_running_as_interrupted(test_db, sign_in):
    # seed run_jobs(status="running") then latest_job -> status "interrupted",
    # finished_at not None; busy_set_ids() == set()
def test_active_job_is_not_swept_as_interrupted(test_db, sign_in):
    # seed running job; register_active_job(id); latest_job -> still "running";
    # unregister_active_job(id); latest_job -> "interrupted"
def test_mark_item_sets_status_run_id_and_error(test_db, sign_in):
def test_latest_job_is_per_user(test_db, sign_in):
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_run_jobs.py -q`
Expected: FAIL — functions missing.

- [ ] **Step 3: Implement**

Use `RunJob` / `RunJobItem` from `app.db.models`. `latest_job` opens one session, calls the
interrupted sweep + commit, then projects. The sweep (`mark_interrupted_jobs`) skips ids in
the module-level `_ACTIVE_JOB_IDS` set; `register_active_job` / `unregister_active_job` are
plain set mutations. Pruning deletes `run_job_items` of the pruned jobs first
(`delete()` query by `job_id.in_(...)`), then the jobs. `mark_item` uses the passed `status`
verbatim and stamps `started_at`/`finished_at` on `running`/terminal transitions. No commits
inside helpers apart from their own session blocks — the worker (B5) writes batches itself.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_run_jobs.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/screener/service.py backend/tests/test_run_jobs.py
git commit -m "feat: run job service — create, prune, busy, interrupted"
```

---

### Task B4: Stored-snapshot run + bulk persist primitives

**Files:**
- Modify: `backend/app/screener/service.py`
- Modify: `backend/tests/test_screen_api.py` (new unit tests can live in
  `tests/test_run_jobs.py`; either file is acceptable, keep the imports there)

**Interfaces:**
- Produces:
  - `evaluate_stored_screen(session, stocks: list[dict], criteria: list[dict],
    shortlist_size: int, provider_stale: bool, today: str) -> tuple[list[dict], list[dict], bool]`
    — upserts `stocks` rows (identity only), reads the newest ok snapshot, builds engine
    rows, returns `(shortlist, rejected, stale)`. Pure DB reads + engine, no network.
  - `run_snapshot_screen(provider, session_factory, user: dict, criteria: list[dict],
    shortlist_size: int, set_id: int | None) -> dict` — calls `provider.list_stocks()`,
    evaluates the stored snapshot, persists one `ScreenRun`, and returns the legacy payload
    `{run_id, shortlisted, failed_count: 0, failed_symbols: [], failed_details, stale, total}`.
  - `persist_fetch_batch(session, results: list[tuple[dict, dict | None, str | None]],
    stocks_by_symbol: dict[str, Stock], today: str) -> tuple[dict[str, dict], list[str]]`
    — one existence query for today's `fundamentals` rows and one for `company_profiles`
    rows, then `add`/attribute updates (no per-row `session.merge`). Returns
    `(fresh_rows, failed_symbols)` where `fresh_rows[symbol]` carries
    `data_date=today`. Failure semantics unchanged: `failed` row only when no same-day `ok`
    row; failed fetch never nulls `market_cap`.

- [ ] **Step 1: Write the failing tests**

```python
def test_run_snapshot_screen_makes_no_fundamentals_calls(test_db, sign_in):
    # seed stored GOOD/BAD rows; p = MapProvider(data=...);
    # service.run_snapshot_screen(p, test_db, user, default_criteria(), 10, active_id)
    # -> p.calls == [] ; shortlist == ["AAA"]; one ScreenRun persisted; stale True
def test_run_snapshot_screen_same_day_is_not_stale(test_db, sign_in):
def test_evaluate_stored_screen_reports_rejected_first_gate(test_db):
def test_persist_fetch_batch_overwrites_same_day(test_db, seed stocks):
    # fetched ok row for same (symbol, today) -> single row, values updated, profile upserted
def test_persist_fetch_batch_failed_keeps_same_day_ok(test_db, seed):
    # today ok row + failed result -> row still ok, no failed row added
def test_persist_fetch_batch_inserts_failed_without_ok_row(test_db, seed):
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_run_jobs.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `evaluate_stored_screen`, `run_snapshot_screen`, and `persist_fetch_batch` **alongside**
the existing `run_screen` (copy the stock-upsert + stored-row + engine part into the new
helper; `persist_fetch_batch` carries the semantics of the per-row loop at
`app/screener/service.py:152-189` with `trim_raw`, `upsert_profile`, and the same-day
protection). **Leave `run_screen` and the endpoint untouched in this task** — existing API
tests stay green; B6 rewires the endpoint and deletes the legacy code.

Test fixtures: `test_run_jobs.py` defines its own `seed_stored` helper (same body as in
`test_screen_api.py`) and constructs provider objects directly; the `provider` fixture is
only needed by API tests in B6.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_run_jobs.py tests/test_screen_api.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/screener/service.py backend/tests
git commit -m "refactor: stored-snapshot screen + bulk fetch persist primitives"
```

---

### Task B5: `runner.execute_job` — fetch, persist, screen stage, refinement

**Files:**
- Create: `backend/app/screener/runner.py`
- Modify: `backend/app/screener/service.py` (worker-facing helper adjustments only —
  legacy `run_screen` removal happens in B6)
- Modify: `backend/tests/test_run_jobs.py`

**Interfaces:**
- Produces in `runner.py`:
  - `WORKERS = 16`.
  - `execute_job(job_id: int, provider: DataProvider, session_factory) -> None` — synchronous;
    never raises (a global failure marks the job `failed`).
  - `submit_job(job_id: int, provider: DataProvider, session_factory) -> None` — module-level
    `ThreadPoolExecutor(max_workers=1)` kick, one job at a time.
- Consumes: D1 models, B3 `mark_item` / `latest_job` shapes, B4 `evaluate_stored_screen` /
  `persist_fetch_batch`, `latest_ok_fundamentals`, B2 `fundamentals(symbol, cached=...)`.

Worker steps (spec §Run flow 6–10):

0. `service.register_active_job(job_id)` first; `unregister_active_job` in a `finally` so
   the interrupted sweep can tell live jobs from crashed ones.
1. Open a session: load the job and its user's sets. `stocks = provider.list_stocks()`;
   compute `refresh_symbols` (not-today or no snapshot). Order: active-screen gate survivors
   first (evaluate against the stored criteria), then the rest by descending `market_cap`
   (None last). Save `universe_total`; commit.
2. Fetch in a `ThreadPoolExecutor(max_workers=WORKERS)` over ordered symbols, passing each
   symbol's stored payload as `cached=` when present. Collect results with
   `as_completed`; flush every 25: open session → `persist_fetch_batch` → add
   `universe_done`/`universe_failed` counters → commit. Per-stock exceptions are isolated
   inside `execute_job` (never re-raised).
3. Screen stage: for every `queued` item whose `set_id != job.set_id`, `mark_item(running)`,
   then run the engine over the fresh-or-stored snapshot (`evaluate_stored_screen` with the
   set's criteria + `provider.stale`), persist `ScreenRun`, `mark_item(done, run_id)`. Wrap
   each screen in try/except → `mark_item(failed, error=str(e))`, continue.
4. Active screen last (refinement): re-run the active set, persist a second `ScreenRun`,
   update its item's `run_id` (status stays `done`), then job `done` + `finished_at`.
5. Global `except Exception` around steps 1–4: job `failed` + `error`; any `queued|running`
   item → `failed` with the same error.

- [ ] **Step 1: Write the failing tests** — extend `backend/tests/test_run_jobs.py`

New worker tests (provider objects passed directly, `seed_stored` local helper):

```python
def test_execute_job_refreshes_stale_and_refines(test_db, sign_in):
    # stored row from yesterday (passes), fresh MapProvider row fails PE gate ->
    # after execute_job: job done, universe_total/done == 1, active item done,
    # latest_screen(active set) returns the refined (empty) shortlist,
    # fundamentals today row exists
def test_execute_job_same_day_rerun_makes_no_calls(test_db, sign_in):
def test_execute_job_runs_every_saved_screen(test_db, sign_in):
    # 2 sets: each item done with distinct run_id; two sets' screen_runs rows exist
def test_job_done_when_every_fetch_fails(test_db, sign_in):
    # DeadFundamentalsProvider -> job done, universe_failed == universe_total,
    # cached shortlist still persisted
def test_screen_failure_isolated(test_db, sign_in):
    # corrupt criteria_json on one set -> that item failed, other item done, job done
def test_global_failure_marks_job_failed(test_db, sign_in):
    # provider.list_stocks raises -> job failed with error, no queued items left
def test_refresh_order_puts_survivors_first(test_db, sign_in):
    # MapProvider.calls order starts with the stored-snapshot survivor
```

**Migrate the fetch-semantics tests from `tests/test_screen_api.py`** (same bodies, now
calling `execute_job` with a created job; POST-level assertions from those cases drop):

- `test_failed_fetch_persisted_and_market_cap_preserved`
- `test_run_twice_same_day_is_idempotent`
- `test_screen_run_refreshes_every_stale_symbol`
- `test_stale_reject_passing_fresh_is_not_reported_failed`
- `test_screen_run_writes_company_profiles`
- `test_first_run_fetches_whole_universe_when_nothing_stored`
- `test_failed_refresh_keeps_same_day_ok_row`
- `test_refreshed_values_override_stored_snapshot`
- `test_stored_snapshot_keeps_screen_alive_when_refresh_fails`
- `test_failed_fetch_logs_warning`
- `test_screen_rerun_same_day_makes_no_fundamentals_calls` (worker variant; the sync-path
  variant stays in `test_screen_api.py`)

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_run_jobs.py -q`
Expected: FAIL — `runner` import missing.

- [ ] **Step 3: Implement**

Use `service.mark_item`, `service.persist_fetch_batch`, `service.evaluate_stored_screen`,
`service.latest_ok_fundamentals`, `service.stored_row`, `service.now_iso`. The refinement
screen is simply the last item processed (active first in display, last in execution). Reuse
one in-memory `stocks` list throughout; do not call `provider.list_stocks()` more than once
per job.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_run_jobs.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/screener/runner.py backend/app/screener/service.py backend/tests/test_run_jobs.py
git commit -m "feat: background run job — refresh universe, all screens, refinement"
```

---

### Task B6: API — instant run, jobs endpoint, busy 409s

**Files:**
- Modify: `backend/app/api/screen.py`
- Modify: `backend/app/screener/service.py` (delete legacy `run_screen`, `_fetch_all`,
  `WORKERS` — no longer referenced)
- Modify: `backend/tests/conftest.py` (monkeypatch `runner.submit_job`)
- Modify: `backend/tests/test_screen_api.py` (sync-path tests only; migrated fetch tests
  already left for `test_run_jobs.py` in B5)
- Modify: `backend/tests/test_sets_api.py` (busy 409s)

**Interfaces:**
- Consumes: B3 service helpers, B5 `runner.submit_job`.
- Produces:
  - `POST /screen/run` → `200 {"run": <legacy payload>, "job": <projection>}`; `409
    {"detail": "Run already in progress", "job_id": <id>}` when busy.
  - `GET /screen/jobs/latest` → `{"job": <projection> | null}`.
  - `PUT /screen/sets/{id}`, `DELETE /screen/sets/{id}`, `POST /screen/sets/{id}/activate` →
    `409 {"detail": "Screen is mid-run"}` when the target `set_id` is in `busy_set_ids`.

- [ ] **Step 1: Write the failing tests**

```python
# test_screen_api.py
def test_run_returns_cached_run_and_job(client, sign_in, provider, test_db):
    # body["run"]["shortlisted"] == ["AAA"] with seeded stored rows; body["job"]["status"]
    # == "running"; job items have the active set done with run_id; provider.calls == []
def test_second_run_while_running_409(client, sign_in, provider, test_db):
    # seed run_jobs(status="running") + item, service.register_active_job(seeded_id)
    # -> POST -> 409, detail string + job_id int; unregister in teardown
def test_jobs_latest_null_when_never_ran_and_shape_after_run(client, sign_in, provider, test_db):
# test_sets_api.py
def test_update_delete_activate_busy_screen_409(client, sign_in, test_db):
    # seed running run_job + queued item for the target set,
    # service.register_active_job(job_id) -> PUT / DELETE / activate all 409
def test_activate_other_screen_allowed_while_busy(client, sign_in, test_db):
```

Existing `test_screen_api.py` cases that stay at the API level change to
`body = client.post("/screen/run").json()["run"]` and seed stored snapshots where the
assertions need a shortlist: `test_run_uses_caller_criteria_and_stores_snapshot`
(`failed_count` is now `0`; `failed_details` comes from the stored snapshot),
`test_latest_is_per_user`, `test_tampered_shortlist_size_still_clamps`,
`test_disabled_criteria_and_raw_catalog_are_honored` (seed `raw_json` with the raw field),
`test_stale_provider_flagged`, `test_unreachable_provider_returns_structured_502`,
`test_screen_routes_require_auth`, `test_run_stores_active_set_id`,
`test_latest_scoped_to_active_set`, `test_delete_screen_keeps_runs_unstamped`,
`test_run_uses_the_updated_active_set`, `test_screen_rerun_same_day_makes_no_fundamentals_calls`
(sync variant). Do **not** re-assert fetch outcomes here — those live in `test_run_jobs.py`
(B5).

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_screen_api.py tests/test_sets_api.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

Endpoint:

```python
@router.post("/run")
def run_screen(user=Depends(current_user)) -> dict:
    init_db()
    busy = service.busy_set_ids(SessionLocal, user["id"])      # sweeps stale runs first
    if busy:
        job = service.latest_job(SessionLocal, user["id"])
        return JSONResponse(status_code=409, content={
            "detail": "Run already in progress", "job_id": job["id"]})
    stored = service.get_criteria(SessionLocal, user["id"])
    provider = get_provider()
    # Snapshot first: a provider burst (502) must not leave a stuck running job.
    run = service.run_snapshot_screen(provider, SessionLocal, user,
                                      stored["criteria"], stored["shortlist_size"], stored["id"])
    job = service.create_job(SessionLocal, user["id"], stored["id"])
    service.mark_item(SessionLocal, job["id"], stored["id"], "done", run_id=run["run_id"])
    runner.submit_job(job["id"], provider, SessionLocal)
    return {"run": run, "job": service.latest_job(SessionLocal, user["id"])}
```

`GET /jobs/latest` returns `{"job": service.latest_job(SessionLocal, user["id"])}`. Busy
checks for sets raise `HTTPException(409, detail="Screen is mid-run")` (target id only;
activating a non-busy screen stays allowed). `conftest.test_db` adds
`monkeypatch.setattr(runner, "submit_job", lambda *args, **kwargs: None)` so TestClient
requests never spawn the worker thread.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_screen_api.py tests/test_sets_api.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/screen.py backend/tests
git commit -m "feat: instant cached run, jobs endpoint, busy-screen 409s"
```

---

### Task B7: Docs, graph, full-suite verification

**Files:**
- Modify: `backend/BACKEND.md` (structure: `screener/runner.py`; data flow: cached-first +
  job; error handling: job failed/interrupted; Phase Gates row `1.8`)
- Modify: `PLAN.md` (Phase 1.8 section + `run_jobs`/`run_job_items` schema lines)
- Modify: `AGENTS.md` (phase list gains `phase-1.8-run-performance/`)

- [ ] **Step 1: Update the three docs** with the shipped behavior (cached-first run,
  background job, counters, busy 409s, pragmas, provider signature).

- [ ] **Step 2: Full backend suite**

Run: `.\.venv\Scripts\python.exe -m pytest tests -q`
Expected: all green, offline.

- [ ] **Step 3: Refresh knowledge graph**

Run from repo root: `graphify update .`
Expected: success, no new cycles.

- [ ] **Step 4: Commit**

```bash
git add backend/BACKEND.md PLAN.md AGENTS.md graphify-out
git commit -m "docs: Phase 1.8 run-performance docs + graph sync"
```

## Acceptance

- `.\.venv\Scripts\python.exe -m pytest tests -q` green offline, including every legacy
  screen/stock/universe test (response shape change is confined to `POST /screen/run`).
- Cold-day sync path returns the stored shortlist with zero `fundamentals()` calls; the job
  refreshes exactly the stale symbols, runs every saved screen, and refines the active
  screen last.
- Job progress is readable from the DB at any point; interrupted jobs recover on the next
  read; pruning keeps 20.
- Per-stock and per-screen failures never fail the job; a global failure marks the job
  `failed` with an error and leaves served data intact.
- Docs + graph updated in the same change.
