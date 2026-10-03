# Phase 1.7 — Backend (saved screens; run/latest per active screen)

> **For agentic workers:** part of the Phase 1.7 plan. Required sub-skill when executing:
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use
> checkbox (`- [ ]`) syntax.
>
> **Spec:** `docs/superpowers/specs/2026-09-29-phase-1.7-saved-screens-design.md`.
> Schema first: `plan/phase-1.7/database.md` (Task D1). Frontend contract:
> `plan/phase-1.7/frontend.md`.

**Goal:** many named criteria sets per user with exactly one active; set CRUD + activate
endpoints; `POST /screen/run` and `GET /screen/latest` scoped to the active screen; `/stocks`
verdicts and the stock report keep their payloads but read the active set.

**Architecture:** `screening_sets` rows (D1) own `criteria_json` + `thesis` + `is_active`;
logic in `app/screener/service.py` (BACKEND.md rule 6 — thin routers); validation models in
`app/screener/criteria.py`. `service.get_criteria` stays as the active-set projection so
`stock/service.py` and `stock/universe.py` do not change. `api/screen.py` exposes
`/screen/sets*` and retires `/screen/criteria`.

**Tech stack:** FastAPI, SQLAlchemy 2.x, pydantic v2, SQLite. No new dependencies.

## Global Constraints

- Work dir: `backend/` (venv active). Tests: `.\.venv\Scripts\python.exe -m pytest tests -q`.
- Tests run OFFLINE; network mocked. `client` + `sign_in` + `test_db` fixtures from
  `tests/conftest.py`.
- BACKEND.md rules stay: DataProvider boundary, thin API layer, per-stock failure isolation,
  composite-PK idempotency, no hardcoded ratios.
- Exactly one active set per user, enforced in service transactions (activate/create/delete).
- Deleting the last set → `LastSetError` → 400. Unknown set id → `SetNotFoundError` → 404.
- Duplicate name (case-insensitive, per user) → `ConfigError` → 422. Name trimmed, 1–60 chars.
- `shortlist_size` never accepted from clients (`extra="forbid"` → 422); engine clamps to 10.
- `GET/PUT /screen/criteria` are retired (404). Nothing else changes shape.

## Review Focus

Failure modes most likely to bite; each has a test in the task that owns the code.

1. Two users' sets/runs never leak — B2 `test_sets_isolated_between_users`, B4 `test_latest_scoped_to_active_set`.
2. After any activate/create/delete, exactly one active set remains — B2 `test_activate_switches_single_active`, `test_delete_active_promotes_most_recent`.
3. Deleting the last set fails cleanly (400), never zero sets — B3 `test_delete_last_screen_returns_400`.
4. A run keeps the criteria it executed even if the screen later changes or is deleted — B4 `test_run_stores_active_set_id` + existing snapshot test.
5. Corrupt `criteria_json` in a set never 500s — `criteria_from_json` fallback stays (B1 `test_corrupt_criteria_json_falls_back`).

---

### Task B1: Set validation models in `criteria.py`

**Files:**
- Modify: `backend/app/screener/criteria.py`
- Modify: `backend/tests/test_criteria.py`

**Interfaces:**
- Consumes: `CriterionItem` (unchanged), `CATALOG_BY_KEY`.
- Produces:
  - `validate_criteria_list(items: list[CriterionItem]) -> list[dict]` — duplicate-key and
    at-least-one-enabled checks, returns `model_dump()` list.
  - `ScreeningSetCreate(name: str, criteria: list[CriterionItem] | None, thesis: str | None)`
    — `extra="forbid"`, name 1–60 trimmed non-blank, criteria 1–50 when present, thesis ≤ 500.
  - `ScreeningSetUpdate(name | criteria | thesis all optional)` — `extra="forbid"`,
    requires at least one field *provided* (`model_fields_set`), same field rules.
  - `CriteriaUpdate` is deleted (no longer used).

- [ ] **Step 1: Write the failing tests** — extend `backend/tests/test_criteria.py`

```python
def test_screening_set_create_rejects_blank_name():        # "   " -> ValidationError
def test_screening_set_create_rejects_shortlist_size():    # {"name": "x", "shortlist_size": 5} -> ValidationError
def test_screening_set_create_accepts_without_criteria():  # name only -> criteria is None
def test_screening_set_update_requires_a_field():          # {} -> ValidationError; {"name": "x"} -> ok
def test_validate_criteria_list_rejects_duplicates_and_disabled():
def test_corrupt_criteria_json_falls_back():               # criteria_from_json('{"bad"') == default_criteria()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_criteria.py -q`
Expected: FAIL — models missing.

