# Theme v2 — "Phosphor Vault" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Terminal-emerald identity with Phosphor Vault — single-source tokens with
sync/contrast tests, a defined motion & ambient system, the Market Ring 3D loader, and a
retrofit of the shipped Phase 1.5 surfaces.

**Architecture:** `src/theme/tokens.ts` is the single source of colour truth; a marked block in
`src/index.css` is test-synced from it and `src/theme/system.ts` imports it for Chakra. Motion
rides the installed `motion` library + CSS keyframes; the loader is hand-rolled
`@react-three/fiber` with `InstancedMesh` (no shaders, no drei). Phase 1.5 components
(`Login`, `CriteriaDialog`, panel/table) are re-skinned in place; `StairTowerLoader` is deleted.

**Tech Stack:** React 19 + TS + Vite, Tailwind v4 (CSS-first), shadcn/ui + Chakra UI v3,
`motion` v13, `@react-three/fiber` + `three`, vitest + jsdom + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-26-theme-v2-phosphor-vault-design.md` — the spec
travels with this plan; all pinned values (hex codes, durations, copy) live there.

## Global Constraints

- Work dir `frontend/`. `npm run test` green offline; `npm run build` (`tsc -b && vite build`)
  clean after every task.
- **One new dependency only:** `@fontsource-variable/geist-mono`. Nothing else.
- Colour values come from the spec palette tables **verbatim**; components never hardcode hex,
  never use raw palette classes; semantic tokens only (`bg-background`, `text-muted-foreground`,
  `border-border`, Chakra `brand`/`fg.muted`).
- **Amber never encodes polarity.** Gain/loss always green/red **plus** sign or arrow
  (`Delta`/`Num` components enforce it).
- Numbers use Geist Mono + `tabular-nums` (`Num`).
- Motion: 120/200/320 ms; one easing `cubic-bezier(0.16, 1, 0.3, 1)`; loop whitelist = Market
  Ring, status-rail marquee (overflow only), last-run dot pulse. Never animate inside tables,
  summaries, or chart interiors. `prefers-reduced-motion` → final state instantly (mock
  `window.matchMedia` in tests, pattern from `AmbientField.test.tsx`).
- Copy stays exact: `${shortlisted} shortlisted · ${failed} failed · ${total} total`,
  `Top {n}` badge, criteria chip text (`PE ≤ 25`), dialog labels.
- `three`/R3F only inside lazy chunks (`AmbientField`, `MarketRingLoader`).
- lucide-react only; 16px default / 14px dense; `strokeWidth={1.75}`; decorative `aria-hidden`;
  icon-only buttons have `aria-label`.
- tsconfig rules: `verbatimModuleSyntax` (`import type`), no enums, `noUnusedLocals`.
- Tests mock all network/WebGL; testids unchanged unless the task updates the test in the same
  commit.

## Review Focus

1. **Token drift** — hand-edited CSS var makes surfaces transparent/broken; `tokens.sync.test.ts`
   fails on any mismatch and `VAULT_SYNC=1` repairs (Task T0).
2. **Light-mode contrast** — casually tweaked light amber/gain/loss breaks AA; `contrast.test.ts`
   pins ≥ 4.5:1 text, ≥ 3:1 graphics in both modes (Task T0).
3. **Amber encoding polarity** — a positive delta rendered amber, or a gain without a sign;
   `Delta`/`Num` tests pin neutral/gain/loss behaviour (Task T2).
4. **Loader without WebGL / reduced motion / hidden tab** — must not crash, render an empty box,
   or spin GPU work; `MarketRingLoader` tests cover fallback + static pose + `role="status"`,
   `useFrame` guards `document.hidden` (Task T4).
5. **Loop leakage into data areas** — flashing/looping INSIDE tables or summaries; only
   `ValueFlash` (colour-only, ≤ 300 ms) may run there; reduced-motion tests cover it (Task T2/T3).

## Out of scope for this plan

Chart components (Phase 3/4) and Documents (Phase 2): the spec defines their language, but those
components do not exist yet. This plan only guarantees tokens/`chartPalette` are ready for them.

---

### Task T0: Token foundation + fonts + docs

**Files:**
- Create: `frontend/src/theme/tokens.ts`, `frontend/src/lib/contrast.ts`,
  `frontend/src/theme/__tests__/tokens.sync.test.ts`,
  `frontend/src/theme/__tests__/contrast.test.ts`
- Modify: `frontend/src/index.css`, `frontend/src/theme/system.ts`,
  `frontend/src/theme/system.test.ts`, `frontend/package.json`, `frontend/DESIGN.md`

**Interfaces:**
- Produces: `ThemeTokens` interface, `dark: ThemeTokens`, `light: ThemeTokens`,
  `amberScale: Record<number, string>`, `chartPalette: { dark: ChartPalette; light: ChartPalette }`;
  CSS vars in the marked `/* @vault-tokens:start */ … /* @vault-tokens:end */` block;
  Chakra tokens `colors.amber.*`, semantic `colors.brand`, `colors.gain`, `colors.loss`;
  npm script `tokens:sync`; contrast helpers `contrastRatio(a, b)`, `relativeLuminance(hex)`.
- Consumed by: every later task.

- [ ] **Step 1: Add the mono font + script**

```powershell
npm install @fontsource-variable/geist-mono
```

`package.json` scripts: add `"tokens:sync": "vitest run src/theme/__tests__/tokens.sync.test.ts"`.

- [ ] **Step 2: Write the failing tests**

`tokens.sync.test.ts`: import `{ dark, light }`; read `src/index.css`; extract the marked block;
build the expected block from a `CSS_VAR_BY_KEY` map (`cardForeground → --card-foreground`,
`chart1 → --chart-1`, …); `expect(actual).toBe(expected)`. When `process.env.VAULT_SYNC === '1'`,
write the expected block back into `index.css` before asserting.

`contrast.test.ts`: for each mode, assert pairs from the spec §Verification — text pairs
(`foreground/background`, `cardForeground/card`, `popoverForeground/popover`,
`primaryForeground/primary`, `mutedForeground/background`, `mutedForeground/card`,
`gain/background`, `gain/card`, `loss/background`, `loss/card`) ≥ 4.5; graphics
(`chart1..chart5` vs `card`, `primary` vs `background`) ≥ 3.

Update `system.test.ts`: amber scale + `colors.brand`/`colors.gain`/`colors.loss` + amber virtual
tokens defined; emerald assertions removed.

Run: `npx vitest run src/theme` → FAIL (missing modules / missing block).

- [ ] **Step 3: Implement**

`tokens.ts` holds the spec values verbatim (dark table, light table, amber scale, chartPalette
with `grid`, `crosshair`, `candleUp`, `candleDown`, `strategy`, `benchmark` derived from the
mode tokens where 1:1). `lib/contrast.ts` is pure math (hex → sRGB → linear → luminance →
ratio), no deps. `index.css`: replace `:root`/`.dark` blocks with the marked block; add
`@import "@fontsource-variable/geist-mono"`; map `--font-mono: 'Geist Mono Variable', monospace`
in `@theme inline`; add motion vars (`--duration-fast/base/entrance`, `--ease-vault`) below
the marked block. `system.ts`: import tokens, define amber scale + semantic tokens
`brand`/`gain`/`loss` + amber virtual tokens (contrast/fg/subtle/muted/emphasized/solid/
focusRing/border); delete emerald.

- [ ] **Step 4: Verify**

```powershell
npx vitest run src/theme
npm run build
```

Expected: all PASS; build clean. Then prove the gate:
`$env:VAULT_SYNC='1'; npm run tokens:sync` → PASS (block already in sync).

- [ ] **Step 5: Rewrite `DESIGN.md` v2**

Replace the emerald contract with: palette tables (dark/light from the spec), amber scale,
typography (Geist + Geist Mono, `Num`/`Delta` rule), shape/texture/elevation, motion
(durations, easing, signature inventory, loop whitelist incl. Market Ring, reduced-motion
mandate), tokens are test-managed (`VAULT_SYNC=1 npm run tokens:sync`), charts palette rules,
icons/a11y.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/theme frontend/src/lib/contrast.ts frontend/src/index.css frontend/package.json frontend/package-lock.json frontend/DESIGN.md
git commit -m "feat: vault token foundation, sync + contrast tests, amber Chakra theme, DESIGN v2"
```

