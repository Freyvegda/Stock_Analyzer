# Phase 4 — Backtest (Database)

> Full schema reference: `backend/app/db/DATABASE.md`. Phase 4 deltas only.

## Tables Used

### backtest_runs — write path
- One row per run. Never update — backtests are immutable history; new run = new row.
- `params_json`: `{train_years, test_months, start, end, initial_capital, max_positions, horizon_days, screen_config_snapshot, benchmark_symbol}` — everything needed to reproduce.
- Headline metrics as columns (`cagr`, `sharpe`, `max_drawdown`) → cheap list/compare queries without parsing JSON.
- `report_json` full detail:
```json
{
  "equity_curve": [{"date": "2019-04-01", "strategy": 1023000, "benchmark": 1018000}],
  "trades": [{"symbol": "TCS", "entry_date": "...", "entry_px": 0, "exit_date": "...",
              "exit_px": 0, "pnl_pct": 0.0, "reason": "sell|horizon|window_end"}],
  "win_rate": 0.0, "trade_count": 0,
  "benchmark": {"symbol": "^NSEI", "cagr": 0.0},
  "limitations": ["point-in-time fundamentals approximated"]
}
```

## Read Patterns

- List runs: `SELECT id, run_date, cagr, sharpe, max_drawdown FROM backtest_runs ORDER BY id DESC`.
- Detail: by id, parse `report_json` at service layer.

## Rules

- Equity curve in JSON: weekly points max (downsample if >~300 points) — keeps `report_json` small.
- Trades array full fidelity (expected < 1000 per run; fine for SQLite Text).

## Acceptance

- 2 runs → 2 rows, metrics queryable without JSON parsing.
- Report JSON parses and contains equity_curve + trades + benchmark.
