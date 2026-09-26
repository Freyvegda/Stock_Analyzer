# Phase 1.5 — Authorization, DB-Driven Screener (Backend)

> Read `backend/BACKEND.md` first. DB details: `plan/phase-1.5/database.md`.
> Spec: `docs/superpowers/specs/2026-09-26-phase-1.5-authorization-db-screener-design.md`.

## Goal

Gate the app behind a single-account login and move screening criteria from
`config/screening.yaml` into per-user DB rows with a dynamic, code-owned ratio
catalog. Every run is user-scoped, snapshots its criteria, and never returns
more than 10 rows.

## What shipped

- `app/auth/` — `security.py` (stdlib scrypt hashing, `data/.session_secret`),
  `service.py` (create/authenticate/get user, `seed_default_criteria`),
  `deps.py` (`current_user`, 401 `Not authenticated`).
- Starlette `SessionMiddleware` (`sa_session`, 30-day, SameSite=lax, HttpOnly);
  `POST /auth/setup` 409 once a user exists.
- `app/api/auth.py` — `GET /auth/state`, `POST /auth/setup`, `POST /auth/login`
  (401 generic), `POST /auth/logout` (204), `GET /auth/me`.
- `app/screener/catalog.py` — 6 derived + 26 raw ratios, fixed direction/scale/unit
  (scales live-verified 2026-09-26 via `scripts/verify_catalog.py`).
- `app/screener/criteria.py` — pydantic validation (`extra="forbid"`,
  unknown key / duplicate / non-finite / zero-enabled / thesis > 500 / client-sent
  `shortlist_size` all 422), Phase-1 defaults, JSON round-trip, `ConfigError`.
- `app/screener/engine.py` — `evaluate_screen(rows, criteria, shortlist_size)`;
  enabled-only evaluation; raw `.info` values scaled; clamp `min(size, 10)`.
- `app/screener/service.py` — `run_screen(provider, session_factory, user, criteria,
  shortlist_size)` stores `user_id` + verbatim `criteria_json`; `latest_screen`
  filters by user; `get_criteria`/`save_criteria` (first read seeds defaults;
  corrupt JSON falls back to defaults).
- API — `GET /screen/ratios`, `GET/PUT /screen/criteria`, `POST /screen/run`,
  `GET /screen/latest`, all session-gated; `/docs`, `/model`, `/backtest` gated too.

## Retired

`config/screening.yaml`, `app/screener/config.py`, `tests/test_config.py`,
`GET /screen/config`, `POST /screen/config/reload`, `screen_runs.config_yaml`.

## Tests

`tests/test_db_models.py`, `test_catalog.py`, `test_criteria.py`, `test_auth.py`,
`test_criteria_api.py`, `test_screener.py`, `test_screen_api.py` — offline; session
cookies signed directly via `tests/conftest.py::create_session_cookie`.

## Acceptance

- `python -m pytest tests -q` green offline (90 tests at implementation time).
- `/screen/*` → 401 without cookie; public routes are `/health` + `/auth/state`,
  `/auth/setup`, `/auth/login`.
- Clamp: any stored `shortlist_size` still yields ≤ 10 rows.
