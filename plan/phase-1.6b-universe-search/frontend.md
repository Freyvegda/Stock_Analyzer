# Phase 1.6b — Frontend (Stocks browse page + richer stock detail)

> **For agentic workers:** part of the Phase 1.6b plan. Required sub-skill when
> executing: `superpowers:subagent-driven-development` or
> `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.
>
> **Spec:** `docs/superpowers/specs/2026-09-27-phase-1.6b-universe-search-design.md`.
> Backend contract: `plan/phase-1.6b-universe-search/backend.md`.
> Design contract: `frontend/DESIGN.md`.

**Goal:** `/stocks` — searchable, filterable, sortable table of the whole Nifty 500
with per-user verdict chips; `StockDetail` gains description, "what it has", main
ratios, "what it's done" and "other ratios" sections with screen data first.

**Architecture:** `pages/Stocks.tsx` fetches `GET /stocks` once and filters/sorts
client-side via a presentational `components/StocksTable.tsx`. `StockDetail.tsx`
renders the new server-composed sections as cards/tiles. `GlassNav` gains a link.
No new dependencies.

**Tech stack:** React 19, TS, Vite, Chakra UI v3, Tailwind v4, lucide, vitest + jsdom
+ Testing Library.

## Global Constraints

- Work dir: `frontend/`. Tests: `npm run test`. Build: `npm run build` (must stay clean).
- Tests run offline; mock the `api` client, never `fetch` for these pages.
- `frontend/DESIGN.md` binds: semantic tokens only (`bg-card`, `border-border`,
  `text-muted-foreground`, Chakra `brand`/`gain`/`loss`/`fg.muted`), Geist + Geist
  Mono, every number through `Num`/`Delta`, lucide 16px `strokeWidth={1.75}`
  (`aria-hidden` decorative, icon-only buttons `aria-label`), `tabular-nums`,
  durations 120/200/320 ms.
- `verbatimModuleSyntax` (`import type`), no enums, `noUnusedLocals`.
- Section titles are fixed copy from the spec: "What the company does",
  "What it has", "Main fundamental ratios", "What it's done", "All other ratios".
- Do not touch `backend/` in this plan.

## Review Focus

1. 500 rows must stay responsive while typing — Task F1 (`filters rows on each
   keystroke without refetching`) — filtering is local; one API call total.
2. Missing metrics/profile must vanish, never blank the page — Task F2
   (`skips missing metrics and a null profile`).
3. Screen data must render directly under the header — Task F2
   (`renders screen data before description`).
4. `no_data` rows must show a neutral chip, not "fail" — Task F1
   (`shows the no-data chip for unseen symbols`).

---

### Task F1: Types, nav link, Stocks page + table

**Files:**
- Modify: `frontend/src/api/types.ts`, `frontend/src/components/GlassNav.tsx`
- Create: `frontend/src/pages/Stocks.tsx`, `frontend/src/components/StocksTable.tsx`
- Modify: `frontend/src/App.tsx` (route `/stocks` inside `AppShell`)
- Test: `frontend/src/pages/__tests__/Stocks.test.tsx`,
  `frontend/src/components/__tests__/GlassNav.test.tsx` (extend)

**Interfaces:**
- Produces (types):

```ts
export interface StockListRow {
  symbol: string; name: string; sector: string | null; market_cap: number | null
  pe: number | null; pb: number | null; roe: number | null; roce: number | null
  debt_to_equity: number | null; data_date: string | null
  passes: number; enabled: number; verdict: 'pass' | 'fail' | 'no_data'
}
export interface StockListResponse { as_of: string | null; total: number; rows: StockListRow[] }
```

- Produces: `StocksTable({rows, loading}: {rows: StockListRow[]; loading?: boolean})`
  — sortable columns; symbol links to `/stock/{symbol}`; screen column badge:
  `passes/enabled pass` (brand), `fail` (loss), `— no data` (muted); `Num` for
  numbers, `—` for null.
- Produces: `Stocks()` page — states `data`, `loading`, `error`; toolbar with
  search `input` (placeholder "Search symbol or company"), sector `select`
  (unique sectors from rows + "All sectors"), verdict filter buttons
  (All / Pass / Fail / No data); client-side filtering only; header shows
  "Nifty 500" and `Data as of {as_of}`; empty state "No stocks match";
  error state `role="alert"` + Retry button.
- Produces: nav item `{to: '/stocks', label: 'Stocks'}` before Documents.

- [ ] **Step 1: Write the failing tests — `frontend/src/pages/__tests__/Stocks.test.tsx`**

Mock `../../api/client` like `StockDetail.test.tsx`; render inside `MemoryRouter`.

```tsx
it('renders rows with ratios and verdict chips')      // find "AAA", "20.0", "8/9 pass"
it('filters rows on each keystroke without refetching') // type "beta" -> only BBB; api.get calls == 1
it('filters by sector and verdict')                   // sector select + "No data" button
it('shows the no-data chip for unseen symbols')       // verdict 'no_data' -> "No data", not "Fail"
it('shows empty state when nothing matches')          // query "zzz" -> "No stocks match"
it('shows an error with Retry when the fetch fails')  // 500 -> role="alert", retry refetches
it('unknown symbol rows link to the detail page')     // href == '/stock/AAA'
```

Extend `GlassNav.test.tsx`: `it('links to the stocks page')` — render inside
`MemoryRouter`, expect `getByRole('link', {name: 'Stocks'})` href `/stocks`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/__tests__/Stocks.test.tsx src/components/__tests__/GlassNav.test.tsx`
Expected: FAIL — `Stocks`/`StocksTable` missing.

