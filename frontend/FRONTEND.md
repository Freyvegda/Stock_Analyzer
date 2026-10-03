# Frontend Context — Stock Analyzer

> Agent context file. Read this before touching `frontend/`. Source of truth: `PLAN.md`.

## Purpose

React + TypeScript dashboard for the analysis pipeline. Three top-nav sections (Fundamental Analysis · Documents · Model & Backtest); Fundamental Analysis carries its own side rail:
1. **Fundamental Analysis** (`/fundamentals`) — glass floating side rail (Screen Criteria · Top 10 Results · Stocks). `/fundamentals/criteria`: Chrome-style glass tabs for saved screens (`GET /screen/sets`; inline new/rename/close, one active, dirty dot) sitting in ONE card stack with the active screen's enabled-ratio badges and the dialog-free inline criteria editor (rotor category dial, one category at a time, per-criterion bookmark ribbons + 3D ribbon rail, thesis), then the Run Screen card: `POST /screen/run` returns in seconds with `{run, job}` — the cached shortlist (`run`) paints immediately, and `RunProgress` tracks the background `job` with per-screen chips + a universe counter. A 2 s `GET /screen/jobs/latest` poll keeps progress live and restores it after a reload; a `done` job refreshes `/screen/latest` once, while `failed|interrupted` keeps the cached rows and toasts a warning. The card auto-jumps to Top 10 right after the POST returns if the user is still on the criteria page; the leaf loader + elapsed show only while that POST is in flight. A screen with a queued/running job item shows a running dot and its editor/rename/delete/activate lock (backend 409 `"Screen is mid-run"`). The badge row is the cross-category summary — the dial shows one category at a time. `/fundamentals/top10`: the active screen's latest run (`GET /screen/latest`), the job's `RunProgress` panel whenever a job exists, and a `cached — refreshing in background` badge while the painted rows predate the job's refresh. `/fundamentals/stocks`: the Nifty 500 browse table. Run state lives in `FundamentalsLayout`, so a run survives rail navigation. `/` redirects to `/fundamentals/criteria`; the retired `/stocks` URL redirects to `/fundamentals/stocks`. Each symbol links to its stock detail page (`/stock/:symbol`).
2. **Stock detail** (`/stock/:symbol`) — two equal-height halves (company description, clipped with "More" opening the full profile dialog | per-user verdict with score and criteria checks), then the price chart (6M/1Y/2Y/5Y × Daily/15D/Monthly), then main fundamental ratios, "What it has" (market cap first), "What it's done" and all other ratios; Refresh button in the header
3. **Documents** (`/documents`) — per shortlisted stock: document list (concall/results/presentation/audit) + AI summary cards (sentiment, guidance, red flags, parse status)
4. **Model & Backtest** (`/backtest`) — train/predict buttons, price chart with buy/sell markers, backtest report (CAGR, Sharpe, max drawdown vs Nifty)

The navbar also carries a **stock search** (`components/NavSearch.tsx`): an always-visible glass bar (no icon trigger; Ctrl/Cmd+K focuses it), lazily fetches `GET /stocks` once, filters client-side and lists the top 8 matches with the caller's verdict chip (Pass/Fail/No data) and pass count; Enter or a click opens `/stock/{symbol}`. It sits in the account cluster on the same row as the nav links (`lg:flex-nowrap`, `h-10`, 12rem–24rem wide, `gap-3` from the username); below `lg` the cluster takes its own full-width row.