---

### Task T1: Shell — backdrop, status rail, nav, theme-toggle wipe

**Files:**
- Create: `frontend/src/components/Backdrop.tsx`, `frontend/src/components/StatusRail.tsx`,
  `frontend/src/components/__tests__/Backdrop.test.tsx`,
  `frontend/src/components/__tests__/StatusRail.test.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/components/ThemeToggle.tsx`,
  `frontend/src/components/__tests__/ThemeToggle.test.tsx`, `frontend/src/index.css`,
  `frontend/src/pages/Fundamentals.tsx`, `frontend/src/pages/__tests__/Fundamentals.test.tsx`

**Interfaces:**
- Produces: `Backdrop()` (presentational, `aria-hidden`, fixed, `-z-10`, `pointer-events-none`,
  class `vault-backdrop`); `StatusProvider`, `useStatusFact(area: string, text: string | null)`,
  `StatusRail()` (renders `null` when no facts; `data-testid="status-rail"`; facts joined by
  ` · `; marquee only on overflow; pauses on hover).
- Consumes: T0 tokens/CSS.

- [ ] **Step 1: Failing tests**

`StatusRail.test.tsx`: probe component calls `useStatusFact('screen', '12 shortlisted')` →
rail shows `SCREEN 12 SHORTLISTED`; no facts → no rail; re-publish `null` → rail disappears.
`Backdrop.test.tsx`: renders one `aria-hidden` element with the fixed/pointer-events classes.
`ThemeToggle.test.tsx` (extend): selecting Dark still calls `setTheme` when
`document.startViewTransition` is undefined (jsdom default).
`Fundamentals.test.tsx` (extend): after latest load, `status-rail` shows the shortlisted count.

