# Phase 1.5 — Backend (auth, per-user DB criteria, dynamic ratio catalog)

> **For agentic workers:** part of the Phase 1.5 plan. Required sub-skill when executing:
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use
> checkbox (`- [ ]`) syntax.
>
> **Spec:** `docs/superpowers/specs/2026-09-26-phase-1.5-authorization-db-screener-design.md`.
> Schema first: `plan/phase-1.5-authorization-db-screener/database.md` (Task D1).
> Frontend contract: `plan/phase-1.5-authorization-db-screener/frontend.md`.

**Goal:** single-account auth (scrypt + signed session cookie), screener criteria stored per
user in the DB, dynamic yfinance-backed ratio catalog, user-scoped screen runs, YAML retired.

**Architecture:** new `app/auth/` package (security, service, deps) + thin `app/api/auth.py`.
Criteria live in `user_criteria.criteria_json`; validation in `app/screener/criteria.py`;
valid keys + resolution rules in `app/screener/catalog.py`. `SessionMiddleware` signs the
`sa_session` cookie. Every `/screen/*`, `/docs/*`, `/model/*`, `/backtest/*` endpoint depends
on `current_user`.

**Tech stack:** FastAPI, SQLAlchemy 2.x, `itsdangerous` (new), stdlib `hashlib.scrypt`,
pydantic v2.

## Global Constraints

- Work dir: `backend/` (venv active). Tests: `.\.venv\Scripts\python.exe -m pytest tests -q`.
- Install new dep with `pip install --isolated itsdangerous` (user pip.ini is broken).
- Tests run OFFLINE; mock all network. TestClient + temp SQLite, like `tests/test_screen_api.py`.
- BACKEND.md architectural rules stay: DataProvider boundary, thin API layer (logic in
  services), per-stock failure isolation, composite PK idempotency, no hardcoded ratios.
- Exactly these auth values: scrypt `n=2**14, r=8, p=1`, 16-byte salt, 32-byte key; password
  min 8 chars; username 3–32 chars stored lowercase; cookie name `sa_session`, `max_age`
  30 days, SameSite=lax, HttpOnly (SessionMiddleware default), `https_only=False`.
- Session secret: env `STOCK_ANALYZER_SESSION_SECRET` wins; else `data/.session_secret`
  (create with `secrets.token_urlsafe(32)` on first use).
- `Shortlist size` is server-owned: default 10, engine clamps `min(value, 10)`; a client
  sending `shortlist_size` gets 422.
- Catalog: only numeric `.info` fields; missing/NaN/boolean → `None` → criterion fails.
- 401 body is exactly `{"detail": "Not authenticated"}`; login failure is exactly
  `{"detail": "Invalid username or password"}`.
- Do not touch `frontend/` in this plan; it has its own plan file.

## Review Focus

Failure modes the spec implies; each gets a test in the task named here.

1. Two-user isolation: criteria and runs never leak — Task B5 (`test_latest_scoped_to_user`, `test_run_snapshot_stores_user`).
2. Tampered `shortlist_size > 10` still yields ≤ 10 rows — Task B4 (`test_shortlist_clamped_to_ten`).
3. `user_criteria` missing (user never opened UI) → run seeds defaults, never crashes — Task B4/B5 (`test_run_seeds_criteria_when_missing`).
4. Missing raw catalog field on some stocks → only those stocks fail that criterion, run continues — Task B4 (`test_raw_criterion_missing_value_fails_stock`).
5. Session cookie tampered/expired → clean 401, no 500 traceback — Task B2 (`test_tampered_cookie_is_401`).
6. NaN/Inf thresholds in payload → 422, never stored — Task B3 (`test_rejects_nan_value`).

---

### Task B1: Auth primitives (scrypt hashing, session secret, user service)

**Files:**
- Create: `backend/app/auth/__init__.py` (empty), `backend/app/auth/security.py`,
  `backend/app/auth/service.py`
- Test: `backend/tests/test_auth_service.py`

**Interfaces:**
- Produces (used by B2+):
  - `security.hash_password(password: str) -> str`
  - `security.verify_password(password: str, stored: str) -> bool`
  - `security.get_session_secret() -> str`
  - `service.create_user(session, username: str, password: str) -> User` (raises `ValueError` on bad input/duplicate)
  - `service.authenticate(session, username: str, password: str) -> User | None`
  - `service.DEFAULT_CRITERIA: list[dict]` — `[{"key": "pe", "enabled": True, "value": 25}, ...]`
    for `pe 25, pb 5, roe 15, roce 15, debt_to_equity 0.5, market_cap 1000`
  - `service.get_or_create_criteria(session, user_id: int) -> UserCriteria`