- [ ] **Step 3: Implement**

Move the duplicate/at-least-one-enabled checks out of `CriteriaUpdate` into
`validate_criteria_list`; add both set models calling it from a
`@model_validator(mode="after")` when `criteria is not None`. Name validator:
`value.strip()`, raise `ValueError("name must not be blank")` when empty.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_criteria.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/screener/criteria.py backend/tests/test_criteria.py
git commit -m "feat: screening set validation models replace single-criteria update"
```

---

### Task B2: Set service — seed, CRUD, activate

**Files:**
- Modify: `backend/app/screener/service.py`
- Modify: `backend/app/auth/service.py` (delete `seed_default_criteria` + `UserCriteria` import)
- Test: `backend/tests/test_sets_service.py` (create)

**Interfaces:**
- Consumes: D1 `ScreeningSet`, B1 `validate_criteria_list` (models run at API layer),
  `criteria_from_json`, `criteria_to_json`, `default_criteria`.
- Produces (exact signatures; used by B3/B4 and future code):
  - `class SetNotFoundError(Exception)`, `class LastSetError(Exception)`
  - `list_sets(session_factory, user_id: int) -> list[dict]`
  - `get_active_set(session_factory, user_id: int) -> dict`
  - `get_criteria(session_factory, user_id: int) -> dict` — alias of `get_active_set`
    (stock service/universe keep working unchanged)
  - `create_set(session_factory, user_id: int, name: str, criteria: list[dict] | None, thesis: str | None) -> dict`
  - `update_set(session_factory, user_id: int, set_id: int, changes: dict) -> dict`
  - `delete_set(session_factory, user_id: int, set_id: int) -> None`
  - `activate_set(session_factory, user_id: int, set_id: int) -> dict`
  - projection shape: `{"id", "name", "criteria", "thesis", "shortlist_size", "is_active", "updated_at"}`

  Semantics: `_seed_active_set(session, user_id)` creates `"Default"` (default criteria,
  active) when the user has none; repairs a user whose sets exist but none is active by
  activating the most recently updated. `create_set` copies the active set's criteria when
  `criteria is None`, becomes active, deactivates the rest. `update_set` takes
  `changes ∈ {"name","criteria","thesis"}` (API sends `exclude_unset`), case-insensitive
  duplicate-name → `ConfigError`. `delete_set` raises `LastSetError` for the last set and
  promotes the most recently updated remaining set when the deleted one was active.

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_sets_service.py`

Use `test_db` (sessionmaker) + `create_user` from `app.auth.service`:

```python
def test_first_read_seeds_default_active_set(test_db):
    # list_sets -> one "Default", active, criteria == default_criteria()
def test_create_set_copies_active_criteria_and_becomes_active(test_db):
def test_activate_switches_single_active(test_db):
def test_update_set_changes_fields_and_clears_thesis(test_db):
def test_duplicate_name_rejected_case_insensitive(test_db):
def test_delete_last_set_rejected(test_db):
def test_delete_active_promotes_most_recent(test_db):
def test_unknown_set_raises_not_found(test_db):
def test_sets_isolated_between_users(test_db):
def test_get_criteria_returns_active_set(test_db):
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_sets_service.py -q`
Expected: FAIL — functions missing.

- [ ] **Step 3: Implement in `screener/service.py`; delete `seed_default_criteria` from `auth/service.py`**

Replace `get_criteria`/`save_criteria` bodies: `get_criteria` → `get_active_set`. Keep
`run_screen`/`latest_screen` signatures for now (B4 changes them). Raise `ConfigError` for
duplicate names; import it from `app.screener.criteria`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_sets_service.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/screener/service.py backend/app/auth/service.py backend/tests/test_sets_service.py
git commit -m "feat: screening set service — seed, CRUD, activate, active-set criteria projection"
```

---

### Task B3: `/screen/sets` endpoints; retire `/screen/criteria`

**Files:**
- Modify: `backend/app/api/screen.py`
- Test: `backend/tests/test_sets_api.py` (create)

**Interfaces:**
- Consumes: B1 models, B2 service fns, `current_user`.
- Produces:
  - `GET /screen/sets` → `list[dict]`
  - `POST /screen/sets` (201) body `ScreeningSetCreate` → dict
  - `PUT /screen/sets/{set_id}` body `ScreeningSetUpdate`, `model_dump(exclude_unset=True)`
    → dict (404 unknown)
  - `DELETE /screen/sets/{set_id}` (204; 400 last set; 404 unknown)
  - `POST /screen/sets/{set_id}/activate` → dict (404 unknown)
  - `GET/PUT /screen/criteria` removed.

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_sets_api.py`

