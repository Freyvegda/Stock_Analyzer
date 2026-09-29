# Frontend Context — Stock Analyzer

> Agent context file. Read this before touching `frontend/`. Source of truth: `PLAN.md`.

## Purpose

React + TypeScript dashboard for the analysis pipeline. Three top-nav sections (Fundamental Analysis · Documents · Model & Backtest); Fundamental Analysis carries its own side rail:
1. **Fundamental Analysis** (`/fundamentals`) — glass floating side rail (Screen Criteria · Top 10 Results · Stocks). `/fundamentals/criteria`: per-user criteria badges from `GET /screen/criteria`, Edit Criteria dialog, Run Screen card (leaf loader + elapsed; auto-jumps to Top 10 when a run finishes while the user is still on the page). `/fundamentals/top10`: the shortlist the last run produced (`GET /screen/latest`). `/fundamentals/stocks`: the Nifty 500 browse table. Run state lives in `FundamentalsLayout`, so a run survives rail navigation. `/` redirects to `/fundamentals/criteria`; the retired `/stocks` URL redirects to `/fundamentals/stocks`. Each symbol links to its stock detail page (`/stock/:symbol`).
2. **Stock detail** (`/stock/:symbol`) — two equal-height halves (company description, clipped with "More" opening the full profile dialog | per-user verdict with score and criteria checks), then the price chart (6M/1Y/2Y/5Y × Daily/15D/Monthly), then main fundamental ratios, "What it has" (market cap first), "What it's done" and all other ratios; Refresh button in the header
3. **Documents** (`/documents`) — per shortlisted stock: document list (concall/results/presentation/audit) + AI summary cards (sentiment, guidance, red flags, parse status)
4. **Model & Backtest** (`/backtest`) — train/predict buttons, price chart with buy/sell markers, backtest report (CAGR, Sharpe, max drawdown vs Nifty)

The navbar also carries a **stock search** (`components/NavSearch.tsx`): an always-visible glass bar (no icon trigger; Ctrl/Cmd+K focuses it), lazily fetches `GET /stocks` once, filters client-side and lists the top 8 matches with the caller's verdict chip (Pass/Fail/No data) and pass count; Enter or a click opens `/stock/{symbol}`.

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
- Theming v3 "Sakura Vault": `src/theme/tokens.ts` is the single source of colour truth; the
  marked block in `src/index.css` is test-synced (`$env:VAULT_SYNC='1'; npm run tokens:sync`),
  Chakra `system.ts` derives from it (sakura scale + `colorPalette="sakura"`, `bg.panel`), and
  `contrast.test.ts` gates WCAG AA in both modes. `scenePalette` (same file) is the login-only
  Sakura Garden palette and `bonfirePalette` the signed-in Bonfire palette — both outside
  `ThemeTokens`, outside the synced block, scene-only (see DESIGN.md).
- Typography: Geist UI + **Geist Mono for every number** via `Num`/`Delta`
  (`src/components/ui/Num.tsx`, `Delta.tsx`). Sakura is attention only — never gain/loss polarity.
- Loader: `SakuraLeafLoader` (`src/components/three/SakuraLeafLoader.tsx`) — brand-only 3D
  sakura leaf flying downwind (x sway + y climb/dive, banked nose, flutter) streaming a
  candle tape of its own path (pure, three-free helpers in `three/leafTrace.ts`: blade,
  curl, wind clock, price curve, candle slots/fade), lazy chunk, WebGL-gated (CSS
  `vault-pulse` fallback), static under reduced motion, hidden below `md`; contexts: run card
  120 (centred, hint + elapsed beneath, the only animation during a run), login 120,
  criteria dialog 80. The run button swaps to "Running…" + disables; no border crawl around
  the card.
- Background: `Bonfire` (`src/components/three/Bonfire.tsx`) is the signed-in ambient layer —
  a bottom-right campfire that emits the app's ember pixels (dense around the fire, a thin
  tail wandering across the screen); theme-aware (palette + burn profile crossfade on theme
  change via `bonfirePalette` and `motionFor`), lazy chunk, WebGL-gated, hidden below `md`,
  frozen under reduced motion, absent on `/login`. It replaced the retired `AmbientField`
  particle wash.
