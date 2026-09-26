# Phase 4 — Backtest (Backend)

> Read `backend/BACKEND.md` first. This phase validates the whole strategy — the number that matters.

## Goal

Walk-forward backtest 2019–2024: replay the full pipeline historically (screen → model → trade sim), report CAGR / Sharpe / max drawdown / win rate vs Nifty 500 buy-and-hold.

## Tasks

1. **`backtest/walkforward.py`**:
   - Config: `train_years=3`, `test_months=3`, `start="2019-01-01"`, `end="2024-12-31"`, `initial_capital=1_000_000`, `max_positions=10`, `horizon_days=21` (match features target).
   - Loop: at each test window start:
     a. Rebuild screen from fundamentals known BEFORE window start (point-in-time — no lookahead. v1 simplification: use earliest fundamentals snapshot ≤ window start; document limitation).
     b. Train XGBoost on price data < window start.
     c. Within window: enter on `buy` (equal weight, next-day open), exit on `sell` or `horizon_days` or window end.
   - Trade log: `{symbol, entry_date, entry_px, exit_date, exit_px, pnl_pct, reason}`.
   - Metrics: CAGR, Sharpe (daily rf=0), max drawdown, win rate, trade count. Benchmark: Nifty 500 index (`^CRSLDX` if available via yfinance, else Nifty 50 `^NSEI` — record which in report).
   - Pure module — no FastAPI imports. Returns report dict.

2. **`api/backtest.py`**:
   - `POST /backtest/run`: run walk-forward (synchronous; ~minutes — acceptable MVP), insert `backtest_runs` (params snapshot + metrics + report_json with equity curve + trades). Return summary.
   - `GET /backtest/{id}`: full row incl. parsed report.

## Lookahead Rules (critical)

- Features at date T use only data ≤ T. Signals trade at T+1 open.
- Fundamentals: only snapshots dated ≤ window start.
- Document these in code comments; a backtest that cheats is worse than none.

## Tests

- Metrics math: known equity curve → hand-computed CAGR/Sharpe/drawdown.
- Trade sim: fixture prices + forced signals → expected P&L.
- Walk-forward on 1 synthetic stock, short windows (train 60d / test 20d) → completes, report shape correct.
- **Integration**: 3 fixture stocks, mocked providers, full pipeline screen→model→backtest offline.

## Acceptance

- `POST /backtest/run` on real data completes; report shows strategy vs benchmark side by side.
- Honest negative result is a valid outcome — report it, don't tune to fake a win.
- pytest green offline.