- [ ] **Step 1: Write the failing tests — `backend/tests/test_auth_service.py`**

```python
def test_hash_round_trip_and_format():
    h = hash_password("s3cret-pass")
    assert h.startswith("scrypt$16384$8$1$")
    assert len(h.split("$")) == 6
    assert verify_password("s3cret-pass", h) is True
    assert verify_password("wrong-pass", h) is False

def test_verify_rejects_malformed_hash():
    assert verify_password("x", "not-a-hash") is False

def test_session_secret_env_override(monkeypatch):
    monkeypatch.setenv("STOCK_ANALYZER_SESSION_SECRET", "unit-secret")
    assert get_session_secret() == "unit-secret"

def test_session_secret_file_created(tmp_path, monkeypatch):
    # monkeypatch security.SESSION_SECRET_PATH to tmp_path/".session_secret"
    # two calls return same value and the file exists

def test_create_user_normalizes_and_rejects_duplicates():
    # fresh temp session; create_user(s, "  Alice ", "password1") -> username "alice"
    # duplicate create_user(s, "alice", "password1") raises ValueError

def test_create_user_password_policy():
    # "short" (<8) raises ValueError; username "ab"/"x"*33 raises ValueError

def test_authenticate_ok_and_wrong_password():
    # create then authenticate(s, "alice", "password1") returns User
    # authenticate(s, "alice", "nope") returns None; unknown user returns None

def test_get_or_create_criteria_seeds_defaults():
    # first call creates row with DEFAULT_CRITERIA (missing pe value? no) and size 10
    # second call returns same row id/values (idempotent), thesis None
```

