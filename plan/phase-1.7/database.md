# Phase 1.7 — Database (saved screening sets)

> **For agentic workers:** part of the Phase 1.7 plan. Required sub-skill when executing:
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use
> checkbox (`- [ ]`) syntax.
>
> **Spec:** `docs/superpowers/specs/2026-09-29-phase-1.7-saved-screens-design.md`.
> Backend contract: `plan/phase-1.7/backend.md`. Frontend contract: `plan/phase-1.7/frontend.md`.
> `backend/app/db/DATABASE.md` is binding; update it in the same change.

**Goal:** schema deltas that let each user own many named screening criteria ("screens"),
with exactly one active, and attribute every screen run to the screen it executed.

**Architecture:** SQLAlchemy 2.x typed mappings in `backend/app/db/models.py`. New
`screening_sets` table, `screen_runs.set_id` added, `user_criteria` retired. No migration
tooling — the dev DB is disposable and rebuilt by `init_db()` (DATABASE.md rule 4).

**Tech stack:** SQLAlchemy 2.x + SQLite (Postgres-compatible types only).

## Global Constraints

- All columns use portable types (`Integer`, `String`, `Float`, `Boolean`, `Text`,
  `UniqueConstraint`); no SQLite-only types or SQL.
- Dates/times stored as ISO strings; JSON-in-Text columns parsed at the service layer.
- Dev DB reset procedure (document in DATABASE.md): stop backend, delete
  `data/stockanalyzer.db`, restart — `init_db()` recreates everything; re-run `/auth/setup`.
- Keep `stocks`, `fundamentals`, `company_profiles`, `documents`, `doc_analysis`, `prices`,
  `signals`, `backtest_runs` byte-identical: pipeline data stays global/shared.

## Review Focus

Inputs/failure modes most likely to bite, each pinned by a test (owned by backend tasks,
listed here for the DB contract):

1. Two users' sets must never leak into each other — `test_sets_api.py::test_sets_isolated_between_users`.
2. Exactly one active set per user after activate/create/delete — `test_sets_service.py::test_activate_switches_single_active`, `::test_delete_active_promotes_most_recent`.
3. Runs must never mix screens — `test_screen_api.py::test_latest_scoped_to_active_set`.
4. Deleting the last screen must fail cleanly (400), never leave zero screens —
   `test_sets_api.py::test_delete_last_screen_returns_400`.
5. Retired `user_criteria` must not be referenced anywhere — grep gate in Task D2.

## Schema (exact)

### `screening_sets` (NEW) — `backend/app/db/models.py`

| Column | Type | Notes |
|---|---|---|
| `id` | `Integer` PK autoincrement | |
| `user_id` | `Integer` NOT NULL, `index=True`, FK → `users.id` | |
| `name` | `String` NOT NULL | 1–60 chars, trimmed; unique per user (exact-match DB constraint; case-insensitive checked in service) |
| `criteria_json` | `Text` NOT NULL | JSON array `[{key, enabled, value, bookmarked?}]` — bookmark addendum 2026-09-29; `bookmarked` optional, default false |
| `thesis` | `Text` NULL | ≤ 500 chars (validated in API layer) |
| `shortlist_size` | `Integer` NOT NULL, default 10 | server-owned; engine clamps to ≤ 10 |
| `is_active` | `Boolean` NOT NULL, default `False` | exactly one active per user, service-enforced |
| `updated_at` | `String` NOT NULL | ISO date-time |

`__table_args__ = (UniqueConstraint("user_id", "name", name="uq_screening_sets_user_name"),)`.

### `screen_runs` (MODIFIED)

| Change | Detail |
|---|---|
| ADD `set_id` | `Integer` NULL, `index=True`, FK → `screening_sets.id` |

Null when the owning screen was deleted (runs are kept as audit); legacy pre-1.7 runs are
gone with the dev reset.

### `user_criteria` (RETIRED)

Remove the model class. No runtime code references it after this phase; the dev reset drops
the table.

## Tasks

### Task D1: Models for screening_sets and screen_runs.set_id

