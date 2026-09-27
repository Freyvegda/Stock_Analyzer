# Phase 1.6 — Frontend (stock detail page, chart, Candle Ridge hero)

> **For agentic workers:** part of the Phase 1.6 plan. Required sub-skill when executing:
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use
> checkbox (`- [ ]`) syntax.
>
> **Spec:** `docs/superpowers/specs/2026-09-27-phase-1.6-stock-detail-design.md`.
> Backend contract: `plan/phase-1.6-stock-detail/backend.md`.
> Design contract: `frontend/DESIGN.md`.

**Goal:** clicking a shortlisted symbol opens `/stock/:symbol` — a header with the
run context and a Refresh button, a data-driven Candle Ridge hero, the per-user
report card, the catalog fundamentals grid and a candlestick chart with
6M/1Y/2Y/5Y ranges and Daily/15D/Monthly intervals.

**Architecture:** page `pages/StockDetail.tsx` fetches `/stock/{symbol}` +
`/stock/{symbol}/ohlc`; `components/StockReportCard.tsx` renders the report;
`components/StockChart.tsx` wraps lightweight-charts to the existing FRONTEND.md
contract; `components/three/CandleRidge.tsx` + `ridgeGeometry.ts` are the new lazy
3D hero (pure helpers + thin renderer, same gates as the 3D kit).
`ShortlistTable` symbol cells become links.

**Tech stack:** React 19, TS, Vite, Chakra UI v3, Tailwind v4, motion,
lightweight-charts v5, three/@react-three/fiber, vitest + jsdom + Testing Library.
**No new dependencies.**

## Global Constraints

- Work dir: `frontend/`. Tests: `npm run test`. Build: `npm run build` (must stay clean).
- Tests run offline; mock `api`, `fetch`, WebGL, matchMedia, `lightweight-charts`.
- `frontend/DESIGN.md` binds: semantic tokens only (`bg-background`,
  `text-muted-foreground`, `border-border`, Chakra `brand`/`gain`/`loss`/`fg.muted`),
  Geist + Geist Mono, every number through `Num`/`Delta`, lucide icons 16px
  `strokeWidth={1.75}` (`aria-hidden` decorative, icon-only buttons `aria-label`),
  `tabular-nums` on numbers, durations 120/200/320 ms.
- 3D rules bind: lazy chunk, `hasWebGL()` fallback (the ridge simply does not mount),
  `useIsDesktop()` gate, `usePrefersReducedMotion()` static pose, paused when the tab
  is hidden, `aria-hidden`, `pointer-events-none`, no hex in `components/three/**`
  (colors as props from `paletteFor`). Three.js must not enter the initial bundle.
- API shapes come from `src/api/types.ts`.
- `tsconfig` rules: `verbatimModuleSyntax` (`import type`), no enums, `noUnusedLocals`.
- Report text is fixed copy: verdict `Passes your screen` / `Below your screen`;
  empty criteria → `No criteria enabled`.
- Do not touch `backend/` in this plan.

## Review Focus

1. Chart must never crash on an empty candle list — Task F2/F5 (`renders an empty state
   without creating a chart`).
2. Range/interval switches must refetch only the chart, never the snapshot — Task F5
   (`switching range refetches only the ohlc endpoint`).
3. A failed refresh keeps the stored snapshot on screen with a warning — Task F5
   (`keeps the stored snapshot when refresh reports a warning`).
4. Unknown symbol shows a friendly 404 state with a way back — Task F5
   (`shows the unknown-symbol state on 404`).
5. Ridge must not mount without WebGL/desktop and must freeze under reduced motion —
   Task F4 (`renders null below md or without WebGL`, `freezes under reduced motion`).

---

### Task F1: API types + shortlist symbol links

**Files:**
- Modify: `frontend/src/api/types.ts`, `frontend/src/components/ShortlistTable.tsx`
- Test: `frontend/src/components/__tests__/ShortlistTable.test.tsx`

