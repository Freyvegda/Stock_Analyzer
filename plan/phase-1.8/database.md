# Phase 1.8 — Database (multi-screen runs)

> Spec: `docs/superpowers/specs/2026-10-03-phase-1.8-multi-screen-runs-design.md` §3.
> `backend/app/db/DATABASE.md` is binding; update it in the same change.

**Goal:** one column on `screen_runs` so automatic extra-screen runs are distinguishable from
user-triggered ones. No new tables.

**Tech stack:** SQLAlchemy 2.x + SQLite (Postgres-compatible types only).

## Schema (exact)

### `screen_runs` (MODIFIED)

| Change | Detail |
|---|---|
| ADD `triggered_by` | `String` NOT NULL, default `'manual'`; values `manual \| auto`. The active screen's run of a batch is `manual`; the extra screens' runs are `auto`. |

Dev DB reset: stop backend, delete `data/stockanalyzer.db`, restart — `init_db()` recreates
(Rule 4, no migration tooling).

## Task D1: `triggered_by` column

**Files:**
- Modify: `backend/app/db/models.py`, `backend/app/db/DATABASE.md`
- Test: `backend/tests/test_db_models.py`

- [ ] **Step 1: Write the failing test** — extend `test_db_models.py`:

```python
def test_screen_runs_triggered_by_defaults_manual(tmp_path):
    # create_all on temp SQLite; insert a ScreenRun without triggered_by;
    # assert row.triggered_by == "manual"; assert column exists with default
```

- [ ] **Step 2: Run to verify failure**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_db_models.py -q`
Expected: FAIL — `triggered_by` missing.

- [ ] **Step 3: Implement**

`ScreenRun` gains
`triggered_by: Mapped[str] = mapped_column(String, nullable=False, server_default="manual", default="manual")`.

- [ ] **Step 4: Run to verify pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_db_models.py -q` → PASS.

- [ ] **Step 5: Document + commit**

`DATABASE.md`: add the `triggered_by` row + note ("auto runs never count toward the most-used
measure").

```bash
git add backend/app/db/models.py backend/app/db/DATABASE.md backend/tests/test_db_models.py
git commit -m "feat: screen_runs.triggered_by distinguishes user-triggered runs"
```

## Acceptance

- `screen_runs` has `triggered_by` defaulting to `manual`; no other schema change.
- `DATABASE.md` matches the implementation.
