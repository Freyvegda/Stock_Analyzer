# Phase 1.8 — Backend (multi-screen runs + stock reports)

> Spec: `docs/superpowers/specs/2026-10-03-phase-1.8-multi-screen-runs-design.md` §§3–6, 8–9.
> Schema: `plan/phase-1.8/database.md` (Task D1 first). Frontend: `plan/phase-1.8/frontend.md`.

**Goal:** `POST /screen/run` evaluates the active set plus the 3 most-used sets in one batch with
one prepare stage, and `GET /stock/{symbol}` serves a live `reports` array (active + top 3) instead
of a single `report`.

**Architecture:** `screener/service.py` splits into `_prepare` + `_evaluate_and_store` behind the
existing `run_screen` wrapper, adds `most_used_sets` and `run_screen_batch`; `api/screen.py` calls
the batch; `stock/service.py` composes reports and scopes the run chip to the active set.

**Tech stack:** FastAPI, SQLAlchemy 2.x, pydantic v2. No new dependencies.

## Global Constraints

- Work dir: `backend/` (venv active). Tests: `.\.venv\Scripts\python.exe -m pytest tests -q`.
- Tests OFFLINE; provider mocked. `client`/`sign_in`/`test_db` fixtures from `tests/conftest.py`.
- BACKEND.md rules stay binding: DataProvider boundary, thin API, per-stock isolation, thin routers.
- `run_screen` public signature/behaviour unchanged (`provider, session_factory, user, criteria,
  shortlist_size=10, set_id=None`).
- Extra-run failure isolation: one failing extra never fails the batch or the response.

## Review Focus

Each failure mode gets a test in the task that owns the code:

1. Auto-runs never count toward "most used" — B1.
2. One extra failing leaves the active result + other extras intact — B3.
3. Batch performs no extra network beyond one prepare — B3 (`provider.fundamentals` count).
4. `latest_screen` + the stock run chip resolve to the **active** set with auto-runs present — B4.
5. Fewer than 3 other sets / no history → fewer/no extras — B1/B3.

---

### Task B1: `most_used_sets` (pure selection) + `triggered_by` write path

**Files:**
- Modify: `backend/app/screener/service.py`
- Test: `backend/tests/test_screen_batch.py` (create)

**Interfaces:**
- Produces:
  - `most_used_sets(session_factory, user_id: int, limit: int = 3, exclude_id: int | None = None) -> list[dict]`
  - `run_screen(...)` gains `triggered_by: str = "manual"` (internal write).
- Selection: last 10 runs `triggered_by='manual'` (id desc) → count `set_id` occurrences → drop
  `None` and `exclude_id` → keep sets that still exist → order count desc, most-recent manual run
  desc, id asc → `limit`.

- [ ] **Step 1: Write the failing tests** — `tests/test_screen_batch.py`

Use a temp `sessionmaker` (`Base.metadata.create_all`) + `User` seed. Insert `ScreeningSet` rows and
`ScreenRun` rows directly (`triggered_by` explicit).

```python
def test_counts_frequency_over_last_10_manual_runs(): ...     # A x3, B x2, C x1 -> [A,B,C]
def test_auto_runs_are_ignored(): ...                         # 10 auto runs of D never appear
def test_only_the_last_10_manual_runs_count(): ...            # 11th-oldest use falls out
def test_excludes_active_and_missing_sets(): ...              # exclude_id skipped; deleted set's nulled runs skipped
def test_tie_breaks_by_most_recent_then_id(): ...
def test_limited_to_three_and_empty_without_history(): ...
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_screen_batch.py -q`
Expected: FAIL — `most_used_sets` missing.

- [ ] **Step 3: Implement** in `screener/service.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_screen_batch.py tests/test_screen_api.py tests/test_sets_service.py -q`
Expected: PASS (existing suites untouched).

- [ ] **Step 5: Commit**

```bash
git add backend/app/screener/service.py backend/tests/test_screen_batch.py
git commit -m "feat: most-used screens from the last 10 manual runs"
```

---

### Task B2: Split `run_screen` into `_prepare` + `_evaluate_and_store`

**Files:**
- Modify: `backend/app/screener/service.py`
- Test: existing `tests/test_screen_api.py` + `tests/test_screener.py` stay green.

**Interfaces:**
- `_prepare(provider, session_factory) -> dict` — `{today, candidates, failed_symbols, total, stale_provider}`.
- `_evaluate_and_store(session_factory, user_id, prepared, criteria, shortlist_size, set_id, triggered_by) -> dict`
  — `{run_id, shortlisted, failed_count, failed_symbols, failed_details, stale, total}`.
- `run_screen(...)` = `_prepare` + `_evaluate_and_store(..., "manual")`, same return shape.

