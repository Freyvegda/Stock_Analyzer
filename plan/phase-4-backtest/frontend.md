# Phase 4 — Backtest (Frontend)

> Read `frontend/FRONTEND.md` first. Endpoints: `plan/phase-4-backtest/backend.md`. This completes the `Backtest.tsx` page (Model section on top from Phase 3, Backtest section below).

## Components

### RunBacktest button
- `POST /backtest/run`. Long-running (minutes) — prominent busy state: "Running walk-forward backtest 2019–2024…". No progress bar in MVP (synchronous endpoint).

### MetricsCards (shadcn `card` × 4)
- CAGR (strategy vs benchmark, e.g. `18.2% vs 12.1%`), Sharpe, Max Drawdown (red), Win Rate + trade count.
- Green/red coloring vs benchmark on CAGR card.

### EquityCurve chart — recharts `LineChart`
- Two lines: strategy (blue), benchmark (zinc dashed). X = date, Y = portfolio value.
- Dark theme: transparent bg, zinc grid/tooltip. Height ~320px.
- Data from `GET /backtest/{id}` → `report_json.equity_curve`.

### TradesTable (shadcn `table`, collapsible)
- Columns: Symbol | Entry date | Entry ₹ | Exit date | Exit ₹ | P&L % (green/red) | Exit reason.
- Default collapsed ("Show N trades"); reuse `sortRows` from Phase 1.

### Run history
- Dropdown/row list of past runs (`id`, `run_date`, headline metrics) → selecting loads that run's detail. Needs a `GET /backtest` list endpoint — add to backend file when implementing (small addition, note it).

## Types (extend `src/api/types.ts`)

```ts
export interface EquityPoint { date: string; strategy: number; benchmark: number }
export interface Trade { symbol: string; entry_date: string; entry_px: number;
  exit_date: string; exit_px: number; pnl_pct: number; reason: string }
export interface BacktestReport { equity_curve: EquityPoint[]; trades: Trade[];
  win_rate: number; trade_count: number; benchmark: { symbol: string; cagr: number } }
export interface BacktestRun { id: number; run_date: string; cagr: number | null;
  sharpe: number | null; max_drawdown: number | null; report: BacktestReport | null }
```

## Tests (vitest)

- Report DTO parsing/mapping functions.
- P&L % formatting + color logic.

## Acceptance

- Run → cards + equity curve + trades table populated; benchmark line visible.
- Reload page → can reopen last run from history without re-running.
- `npm run build` clean. Phase 4 done = app feature-complete per PLAN.md.