- [ ] **Step 3: Implement**

- `types.ts`: append `StockListRow`, `StockListResponse`.
- `StocksTable.tsx`: model on `ShortlistTable.tsx` (`sortRows` from `../lib/sort`,
  `aria-sort`, skeleton rows, `STAGGER_ROWS` entrance); columns symbol/name/sector/
  mkt cap/PE/PB/ROE%/ROCE%/D/E/Screen/Updated.
- `Stocks.tsx`: `useEffect` fetch `api.get<StockListResponse>('/stocks')`;
  `useMemo` filter by lowercased query against symbol+name, sector, verdict;
  Chakra `Input`/`NativeSelect`/`Button`; `BlurFade` wrapper; reuse existing empty
  card pattern from `Fundamentals.tsx`.
- `App.tsx`: `<Route path="/stocks" element={<Stocks />} />`; `GlassNav` navItems entry.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/__tests__/Stocks.test.tsx src/components/__tests__/GlassNav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/components/GlassNav.tsx frontend/src/pages/Stocks.tsx frontend/src/components/StocksTable.tsx frontend/src/App.tsx frontend/src/pages/__tests__/Stocks.test.tsx frontend/src/components/__tests__/GlassNav.test.tsx
git commit -m "feat: Nifty 500 stocks browse page with search, filters and verdict chips"
```

---

### Task F2: StockDetail sections

**Files:**
- Modify: `frontend/src/api/types.ts`, `frontend/src/pages/StockDetail.tsx`
- Test: `frontend/src/pages/__tests__/StockDetail.test.tsx` (extend)

**Interfaces:**
- Produces (types):

```ts
export interface CompanyProfile {
  description: string | null; industry: string | null; sector: string | null
  website: string | null; employees: number | null; hq: string | null
}
export interface StockFact { key: string; label: string; unit: string; value: number }
```

`StockDetail` gains `profile: CompanyProfile`, `main_ratios: StockFact[]`,
`has: StockFact[]`, `done: StockFact[]`, `other_groups: MetricGroup[]`.
- Produces: detail page section order — header → ridge → `StockReportCard` →
  description card → "What it has" tiles → "Main fundamental ratios" tiles →
  "What it's done" tiles → "All other ratios" catalog groups → chart card.

- [ ] **Step 1: Write the failing tests (extend `frontend/src/pages/__tests__/StockDetail.test.tsx`)**

Extend the existing detail fixture with `profile`, `main_ratios`, `has`, `done`,
`other_groups`.

```tsx
it('renders screen data before description')     // DOM order: report card container index < description
it('renders the company description and industry')
it('skips missing metrics and a null profile')   // all-null profile + empty arrays -> page renders, no empty cards
it('renders has, done and other-ratio tiles')    // labels/values appear
it('renders the other groups by category')       // e.g. "Valuation" heading
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pages/__tests__/StockDetail.test.tsx`
Expected: FAIL — new sections absent.

- [ ] **Step 3: Implement**

- `types.ts`: append `CompanyProfile`, `StockFact`; extend `StockDetail`.
- `StockDetail.tsx`: after `StockReportCard` add, in order:
  - description card (`data-testid="company-description"`): paragraph
    (`whitespace-pre-line`), chips for industry/sector, website `Link`, employees
    `Num`, hq — each rendered only when non-null;
  - a reusable local `FactTiles({title, facts})` component in the same file
    (`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`, `Num` + unit) used for
    "What it has", "Main fundamental ratios", "What it's done" — skip the card
    when `facts.length === 0`;
  - "All other ratios" reuses today's `report.groups` grid markup but fed by
    `detail.other_groups`.
- Keep Refresh, warning, chart, notFound/error/skeleton states untouched.

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run src/pages/__tests__/StockDetail.test.tsx && npm run build`
Expected: PASS; build clean; three.js still only in lazy chunks.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/pages/StockDetail.tsx frontend/src/pages/__tests__/StockDetail.test.tsx
git commit -m "feat: stock detail profile, balance, performance and other-ratio sections"
```

---

### Task F3: Docs + full verification

**Files:**
- Modify: `frontend/FRONTEND.md`

- [ ] **Step 1: Full checks**

```powershell
npm run test
npm run build
rg -n "localhost:8000|#(FFA9C6|0C080B)" src
```

Expected: tests PASS; build clean; no hardcoded base URLs or palette hex in `src`.

- [ ] **Step 2: Update `FRONTEND.md`**

Structure entries (`pages/Stocks.tsx`, `components/StocksTable.tsx`), API
integration (`GET /stocks`, detail sections), route list (`/stocks`), phase gate
row `1.6b`.

- [ ] **Step 3: Manual checklist (backend running; mark deferred if unavailable)**

1. `/stocks` loads ~500 rows; typing filters instantly; sector/verdict filters work.
2. Row opens `/stock/{symbol}`; description/has/main/done/other sections render.
3. A `no_data` symbol shows the neutral chip and opens a page whose Refresh fills data.

- [ ] **Step 4: Commit**

```bash
git add frontend/FRONTEND.md
git commit -m "docs: frontend context for Phase 1.6b stocks browse and detail sections"
```

## Acceptance

- `npm run test` green offline; `npm run build` clean.
- Search finds any seeded symbol by symbol or company name; verdict chips match the
  API verdict; `no_data` rows never render as failures.
- Detail page order: screen data → description → has → main ratios → done → other
  ratios → chart; missing data never produces empty cards or crashes.
- Existing Phase 1.6 tests (`StockChart`, `CandleRidge`, `ShortlistTable`,
  `StockReportCard`, vault/contrast/tokens) stay green.
