# Phase 1.5 — Database Deltas

> Full schema reference: `backend/app/db/DATABASE.md`. This file = only Phase 1.5 deltas.

## New tables

### users
| Column | Type | Notes |
|---|---|---|
| id | Int PK autoincrement | |
| username | String unique, NOT NULL | trimmed, lowercased, 3–32 chars |
| password_hash | String NOT NULL | `scrypt$n$r$p$salt$hash` |
| created_at | String NOT NULL | ISO date-time |

One row in practice (`POST /auth/setup` 409s once any user exists); schema is
multi-user-ready.

### user_criteria
| Column | Type | Notes |
|---|---|---|
| user_id | Int PK, FK → users.id | one row per user |
| criteria_json | Text NOT NULL | `[{key, enabled, value}]`; keys from `screener/catalog.py` |
| thesis | Text? | ≤ 500 chars |
| shortlist_size | Int NOT NULL default 10 | server-set; engine clamps to `min(value, 10)` |
| updated_at | String NOT NULL | ISO date-time |

First `GET /screen/criteria` seeds the Phase-1 defaults
(`pe 25, pb 5, roe 15, roce 15, debt_to_equity 0.5, market_cap 1000`, all enabled).

## Altered table

### screen_runs (dev DB is disposable — no migration)
- Added: `user_id` Int NOT NULL, indexed, FK → users.id.
- Added: `criteria_json` Text NOT NULL — verbatim criteria used by the run.
- Dropped: `config_yaml`.
- Read pattern: latest run = `WHERE user_id = ? ORDER BY id DESC LIMIT 1`.

## Not a table

`data/.session_secret` — file holding the cookie-signing secret (gitignored via
`/data/`); deleting/rotating it invalidates all sessions.

## Rules

- Writes via SQLAlchemy `SessionLocal()`; composite-PK merges unchanged for
  `fundamentals`; `user_criteria` is a plain PK upsert.
- No migrations tool: delete `data/stockanalyzer.db` → `init_db()` rebuilds.