Run: `npx vitest run src/components/__tests__/StatusRail.test.tsx src/components/__tests__/Backdrop.test.tsx src/components/__tests__/ThemeToggle.test.tsx` → FAIL.

- [ ] **Step 2: Implement**

`StatusRail.tsx`: context + `useStatusFact` (effect publishes on `text` change, clears on
unmount); rail renders uppercase mono 11px facts with `tracking-[0.08em]`, `aria-label="Pipeline
status"`; marquee = duplicate content + CSS animation toggled only when
`scrollWidth > clientWidth` (ResizeObserver + initial measure). `App.tsx`: wrap shell in
`StatusProvider`, mount `<Backdrop />` before the `AmbientField` Suspense, nav gets brand glyph
(lucide `ChartCandlestick`, amber) + `STOCK ANALYZER` + active-underline via `NavLink` function
children + `motion.span layoutId="nav-underline"` (skip transition under reduced motion) + rail
under the nav. `ThemeToggle.tsx`: wrap `setTheme` in `document.startViewTransition` when
available and not reduced, set `--vt-x/--vt-y` from the click event first; CSS
`::view-transition-new(root)` circle wipe in `index.css`. `index.css`: `.vault-backdrop` +
focus-visible rule `outline: 2px solid var(--ring); outline-offset: 2px`. `Fundamentals.tsx`:
publish `screen` fact (`{count} shortlisted` / `last run {date}`).

- [ ] **Step 3: Verify**

Run: `npx vitest run src/components src/pages` → PASS; `npm run build` → clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "feat: vault shell - backdrop layer, status rail, nav underline, theme wipe"
```

---

### Task T2: Motion kit — Num, Delta, ValueFlash, Skeleton

**Files:**
- Create: `frontend/src/components/ui/Num.tsx`, `frontend/src/components/ui/Delta.tsx`,
  `frontend/src/components/ui/ValueFlash.tsx`, `frontend/src/components/ui/Skeleton.tsx`,
  `frontend/src/components/__tests__/{Num,Delta,ValueFlash,Skeleton}.test.tsx`
- Modify: `frontend/src/components/ui/NumberTicker.tsx`,
  `frontend/src/components/ui/BorderBeam.tsx`, `frontend/src/index.css`

**Interfaces:**
- Produces: `Num({ children, className })` — mono + `tabular-nums` span.
  `Delta({ value, decimals = 1, suffix })` — lucide arrow + explicit sign + absolute value;
  gain/loss/muted colour by sign, muted at 0. `ValueFlash({ value, tone = 'neutral', children })`
  — sets `data-flash={tone}` for 300 ms after `value` changes (never on mount; never under
  reduced motion). `Skeleton({ className })` — shimmer block, static under reduced motion.
- Consumes: T0 tokens; used by T3/T4.

- [ ] **Step 1: Failing tests** — behaviour per the Interfaces block, including:
  `Delta` zero renders muted with no sign; `Delta(+2.5)` exposes an up arrow and `+2.5`;
  `ValueFlash` adds no attribute on first render, adds it after a prop change, and never under
  mocked reduced motion; `Skeleton` is `aria-hidden`.

Run: `npx vitest run src/components/__tests__/Num.test.tsx src/components/__tests__/Delta.test.tsx src/components/__tests__/ValueFlash.test.tsx src/components/__tests__/Skeleton.test.tsx` → FAIL.

- [ ] **Step 2: Implement** — components + CSS (`.vault-skeleton` shimmer, `vault-flash`
  keyframes with `--flash-color` per tone). `NumberTicker`: duration 0.2 (spec), keep API and
  testid. `BorderBeam`: `offsetPath` round radius 10px (match `--radius`).

- [ ] **Step 3: Verify** — `npx vitest run src/components` → PASS; `npm run build` → clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "feat: motion kit - Num, Delta, ValueFlash, Skeleton + ticker/beam retune"
```

