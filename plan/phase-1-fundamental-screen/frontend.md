# Phase 1 — Fundamental Screener (Frontend)

> Read `frontend/FRONTEND.md` first. Backend endpoints: `plan/phase-1-fundamental-screen/backend.md`.

## Goal

`Fundamentals.tsx` becomes the working screen UI: view criteria → run screen → see ranked shortlist table.

## Components

### CriteriaPanel
- `GET /screen/config` on mount → render criteria as read-only badge list (`PE ≤ 25`, `ROE ≥ 15%`, ...).
- Hint text: "Edit `backend/config/screening.yaml`" + reload button → `POST /screen/config/reload`, refresh panel.

### RunButton
- `POST /screen/run`. Loading state while request in flight (minutes possible — show "Fetching fundamentals for ~500 stocks, this takes a few minutes").
- On success: show summary line — `X shortlisted · Y failed · Z total`, then render table.

### ShortlistTable (shadcn `table`)
- Columns: Rank | Symbol | Name | Sector | PE | PB | ROE% | ROCE% | D/E | Mkt Cap (cr) | Score.
- Client-side column sorting (click header toggles asc/desc). Keep sort logic in a pure function `sortRows(rows, key, dir)` in `src/lib/sort.ts` — unit-testable.
- Pass/fail context: stocks shown all passed; show `failed: []` count implicitly. Keep it simple.
- Numbers: 1 decimal, right-aligned. D/E red badge if > 0.3 even when passed.

### State
- On mount: `GET /screen/latest` → if a run exists, render its table immediately (before any new run).
- Local `useState` sufficient — no global store.

## Types (`src/api/types.ts` — create)

```ts
export interface ScreenConfig { criteria: Record<string, number>; shortlist_size: number }
export interface ShortlistRow { symbol: string; rank: number; score: number;
  ratios: { pe: number | null; pb: number | null; roe: number | null; roce: number | null; debt_to_equity: number | null };
  name?: string; sector?: string; market_cap?: number | null }
export interface FailedDetail { symbol: string; failed: string[] }
export interface ScreenRunResult { run_id: number; shortlisted: ShortlistRow[]; failed_count: number;
  failed_symbols?: string[]; failed_details?: FailedDetail[]; stale?: boolean; total: number }
```

## Tests (vitest)

- `sortRows`: numeric sort, null handling (nulls last both directions), toggle direction.
- CriteriaPanel renders config entries.

## Acceptance

- Full loop: click Run → spinner → table populated from live backend.
- Page reload shows last run without re-running.
- `npm run build` clean.