Use `client` + `sign_in` like `test_screen_api.py`:

```python
def test_first_get_seeds_default_screen(client, sign_in):      # one "Default", is_active true
def test_create_screen_round_trip(client, sign_in):            # 201; list contains it; it is active
def test_create_validation_errors(client, sign_in):            # blank name, dup name, shortlist_size, all-disabled criteria -> 422
def test_put_updates_and_404_for_unknown(client, sign_in):
def test_delete_last_screen_returns_400(client, sign_in):
def test_delete_screen_keeps_its_runs(client, sign_in):        # runs row keeps, set_id nulled (needs provider; can patch later in B4)
def test_activate_returns_single_active(client, sign_in):
def test_criteria_endpoints_retired(client, sign_in):          # GET and PUT /screen/criteria -> 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_sets_api.py -q`
Expected: FAIL — 404 on `/screen/sets`.

- [ ] **Step 3: Implement in `api/screen.py`**

Thin handlers: map `SetNotFoundError → HTTPException(404, "Screen not found")`,
`LastSetError → HTTPException(400, "The last screen cannot be deleted")`. `ConfigError`
stays on the global 422 handler. Delete `get_criteria`/`put_criteria` handlers and the
`CriteriaUpdate` import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_sets_api.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/screen.py backend/tests/test_sets_api.py
git commit -m "feat: /screen/sets CRUD + activate; retire /screen/criteria"
```

---

### Task B4: Run and latest per active screen

**Files:**
- Modify: `backend/app/screener/service.py` (`run_screen`, `latest_screen`)
- Modify: `backend/app/api/screen.py` (`/run`, `/latest`)
- Modify: `backend/tests/test_screen_api.py`

**Interfaces:**
- `run_screen(provider, session_factory, user: dict, criteria: list[dict], shortlist_size: int = 10, set_id: int | None = None) -> dict` — writes `ScreenRun.set_id`.
- `latest_screen(session_factory, user_id: int) -> dict | None` — filters
  `ScreenRun.set_id == active.id` (activates/creates the active set first).
- `POST /screen/run` loads the active set and passes
  `criteria=active["criteria"], shortlist_size=active["shortlist_size"], set_id=active["id"]`.

- [ ] **Step 1: Write the failing tests** — extend `backend/tests/test_screen_api.py`

```python
def test_run_stores_active_set_id(client, sign_in, provider, test_db):
    # run; ScreenRun.set_id == GET /screen/sets active id
def test_latest_scoped_to_active_set(client, sign_in, provider):
    # run on Default; create screen "Momentum" (becomes active) -> GET /screen/latest -> 404
    # run again -> latest shortlist belongs to the second run (run_ids differ)
def test_delete_screen_nullstamp_keeps_run(client, sign_in, provider, test_db):
    # run twice with a second screen; delete second screen -> its runs kept with set_id None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_screen_api.py -q`
Expected: FAIL — `set_id` not written / latest not scoped (existing tests may still pass —
the new three must fail).

- [ ] **Step 3: Implement**

