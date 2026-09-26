# Frontend Context — Stock Analyzer

> Agent context file. Read this before touching `frontend/`. Source of truth: `PLAN.md`.

## Purpose

React + TypeScript dashboard for the analysis pipeline. Three nav sections mirroring the pipeline:
1. **Fundamental Analysis** (`/`) — run screen button, criteria display (from screening.yaml), shortlist table with all ratios, sortable/filterable
2. **Documents** (`/documents`) — per shortlisted stock: document list (concall/results/presentation/audit) + AI summary cards (sentiment, guidance, red flags, parse status)
3. **Model & Backtest** (`/backtest`) — train/predict buttons, price chart with buy/sell markers, backtest report (CAGR, Sharpe, max drawdown vs Nifty)

Dense, tabular, dark-themed. This is a tool, not a marketing site.

## Stack

- React 19 + TypeScript + Vite
- react-router-dom v7 (BrowserRouter in `main.tsx`)
- Tailwind CSS v4 via `@tailwindcss/vite` plugin (NO tailwind.config.js — CSS-first, theme in `src/index.css`)
- shadcn/ui (zinc base) — components in `src/components/ui/`; add via `npx shadcn@latest add <name>`; already added: button, card, table, tabs, badge
- Charts: `lightweight-charts` (candlesticks/OHLC + signal markers), `recharts` (metric/ratio charts)
- Path alias `@/` -> `src/` (vite.config.ts + tsconfig paths, NO baseUrl — TS6 deprecated)

## Structure

```
frontend/src/
├── main.tsx            # BrowserRouter + StrictMode
├── App.tsx             # nav shell (3 NavLinks) + Routes
├── index.css           # @import "tailwindcss" + shadcn theme tokens
├── api/
│   └── client.ts       # api.get/api.post -> fetch wrapper, BASE="/api"
├── pages/
│   ├── Fundamentals.tsx
│   ├── Documents.tsx
│   └── Backtest.tsx
└── components/
    ├── ui/             # shadcn — DO NOT hand-edit unless necessary
    └── StockChart.tsx  # lightweight-charts wrapper (to be built, Phase 3)
```

## API Integration

- Dev server proxies `/api/*` -> `http://localhost:8000/*` (vite.config.ts `server.proxy`). ALWAYS call via `api.get('/screen/latest')` etc. — never hardcode `localhost:8000`.
- Backend endpoints (see BACKEND.md): `/screen/*`, `/docs/*`, `/model/*`, `/backtest/*`, `/health`.
- All pipeline stages triggered by button clicks (manual pipeline — no polling/scheduler in MVP).
- Handle `{"status":"not_implemented","phase":N}` placeholders gracefully until phases land.

## Conventions

- Dark theme: page bg `bg-zinc-950`, text `text-zinc-100`, muted `text-zinc-400`
- shadcn components for interactive elements; Tailwind utilities for layout
- Tables for dense data (shortlist, documents, signals) — sortable client-side
- StockChart props: `{ candles: {time,open,high,low,close}[], markers: {time, kind: 'buy'|'sell'}[] }`
- Type all API responses with generics: `api.get<ScreenRun>('/screen/latest')`
- Build check: `npm run build` (tsc -b && vite build) must pass; dev: `npm run dev`
- Tests (when added): vitest — table/sort logic, api client; run `npm run test`

## Phase Gates

| Phase | UI work |
|---|---|
| 1 | Fundamentals page live: run button, criteria panel, shortlist table (symbol, name, PE, PB, ROE, ROCE, D/E, market cap), fail-count display |
| 2 | Documents page: stock sub-nav -> doc list + summary cards; badge shows `analysis_method` (gemini/fallback) and parse status ("n/m parsed") |
| 3 | Signals chart: lightweight-charts candles + buy/sell markers from `/model/signals` |
| 4 | Backtest report: metric cards (CAGR/Sharpe/drawdown) + equity-curve chart (recharts) vs Nifty line |