- [ ] **Step 1: Refactor under the existing tests** (they are the failing/passing gate)

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_screen_api.py tests/test_screener.py -q`
Expected at each step: PASS before and after; behaviour identical.

- [ ] **Step 2: Verify no behaviour change**

Run: `.\.venv\Scripts\python.exe -m pytest tests -q`
Expected: 256 passed.

- [ ] **Step 3: Commit**

```bash
git add backend/app/screener/service.py
git commit -m "refactor: prepare/evaluate split inside the screen service"
```

---

### Task B3: `run_screen_batch` + `POST /screen/run` response

**Files:**
- Modify: `backend/app/screener/service.py`, `backend/app/api/screen.py`
- Test: `backend/tests/test_screen_batch.py`, `backend/tests/test_screen_api.py`

**Interfaces:**
- `run_screen_batch(provider, session_factory, user) -> dict` — active result + `extra_runs`
  (`[{set_id, name, run_id, shortlisted, error}]`).
- `POST /screen/run` returns it.

- [ ] **Step 1: Write the failing tests**

```python
def test_batch_runs_active_manual_and_extras_auto(): ...   # 1 manual + up to 3 auto rows, set_id + triggered_by
def test_batch_caps_extras_at_three_and_reuses_one_prepare(): ...  # provider.fundamentals calls == single run
def test_extra_failure_is_isolated_and_reported(): ...     # provider/engine failure on one extra -> error, others stored
def test_batch_without_history_returns_no_extras(): ...
def test_run_endpoint_serializes_extra_runs(client, sign_in, provider): ...
```

- [ ] **Step 2: Run to verify failure**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_screen_batch.py tests/test_screen_api.py -q`
Expected: FAIL — `run_screen_batch` missing; response lacks `extra_runs`.

- [ ] **Step 3: Implement**

`run_screen_batch`: active set → `_prepare` → `_evaluate_and_store(active, "manual")` →
`most_used_sets(exclude=active.id)` → per set `try: _evaluate_and_store(auto)` / `except Exception`
→ `extra_runs`. `api/screen.py` `/run` calls the batch.

- [ ] **Step 4: Run to verify pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_screen_batch.py tests/test_screen_api.py -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/screener/service.py backend/app/api/screen.py backend/tests/test_screen_batch.py backend/tests/test_screen_api.py
git commit -m "feat: one Run Screen evaluates the active set plus the 3 most used"
```

---

### Task B4: Stock `reports` array + active-scoped run chip

**Files:**
- Modify: `backend/app/stock/service.py`
- Test: `backend/tests/test_stock_service.py`, `backend/tests/test_stock_api.py`

**Interfaces:**
- `_detail_payload` returns `reports: [{set_id, name, is_active, report}]` (active first, then
  `most_used_sets(limit=3, exclude_id=active.id)`); `report` removed.
- `_latest_run_entry(session, user_id, symbol, set_id)` filters `ScreenRun.set_id == set_id`.

- [ ] **Step 1: Write the failing tests**

```python
def test_reports_are_active_first_then_most_used(): ...     # order + per-set verdicts differ
def test_reports_without_history_have_only_the_active(): ...
def test_run_context_ignores_auto_runs_of_other_screens(): ...  # newest run is auto for set B; chip still shows active set A's run
```

- [ ] **Step 2: Run to verify failure**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stock_service.py tests/test_stock_api.py -q`
Expected: FAIL — `reports` key absent.

- [ ] **Step 3: Implement** in `stock/service.py` (`screener_service.get_active_set` +
  `screener_service.most_used_sets` + `report_builder.build_report` per set).

- [ ] **Step 4: Run to verify pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stock_service.py tests/test_stock_api.py -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/stock/service.py backend/tests/test_stock_service.py backend/tests/test_stock_api.py
git commit -m "feat: stock detail serves live reports for the active + most-used screens"
```

---

### Task B5: Docs, full suite, knowledge graph

**Files:**
- Modify: `backend/BACKEND.md`, `backend/app/db/DATABASE.md`, `PLAN.md`, `AGENTS.md`

- [ ] **Step 1: Docs** — BACKEND.md structure/API/data-flow/phase-gate rows for the batch runs and
  `reports`; DATABASE.md read pattern for the active run; PLAN.md Phase 1.8 section; AGENTS.md plan
  folder list gains `phase-1.8/`.
- [ ] **Step 2: Full suite** — `.\.venv\Scripts\python.exe -m pytest tests -q` → all green.
- [ ] **Step 3: `graphify update .`** from repo root (success, no new cycles).
- [ ] **Step 4: Commit**

```bash
git add backend/BACKEND.md backend/app/db/DATABASE.md PLAN.md AGENTS.md
git commit -m "docs: backend context, schema and phase lists for multi-screen runs"
```

## Acceptance

- Batch: 1 manual + ≤3 auto rows; extras reuse the prepare; failure isolated; `extra_runs` shaped.
- `most_used_sets` ignores auto-runs, honours the last-10 window and ordering rules.
- `/stock/{symbol}` returns `reports` (active first); run chip never reads another screen's run.
- Full suite green offline.