**Interfaces:**
- Produces (types):
  - `ChartRange = '6m' | '1y' | '2y' | '5y'`, `ChartInterval = '1d' | '15d' | '1mo'`
  - `StockSnapshot {date, pe, pb, roe, roce, debt_to_equity, data_status}`
  - `ReportCriterion {key, label, unit, direction, threshold, value: number | null, passed, delta: number | null}`
  - `MetricGroup {category, metrics: {key, label, unit, value}[]}`
  - `StockReport {verdict: 'pass' | 'fail'; score; passed; enabled; criteria: ReportCriterion[]; notes: string[]; groups: MetricGroup[]}`
  - `RunContext {run_id, run_date, rank, score}`
  - `StockDetail {symbol, name, sector, market_cap, snapshot, report, data_date, stale, run: RunContext | null, refreshed: boolean | null, warning: string | null}`
  - `Candle {time, open, high, low, close, volume}`, `ChartMarker {time, kind: 'buy' | 'sell'}`
  - `OhlcResponse {symbol, range: ChartRange, interval: ChartInterval, as_of, candles: Candle[]}`
- Produces (component): symbol cell links to `/stock/{symbol}`.

- [ ] **Step 1: Update the failing test**

Wrap every existing `render(<ShortlistTable …/>)` in
`<MemoryRouter>` (react-router-dom) and add:

```tsx
it('links each symbol to its stock detail page', () => {
  render(<ShortlistTable rows={[makeRow({ symbol: 'AAA' })]} />, { wrapper: MemoryRouter })
  expect(screen.getByRole('link', { name: 'AAA' })).toHaveAttribute('href', '/stock/AAA')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/__tests__/ShortlistTable.test.tsx`
Expected: FAIL — `AAA` is not a link.

- [ ] **Step 3: Implement**

Append the types to `types.ts`. In `ShortlistTable.tsx` replace the symbol cell with
`<Link to={\`/stock/${r.symbol}\`} className="font-semibold underline-offset-4 hover:underline">{r.symbol}</Link>`
(import `Link` from `react-router-dom`).

- [ ] **Step 4: Run to verify pass + commit**

Run: `npx vitest run src/components/__tests__/ShortlistTable.test.tsx` → PASS.

```bash
git add frontend/src/api/types.ts frontend/src/components/ShortlistTable.tsx frontend/src/components/__tests__/ShortlistTable.test.tsx
git commit -m "feat: stock detail API types and shortlist symbol links"
```

---

### Task F2: `StockChart` (lightweight-charts wrapper)

**Files:**
- Create: `frontend/src/components/StockChart.tsx`
- Test: `frontend/src/components/__tests__/StockChart.test.tsx`

**Interfaces:**
- Consumes: `Candle`, `ChartMarker` (F1); `chartPalette` from `@/theme/tokens`;
  `useColorMode` from `@/components/ui/color-mode`.
- Produces: `StockChart({candles, markers}: {candles: Candle[]; markers?: ChartMarker[]})`
  — contract from FRONTEND.md (Phase 3 only passes markers).

- [ ] **Step 1: Write the failing tests**

`vi.mock('lightweight-charts', ...)`: `createChart` returns a stub
(`addSeries`, `applyOptions`, `remove`, `timeScale().fitContent` as `vi.fn()`),
`CandlestickSeries` is a sentinel, `createSeriesMarkers` a `vi.fn()`.