- Path alias `@/` -> `src/` (vite.config.ts + tsconfig paths, NO baseUrl — TS6 deprecated)

## Structure

```
frontend/src/
├── main.tsx            # BrowserRouter + StrictMode + Provider + AuthProvider
├── App.tsx             # /login public; everything else inside RequireAuth + GlassNav shell
├── index.css           # tailwindcss + fonts + @vault-tokens block (test-synced) + motion vars
├── api/
│   ├── client.ts       # api.get/api.post/api.put -> fetch wrapper, BASE="/api", 401 event
│   └── types.ts        # AuthUser, RatioSpec, Criterion, UserCriteria, screen types
├── auth/
│   └── AuthContext.tsx # session user state, logout, listens for auth:unauthorized
├── theme/
│   └── system.ts       # Chakra v3 system (sakura + brand/gain/loss + bg.panel); tokens.ts is the source
├── pages/
│   ├── Login.tsx       # brand panel + Sakura Garden backdrop + auth card (setup | login)
│   ├── fundamentals/   # FundamentalsLayout (rail + shared run state) · ScreeningCriteria · TopTen
│   ├── Stocks.tsx      # /fundamentals/stocks — Nifty 500 search/filter/sort table with per-user verdict chips
│   ├── StockDetail.tsx # /stock/:symbol — description|verdict halves, chart controls, main/has/done/other sections
│   ├── Documents.tsx
│   └── Backtest.tsx
└── components/
    ├── ui/             # shadcn + Chakra snippets + Num/Delta/ValueFlash/Skeleton
    ├── three/          # Bonfire + SakuraLeafLoader + SakuraScene — lazy, WebGL-gated
    ├── Backdrop.tsx    # fixed texture layer (scanlines + blossom glow)
    ├── GlassNav.tsx    # sticky liquid-glass capsule navbar (pointer sheen, no tilt, NavSearch)
    ├── FundamentalNav.tsx   # floating glass side rail (Screen Criteria · Top 10 Results · Stocks)
    ├── NavSearch.tsx   # navbar stock search: Ctrl/Cmd+K glass combobox over GET /stocks, verdict chips
    ├── LoginGarden.tsx      # memoised login scene layer (SakuraScene + theme toggle)
    ├── LoginBrandPanel.tsx  # memoised login story column, hidden below lg
    ├── StatusRail.tsx  # StatusProvider/useStatusFact + mono pipeline rail
    ├── RequireAuth.tsx
    ├── CriteriaPanel.tsx    # read-only badges + Edit Criteria
    ├── CriteriaDialog.tsx   # criteria editor subwindow
    ├── StockReportCard.tsx  # per-user verdict, criterion checks, notes
    ├── StocksTable.tsx  # universe table: sortable columns, verdict chips, links
    └── StockChart.tsx  # lightweight-charts wrapper ({candles, markers?})
```

## API Integration

