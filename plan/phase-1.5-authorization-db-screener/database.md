# Phase 1.5 — Database (users, per-user criteria, user-scoped runs)

> **For agentic workers:** part of the Phase 1.5 plan. Required sub-skill when executing:
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use
> checkbox (`- [ ]`) syntax. Backend tasks: `plan/phase-1.5-authorization-db-screener/backend.md`.
> Frontend tasks: `plan/phase-1.5-authorization-db-screener/frontend.md`.
>
> **Spec:** `docs/superpowers/specs/2026-09-26-phase-1.5-authorization-db-screener-design.md`
> (sections "Data model (deltas)" and "Migration / retirement").

**Goal:** schema deltas that make the app single-account (multi-user-ready) and move screener
criteria from YAML into per-user DB rows, with every screen run attributed to its user.

**Architecture:** SQLAlchemy 2.x typed mappings in `backend/app/db/models.py`. Three changes:
new `users`, new `user_criteria`, extended `screen_runs` (`user_id` + `criteria_json`,
`config_yaml` dropped). No migration tooling — the dev DB is disposable and rebuilt by
`init_db()` (DATABASE.md rule 4).

**Tech stack:** SQLAlchemy 2.x + SQLite (Postgres-compatible types only).

## Global Constraints

- `backend/app/db/DATABASE.md` is binding; update it in the same change.
- All columns use portable types (`Integer`, `String`, `Float`, `Text`); no SQLite-only types.
- Dates/times stored as ISO strings; market data stays date-granular.
- JSON-in-Text columns parsed at the service layer, never in SQL.
- Dev DB reset procedure (document in DATABASE.md): stop backend, delete
  `data/stockanalyzer.db`, restart — `init_db()` recreates everything.
- No `config_yaml` anywhere after this phase (removed column; grep gate in backend Task B6).
- Keep `stocks`, `fundamentals`, `documents`, `doc_analysis`, `prices`, `signals`,
  `backtest_runs` byte-identical: pipeline data stays global/shared.

## Review Focus

Inputs/failure modes most likely to bite, each pinned by a test named here (owned by backend
tasks, listed for the DB contract):

1. Two users' criteria/runs must never leak into each other — tests `test_screen_api.py::test_latest_scoped_to_user`, `::test_run_snapshot_stores_user`.
2. Tampered `user_criteria.shortlist_size` (e.g. 50) must still yield ≤ 10 rows — `test_screener.py::test_shortlist_clamped_to_ten`.
3. `screen_runs.criteria_json` must be written for every run, including zero-shortlist runs — `test_screen_api.py::test_run_stores_criteria_snapshot`.
4. Pre-1.5 DB file exists without the new tables — app must fail loudly at query time; resolution is developer reset (documented, not code).
5. `user_criteria` row must exist before a run even if the user never opened the criteria UI — `test_criteria_api.py::test_first_read_seeds_defaults`.

## Schema (exact)

### `users` (NEW) — `backend/app/db/models.py`

| Column | Type | Notes |
|---|---|---|
| `id` | `Integer` PK autoincrement | |
| `username` | `String` NOT NULL, unique | stored lowercase, trimmed; 3–32 chars (validated in service) |
| `password_hash` | `String` NOT NULL | `scrypt$16384$8$1$<salt_b64>$<hash_b64>` |
| `created_at` | `String` NOT NULL | ISO date-time (`datetime.now(UTC).isoformat()`) |

### `user_criteria` (NEW)

| Column | Type | Notes |
|---|---|---|
| `user_id` | `Integer` PK, FK → `users.id` | one row per user |
| `criteria_json` | `Text` NOT NULL | JSON array `[{key, enabled, value}]` |
| `thesis` | `Text` NULL | ≤ 500 chars (validated in API layer) |
| `shortlist_size` | `Integer` NOT NULL, default 10 | server-set; engine clamps to ≤ 10 |
| `updated_at` | `String` NOT NULL | ISO date-time |

### `screen_runs` (MODIFIED)

| Change | Detail |
|---|---|
| ADD `user_id` | `Integer` NOT NULL, `index=True`; FK → `users.id` |
| ADD `criteria_json` | `Text` NOT NULL — verbatim criteria used for this run |
| DROP `config_yaml` | replaced by `criteria_json` |

## Tasks

### Task D1: Models for users, criteria, and user-scoped runs

**Files:**
- Modify: `backend/app/db/models.py` (add `User`, `UserCriteria`; edit `ScreenRun`)
- Modify: `backend/app/db/DATABASE.md` (new tables, changed `screen_runs`, reset note)
- Test: `backend/tests/test_db_models.py` (create)

**Interfaces:**
- Consumes: `Base` from `app.db.database`.
- Produces: `User(id, username, password_hash, created_at)`,
  `UserCriteria(user_id, criteria_json, thesis, shortlist_size, updated_at)`,
  `ScreenRun(id, run_date, user_id, criteria_json, shortlisted_json)`.
  Later tasks import exactly these names.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_db_models.py` — create tables in a temp SQLite engine, then assert:

```python
def test_screen_runs_has_user_scope_and_criteria_snapshot(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/m.db")
    Base.metadata.create_all(engine)
    cols = {c["name"] for c in inspect(engine).get_columns("screen_runs")}
    assert {"user_id", "criteria_json"} <= cols
    assert "config_yaml" not in cols

def test_user_criteria_defaults(tmp_path):
    # create_all, insert UserCriteria(user_id=1, criteria_json="[]", updated_at="...")
    # assert shortlist_size == 10 and thesis is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_db_models.py -q` (from `backend/`)
Expected: FAIL — `User` / `UserCriteria` do not exist; `user_id` column missing.

- [ ] **Step 3: Implement the mappings**

Add `User` and `UserCriteria` classes; edit `ScreenRun` to
`run_date`, `user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)`,
`criteria_json: Mapped[str] = mapped_column(Text)`, keep `shortlisted_json`, drop
`config_yaml`. Import `ForeignKey` from `sqlalchemy`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_db_models.py -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Reset dev DB + verify live schema**

```powershell
Remove-Item ..\data\stockanalyzer.db -ErrorAction SilentlyContinue
.\.venv\Scripts\python.exe -c "from app.db.database import init_db; init_db(); import sqlite3; c=sqlite3.connect(r'..\data\stockanalyzer.db'); print([r[1] for r in c.execute('PRAGMA table_info(screen_runs)')]); print([r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='table'\")])"
```
Expected: `screen_runs` columns include `user_id`, `criteria_json`, no `config_yaml`; table
list includes `users`, `user_criteria`.

- [ ] **Step 6: Document in `backend/app/db/DATABASE.md`**

Add `users` + `user_criteria` table sections, update `screen_runs` (user_id, criteria_json,
no config_yaml), add the reset procedure, and state: criteria/runs are per-user, all other
tables global.

- [ ] **Step 7: Commit**

```bash
git add backend/app/db/models.py backend/app/db/DATABASE.md backend/tests/test_db_models.py
git commit -m "feat: users, user_criteria tables; scope screen_runs by user with criteria snapshot"
```

## Acceptance

- `init_db()` on an empty file creates `users`, `user_criteria`, and user-scoped `screen_runs`
  with the exact columns above (verified in D1 Step 5).
- `inspect().get_columns` test proves `config_yaml` gone and `user_id`/`criteria_json` present.
- No SQLite-only types; `PRAGMA` output matches for a fresh DB.
- `DATABASE.md` matches the implementation (binding per AGENTS.md).
