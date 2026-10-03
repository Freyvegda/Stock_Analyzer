# Phase 1.8 — Run performance (database: job tables + SQLite pragmas)

> **For agentic workers:** part of the Phase 1.8 plan. Required sub-skill when executing:
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use
> checkbox (`- [ ]`) syntax.
>
> **Spec:** `docs/superpowers/specs/2026-10-03-run-performance-design.md`.
> Backend: `plan/phase-1.8-run-performance/backend.md`. Frontend:
> `plan/phase-1.8-run-performance/frontend.md`.

**Goal:** two append-only job-progress tables (`run_jobs`, `run_job_items`) and
connection-level SQLite pragmas (WAL + busy_timeout) so a background run no longer locks
other endpoints.

**Architecture:** plain tables in `app/db/models.py` (Postgres-compatible, no SQLite-only
types). Pragmas attach an event listener to the engine in `app/db/database.py`, applied
only when `engine.dialect.name == "sqlite"` — schema and queries stay portable.

**Tech stack:** SQLAlchemy 2.x, SQLite, pytest. No new dependencies.

## Global Constraints

- Work dir: `backend/` (venv active). Tests:
  `.\.venv\Scripts\python.exe -m pytest tests -q`; all offline, no network.
- Schema stays Postgres-compatible (DATABASE.md hard rule): no SQLite-only column types.
- Dev DB reset (delete `data/stockanalyzer.db`) is the migration, per repo rule.
- `run_jobs` / `run_job_items` are append-only job history; `screen_runs` audit stays
  untouched.

## Review Focus

Failure modes most likely to bite; each has a test in the task that owns the code.

1. Pragma listener must not fire on non-SQLite dialects — D1 `test_configure_sqlite_skips_other_dialects`.
2. WAL must actually be active on the app engine, not just requested — D1 `test_configure_sqlite_sets_wal_and_busy_timeout`.
3. Deleting a `screening_set` must not break job history — items/jobs keep `set_id` as a
   plain FK without cascade (rows survive; projection tolerates missing set names).
4. `run_job_items.run_id` must not require the run to exist (job may fail before a run is
   written) — nullable FK.
5. Both tables get `create_all()` registration — D1 `test_job_tables_exist`.

---

### Task D1: `run_jobs` + `run_job_items` models, `configure_sqlite` pragmas

**Files:**
- Modify: `backend/app/db/models.py`
- Modify: `backend/app/db/database.py`
- Modify: `backend/tests/test_db_models.py`
- Modify: `backend/app/db/DATABASE.md` (table docs + pragma note)

**Interfaces:**
- Consumes: `Base` (unchanged).
- Produces (exact model fields; used by backend B3–B6 and the API projection):
  - `RunJob(id, user_id, set_id, started_at, finished_at, status, universe_total,
    universe_done, universe_failed, error)` — `__tablename__ = "run_jobs"`.
  - `RunJobItem(id, job_id, set_id, status, started_at, finished_at, error, run_id)` —
    `__tablename__ = "run_job_items"`; `job_id` and `run_id` FKs, `job_id` indexed.
  - `_sqlite_pragmas(dbapi_conn, _record)` module-level in `app/db/database.py` — sets
    `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` on connect.
  - `configure_sqlite(engine) -> None` — attaches `_sqlite_pragmas` via `event.listens_for`
    only when `engine.dialect.name == "sqlite"`; no-op otherwise. Module engine registered
    at import.

- [ ] **Step 1: Write the failing tests** — extend `backend/tests/test_db_models.py`

```python
def test_job_tables_exist():        # inspect(engine).has_table for run_jobs, run_job_items
def test_run_job_item_fks_are_nullable():
    # run_job_items.run_id and run_jobs.finished_at/error nullable; status NOT NULL
def test_configure_sqlite_sets_wal_and_busy_timeout():
    # temp engine -> configure_sqlite -> PRAGMA journal_mode == "wal",
    # PRAGMA busy_timeout == 5000
def test_configure_sqlite_skips_other_dialects():
    # create_mock_engine("postgresql://", executor) -> configure_sqlite(engine) ->
    # event.contains(engine, "connect", _sqlite_pragmas) is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_db_models.py -q`
Expected: FAIL — import of `RunJob` / `configure_sqlite` missing.

- [ ] **Step 3: Implement**

`models.py`: add both classes with `Mapped[...]` typed columns. FKs:
`user_id -> users.id` (indexed), `set_id -> screening_sets.id` (no cascade),
`job_id -> run_jobs.id` (indexed), `run_id -> screen_runs.id` (nullable). `status` columns
`String, nullable=False`; counters `Integer, nullable=False, default=0`; timestamps
`String` ISO; `error` `Text | None`.

`database.py`:

```python
from sqlalchemy import event

def _sqlite_pragmas(dbapi_conn, _record) -> None:
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()

def configure_sqlite(engine) -> None:
    """WAL + busy_timeout for SQLite only; other dialects untouched."""
    if engine.dialect.name != "sqlite":
        return
    event.listen(engine, "connect", _sqlite_pragmas)

engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
configure_sqlite(engine)
```

`DATABASE.md`: document both tables (columns + the `interrupted`/pruning rules from the
spec) and the pragma note under Choice.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_db_models.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/db/models.py backend/app/db/database.py backend/app/db/DATABASE.md backend/tests/test_db_models.py
git commit -m "feat: run job tables + SQLite WAL/busy_timeout pragmas"
```