`run_screen` adds `set_id` to the `ScreenRun(...)` construction. `latest_screen` resolves
`_seed_active_set` inside the session, filters by `set_id`, keeps the existing join/enrich.
`delete_set` nulls `set_id` on the deleted set's runs (`session.query(ScreenRun).filter(
ScreenRun.user_id == user_id, ScreenRun.set_id == set_id).update({"set_id": None})`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_screen_api.py -q`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add backend/app/screener/service.py backend/app/api/screen.py backend/tests/test_screen_api.py
git commit -m "feat: screen runs are scoped to the active screening set"
```

---

### Task B5: Existing suites, docs, live smoke, knowledge graph

**Files:**
- Modify: `backend/tests/test_stocks_api.py`, `backend/tests/test_stock_api.py`,
  `backend/tests/test_stock_service.py`, `backend/tests/test_auth.py`
- Delete: `backend/tests/test_criteria_api.py` (coverage lives in `test_sets_api.py`
  and `test_criteria.py`)
- Modify: `backend/BACKEND.md`, `AGENTS.md`, `PLAN.md`

**Interfaces:** no new code interfaces; this task makes the whole suite green offline.

- [ ] **Step 1: Fix the remaining `UserCriteria` fixtures**

Every insert of `UserCriteria(user_id=..., criteria_json=..., ...)` in tests becomes a
`ScreeningSet(user_id=..., name="Default", criteria_json=..., shortlist_size=10,
is_active=True, updated_at="...")`. `test_auth.py`: delete the
`test_seed_default_criteria_is_idempotent` case (the service function is gone); setup no
longer seeds anything (first `/screen/sets` read does).

- [ ] **Step 2: Full offline suite**

Run: `.\.venv\Scripts\python.exe -m pytest tests -q`
Expected: all green, zero network.

- [ ] **Step 3: Live smoke (manual, backend running; dev DB was reset in D1)**

```powershell
uvicorn app.main:app --reload
# other shell (after /auth/setup/login to get the cookie):
curl.exe -i -b cookies.txt http://localhost:8000/screen/sets               # one Default, active
curl.exe -i -b cookies.txt -X POST http://localhost:8000/screen/sets -H "Content-Type: application/json" -d "{\"name\":\"Quality\",\"thesis\":\"high ROE\"}"
curl.exe -i -b cookies.txt -X POST http://localhost:8000/screen/sets/1/activate
curl.exe -i -b cookies.txt -X POST http://localhost:8000/screen/run        # shortlist belongs to the active set
curl.exe -i -b cookies.txt http://localhost:8000/screen/latest
curl.exe -i -b cookies.txt http://localhost:8000/screen/criteria           # 404 (retired)
```

- [ ] **Step 4: Update context docs**

`BACKEND.md`: structure (`screening_sets`, `/screen/sets*`), rule 7 rewritten (criteria live
in `screening_sets`, one active per user, `shortlist_size` server-owned), phase-gate row
`1.7`. `AGENTS.md`: add `phase-1.7/` to the phase list. `PLAN.md`: add the Phase 1.7 section
+ schema line.

- [ ] **Step 5: Refresh knowledge graph**

Run from repo root: `graphify update .` — expected success, no new cycles.

- [ ] **Step 6: Commit**

```bash
git add -A backend AGENTS.md PLAN.md
git commit -m "test: migrate suites to screening sets; docs + graph sync for Phase 1.7"
```

### Task B6: Criterion bookmarks (addendum, 2026-09-29)

**Files:**
- Modify: `backend/app/screener/criteria.py`
- Modify: `backend/tests/test_criteria.py`, `backend/tests/test_screener.py`

**Interfaces:**
- `CriterionItem` gains `bookmarked: bool = False` (extra="forbid" stays; old payloads without
  the key stay valid). `criteria_from_json` / `criteria_to_json` / `validate_criteria_list`
  round-trip the flag untouched. The engine ignores it (`screen_rows` reads only
  `key`/`enabled`/`value`).

- [ ] **Step 1: Write the failing tests**

```python
def test_criterion_bookmark_defaults_false_and_round_trips():
    # CriterionItem(key="pe", enabled=True, value=25).bookmarked is False
    # criteria_from_json('[{"key":"pe","enabled":true,"value":25,"bookmarked":true}]')[-1]["bookmarked"] is True
def test_bookmark_flag_does_not_change_screening():
    # screen_rows with identical criteria ± bookmarked → identical shortlist/rejected
```

- [ ] **Step 2: Run to verify failure, implement the field, run to verify pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_criteria.py tests/test_screener.py -q`

- [ ] **Step 3: Full suite + commit**

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
git add backend/app/screener/criteria.py backend/tests/test_criteria.py backend/tests/test_screener.py
git commit -m "feat: criterion bookmark flag in criteria payloads"
```

## Acceptance

- `.\.venv\Scripts\python.exe -m pytest tests -q` green offline (sets service, sets API,
  criteria models, screen API, stocks API, stock API/service, auth).
- A user always has ≥ 1 set and exactly one active after any sequence of create/activate/
  delete; last-set delete is 400.
- `POST /screen/run` stores `set_id` + criteria snapshot; `GET /screen/latest` returns only
  the active set's latest run (404 before its first run).
- `/stocks` verdicts and `/stock/{symbol}` report unchanged in shape, sourced from the
  active set; `GET/PUT /screen/criteria` → 404.
- Docs + graph updated in the same change.
