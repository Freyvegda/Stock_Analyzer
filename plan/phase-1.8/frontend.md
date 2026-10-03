# Phase 1.8 — Frontend (extra-run line + stock Criteria pass accordion)

> Spec: `docs/superpowers/specs/2026-10-03-phase-1.8-multi-screen-runs-design.md` §7.
> Backend contract: `plan/phase-1.8/backend.md`. Design contract: `frontend/DESIGN.md`.

**Goal:** the criteria page reports the extra screens a run evaluated, and the stock detail page
shows a "Criteria pass" accordion — one live report per screen (active + 3 most used).

**Architecture:** `StockReportsAccordion` replaces `StockReportCard` (its body becomes the
accordion item body); `StockDetail` consumes `reports`; `FundamentalsLayout` carries `extraRuns`
from the run response; `ScreeningCriteria` renders the `Also ran` line.

**Tech stack:** React 19, TS, Vite, Chakra UI v3, Tailwind v4, lucide, vitest + jsdom. No new deps.

## Global Constraints

- Work dir: `frontend/`. Tests: `npm test` (offline, mocked `api`); build: `npm run build`.
- DESIGN.md binds: semantic tokens only, `Num` for numbers, lucide 16px `strokeWidth={1.75}`,
  icon-only buttons `aria-label`, durations 120/200/320 ms, reduced-motion aware.
- `verbatimModuleSyntax` (`import type`), no enums, `noUnusedLocals`.
- Accordion items in API order (active first); active item expanded by default.

## Review Focus

1. A stock with no run history still renders the accordion with the active report only — F2/F3.
2. Auto-runs never appear in Top 10 (frontend keeps reading `/screen/latest`) — F3.
3. Failed extras are visible without breaking the run summary — F3.

---

### Task F1: Types + `extraRuns` through the layout

**Files:**
- Modify: `frontend/src/api/types.ts`, `frontend/src/pages/fundamentals/FundamentalsLayout.tsx`
- Test: `frontend/src/pages/__tests__/FundamentalsLayout.test.tsx`

**Interfaces:**

```ts
export interface ExtraRun {
  set_id: number
  name: string
  run_id: number | null
  shortlisted: number | null
  error: string | null
}
// ScreenRunResult gains: extra_runs?: ExtraRun[]

export interface StockScreenReport { set_id: number; name: string; is_active: boolean; report: StockReport }
// StockDetail: `report: StockReport` -> `reports: StockScreenReport[]`
```

- `FundamentalsOutletContext` gains `extraRuns: ExtraRun[] | null`; `runScreen` stores
  `res.extra_runs ?? []`; `activateSet`/`createSet`/`deleteSet` clear it (they already clear
  `summary`).

- [ ] **Step 1: Write the failing test** — extend `FundamentalsLayout.test.tsx` (probe reads
  `extraRuns` from the context; mock `/screen/run` returning two extras).
- [ ] **Step 2: Run to verify failure** — `npx vitest run src/pages/__tests__/FundamentalsLayout.test.tsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/pages/fundamentals/FundamentalsLayout.tsx frontend/src/pages/__tests__/FundamentalsLayout.test.tsx
git commit -m "feat: extra-run payload types and layout state"
```

---

### Task F2: `StockReportsAccordion` (replaces `StockReportCard`)

**Files:**
- Create: `frontend/src/components/StockReportsAccordion.tsx`
- Delete: `frontend/src/components/StockReportCard.tsx`, `frontend/src/components/__tests__/StockReportCard.test.tsx`
- Test: `frontend/src/components/__tests__/StockReportsAccordion.test.tsx`

**Interfaces:**

```ts
export function StockReportsAccordion({ reports }: { reports: StockScreenReport[] })
```

- Chakra `Accordion.Root multiple`, one item per report keyed `String(set_id)`,
  `defaultValue={[String(reports[0]?.set_id)]}` (active open).
- Header: screen name, `Active` badge when `is_active`, pass/fail badge (verdict copy stays
  `Passes your screen` / `Below your screen`). Body: score + passed/enabled, criteria rows
  (glyph + sr-only pass/fail text, value vs threshold), notes; `No criteria enabled` when empty.

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders one item per screen, active first and expanded')
it('shows each screen verdict and criteria rows inside')
it('keeps the No criteria enabled copy')
it('renders a single active report without history')
```

- [ ] **Step 2: Run to verify failure** — module missing.
- [ ] **Step 3: Implement** (port the `StockReportCard` body).
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/StockReportsAccordion.tsx frontend/src/components/__tests__/StockReportsAccordion.test.tsx
git rm frontend/src/components/StockReportCard.tsx frontend/src/components/__tests__/StockReportCard.test.tsx
git commit -m "feat: stock Criteria pass accordion over per-screen reports"
```

---

### Task F3: StockDetail wiring + `Also ran` line

**Files:**
- Modify: `frontend/src/pages/StockDetail.tsx`, `frontend/src/pages/fundamentals/ScreeningCriteria.tsx`
- Test: `frontend/src/pages/__tests__/StockDetail.test.tsx`, `frontend/src/pages/__tests__/ScreeningCriteria.test.tsx`

- [ ] **Step 1: Update the failing tests** — StockDetail fixture moves `report` → `reports`
  (active + one extra; assert both headers and the active-first order). ScreeningCriteria: run
  response with `extra_runs` renders `Also ran: Quality (7) · Value (0)`; a failed extra shows its
  name + failure marker; no `extra_runs` renders nothing.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — StockDetail passes `detail.reports` to the accordion; the layout
  `extraRuns` line lands in the run card.
- [ ] **Step 4: Run to verify pass** — affected suites + `npm run build`.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/StockDetail.tsx frontend/src/pages/fundamentals/ScreeningCriteria.tsx frontend/src/pages/__tests__/StockDetail.test.tsx frontend/src/pages/__tests__/ScreeningCriteria.test.tsx
git commit -m "feat: stock reports accordion + extra screens line on the run card"
```

---

### Task F4: Docs + full verification

**Files:**
- Modify: `frontend/FRONTEND.md`

- [ ] **Step 1: Full checks** — `npm test`; `npm run build`; no stray `StockReportCard` references.
- [ ] **Step 2: FRONTEND.md** — structure entry `StockReportsAccordion.tsx` (removed
  `StockReportCard.tsx`), API integration (`reports` array, `extra_runs`), phase-gate row `1.8`.
- [ ] **Step 3: Commit**

```bash
git add frontend/FRONTEND.md
git commit -m "docs: frontend context for multi-screen runs and the reports accordion"
```

## Acceptance

- Accordion renders active-first, one item per report, verdicts and criteria correct; empty state
  intact; no single-report component remains.
- Criteria page shows the extra screens a run touched, failures included, without disturbing the
  active summary.
- `npm test` green offline; `npm run build` clean.