Dense, tabular, dark-themed. This is a tool, not a marketing site — with one exception: `/` is a
public landing page (a 3D pagoda) and the only marketing surface. Everything behind auth stays
dense and tabular.

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
- Auth: a short-lived (15 min) HS256 access token held **in memory only** in
  `src/auth/tokenStore.ts`, plus a rotating opaque refresh token in an HttpOnly `SameSite=Strict`
  `sa_refresh` cookie. `AuthProvider` (`src/auth/AuthContext.tsx`) boots by exchanging the refresh
  cookie for an access token, then resolves `GET /auth/me`; a failed refresh short-circuits to
  anonymous without the extra request. `api/client.ts` attaches `Authorization: Bearer` and, on a
   401 for a non-login/setup path, refreshes **once** and replays the request. That refresh is
  single-flighted and must stay so — the server rotates the refresh token, so parallel refreshes
  would invalidate each other. `RequireAuth` gates every route except `/login` and `/`. 3h of real
  user activity inactivity signs the user out (`useIdleLogout`); the backend enforces the same
  window server-side as a backstop. Any non-login/setup 401 that survives a refresh dispatches
  `auth:unauthorized`, clears the token and the user, and the guard redirects to `/login`.
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
  120 (centred, hint + elapsed beneath, shown only while `POST /screen/run` is in flight —
  background-job progress is the `RunProgress` panel, not the loader), login 120,
  criteria dialog 80. The run button swaps to "Running…" + disables while the run is
  starting or its job is active; no border crawl around the card.
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
│   ├── client.ts       # api.get/api.post/api.put -> fetch wrapper, BASE="/api", bearer + 401 refresh/replay
│   └── types.ts        # AuthUser, RatioSpec, Criterion, ScreeningSet, screen + run-job types
├── auth/
│   ├── AuthContext.tsx # user state, re-bootstrap from the refresh cookie, logout, auth:unauthorized
│   └── tokenStore.ts   # in-memory access token + single-flighted refresh (never localStorage)
├── content/
│   └── tower.ts        # the landing page's tiers: the single source of the storey count
├── theme/
│   └── system.ts       # Chakra v3 system (sakura + brand/gain/loss + bg.panel); tokens.ts is the source
├── pages/
│   ├── Login.tsx       # brand panel + Sakura Garden backdrop + auth card (setup | login)
│   ├── fundamentals/   # FundamentalsLayout (rail + saved-screen/run state) · ScreeningCriteria · TopTen
│   ├── Stocks.tsx      # /fundamentals/stocks — Nifty 500 search/filter/sort table with per-user verdict chips
│   ├── StockDetail.tsx # /stock/:symbol — description|verdict halves, chart controls, main/has/done/other sections
│   ├── Documents.tsx
│   └── Backtest.tsx
└── components/
    ├── ui/             # shadcn + Chakra snippets + Num/Delta/ValueFlash/Skeleton
    ├── three/          # Bonfire + SakuraLeafLoader + SakuraScene + RibbonRail + Pagoda — lazy, WebGL-gated
    │                   #   pagodaScene.ts / pagodaWorld.ts / storeyGeometry.ts / worldGeometry.ts
    │                   #   are pure and unit-tested; Pagoda.tsx / PagodaStorey.tsx /
    │                   #   PagodaEnvironment.tsx render
    ├── TowerAccordion.tsx   # one row per storey card, hover-open, one at a time
    ├── TowerRail.tsx        # the right-edge storey rail: one fixed-size dot per storey
    ├── Backdrop.tsx    # fixed texture layer (scanlines + blossom glow)
    ├── GlassNav.tsx    # sticky liquid-glass capsule navbar (pointer sheen, no tilt, NavSearch)
    ├── FundamentalNav.tsx   # floating glass side rail (Screen Criteria · Top 10 Results · Stocks)
    ├── NavSearch.tsx   # navbar stock search: always-visible glass bar, Ctrl/Cmd+K focuses, lazy GET /stocks, verdict chips
    ├── LoginGarden.tsx      # memoised login scene layer (SakuraScene + theme toggle)
    ├── LoginBrandPanel.tsx  # memoised login story column, hidden below lg
    ├── StatusRail.tsx  # StatusProvider/useStatusFact + mono pipeline rail
    ├── RequireAuth.tsx
    ├── CriteriaPanel.tsx    # active-screen badges (bookmark ribbons) + Edit Criteria
    ├── CriteriaEditor.tsx   # dialog-free inline editor: rotor category dial, criterion flashcards, 3D ribbon rail
    ├── CategoryDial.tsx     # rotary "dialling telephone" category selector (plate, rotor, finger holes, hub)
    ├── CriterionCard.tsx    # one criterion as a glass flashcard (ribbon, switch, value chip, remove)
    ├── ScreenTabs.tsx       # Chrome-style glass tab strip for saved screens (draft tab, rename-in-place, dirty dot, busy dot + locked controls mid-run)
    ├── RunProgress.tsx      # background-job panel: per-screen status chips + universe counter (presentation-only)
    ├── StockReportCard.tsx  # per-user verdict, criterion checks, notes
    ├── StocksTable.tsx  # universe table: sortable columns, verdict chips, links
    └── StockChart.tsx  # lightweight-charts wrapper ({candles, markers?})