---

### Task T3: Fundamentals re-skin

**Files:**
- Modify: `frontend/src/components/ShortlistTable.tsx`, `frontend/src/components/CriteriaPanel.tsx`,
  `frontend/src/pages/Fundamentals.tsx`, `frontend/src/index.css`,
  tests: `frontend/src/components/__tests__/{ShortlistTable,CriteriaPanel}.test.tsx`,
  `frontend/src/pages/__tests__/Fundamentals.test.tsx`

**Interfaces:**
- Consumes: T1 rail, T2 `Num`/`Delta`/`Skeleton`.
- Produces: `ShortlistTable({ rows, loading = false })` — unchanged columns/testids; numeric
  cells use `Num`; first 8 rows get `.vault-row-in` with `--row-index` for CSS-only stagger;
  `loading` renders 5 `Skeleton` rows. CriteriaPanel: amber primary button, amber mono chips
  (text unchanged: `PE ≤ 25`, `Top 10`). RunCard: amber button, elapsed timer
  (`data-testid="elapsed"`, `mm:ss`, resets each run), summary copy unchanged (numbers wrapped
  in `Num`).

- [ ] **Step 1: Update failing tests** — chips render mono amber text without changing strings;
  table numeric cells keep `tabular-nums`; `loading` shows skeleton rows; run flow shows
  `elapsed` ticking while running (advance to `00:01` with fake timers); summary text still
  matches the exact copy.

Run: `npx vitest run src/components/__tests__/ShortlistTable.test.tsx src/components/__tests__/CriteriaPanel.test.tsx src/pages/__tests__/Fundamentals.test.tsx` → FAIL.

- [ ] **Step 2: Implement** per Interfaces; keep `StairTowerLoader` in the run card for now
  (T4 swaps it).

- [ ] **Step 3: Verify + commit**

Run: `npm run test` → PASS; `npm run build` → clean.

```bash
git add frontend/src
git commit -m "feat: fundamentals vault re-skin - mono numerals, amber chips, elapsed timer, skeletons"
```

---

### Task T4: Market Ring 3D loader (replaces stair-tower)

**Files:**
- Create: `frontend/src/components/three/MarketRingLoader.tsx`,
  `frontend/src/components/three/__tests__/MarketRingLoader.test.tsx`
- Delete: `frontend/src/components/ui/StairTowerLoader.tsx`,
  `frontend/src/components/ui/stair-tower.css`,
  `frontend/src/components/__tests__/StairTowerLoader.test.tsx`
- Modify: `frontend/src/pages/Fundamentals.tsx`, `frontend/src/pages/Login.tsx`,
  `frontend/src/components/CriteriaDialog.tsx`, their tests, `frontend/src/index.css`
  (`.vault-pulse` fallback)

**Interfaces:**
- Produces: `MarketRingLoader({ size = 120, label = 'Loading…', className })` — root
  `role="status"` + `aria-live="polite"` + sr-only label + `data-testid="market-ring-loader"`;
  `data-reduced` when reduced; `hasWebGL() === false` → `data-testid="vault-pulse"` CSS ring
  instead of a canvas; outer component reads `useToken('colors.brand','colors.gain','colors.loss')`
  and passes colour strings into the scene (no Chakra hooks inside the R3F tree).
- Scene: 48 instanced candle bodies + 48 instanced wicks on radius 1.2, travelling height wave,
  group rotation `delta * 0.18`, amber torus base, `frameloop={reduced ? 'demand' : 'always'}`,
  `dpr [1,1.5]`, `antialias: false`, `powerPreference: 'low-power'`; `useFrame` returns early
  when `document.hidden`.
- Call sites import it lazily (`lazy(() => import(...))` + `Suspense fallback={null}`):
  Fundamentals run card 120px; Login session check 120px; CriteriaDialog load phase 80px.
  Inline pending states use Chakra `Spinner` with `data-testid="inline-spinner"`.

