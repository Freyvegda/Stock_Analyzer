# Phase 3 — Price Model (Frontend)

> Read `frontend/FRONTEND.md` first. Endpoints: `plan/phase-3-price-model/backend.md`.

## Goal

`Backtest.tsx` top half becomes Model section: stock picker → train/predict buttons → candlestick chart with signal markers.

## Components

### ModelControls
- Stock selector (shortlist from `GET /screen/latest`; shadcn `tabs` or simple `<select>`-style button row — keep consistent with Documents page: tabs).
- `Train` → `POST /model/train` {symbol}; shows returned sanity accuracy. `Predict` → `POST /model/predict`; refreshes signals.

### StockChart (`src/components/StockChart.tsx`) — lightweight-charts
- Props: `{ candles: Candle[], markers: Marker[] }`.
  ```ts
  export interface Candle { time: string; open: number; high: number; low: number; close: number }
  export interface Marker { time: string; kind: 'buy' | 'sell' }
  ```
- `createChart` in `useEffect`, `addCandlestickSeries`, dark theme matching zinc-950 (`layout: { background: '#09090b', textColor: '#e4e4e7' }`).
- Markers via `series.setMarkers`: buy = green arrow up below bar, sell = red arrow down above bar.
- Cleanup: `chart.remove()` on unmount. Resize via ResizeObserver on container.
- Data: `GET /model/prices?symbol=` (candles) + `GET /model/signals?symbol=` (markers).

### Signal summary strip
- Latest signal badge (buy green / sell red / hold zinc) + confidence % + date.

## Notes

- Do NOT use recharts for candles — recharts is for metric charts (Phase 4 equity curve).
- Chart height ~420px, full width of content area.

## Tests (vitest)

- Pure mapping functions: API price rows → `Candle[]`, signal rows → `Marker[]` (filter to buy/sell only, skip hold).
- Chart component itself: smoke render with mocked lightweight-charts (or skip — mapping purity covers logic).

## Acceptance

- Select stock → Train → accuracy shown → Predict → latest signal badge + marker on chart.
- Candles render for full 5y range, scroll/zoom work (built into lightweight-charts).
- `npm run build` clean.