Use the shared `db_session` fixture you add to `tests/conftest.py` in Step 3
(sessionmaker over a `tmp_path` SQLite engine with `Base.metadata.create_all`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_auth_service.py -q`
Expected: FAIL — `app.auth` does not exist.

- [ ] **Step 3: Implement `security.py`, `service.py`, and the conftest fixture**

- `security.py`: constants `SCRYPT_N, SCRYPT_R, SCRYPT_P, SALT_BYTES, KEY_BYTES`;
  `hash_password` = `os.urandom(16)` salt → `hashlib.scrypt(...)` → format string;
  `verify_password` parses the 6 parts, recomputes with the stored params, compares with
  `secrets.compare_digest`, returns `False` on any parse/value error;
  `SESSION_SECRET_PATH = Path(__file__).resolve().parents[3] / "data" / ".session_secret"`;
  `get_session_secret()` checks the env var first, else reads the file, creating it
  (`parents=True`, `exist_ok=True`) with `secrets.token_urlsafe(32)`.
- `service.py`: `create_user` (trim + lowercase username, validate lengths, hash, `session.add`,
  `commit`, `refresh`), `authenticate` (lookup, `verify_password`), `DEFAULT_CRITERIA`,
  `get_or_create_criteria` (`session.get(UserCriteria, user_id)` else create with
  `json.dumps(DEFAULT_CRITERIA)` and `datetime.now(UTC).isoformat()`).
- `tests/conftest.py`: add a `db_session` fixture + keep the file import-light (B6 removes the
  old `config_bundle` fixture; until then leave it). Also set
  `os.environ.setdefault("STOCK_ANALYZER_SESSION_SECRET", "test-secret")` at module top so
  `app.main` never creates a real secret file in tests.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_auth_service.py -q`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth backend/tests/test_auth_service.py backend/tests/conftest.py
git commit -m "feat: scrypt password hashing, session secret, user + default criteria service"
```

---

### Task B2: Auth endpoints, session middleware, route guard

**Files:**
- Create: `backend/app/auth/deps.py`, `backend/app/api/auth.py`
- Modify: `backend/app/main.py`, `backend/requirements.txt`, `backend/tests/conftest.py`
- Test: `backend/tests/test_auth_api.py`

**Interfaces:**
- Consumes: B1 `security.get_session_secret`, `service.create_user/authenticate`.
- Produces:
  - `deps.current_user(request: Request) -> dict` — returns `{"id": int, "username": str}`;
    raises `HTTPException(401, "Not authenticated")` when the session has no valid user.
  - Endpoints `GET /auth/state`, `POST /auth/setup`, `POST /auth/login`, `POST /auth/logout`,
    `GET /auth/me` exactly as in the spec's API table (setup 201, login 200, logout 204).
  - `tests/conftest.py` fixture `authed_client(db_session monkeypatch...)` returning a
    `TestClient(app)` that has completed `POST /auth/setup`.

- [ ] **Step 1: Write the failing tests — `backend/tests/test_auth_api.py`**

```python
def test_state_reports_no_users(anon_client):        # {"users_exist": False, "user": None}
def test_setup_creates_user_and_session(anon_client): # 201; then GET /auth/me -> 200 same username
def test_setup_twice_conflicts(authed_client):        # POST /auth/setup -> 409
def test_login_success_and_failure(anon_client, db_session_with_user):  # 200; wrong pw -> 401 detail exact
def test_me_requires_session(anon_client):            # 401 {"detail": "Not authenticated"}
def test_logout_clears_session(authed_client):        # 204; then /auth/me -> 401
def test_setup_rejects_short_password(anon_client):   # 422
def test_screen_requires_auth(anon_client):           # GET /screen/latest -> 401
def test_tampered_cookie_is_401(anon_client):         # client.cookies.set("sa_session", "garbage") -> 401
```

`anon_client` fixture: `TestClient(app)` with `app.api.screen.SessionLocal` /
`init_db` patched the same way `test_screen_api.py` does (temp engine).

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_auth_api.py -q`
Expected: FAIL — 404 on `/auth/*`.

- [ ] **Step 3: Implement**

- `deps.py`: read `request.session.get("user_id")`; query the DB via `SessionLocal`; 401 if
  missing/unknown.
- `api/auth.py`: pydantic bodies `SetupBody{username, password}`, `LoginBody{username, password}`
  (`min_length=8` on password). `setup` → 409 when `session.query(User).first()` exists; on
  success set `request.session["user_id"]/["username"]` and call
  `service.get_or_create_criteria`. `login` → `authenticate`, else 401 with the exact generic
  detail; success sets the session. `logout` → `request.session.clear()`.
  `state` → `{"users_exist": bool, "user": {"id", "username"} | None from session}`.
- `main.py`: `SessionMiddleware` with `secret_key=get_session_secret()`,
  `session_cookie="sa_session"`, `max_age=60 * 60 * 24 * 30`, `same_site="lax"`,
  `https_only=False`; include `auth.router` at prefix `/auth`; add
  `dependencies=[Depends(current_user)]` to the `docs`, `signals`, `backtest` routers and
  per-endpoint `user: dict = Depends(current_user)` params on `screen.router` endpoints
  (screen service still receives the Phase-1 signature until B5).
- `requirements.txt`: add `itsdangerous`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_auth_api.py -q`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth/deps.py backend/app/api/auth.py backend/app/main.py backend/requirements.txt backend/tests/test_auth_api.py backend/tests/conftest.py
git commit -m "feat: auth endpoints, signed session cookie, current_user guard on pipeline routes"
```

---

### Task B3: Ratio catalog + criteria validation models

**Files:**
- Create: `backend/app/screener/catalog.py`, `backend/app/screener/criteria.py`
- Test: `backend/tests/test_catalog.py`, `backend/tests/test_criteria.py`

**Interfaces:**
- Produces:
  - `catalog.RatioSpec(BaseModel)` fields `key, label, yf_field: str | None, source: Literal["derived","raw"], direction: Literal["min","max"], scale: float, unit: str, category: str`
  - `catalog.RATIO_CATALOG: list[RatioSpec]`, `catalog.CATALOG_BY_KEY: dict[str, RatioSpec]`
  - `catalog.resolve_value(spec: RatioSpec, row: dict) -> float | None`
  - `criteria.CriterionItem{key: str, enabled: bool, value: float}` (`extra="forbid"`, `allow_inf_nan=False`)
  - `criteria.CriteriaUpdate{criteria: list[CriterionItem] (1..50), thesis: str | None (≤500)}`, `extra="forbid"`
  - `criteria.validate_criteria(payload: CriteriaUpdate) -> list[dict]` — raises `ConfigError`
  - `criteria.ConfigError` (moved here from `config.py`; `main.py` handler import updates in B6)

- [ ] **Step 1: Write the failing tests**

`test_catalog.py`:

```python
def test_catalog_keys_unique_and_complete():
    keys = [s.key for s in RATIO_CATALOG]
    assert len(keys) == len(set(keys))
    assert set(DERIVED_KEYS) == {"pe", "pb", "roe", "roce", "debt_to_equity", "market_cap"}
    assert all(s.yf_field for s in RATIO_CATALOG if s.source == "raw")

def test_catalog_fields_non_empty():
    for s in RATIO_CATALOG:
        assert s.label and s.unit and s.category
        assert s.direction in {"min", "max"} and s.scale > 0

def test_resolve_derived_reads_row_scaled_row():
    spec = CATALOG_BY_KEY["roe"]
    assert resolve_value(spec, {"roe": 18.5, "raw": {}}) == 18.5

def test_resolve_raw_applies_scale_and_rejects_junk():
    spec = CATALOG_BY_KEY["returnOnAssets"]      # scale 100
    assert resolve_value(spec, {"raw": {"returnOnAssets": 0.08}}) == pytest.approx(8.0)
    assert resolve_value(spec, {"raw": {"returnOnAssets": None}}) is None
    assert resolve_value(spec, {"raw": {"returnOnAssets": True}}) is None
    assert resolve_value(spec, {"raw": {"returnOnAssets": float("nan")}}) is None
    assert resolve_value(spec, {"raw": {}}) is None
```

`test_criteria.py`: valid payload passes; unknown key, duplicate key, zero enabled,
`test_rejects_nan_value` (`value=float("nan")`), `value=float("inf")`, `thesis` 501 chars,
`shortlist_size` in payload → each raises/422 (`validate_criteria` raises `ConfigError`;
models raise `ValidationError`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_catalog.py tests/test_criteria.py -q`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement**

Catalog: six `derived` entries (`pe`/`pb` unit `×` direction `max`; `roe`/`roce` unit `%`
direction `min`; `debt_to_equity` unit `×` direction `max`; `market_cap` unit `₹ cr`
direction `min`) plus the spec's ~26 `raw` entries with sensible default direction/scale
per field (`dividendYield`, `payoutRatio` and other fraction-percent fields get a TODO-free
value decided here; final scales pinned in Task B6's live check). `resolve_value`: derived →
`row.get(key)`; raw → `raw = row.get("raw") or {}`, reject `bool`, non-numeric, `math.isnan`,
`not math.isfinite`; return `float(v) * spec.scale`.

Criteria: run pydantic validation, then `validate_criteria` checks unknown keys, duplicates,
and `any(enabled)`; raises `ConfigError` with a message naming offenders.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_catalog.py tests/test_criteria.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/screener/catalog.py backend/app/screener/criteria.py backend/tests/test_catalog.py backend/tests/test_criteria.py
git commit -m "feat: yfinance ratio catalog and DB-backed criteria validation"
```

---

### Task B4: Dynamic-criteria engine + service user scoping

**Files:**
- Modify: `backend/app/screener/engine.py`, `backend/app/screener/service.py`
- Modify: `backend/tests/test_screener.py`

**Interfaces:**
- Produces:
  - `engine.SHORTLIST_MAX = 10`
  - `engine.evaluate_screen(rows: list[dict], criteria: list[dict], shortlist_size: int = 10) -> tuple[list[dict], list[dict]]`
  - `service.run_screen(provider, session_factory, user_id: int, criteria: list[dict], shortlist_size: int) -> dict`
  - `service.latest_screen(session_factory, user_id: int) -> dict | None`

- [ ] **Step 1: Rewrite `tests/test_screener.py` for the new signature**

Replace `config` dicts with criteria lists, e.g.
`[{"key": "pe", "enabled": True, "value": 25}, ...]`. Keep the hand-computed ranking
fixture. Add:

```python
def test_disabled_criterion_is_skipped(): ...        # stock with pe=999 passes when pe disabled
def test_raw_criterion_uses_catalog_scale(): ...     # raw={"returnOnAssets": 0.08}, roa_min 5 -> passes
def test_raw_criterion_missing_value_fails_stock(): ...   # raw={} -> rejected with ["returnOnAssets"]
def test_rejection_lists_criterion_keys(): ...       # failed == ["pe", "roe"]
def test_shortlist_clamped_to_ten(): ...             # 12 survivors, shortlist_size=50 -> len == 10
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_screener.py -q`
Expected: FAIL — engine still takes the old dict config.

- [ ] **Step 3: Implement engine + service changes**

- `engine.py`: drop `CRITERIA`/`_criteria_limits`; iterate `enabled` items; value via
  `catalog.resolve_value(CATALOG_BY_KEY[item["key"]], row)`; `min` → `value >= threshold`,
  `max` → `value <= threshold`; `None` fails. Rank unchanged
  (`roe + roce − 20 × debt_to_equity`, missing → 0); `size = min(int(shortlist_size), SHORTLIST_MAX)`.
- `service.py`: `run_screen` takes `user_id`, `criteria`, `shortlist_size`; writes
  `user_id=user_id`, `criteria_json=json.dumps(criteria)`; `latest_screen` filters
  `ScreenRun.user_id == user_id`. `read_config_text()` import removed.
  Delete `app/screener/config.py` at the end of this task only if `tests/test_screen_api.py`
  is already updated in B5 — otherwise remove the import and leave the file until B5/B6.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_screener.py -q`
Expected: PASS (existing + 5 new tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/screener/engine.py backend/app/screener/service.py backend/tests/test_screener.py
git commit -m "feat: evaluate screens from per-user dynamic criteria with raw yfinance resolution"
```

---

### Task B5: Screen endpoints — ratios, criteria CRUD, user-scoped run/latest

**Files:**
- Modify: `backend/app/api/screen.py`, `backend/tests/test_screen_api.py`
- Test: `backend/tests/test_criteria_api.py` (create)

**Interfaces:**
- Consumes: B3 `validate_criteria`, `CriteriaUpdate`, `RATIO_CATALOG`; B2 `current_user`;
  B4 service signatures; `service.get_or_create_criteria` (B1).
- Produces: the spec's endpoint table — `GET /screen/ratios`, `GET /screen/criteria`,
  `PUT /screen/criteria`, `POST /screen/run`, `GET /screen/latest`; removed
  `GET /screen/config`, `POST /screen/config/reload`.

- [ ] **Step 1: Write failing tests — `tests/test_criteria_api.py`**

```python
def test_ratios_returns_catalog(authed_client): ...            # list; every item has key/label/unit/category/direction
def test_first_read_seeds_defaults(authed_client): ...         # pe=25, pb=5, roe=15, roce=15, d/e=0.5, mcap=1000, size 10
def test_put_round_trip(authed_client): ...                    # PUT custom list + thesis -> GET equals payload
def test_put_validation_errors(authed_client): ...             # unknown key, dup, zero enabled, nan, thesis>500, shortlist_size -> 422
def test_criteria_isolation(db_session): ...                   # two authed clients, different criteria, no leak
```

Extend `tests/test_screen_api.py`: replace YAML-based fixtures with a criteria list; add

```python
def test_run_stores_criteria_snapshot(authed_client, ...): ...  # row.user_id + json.loads(criteria_json) == payload
def test_run_seeds_criteria_when_missing(authed_client, ...): ...  # delete user_criteria row -> run still works, row recreated
def test_latest_scoped_to_user(...): ...                        # user A latest != user B latest
def test_latest_404_for_new_user(authed_client): ...            # other user with no runs -> 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_criteria_api.py tests/test_screen_api.py -q`
Expected: FAIL — `/screen/criteria` 404, validation missing.

- [ ] **Step 3: Implement `api/screen.py`**

Thin handlers only: `GET /ratios` → `[spec.model_dump() for spec in RATIO_CATALOG]`;
`GET /criteria` → `get_or_create_criteria(SessionLocal(), user["id"])` → parsed dict;
`PUT /criteria` → `validate_criteria(CriteriaUpdate.model_validate(body))` → update row +
`updated_at` → return saved shape; `POST /run` → load-or-create criteria row, call
`service.run_screen(get_provider(), SessionLocal, user["id"], criteria, row.shortlist_size)`;
`GET /latest` → `service.latest_screen(SessionLocal, user["id"])` (404 when `None`).
Delete the `/config` and `/config/reload` handlers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_criteria_api.py tests/test_screen_api.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/screen.py backend/tests/test_criteria_api.py backend/tests/test_screen_api.py
git commit -m "feat: per-user criteria CRUD, ratio catalog endpoint, user-scoped screen runs"
```

---

### Task B6: Retire YAML, pin catalog scales live, remove dead code

**Files:**
- Delete: `backend/config/screening.yaml`, `backend/app/screener/config.py`, `backend/tests/test_config.py`
- Modify: `backend/app/main.py` (ConfigError import → `app.screener.criteria`),
  `backend/tests/conftest.py` (drop `config_bundle` fixture if still present)
- Modify: `backend/app/screener/catalog.py` (scale/unit fixes from live check)

**Interfaces:**
- Consumes: everything above.
- Produces: no runtime path reads YAML; `ConfigError` lives only in `app/screener/criteria.py`.

- [ ] **Step 1: Grep gate (must be empty) before deleting**

```powershell
rg -n "screening\.yaml|config_yaml|read_config_text|load_config|reload_config|/screen/config" backend --glob "!__pycache__"
```
Expected: only the files being deleted + `tests/test_config.py` + doc references.

- [ ] **Step 2: Verify catalog scales against live yfinance (one-off, manual)**

```powershell
.\.venv\Scripts\python.exe -c "import yfinance as yf; i=yf.Ticker('RELIANCE.NS').info; print({k: i.get(k) for k in ['returnOnAssets','dividendYield','payoutRatio','profitMargins','revenueGrowth','currentRatio','payoutRatio','heldPercentInstitutions','beta','bookValue','trailingEps']})"
```
Compare each printed value with `unit`/`scale` in `RATIO_CATALOG` (e.g. fraction → `0.08`
must be `%` with scale 100). Fix `scale`/`unit` in the catalog where the interpretation is
wrong. Record the pinned values in a short comment block at the top of `catalog.py`.

- [ ] **Step 3: Delete + rewire, then run the full suite**

```powershell
Remove-Item config\screening.yaml, app\screener\config.py, tests\test_config.py
.\.venv\Scripts\python.exe -m pytest tests -q
```
Update every remaining import to `from app.screener.criteria import ConfigError` (or the
validation helpers). Expected: full suite PASS, no import errors.

- [ ] **Step 4: Final grep gate**

```powershell
rg -n "screening\.yaml|config_yaml|read_config_text|load_config|reload_config|/screen/config" backend frontend --glob "!__pycache__"
```
Expected: no matches outside `plan/` and `docs/`.

- [ ] **Step 5: Commit**

```bash
git add -A backend
git commit -m "refactor: retire screening.yaml and config endpoints; pin catalog scales from live yfinance"
```

---

### Task B7: Verification + context docs

**Files:**
- Modify: `backend/BACKEND.md`, `backend/app/db/DATABASE.md` (if not already), `AGENTS.md`,
  `PLAN.md`

- [ ] **Step 1: Full offline suite**

Run: `.\.venv\Scripts\python.exe -m pytest tests -q`
Expected: all green, zero network (tests would hang/fail otherwise).

- [ ] **Step 2: Live smoke (manual, backend running)**

```powershell
uvicorn app.main:app --reload
# other shell:
curl.exe -i http://localhost:8000/screen/latest        # 401
curl.exe -i -X POST http://localhost:8000/auth/setup -H "Content-Type: application/json" -d "{\"username\":\"vaibhav\",\"password\":\"changeme123\"}"  # 201 + set-cookie
curl.exe -i -b cookies.txt http://localhost:8000/auth/me
```
Expected: 401 without cookie; 201 with `sa_session` cookie; `/auth/me` 200 with cookie.

- [ ] **Step 3: Update context docs**

BACKEND.md: structure (auth package, catalog/criteria modules), rules 7 replaced (criteria in
DB per user, never hardcoded, YAML gone), phase-gate row for 1.5. DATABASE.md already updated
in D1. AGENTS.md + PLAN.md: add Phase 1.5 to the phase lists.

- [ ] **Step 4: Refresh knowledge graph**

Run: `graphify update .` (from repo root). Expected: succeeds; no new cycles reported.

- [ ] **Step 5: Commit**

```bash
git add backend/BACKEND.md backend/app/db/DATABASE.md AGENTS.md PLAN.md
git commit -m "docs: sync backend context and phase lists with Phase 1.5"
```

## Acceptance

- `.\.venv\Scripts\python.exe -m pytest tests -q` green offline (auth, criteria API, catalog,
  engine, screen API, provider, DB models).
- No cookie → 401 on every pipeline route; setup creates one user; second setup 409.
- `PUT /screen/criteria` round-trips; 422 for unknown/duplicate/NaN/zero-enabled/oversized
  payloads and for a client-supplied `shortlist_size`.
- Run stores `user_id` + `criteria_json`; `/screen/latest` is per-user; ≤ 10 rows always.
- `backend/config/screening.yaml` gone; grep gate clean; `ConfigError` handler still returns
  422 with human-readable detail.
- `graphify update .` run; BACKEND.md / DATABASE.md / AGENTS.md / PLAN.md synced.