- Dev server proxies `/api/*` -> `http://localhost:8000/*` (vite.config.ts `server.proxy`). ALWAYS call via `api.get('/screen/latest')` etc. — never hardcode `localhost:8000`.
- Auth endpoints: `GET /auth/state`, `POST /auth/setup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. Login and setup 401s are handled inline and are exempt from the global `auth:unauthorized` event.
- Criteria endpoints: `GET /screen/ratios` (catalog: key/label/unit/category/direction), `GET /screen/criteria`, `PUT /screen/criteria` (body `{criteria, thesis}`; `shortlist_size` is server-owned). The old YAML-config endpoints are retired — do not reintroduce them.
- Stock endpoints: `GET /stock/{symbol}` (shared snapshot + per-user report + profile + digest sections `main_ratios`/`has`/`done`/`other_groups`), `POST /stock/{symbol}/refresh` (force re-fetch; stored data + `warning` on failure), `GET /stock/{symbol}/ohlc?range=6m|1y|2y|5y&interval=1d|15d|1mo` (candles, memory-cached server-side, never stored).
- Universe endpoint: `GET /stocks` — one payload (~500 rows) with ratios, `data_date`, `passes`/`enabled` and the caller's `verdict` (`pass|fail|no_data`); the Stocks page fetches once and filters/sorts client-side; the navbar `NavSearch` lazily reuses the same endpoint on first open (one fetch per shell mount) and filters client-side too.
- Backend endpoints (see BACKEND.md): `/auth/*`, `/screen/*`, `/docs/*`, `/model/*`, `/backtest/*`, `/health`.
- All pipeline stages triggered by button clicks (manual pipeline — no polling/scheduler in MVP); any 401 from them clears auth state and bounces to `/login`.
- Handle `{"status":"not_implemented","phase":N}` placeholders gracefully until phases land.

## Conventions

- Theming: one `.dark` class on `<html>` (next-themes) drives both Chakra tokens and
  Tailwind/shadcn vars — use semantic tokens (`bg-background`, `text-foreground`,
  `text-muted-foreground`, `border-border`, Chakra `brand`/`gain`/`loss`), never hardcoded
  palette classes or hex; `vault-rules.test.ts` enforces the ban (emerald refs, hex in 3D code,
  raw palette utilities) in code
- Chakra for interactive/status elements; shadcn components and Tailwind utilities for layout and dense data
- Tables for dense data (shortlist, documents, signals) — sortable client-side
- StockChart props: `{ candles: {time,open,high,low,close}[], markers: {time, kind: 'buy'|'sell'}[] }`
- Type all API responses with generics: `api.get<ScreenRun>('/screen/latest')`
- Build check: `npm run build` (tsc -b && vite build) must pass; dev: `npm run dev`
- Tests: vitest + jsdom + Testing Library; run `npm run test`; mock all network/api/WebGL
  in tests
- Design contract: `DESIGN.md` (Sakura Vault: dark-first sakura identity, Geist + Geist Mono,
  motion signatures + loop whitelist, liquid-glass navbar rules, lucide-only icons, 3D rules) —
  every frontend change follows it

## Phase Gates

| Phase | UI work |
|---|---|
| 1 | Fundamentals page live: run button, criteria panel, shortlist table (symbol, name, PE, PB, ROE, ROCE, D/E, market cap), fail-count display |
| 1.5 | Auth gate (setup/login/logout, session persists), per-user criteria panel + editor dialog (`/screen/criteria`, `/screen/ratios`), fixed Top-10 badge, loader run visual (stair-tower; superseded by the 3D Market Ring in theme v2, itself replaced by the Sakura Leaf) |
| 1.6 | Stock detail page: shortlist symbol links to `/stock/:symbol` — per-user report card, catalog metric groups, `StockChart` with range/interval switchers; refresh fallback keeps stored data (Candle Ridge hero superseded in 1.6c) |
| 1.6b | `/stocks` browse page (search + sector/verdict filters, sortable, verdict chips) with nav link; stock detail gains description, "What it has", "Main fundamental ratios", "What it's done", "All other ratios" |
| 1.6c | Nav stock search (`NavSearch`, Ctrl/Cmd+K glass panel, verdict chips, keyboard-complete) + detail layout revision: description \| verdict halves (equal height, clipped description with More dialog) → chart → main ratios → has (market cap first) → done → other; Candle Ridge hero retired |
| v2 | Phosphor Vault theme: tokens + sync/contrast tests, status rail, Market Ring 3D loader, motion kit (Num/Delta/ValueFlash/Skeleton), Fundamentals/login/dialog re-skin |
| v3 | Sakura Vault theme site-wide (sakura tokens incl. `panel`, retinted backdrop/flash/pulse, legacy-amber guard) + liquid-glass capsule navbar (`GlassNav`) |
| v3.1 | Sakura Leaf 3D loader replaces the Market Ring: wind-flown low-poly leaf streaming a brand-only candle tape of its own path (`leafTrace.ts` pure helpers), call sites, tests and `DESIGN.md` loop whitelist updated |
| 2 | Documents page: stock sub-nav -> doc list + summary cards; badge shows `analysis_method` (gemini/fallback) and parse status ("n/m parsed") |
| 3 | Signals chart: lightweight-charts candles + buy/sell markers from `/model/signals` |
| 4 | Backtest report: metric cards (CAGR/Sharpe/drawdown) + equity-curve chart (recharts) vs Nifty line |