- [ ] **Step 1: Failing tests** — `MarketRingLoader.test.tsx` (mock `@react-three/fiber` and
  `@/lib/webgl` like `AmbientField.test.tsx`): announces via `role="status"` + label; no-WebGL →
  `vault-pulse`, no canvas; reduced motion → canvas present, `data-reduced`, `frameloop="demand"`
  passed to the mocked Canvas. Update call-site tests: running Fundamentals →
  `await screen.findByTestId('market-ring-loader')`; dialog save pending → `inline-spinner`;
  Login submit → `inline-spinner`.

Run: `npx vitest run src/components/three/__tests__/MarketRingLoader.test.tsx` → FAIL.

- [ ] **Step 2: Implement** the loader + fallback + call-site swaps; delete the tower files.

- [ ] **Step 3: Verify** — `npm run test` → PASS; `npm run build` → clean. Confirm three stays in
  lazy chunks only (build output inspect); tower greps empty:
  `rg -n "stair-tower|StairTowerLoader" frontend/src` → no matches.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src
git commit -m "feat: Market Ring 3D loader replaces stair-tower; inline Chakra spinners"
```

---

### Task T5: Ambient v2 + Phase 1.5 retrofit

**Files:**
- Modify: `frontend/src/components/three/AmbientField.tsx`,
  `frontend/src/components/three/__tests__/AmbientField.test.tsx`,
  `frontend/src/pages/Login.tsx`, `frontend/src/components/CriteriaDialog.tsx`,
  `plan/phase-1.5/frontend.md` (docs only)

**Interfaces:**
- Produces: `AmbientField` embers — 500 particles, slow rise + sway, opacity ~0.3, colour from
  `colors.brand` (prop-passed like T4), all existing gates intact.

- [ ] **Step 1: Tests** — existing AmbientField tests still pass; add: particle colour/opacity
  come from props (assert the mocked scene receives the token colour).
- [ ] **Step 2: Implement** — ember motion in `useFrame`, count/opacity per spec; Login +
  CriteriaDialog: remaining `colorPalette="emerald"` → `"amber"` (grep), dialog row stagger
  16ms (spec §Motion 5), mono micro-labels on form/status text, amber focus states via tokens
  (system.ts already does this).
- [ ] **Step 3: Docs** — append one line to the loader task in `plan/phase-1.5/frontend.md`:
  "Theme v2 note: `StairTowerLoader` was replaced by `MarketRingLoader` — see
  `docs/superpowers/specs/2026-09-26-theme-v2-phosphor-vault-design.md` §Loader v2."
- [ ] **Step 4: Verify + commit** — `npm run test` PASS; `npm run build` clean;
  `rg -n "emerald" frontend/src` → only intentional gain-lineage comments (ideally none).

```bash
git add frontend/src plan/phase-1.5/frontend.md
git commit -m "feat: ember ambient field, login/dialog vault retrofit; docs: loader swap note"
```

---

### Task T6: Verify + docs sync

**Files:**
- Modify: `frontend/FRONTEND.md`; update graph with `graphify update .`

- [ ] **Step 1: Full checks**

```powershell
cd frontend
npm run test
npm run build
rg -n "emerald|stair-tower|StairTowerLoader" src
```

Expected: tests PASS; build clean; grep empty (gain-lineage comments allowed only where they
explain history). Inspect `dist/assets`: `three` must appear only in lazy chunks.

- [ ] **Step 2: Manual checklist** (needs `uvicorn` running; mark deferred if unavailable)

Both modes × three pages; reduced-motion pass (loader frozen skyline, rail static, no flashes);
density spot-check (row heights unchanged); toggle wipe; rail overflow pause; Market Ring in run
card + Login.

- [ ] **Step 3: FRONTEND.md** — stack line (vault, not zinc), mono font, `Num`/`Delta`,
  status rail, Market Ring loader, `tokens:sync` workflow, DESIGN.md v2 reference.

- [ ] **Step 4: Graph + commit**

```powershell
graphify update .
```

```bash
git add frontend/FRONTEND.md graphify-out
git commit -m "docs: frontend context for Phosphor Vault; graph refresh"
```

---

## Acceptance

- T0–T6 complete; `npm run test` green offline; `npm run build` clean; three isolated to lazy
  chunks.
- `tokens.sync.test.ts` + `contrast.test.ts` pass; `VAULT_SYNC=1` repair path works.
- Market Ring renders in the run card and Login; frozen static pose under reduced motion;
  vault-pulse ring when WebGL is missing; inline `Spinner` in buttons/dialog.
- Status rail shows real facts and hides when empty.
- DESIGN.md v2, FRONTEND.md, and `plan/phase-1.5/frontend.md` note all agree with shipped code.