```

## API Integration

- Dev server proxies `/api/*` -> `http://localhost:8000/*` (vite.config.ts `server.proxy`). ALWAYS call via `api.get('/screen/latest')` etc. — never hardcode `localhost:8000`.
- Auth endpoints: `GET /auth/state`, `POST /auth/setup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. Login and setup 401s are handled inline and are exempt from the global `auth:unauthorized` event.
- Criteria endpoints: `GET /screen/ratios` (catalog: key/label/unit/category/direction), `GET /screen/sets` (list; each item `{id, name, criteria, thesis, shortlist_size, is_active, updated_at}`), `POST /screen/sets` (`{name, criteria?, thesis?}`; becomes active), `PUT /screen/sets/{id}` (`{name?, criteria?, thesis?}`), `DELETE /screen/sets/{id}` (400 on the last screen), `POST /screen/sets/{id}/activate`. Criteria items are `{key, enabled, value, bookmarked?}`; `shortlist_size` is server-owned. While a screen has `queued|running` items in the newest job, `PUT`/`DELETE` and `/activate` for it return 409 `"Screen is mid-run"`. The single-criteria `GET/PUT /screen/criteria` endpoints and the old YAML-config endpoints are retired — do not reintroduce them.
- Run endpoints (Phase 1.8): `POST /screen/run` -> `{run, job}` — `run` is the cached-first snapshot (`{run_id, shortlisted, failed_count, failed_symbols, failed_details, stale, total}`, `stale` true when the stored rows are not from today) and `job` is the background refresh job (`{id, set_id, status: running|done|failed|interrupted, started_at, finished_at, error, universe_total, universe_done, universe_failed, items:[{set_id, name, status: queued|running|done|failed, run_id, error, started_at, finished_at}]}`); 409 `{"detail": "Run already in progress", "job_id"}` while the newest job is running. `GET /screen/jobs/latest` -> `{job | null}` (newest job, stale `running` jobs swept to `interrupted`); `GET /screen/latest` is unchanged but now refreshes once when the job completes.
- Stock endpoints: `GET /stock/{symbol}` (shared snapshot + per-user report + profile + digest sections `main_ratios`/`has`/`done`/`other_groups`), `POST /stock/{symbol}/refresh` (force re-fetch; stored data + `warning` on failure), `GET /stock/{symbol}/ohlc?range=6m|1y|2y|5y&interval=1d|15d|1mo` (candles, memory-cached server-side, never stored).
- Universe endpoint: `GET /stocks` — one payload (~500 rows) with ratios, `data_date`, `passes`/`enabled` and the caller's `verdict` (`pass|fail|no_data`); the Stocks page fetches once and filters/sorts client-side; the navbar `NavSearch` lazily reuses the same endpoint on first focus/open (one fetch per shell mount) and filters client-side too.
- Backend endpoints (see BACKEND.md): `/auth/*`, `/screen/*`, `/docs/*`, `/model/*`, `/backtest/*`, `/health`.
- All pipeline stages triggered by button clicks (manual pipeline — the only polling is the 2 s `/screen/jobs/latest` poll while a run job is active; no scheduler in MVP); any 401 from them clears auth state and bounces to `/login`.
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
| 1.7 | Saved screens + inline criteria editor + navbar search: `/screen/sets` CRUD/activate (one active drives run, Top 10, verdicts), dialog-free editor with category sub-accordions and criterion bookmark ribbons (3D ribbon rail), always-visible glass search bar |
| 1.8 | Run performance: `POST /screen/run` paints cached results in seconds + returns `{run, job}`, `RunProgress` background panel (per-screen chips + universe counter) with a 2 s `/screen/jobs/latest` poll that survives reload, completion refreshes `/screen/latest` once, `failed|interrupted` keeps cached rows + warns, busy-screen locks (running dot; editor/rename/delete/activate 409) and the Top 10 stale badge |
| v2 | Phosphor Vault theme: tokens + sync/contrast tests, status rail, Market Ring 3D loader, motion kit (Num/Delta/ValueFlash/Skeleton), Fundamentals/login/dialog re-skin |
| v3 | Sakura Vault theme site-wide (sakura tokens incl. `panel`, retinted backdrop/flash/pulse, legacy-amber guard) + liquid-glass capsule navbar (`GlassNav`) |
| v3.1 | Sakura Leaf 3D loader replaces the Market Ring: wind-flown low-poly leaf streaming a brand-only candle tape of its own path (`leafTrace.ts` pure helpers), call sites, tests and `DESIGN.md` loop whitelist updated |
| 1.8 | Public landing page at `/` (auth re-bootstrap, refresh rotation, 3h idle logout): a four-storey pagoda in a full scene - sky, sun by day / moon by night, mountain ranges, a blossom grove on the river banks, stars, petals, fireflies and birds. The visitor walks a gate path to the pagoda: one torii per feature section, placed on a meandering walkway, the river flowing sideways in the distance; crossing a gate softens the vista (cheap CSS blur, off on the low tier and under reduced motion) and the sign-up steps back to present the pagoda whole. Storey detail from the reference illustration (door with ring pulls, lattice screens, tiled roofs, lanterns on cords), merged geometry and instanced fields for cost, river and walkway as vertex-budgeted ribbons on one shared 8 Hz tick, `pickQuality` per device, a theme selector, a fixed-size-dot storey rail, a clickable overview, a hover-open accordion on glass copy panels, honest routes for the two unbuilt storeys and scroll memory. No mist |
| 2 | Documents page: stock sub-nav -> doc list + summary cards; badge shows `analysis_method` (gemini/fallback) and parse status ("n/m parsed") |
| 3 | Signals chart: lightweight-charts candles + buy/sell markers from `/model/signals` |
| 4 | Backtest report: metric cards (CAGR/Sharpe/drawdown) + equity-curve chart (recharts) vs Nifty line |
