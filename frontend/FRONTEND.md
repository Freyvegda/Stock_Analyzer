# Frontend Context — Stock Analyzer

> Agent context file. Read this before touching `frontend/`. Source of truth: `PLAN.md`.

## Purpose

React + TypeScript dashboard for the analysis pipeline. Three nav sections mirroring the pipeline:
1. **Fundamental Analysis** (`/`) — run screen button, per-user criteria panel fed by `GET /screen/criteria` (Top 10 is server-fixed), Edit Criteria dialog, shortlist table with all ratios, sortable/filterable
2. **Documents** (`/documents`) — per shortlisted stock: document list (concall/results/presentation/audit) + AI summary cards (sentiment, guidance, red flags, parse status)
3. **Model & Backtest** (`/backtest`) — train/predict buttons, price chart with buy/sell markers, backtest report (CAGR, Sharpe, max drawdown vs Nifty)

Dense, tabular, dark-themed. This is a tool, not a marketing site.

## Stack

- React 19 + TypeScript + Vite
- react-router-dom v7 (BrowserRouter in `main.tsx`)
- Tailwind CSS v4 via `@tailwindcss/vite` plugin (NO tailwind.config.js — CSS-first, theme in `src/index.css`)
- shadcn/ui (zinc base) — components in `src/components/ui/`; add via `npx shadcn@latest add <name>`; already added: button, card, table, tabs, badge
- Chakra UI v3 + `@emotion/react` + `next-themes` — hybrid rule: Chakra owns the provider,
  theme, toggle, toasts, and status/interactive controls; shadcn + Tailwind own the shell,
  cards, and dense tables. Accessible snippets (provider, color-mode, toaster, tooltip) live
  in `src/components/ui/` too.
- Charts: `lightweight-charts` (candlesticks/OHLC + signal markers), `recharts` (metric/ratio charts)
- Auth: HttpOnly cookie session (`sa_session`) issued by the backend. `AuthProvider`
  (`src/auth/AuthContext.tsx`) resolves `GET /auth/me` on mount; `RequireAuth` gates every route
  except `/login`. Any non-login/setup 401 dispatches `auth:unauthorized`, clears the user, and the
  guard redirects to `/login`.
- Loader: `StairTowerLoader` (`src/components/ui/StairTowerLoader.tsx`) is the single sanctioned
  looping animation (run card ~120px, login/save buttons ~20px) and never renders inside data areas.
- Path alias `@/` -> `src/` (vite.config.ts + tsconfig paths, NO baseUrl — TS6 deprecated)

## Structure

```
frontend/src/
├── main.tsx            # BrowserRouter + StrictMode + Provider + AuthProvider
├── App.tsx             # /login public; everything else inside RequireAuth + nav shell (+ logout)
├── index.css           # @import "tailwindcss" + shadcn theme tokens
├── api/
│   ├── client.ts       # api.get/api.post/api.put -> fetch wrapper, BASE="/api", 401 event
│   └── types.ts        # AuthUser, RatioSpec, Criterion, UserCriteria, screen types
├── auth/
│   └── AuthContext.tsx # session user state, logout, listens for auth:unauthorized
├── pages/
│   ├── Login.tsx       # setup card (first run) | login card
│   ├── Fundamentals.tsx
│   ├── Documents.tsx
│   └── Backtest.tsx
└── components/
    ├── ui/             # shadcn + Chakra snippets + StairTowerLoader/stair-tower.css
    ├── RequireAuth.tsx
    ├── CriteriaPanel.tsx    # read-only badges + Edit Criteria
    ├── CriteriaDialog.tsx   # criteria editor subwindow
    └── StockChart.tsx  # lightweight-charts wrapper (to be built, Phase 3)
```

## API Integration

- Dev server proxies `/api/*` -> `http://localhost:8000/*` (vite.config.ts `server.proxy`). ALWAYS call via `api.get('/screen/latest')` etc. — never hardcode `localhost:8000`.
- Auth endpoints: `GET /auth/state`, `POST /auth/setup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. Login and setup 401s are handled inline and are exempt from the global `auth:unauthorized` event.
- Criteria endpoints: `GET /screen/ratios` (catalog: key/label/unit/category/direction), `GET /screen/criteria`, `PUT /screen/criteria` (body `{criteria, thesis}`; `shortlist_size` is server-owned). The old YAML-config endpoints are retired — do not reintroduce them.
- Backend endpoints (see BACKEND.md): `/auth/*`, `/screen/*`, `/docs/*`, `/model/*`, `/backtest/*`, `/health`.
- All pipeline stages triggered by button clicks (manual pipeline — no polling/scheduler in MVP); any 401 from them clears auth state and bounces to `/login`.
- Handle `{"status":"not_implemented","phase":N}` placeholders gracefully until phases land.

## Conventions

- Theming: one `.dark` class on `<html>` (next-themes) drives both Chakra tokens and
  Tailwind/shadcn vars — use semantic tokens (`bg-background`, `text-foreground`,
  `text-muted-foreground`, `border-border`), never hardcoded palette classes
- Chakra for interactive/status elements; shadcn components and Tailwind utilities for layout and dense data
- Tables for dense data (shortlist, documents, signals) — sortable client-side
- StockChart props: `{ candles: {time,open,high,low,close}[], markers: {time, kind: 'buy'|'sell'}[] }`
- Type all API responses with generics: `api.get<ScreenRun>('/screen/latest')`
- Build check: `npm run build` (tsc -b && vite build) must pass; dev: `npm run dev`
- Tests: vitest + jsdom + Testing Library; run `npm run test`; mock all network/api/WebGL
  in tests
- Design contract: `DESIGN.md` (Terminal emerald, Geist, tabular numerals, lucide-only
  icons, motion and 3D rules) — every frontend change follows it

## Phase Gates

| Phase | UI work |
|---|---|
| 1 | Fundamentals page live: run button, criteria panel, shortlist table (symbol, name, PE, PB, ROE, ROCE, D/E, market cap), fail-count display |
| 1.5 | Auth gate (setup/login/logout, session persists), per-user criteria panel + editor dialog (`/screen/criteria`, `/screen/ratios`), fixed Top-10 badge, stair-tower loader replaces the Three.js run visual |
| 2 | Documents page: stock sub-nav -> doc list + summary cards; badge shows `analysis_method` (gemini/fallback) and parse status ("n/m parsed") |
| 3 | Signals chart: lightweight-charts candles + buy/sell markers from `/model/signals` |
| 4 | Backtest report: metric cards (CAGR/Sharpe/drawdown) + equity-curve chart (recharts) vs Nifty line |