**Files:**
- Modify: `backend/app/db/models.py`
- Modify: `backend/app/db/DATABASE.md`
- Test: `backend/tests/test_db_models.py`

**Interfaces:**
- Consumes: `Base` from `app.db.database`, `ForeignKey`/`UniqueConstraint` from `sqlalchemy`.
- Produces: `ScreeningSet(id, user_id, name, criteria_json, thesis, shortlist_size,
  is_active, updated_at)`, `ScreenRun(id, run_date, user_id, set_id, criteria_json,
  shortlisted_json)`. Later tasks import exactly these names. `UserCriteria` is gone.

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_db_models.py`

Add:

```python
def test_screening_sets_table_schema(tmp_path):
    # create_all on a temp SQLite engine; inspect columns
    # assert {"id","user_id","name","criteria_json","thesis","shortlist_size","is_active","updated_at"} <= cols
    # assert user_id has an index; unique constraint uq_screening_sets_user_name present

def test_screen_runs_has_set_id(tmp_path):
    # inspect columns; assert "set_id" in cols
    # assert no "user_criteria" table in inspect(engine).get_table_names()

def test_screening_set_defaults(tmp_path):
    # insert ScreeningSet(user_id=1, name="Default", criteria_json="[]", updated_at="...")
    # assert shortlist_size == 10 and is_active is False and thesis is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `.\.venv\Scripts\python.exe -m pytest tests/test_db_models.py -q`
Expected: FAIL — `ScreeningSet` does not exist; `user_criteria` still present.

- [ ] **Step 3: Implement the mappings**

Add `ScreeningSet`; edit `ScreenRun` to add
`set_id: Mapped[int | None] = mapped_column(ForeignKey("screening_sets.id"), nullable=True, index=True)`;
delete `UserCriteria`. Import `Boolean` and `UniqueConstraint` from `sqlalchemy`, `Index` not
needed (`index=True` covers it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_db_models.py -q`
Expected: PASS.

- [ ] **Step 5: Reset dev DB + verify live schema (destructive; local dev only)**

```powershell
Remove-Item ..\data\stockanalyzer.db -ErrorAction SilentlyContinue
.\.venv\Scripts\python.exe -c "from app.db.database import init_db; init_db(); import sqlite3; c=sqlite3.connect(r'..\data\stockanalyzer.db'); print([r[1] for r in c.execute('PRAGMA table_info(screening_sets)')]); print([r[1] for r in c.execute('PRAGMA table_info(screen_runs)')]); print([r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='table'\")])"
```

Expected: `screening_sets` columns as specced; `screen_runs` includes `set_id`; table list
includes `screening_sets` and **not** `user_criteria`. Account and runs are wiped — re-run
`/auth/setup` in the UI.

- [ ] **Step 6: Document in `backend/app/db/DATABASE.md`**

Replace the `user_criteria` section with `screening_sets`; update `screen_runs` (add
`set_id`); update the table count; update the reset procedure; state: sets/runs are per-user,
all other tables global.

- [ ] **Step 7: Commit**

```bash
git add backend/app/db/models.py backend/app/db/DATABASE.md backend/tests/test_db_models.py
git commit -m "feat: screening_sets table, screen_runs.set_id, retire user_criteria"
```

### Task D2: Grep gate + docs consistency

- [ ] **Step 1: Grep gate**

Run from repo root:
```powershell
rg -n "UserCriteria|user_criteria" backend --glob "!__pycache__"
```
Expected after backend Task B4: no matches outside `plan/`, `docs/`. Capture remaining
matches and fix them in backend.md tasks (they are the file-by-file test updates).

- [ ] **Step 2: Commit** (only if Step 1 changed docs again)

```bash
git add backend/app/db/DATABASE.md
git commit -m "docs: database context for Phase 1.7 screening sets"
```

## Acceptance

- `init_db()` on an empty file creates `screening_sets` with the exact columns above;
  `screen_runs` has `set_id`; `user_criteria` is gone (verified in D1 Step 5).
- `inspect()` tests prove schema + defaults; `db.DATABASE.md` matches the implementation.
- No SQLite-only types; the fresh DB opens with the same `PRAGMA` output.
