# Phase 1 — Fundamental Screener (Frontend)

> Read `frontend/FRONTEND.md` first. Backend endpoints: `plan/phase-1-fundamental-screen/backend.md`.

## Goal

`Fundamentals.tsx` becomes the working screen UI: view criteria → run screen → see ranked shortlist table.

## Components

### CriteriaPanel
- `GET /screen/config` on mount → render criteria as read-only badge list (`PE ≤ 25`, `ROE ≥ 15%`, ...).
- Hint text: "Edit `backend/config/screening.yaml`" + reload button → `POST /screen/config/reload`, which returns the fresh config; reload failures render in the panel (`role="alert"`). `frontend/DESIGN.md` is the design contract for tokens, icons, and motion.

### RunButton
- `POST /screen/run`. Loading state while request in flight (minutes possible — show "Fetching fundamentals for ~500 stocks, this takes a few minutes").
- On success: show summary line — `X shortlisted · Y failed · Z total` with animated `NumberTicker` numbers, then render the table. Rows come from `GET /screen/latest` (enriched with name/sector/market cap); if that call fails, fall back to the run response and toast. Zero-row runs show the `No stocks passed the screen.` empty state over `DotPattern`.
- Motion/3D decorations (`BlurFade`, `BorderBeam`, lazy `RunVisual`) are `prefers-reduced-motion` aware and never block data.

### ShortlistTable (shadcn `table`)
- Columns: Rank | Symbol | Name | Sector | PE | PB | ROE% | ROCE% | D/E | Mkt Cap (cr) | Score.
- Client-side column sorting (click header toggles asc/desc). Keep sort logic in a pure function `sortRows(rows, key, dir)` in `src/lib/sort.ts` — unit-testable.
- Pass/fail context: stocks shown all passed; show `failed: []` count implicitly. Keep it simple.
- Numbers: 1 decimal, right-aligned. D/E red badge if > 0.3 even when passed.

### State
- On mount: `GET /screen/latest` → if a run exists, render its table immediately (before any new run). A 404 means "no run yet" and is ignored; any other mount failure surfaces as an inline `role="alert"` error instead of a blank page.
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

`npm run test` (offline, jsdom, mocks only). Files: `src/lib/sort.test.ts`, `src/lib/webgl.test.ts`, `src/api/__tests__/client.test.ts`, `src/components/__tests__/{ThemeToggle,CriteriaPanel,ShortlistTable,NumberTicker,BlurFade,BorderBeam,DotPattern}.test.tsx`, `src/components/three/__tests__/{AmbientField,RunVisual}.test.tsx`, `src/pages/__tests__/Fundamentals.test.tsx`.

- `sortRows`: numeric sort, null handling (nulls last both directions), toggle direction.
- CriteriaPanel: human labels, fallback keys, reload callback, error display.
- Fundamentals: mount failures, latest-run rows, zero-row empty state, config reload via POST.

## Acceptance

- Full loop: click Run → spinner → table populated from live backend.
- Page reload shows last run without re-running.
- `npm run build` clean.