```tsx
it('creates a chart and sets candle data in order')   // stub.addSeries + series.setData argument mapping
it('applies buy/sell markers only when provided')     // createSeriesMarkers called with mapped {time, position, color}
it('removes the chart on unmount')                    // stub.remove called
it('renders an empty state without creating a chart') // candles [] -> placeholder text, no createChart call
it('re-applies the palette when the color mode flips') // dark mode -> applyOptions called with dark candleUp
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/__tests__/StockChart.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`useColorMode()` → `const palette = chartPalette[colorMode === 'dark' ? 'dark' : 'light']`;
one effect keyed on `[candles, markers, colorMode]`: create chart with
`{layout: {background: {color: 'transparent'}, textColor: undefined}, grid: {vertLines: {color: palette.grid}, horzLines: {color: palette.grid}}, height: 320, autoSize: false}`;
`chart.addSeries(CandlestickSeries, {upColor: palette.candleUp, downColor: palette.candleDown,
borderVisible: false, wickUpColor: palette.candleUp, wickDownColor: palette.candleDown})`;
`series.setData(candles.map(({time, open, high, low, close}) => ({time, open, high, low, close})))`;
`createSeriesMarkers(series, markers.map(...))` only when `markers?.length`;
guarded `ResizeObserver` → `chart.applyOptions({width: container.clientWidth})`;
cleanup `chart.remove()`. Empty `candles` → render
`<div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No price data</div>`
and skip chart creation.

- [ ] **Step 4: Run to verify pass + commit**

Run: `npx vitest run src/components/__tests__/StockChart.test.tsx` → PASS.

```bash
git add frontend/src/components/StockChart.tsx frontend/src/components/__tests__/StockChart.test.tsx
git commit -m "feat: lightweight-charts candlestick wrapper with optional markers"
```

---

### Task F3: Candle Ridge pure helpers

**Files:**
- Create: `frontend/src/components/three/ridgeGeometry.ts`
- Test: covered in Task F4's test file (`CandleRidge.test.tsx`) — same pattern as
  `leafTrace` inside `SakuraLeafLoader.test.tsx`.
- Naming note: `ridgeGeometry.ts`, not `candleRidge.ts` — on Windows, a helper and
  a component whose paths differ only by case resolve to the same module.

**Interfaces:**
- Produces:
  - `RIDGE_BARS = 96`
  - `ridgeValues(candles: {close: number}[], count = RIDGE_BARS): number[]` — last ≤count closes.
  - `normalizeRidge(values: number[]): number[]` — 0..1; flat series → all `0.5`; empty → `[]`.
  - `ridgeTones(values: number[]): number[]` — 0..1 brand ladder from the delta
    `(v − prev) / (2 × range) + 0.5`, clamped; first bar `0.5`; flat series → all `0.5`.
  - `barLayout(count: number, spanX: number, gapFraction = 0.28): {x: number; width: number}[]`
    — centered on 0; `width = spanX / count × (1 − gapFraction)`.
  - `easeOutCubic(t: number): number` — clamped 0..1.
  - `barProgress(index: number, count: number, elapsedMs: number, durationMs = 320, staggerMs = 6): number`
    — `easeOutCubic((elapsedMs − index × staggerMs) / durationMs)` clamped.

- [ ] **Step 1: Write the failing tests** (in `CandleRidge.test.tsx`, Task F4 adds scene tests)

```tsx
it('takes the last closes up to the bar budget')     // 200 candles -> 96 values, correct tail
it('normalizes to 0..1 and treats a flat series as mid') // [5,5,5] -> [0.5,0.5,0.5]
it('tones rise with the delta and clamp')            // climbing series all > 0.5; falling all < 0.5
it('lays bars out centered and non-overlapping')     // first x < 0 < last x; width > 0
it('eases out and staggers')                         // easeOutCubic(0)=0, (1)=1; barProgress 0 at t=0, 1 for large t, index 0 ahead of index 5
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/three/__tests__/CandleRidge.test.tsx`
Expected: FAIL — helpers missing.

- [ ] **Step 3: Implement `candleRidge.ts`** (pure numbers, no three.js import)

- [ ] **Step 4: Run to verify pass + commit**

Run: `npx vitest run src/components/three/__tests__/CandleRidge.test.tsx` → PASS.

```bash
git add frontend/src/components/three/candleRidge.ts frontend/src/components/three/__tests__/CandleRidge.test.tsx
git commit -m "feat: pure Candle Ridge geometry, tone and entrance helpers"
```

---

### Task F4: `CandleRidge` 3D scene

**Files:**
- Create: `frontend/src/components/three/CandleRidge.tsx`
- Test: `frontend/src/components/three/__tests__/CandleRidge.test.tsx` (extend)

**Interfaces:**
- Consumes: F3 helpers; `hasWebGL` (`@/lib/webgl`), `usePrefersReducedMotion`,
  `useIsDesktop`, `useColorMode`, `paletteFor`.
- Produces: `CandleRidge({candles, className}: {candles: Candle[]; className?: string})`
  — returns `null` when `!hasWebGL()`, below `md`, or fewer than 2 closes.

- [ ] **Step 1: Write the failing scene tests**

Mirror `SakuraLeafLoader.test.tsx`: `vi.mock('@/lib/webgl')`,
`vi.mock('@react-three/fiber')` (`Canvas` → `<div data-testid="candle-ridge-canvas"
data-frameloop=… />`, `useFrame: () => {}`), `mockMedia({reduced, desktop})`.

```tsx
it('renders a continuous 3D ridge by default')        // canvas present, frameloop "always"
it('freezes to a demand-rendered static pose under reduced motion')
it('renders null below md — no canvas mounted')
it('renders null without WebGL')
it('probes WebGL once, not on every render')
it('renders null with fewer than two candles')
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/three/__tests__/CandleRidge.test.tsx`
Expected: FAIL — `CandleRidge` missing.

- [ ] **Step 3: Implement**

Wrapper: gate with `useMemo(() => hasWebGL(), [])`, `useIsDesktop()`,
`usePrefersReducedMotion()`, `useColorMode()` + `paletteFor(colorMode)`; `values =
useMemo(() => normalizeRidge(ridgeValues(candles)), [candles])`; render
`<div aria-hidden="true" className={cn('pointer-events-none', className)} data-testid="candle-ridge"
data-reduced={reduced ? 'true' : undefined}>` + `<Canvas frameloop={reduced ? 'demand' : 'always'}
dpr={[1, 1.5]} camera={{position: [0, 0.6, 2.2], fov: 38}} gl={{antialias: false,
powerPreference: 'low-power', alpha: true}}>`.

Scene: `instancedMesh` boxes (`args={[undefined, undefined, values.length]}`) + a
`useFrame` that tracks `elapsed` (skipped when `document.hidden`; frozen elapsed 999
under reduced motion so the entrance is complete): each bar's height
`0.05 + 1.15 × level × barProgress(i, …)` with x/width from `barLayout`, brightness
`base.lerp(lit, 0.15 + 0.7 × tone)`; the group yaws `sin(elapsed × 0.25) × 0.06`
(0 under reduced motion). Colors from `paletteFor`: `primary` base, `foreground` lit,
`background` dim — brand ladder only, no gain/loss polarity. `data-reduced`,
`aria-hidden`, `pointer-events-none` as in the wrapper.

- [ ] **Step 4: Run to verify pass + commit**

Run: `npx vitest run src/components/three/__tests__/CandleRidge.test.tsx` → PASS.

```bash
git add frontend/src/components/three/CandleRidge.tsx frontend/src/components/three/__tests__/CandleRidge.test.tsx
git commit -m "feat: data-driven Candle Ridge 3D hero with kit gates and reduced-motion still"
```

---

### Task F5: `StockDetail` page + `StockReportCard` + route

**Files:**
- Create: `frontend/src/pages/StockDetail.tsx`, `frontend/src/components/StockReportCard.tsx`
- Modify: `frontend/src/App.tsx` (route `/stock/:symbol` inside `AppShell`)
- Test: `frontend/src/pages/__tests__/StockDetail.test.tsx`,
  `frontend/src/components/__tests__/StockReportCard.test.tsx`

**Interfaces:**
- Consumes: F1 types, F2 `StockChart`, F4 `CandleRidge` (lazy), `api` client,
  `BlurFade`, `Skeleton`, `Num`, `Badge`, `Button` (Chakra), `toaster`.
- Produces:
  - `StockDetail()` — reads `useParams().symbol`; fetches
    `/stock/{symbol}` and `/stock/{symbol}/ohlc?range={range}&interval={interval}`;
    state: `detail`, `loading`, `error`, `notFound`, `candles`, `candlesLoading`,
    `candlesError`, `range: ChartRange = '1y'`, `interval: ChartInterval = '1d'`,
    `refreshing`.
  - `StockReportCard({report}: {report: StockReport})`.

- [ ] **Step 1: Write the failing tests**

Page tests mock `../api/client` (`api.get` / `api.post` with fixture payloads) and
render inside `MemoryRouter` with an initial entry of `/stock/AAA`.

```tsx
it('renders the identity header, report verdict and metric groups')
it('shows the unknown-symbol state on 404')            // ApiError 404 -> copy + back link, no crash
it('shows an error with Retry when the snapshot fails') // 500 -> role="alert" + retry refetches
it('switching range refetches only the ohlc endpoint')  // api.get mock call list has /stock/AAA/ohlc?...range=6m and no second /stock/AAA
it('switching interval refetches with interval=1mo')
it('refreshes the snapshot via POST and merges the response')
it('keeps the stored snapshot when refresh reports a warning') // POST -> warning + refreshed false -> toast + data still rendered
it('shows the run chips when the symbol was in the latest run')
```

Report-card tests: verdict copy for both verdicts, criteria rows show threshold and
value with a pass/fail glyph and sr text, notes list, `No criteria enabled` when the
criteria array is empty.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pages/__tests__/StockDetail.test.tsx src/components/__tests__/StockReportCard.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

Page layout per spec §5.1: header (back link to `/`, symbol + name, sector badge,
market cap `Num`, `Data as of {data_date}` when stale, Refresh button disabled while
`refreshing`, run chips), hero strip `hidden md:block` with
`<Suspense fallback={null}><CandleRidge candles={candles} /></Suspense>`,
`BlurFade`-wrapped `StockReportCard`, groups grid (`Num` values, unit suffix),
chart card with range buttons (`6M/1Y/2Y/5Y`) and interval buttons
(`Daily/15D/Monthly`, `aria-pressed`), `StockChart candles={candles}`, skeleton while
`candlesLoading`, inline error + Retry. Refresh success replaces `detail`; a `warning`
fires an info toast and keeps the payload. `api.get` calls use `encodeURIComponent(symbol)`.
Route added in `App.tsx` inside the `AppShell` `<Routes>`.

- [ ] **Step 4: Run to verify pass + build**

Run: `npx vitest run src/pages/__tests__/StockDetail.test.tsx src/components/__tests__/StockReportCard.test.tsx && npm run build`
Expected: PASS; build clean; three.js only in lazy chunks.

```bash
git add frontend/src/pages/StockDetail.tsx frontend/src/components/StockReportCard.tsx frontend/src/App.tsx frontend/src/pages/__tests__/StockDetail.test.tsx frontend/src/components/__tests__/StockReportCard.test.tsx
git commit -m "feat: stock detail page with per-user report, metric groups and chart controls"
```

---

### Task F6: Docs + full verification

**Files:**
- Modify: `frontend/FRONTEND.md`, `frontend/DESIGN.md`

- [ ] **Step 1: Full checks**

```powershell
npm run test
npm run build
rg -n "localhost:8000|#(FFA9C6|0C080B)" src
```

Expected: tests PASS; build clean; no hardcoded base URLs or palette hex in `src`.

- [ ] **Step 2: Update docs**

- `FRONTEND.md`: structure entries (`pages/StockDetail.tsx`,
  `components/StockReportCard.tsx`, `components/StockChart.tsx`,
  `components/three/CandleRidge.tsx` + `ridgeGeometry.ts`), API integration
  (`/stock/{symbol}`, `POST /stock/{symbol}/refresh`, `/stock/{symbol}/ohlc`),
  phase gate row `1.6`.
- `DESIGN.md`: new "Stock hero — Candle Ridge" section under 3D (data-driven ridge,
  brand ladder only, assembled under reduced motion, strip without text over the
  canvas) and the loop whitelist gains "Candle Ridge hero (stock detail only)".

- [ ] **Step 3: Manual checklist (needs backend running; mark deferred if unavailable)**

1. Click a shortlisted symbol → page renders report, groups, chart.
2. Range/interval switches re-render candles; no layout shift.
3. Refresh pulls fresh values; toast on warning fallback.
4. Ridge assembles on load; static under reduced motion; absent below `md`.
5. Direct `/stock/NOPE` → friendly unknown-symbol state.

- [ ] **Step 4: Commit**

```bash
git add frontend/FRONTEND.md frontend/DESIGN.md
git commit -m "docs: frontend context and Candle Ridge design contract for Phase 1.6"
```

## Acceptance

- `npm run test` green offline; `npm run build` clean; three.js not in the initial chunk.
- Symbol link navigates to `/stock/{symbol}`; page renders header, report card,
  fundamentals grid and chart.
- Report verdict copy matches the API verdict; per-user criteria change the verdict
  without touching stock data.
- Chart: 6M/1Y/2Y/5Y × Daily/15D/Monthly all served; empty/error/loading states never
  blank; range switches do not refetch the snapshot.
- Ridge gates verified by tests; `vault-rules`, `contrast`, `tokens.sync` suites green.
