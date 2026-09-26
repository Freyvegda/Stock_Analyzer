# Theme v2 — "Phosphor Vault" Visual System

**Date:** 2026-09-26
**Status:** Approved (design reviewed section by section in session)
**Scope:** `frontend/` only. Lands **before** Phase 1.5 execution. Phase 1.5 then builds on this foundation.

## Intent

Replace the Terminal-emerald visual identity with an original, researched identity —
**Phosphor Vault** — plus a motion/animation language, so every page (shipped and planned)
reads as one instrument. Deliverables:

1. **Theme source files** — a single token source (`src/theme/tokens.ts`) that drives
   Tailwind/shadcn CSS vars and Chakra UI tokens, synchronized by script and guarded by tests.
2. **Motion & ambient system** — a defined signature set; "Living instrument" ambition:
   craft + ambient motion, data areas stay calm.
3. **A plan** — `frontend/THEME-V2-PLAN.md`, task-checkbox format matching `plan/phase-*`,
   executing the rollout in this spec.

Success criteria:

- Both modes pass an automated contrast test (text ≥ 4.5:1, chart series ≥ 3:1).
- CSS vars and `tokens.ts` can never silently drift (parity test + sync script).
- Shell, Fundamentals, and every planned surface (auth, dialog, loader, documents, charts,
  backtest) are specified in vault tokens and the component language below.
- `npm run test` green offline, `npm run build` clean, `three` stays only in the
  `AmbientField` chunk.
- `frontend/DESIGN.md` is rewritten (v2) and describes exactly what shipped.
- Phase 1.5 plan is rebased (wording only) so it pins vault tokens, not emerald.

## Constraints

- `frontend/FRONTEND.md`, `frontend/DESIGN.md`, and `plan/phase-1.5/frontend.md` are binding
  context; update them in the same change where they pin the old identity.
- Tailwind CSS v4 CSS-first (no config file; vars in `src/index.css`), shadcn/ui + Chakra v3
  hybrid rule unchanged (Chakra owns provider/theme/toggle/toasts; shadcn+Tailwind own shell,
  cards, tables).
- Tests run offline; mock network/WebGL/matchMedia. Budget stays ₹0.
- **One new dependency only:** `@fontsource-variable/geist-mono` (self-hosted woff2, tiny).
  No new runtime libraries — `motion` v13, `three`, `lightweight-charts`, `recharts` already in.
- Reduced motion (`prefers-reduced-motion: reduce`) is mandatory for every animation.
- No backend/API/route/feature changes. No density changes (table row heights stay).

## Decisions (locked in review)

1. **Emerald is retired as brand.** Identity = near-black navy + amber primary + green/red
   status. Emerald survives, evolved, as the dark-mode gain token (`#3DD68C`).
2. **Amber never encodes polarity.** Amber = brand, focus, attention, selection, live/current
   position. Gain/loss is always green/red **plus** a sign or arrow (colorblind redundancy).
3. **Dark-first, light supported.** Dark is the designed canvas; light mode ("Parchment
   Vault") is a deliberately tuned sibling (warm ivory, darkened amber), not an inversion.
   ThemeToggle stays.
4. **Living instrument motion.** Entrances, value flashes, tickers, chart draw-ins, route
   transitions, richer loader/empty states, upgraded ambient field. Data areas (tables,
   summaries, chart interiors) never animate continuously.
5. **Theme v2 lands before Phase 1.5.** Phase 1.5 plan gets a rebaseline note; its structure,
   copy, and rules stand.
6. **Single token source + script sync + tests.** No manual dual-file syncing.

## Research basis

Sources distilled into this design (firecrawl research, 2026-09-26):

- **WANDR — Dark Mode Fintech Dashboard Design:** never pure black; elevation = lighter
  surfaces; tune status colors per mode; whisper gridlines; limit concurrent chart series;
  skeleton shimmer over spinners.
- **Aniq-UI — Best Dark Mode Dashboard Designs 2026:** surface ladder `#0B0E13/#11151C/#171C24`;
  off-white text; desaturated accents; candles ≥ 3:1, wicks ≥ 2:1; one accent for live price;
  value flash 50–80ms; no continuous row motion; solid depth bars, no gradient banding.
- **pixel-show — Designing Data-Dense Dashboards:** four-step elevation; two color scales per
  semantic role (light/dark); two fonts (prose + mono numerals); conditional density (0.85
  tint for repeated cells); motion durations 120/200/350 + one easing; motion for confidence.
- **Bloomberg terminal recipe (garden-skills) + Ted Merz "Amber on Black":** amber-on-near-black
  is the most distinctive finance identity; 1px hairlines, minimal radius, monospace digits,
  instant state flips, ticker scroll.
- **Magic UI / motion-primitives / Aceternity UI inventories:** candidate patterns — value
  tickers, sliding numbers, text scramble, marquee, border beam, dot/grid patterns, morphing
  dialog, progressive blur, spotlight, magnetic, dock.
- **StanVision 2026 trends:** spatial depth on flat screens; dark mode as baseline; functional
  micro-interactions.

## Foundations

### Token architecture

```
frontend/src/theme/
├── tokens.ts            # SINGLE SOURCE: dark + light palette, amber scale, chart palette
├── tokens.sync.mjs      # exports renderTokenBlock(tokens); CLI rewrites index.css block
├── system.ts            # imports tokens.ts -> Chakra tokens + semantic tokens
└── __tests__/
    ├── tokens.parity.test.ts   # index.css block === renderTokenBlock(tokens)
    └── contrast.test.ts        # AA text pairs + 3:1 chart series, both modes
```

- `src/index.css` contains a marked region
  `/* @vault-tokens:start */ … /* @vault-tokens:end */` — **script-written, never hand-edited**.
  Run `npm run tokens:sync` (new package.json script) after editing `tokens.ts`.
- Token block covers color vars only. Radius, fonts, motion durations/easings stay
  hand-authored below it.
- Canonical value format: hex (readable in review). `oklch()` conversions are unnecessary.
- `system.ts` keeps `preflight: false`, defines the amber color scale, and semantic tokens
  `brand` (amber), `gain`, `loss`, plus the virtual amber `colorPalette` tokens
  (contrast/fg/subtle/muted/emphasized/solid/focusRing/border) mirroring the old emerald
  pattern. The emerald scale/tokens are removed.
- Charts never hardcode hex: `chartPalette` (per mode) is exported from `tokens.ts` and
  consumed by `StockChart` and recharts components (grep-able rule: no `#` color literals in
  `StockChart.tsx`, `Backtest.tsx`, or future chart modules).

### Palette — dark (primary canvas)

| Token | Value | Role |
|---|---|---|
| `--background` | `#0A0E1A` | void (near-black navy) |
| `--card` | `#111828` | surface-1: cards, tables, panels |
| `--popover` | `#1F2A42` | surface-3: overlays only (+ shadow) |
| `--muted` | `#141D31` | muted blocks |
| `--secondary` / `--accent` | `#182136` | surface-2: hover rows, active nav, controls |
| `--border` / `--input` | `#232C45` | 1px hairlines |
| `--foreground` | `#E9EDF6` | primary text |
| `--muted-foreground` | `#8891A8` | labels, meta |
| `--primary` | `#FFB454` | amber: brand, focus, attention, selection |
| `--primary-foreground` | `#201403` | text on amber |
| `--gain` | `#3DD68C` | gains, success, parsed |
| `--loss` / `--destructive` | `#FF6B6E` | losses, errors, red flags |
| `--ring` | `#FFB454` | focus rings |
| `--chart-1` | `#FFB454` | primary series / strategy |
| `--chart-2` | `#6FB7D9` | benchmark / second series (steel-cyan) |
| `--chart-3` | `#3DD68C` | third series |
| `--chart-4` | `#FF6B6E` | fourth series |
| `--chart-5` | `#8891A8` | fifth series / muted series |
| chart grid (JS palette) | `rgba(255,255,255,0.06)` | gridlines |
| chart crosshair (JS palette) | `rgba(255,180,84,0.5)` | crosshair |
| `--radius` | `0.625rem` (unchanged) | sm 6 / md 8 / lg 10 / xl 14 |

Sidebar vars mirror: `--sidebar` = card, `--sidebar-accent` = accent,
`--sidebar-primary` = primary, `--sidebar-ring` = ring, `--sidebar-border` = border.

### Palette — light (Parchment Vault)

| Token | Value | Role |
|---|---|---|
| `--background` | `#F6F4EF` | warm ledger ivory |
| `--card` / `--popover` | `#FFFFFF` | raised surfaces |
| `--muted` / `--accent` | `#EFEBE3` | muted + hover surfaces |
| `--secondary` | `#EAE5DB` | controls |
| `--border` | `#E3DDD2` | hairlines |
| `--input` | `#D9D2C4` | input borders |
| `--foreground` | `#14181F` | ink |
| `--muted-foreground` | `#6E6A62` | labels, meta |
| `--primary` | `#B45309` | darkened amber (AA on ivory) |
| `--primary-foreground` | `#FFF8EC` | text on amber |
| `--gain` | `#15803D` | gains (light-tuned, not reused from dark) |
| `--loss` / `--destructive` | `#B91C1C` | losses (light-tuned) |
| `--ring` | `#B45309` | focus rings |
| `--chart-1..5` | `#B45309`, `#3E6B8C`, `#15803D`, `#B91C1C`, `#6E6A62` | same roles as dark |
| chart grid (JS palette) | `rgba(20,24,31,0.06)` | gridlines |

Starting values are final unless the contrast test forces a tune; the test is the gate.

### Amber scale (Chakra + Tailwind utilities)

| Step | Value |
|---|---|
| 50 | `#FFF9ED` |
| 100 | `#FEF0D6` |
| 200 | `#FCE0AE` |
| 300 | `#F9C87B` |
| 400 | `#FFB454` (dark primary) |
| 500 | `#EE9A2F` |
| 600 | `#D97706` |
| 700 | `#B45309` (light primary) |
| 800 | `#92400E` |
| 900 | `#78350F` |
| 950 | `#451A03` |

`colorPalette="amber"` is valid in Chakra; `bg-amber-400` etc. work in Tailwind.

### Typography

- UI: **Geist Variable** (kept, `@fontsource-variable/geist`).
- Numbers: **Geist Mono** for every price, ratio, score, count, date
  (`@fontsource-variable/geist-mono`, imported in `index.css`; `--font-mono` mapped in
  `@theme inline`). `--font-heading` stays `var(--font-sans)`.
- Two shared components enforce it:
  - `Num` — `<span class="font-mono tabular-nums">`, used for all numeric output.
  - `Delta` — numeric value + arrow + explicit sign, colored `--gain`/`--loss`; renders
    neutral when zero. Redundancy by construction.
- Labels (table headers, chips, rail): 11px uppercase, `tracking-[0.08em]`, muted; mono for
  status/rail text.
- Scale unchanged: 12/14/16/18/20–24.
- Conditional density: repeated table numbers render token colors at 85% opacity
  (`color-mix(in oklab, var(--gain) 85%, transparent)`; same pattern for `--loss`); hero
  metrics use full-strength tokens.

### Shape, texture, elevation

- Radius: unchanged (6/8/10/14).
- Elevation: page flat; overlays = `--popover` + 1px `--border` + shadow. Lighter surface =
  higher elevation (4-step ladder: background → card → secondary/accent → popover).
- Texture layer (fixed, `pointer-events-none`, `aria-hidden`, `-z-10`, DOM-ordered before
  `AmbientField`):
  - Dark: scanlines `repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0 1px, transparent 1px 3px)`
    plus radial amber glow `radial-gradient(1200px 600px at 85% -10%, rgba(255,180,84,0.06), transparent 60%)`.
  - Light: faint warm radial + horizontal lines at `rgba(20,24,31,0.012)`.
  - Disabled under `prefers-contrast: more`.
- Selected/active signature: amber 12% tint + 1px amber left border (rows), amber underline
  (nav/tabs).

### Motion tokens (index.css)

```
--duration-fast: 120ms;      /* feedback: hover, press, focus */
--duration-base: 200ms;      /* overlays, tabs indicator, hero tickers */
--duration-entrance: 320ms;  /* route/chart/card entrances */
--ease-vault: cubic-bezier(0.16, 1, 0.3, 1);
```

Two timing classes: **narrative** (chrome, overlays — eased) vs **data** (numbers, rows —
instant/linear, ≤ 120ms).

## Motion & ambient system

### Signature inventory

1. **Value flash** — a data value update tints its cell background/color 80ms, fades 220ms.
   Color-only, zero movement. Shared `ValueFlash` wrapper. Applied to: table cells, latest
   signal badge, metric cards, parse-status counts, criteria save.
2. **NumberTicker v2** — odometer-style roll (200ms) for hero metrics only. Dense table
   cells flash; they never count up.
3. **Status rail** — mono strip under the nav, e.g.
   `SCREEN 12 SHORTLISTED · DOCS 34/40 PARSED · MODEL LAST TRAINED 26 SEP`.
   Real pipeline state only (no fake live data). Data comes from a small `StatusContext`
   (React context): pages publish the latest known facts after their existing API calls; the
   rail renders only facts that exist and hides itself when empty — no extra API calls. If
   content overflows: linear marquee, pauses on hover/focus, static under reduced motion.
   Real content, not `aria-hidden`.
4. **Chart entrance** — StockChart canvas mask wipe left→right 320ms; buy/sell markers pop in
   staggered 24ms (cap 10); recharts animationDuration 320ms. Reduced motion → final frame.
5. **Overlays** — dialogs/popovers scale 0.98→1 + fade 200ms (`--ease-vault`), backdrop 120ms;
   dialog rows stagger 16ms. Stretch: morph-from-trigger for CriteriaDialog.
6. **Route entrance** — BlurFade retuned to 320ms on route content. Enter-only; no exit
   animations.
7. **Theme toggle wipe** — View Transitions API circular wipe anchored to the toggle;
   instant fallback when unsupported or reduced motion.
8. **BorderBeam** — retinted amber; used as the "scan" on the run card/button while a
   pipeline stage runs.
9. **Row entrance** — first load only: 12ms stagger, cap 8 rows, rest instant. Sorting,
   filtering, and reorders are always immediate.
10. **Sanctioned loops (complete whitelist)** — stair-tower loader (inherits amber via
    `--primary`), status rail marquee (only when overflowing), pipeline last-run dot pulse.
    Max one loop per viewport zone; loops never render inside tables, summaries, or charts.
11. **Stretch tier (explicitly optional, not required for acceptance):** pointer spotlight
    glow on run card/metric tiles (pointer-fine only, ~4% amber); CriteriaDialog
    morph-from-trigger; wireframe grid floor in `AmbientField`.

### Ambient & 3D

- **AmbientField v2:** particles retinted `#FFB454`, count 800→500, slow rise + sway,
  opacity ~0.3. Keeps every existing gate: lazy chunk, `hasWebGL()`, hidden below `md`,
  paused when tab hidden, `null` under reduced motion.
- **Login page** uses ambient at full strength (no data to protect) behind a centered card.
- Budget: `dpr [1, 1.5]`, `antialias: false`, one draw call; no new geometry.
- No sound, no scroll effects, no parallax, no scroll-jacking, no magnetic buttons.

### Reduced-motion contract

Every animation above, under `prefers-reduced-motion: reduce`: renders final state instantly
or does not run. New animated components ship tests using the existing
`usePrefersReducedMotion` mock pattern (as `StairTowerLoader` does in Phase 1.5).

## Component & chart language

### Shell

- Nav: hairline bottom; brand = amber candlestick glyph (lucide) + `STOCK ANALYZER`;
  links 14px; active = amber underline (layout slide) + foreground text; ThemeToggle wipes.
- Status rail under nav (see Motion #3).
- Focus ring: 2px amber, offset 2px — everywhere (`--ring`).
- Buttons: primary amber solid (dark text), destructive loss, outline hairline + accent
  hover, ghost. Press scale 0.98 / 120ms. Chakra `colorPalette="amber"`.
- Layout: `max-w-[1600px] mx-auto p-6`.

### Fundamentals (existing)

- RunCard: BorderBeam amber while running; `StairTowerLoader` (amber, auto via `--primary`);
  **elapsed timer** in mono (honest, no fake progress). Summary line copy stays exactly
  `${shortlisted} shortlisted · ${failed} failed · ${total} total` — styling only.
- CriteriaPanel: chips become mono micro-chips (`PE ≤ 25`) amber-tinted when enabled,
  dimmed when disabled; `Top 10` muted; Edit Criteria = primary button.
- ShortlistTable: headers 11px uppercase tracking; numbers `Num`, right-aligned, 0.85 tint;
  hover `--accent`; selected row amber left border; sort arrows amber; fail-count loss chip
  when > 0; first-load row stagger.
- Empty/error states: glyph + mono message + amber outline retry.

### Auth (Phase 1.5 — built on v2)

- Login: surface-2 card on void + ambient; mono micro-labels; amber focus; errors loss-red in
  `role="alert"`; tower loader inside submit.
- CriteriaDialog: scale+fade, staggered rows, amber Switch, mono numeric inputs, inline 422
  loss text, mini tower while saving.

### Documents (Phase 2)

- Symbol sub-nav = mono tabs with amber active underline; doc-type chips muted mono
  (`CONCALL`, `RESULTS`, `PRESENTATION`, `AUDIT`); parse dot gain/loss/muted + `n/m parsed`
  mono; sentiment badge gain/loss/neutral; red-flag count = loss chip; `analysis_method`
  (`gemini`/`fallback`) = muted chip.

### Charts (Phase 3/4)

- StockChart: bg `#0A0E1A` (dark) / `#FFFFFF` (light); grid from `chartPalette`; candle
  up/down = gain/loss (wicks same fill); live price line amber + amber axis label; markers
  ▲ gain below bar / ▼ loss above; axes Geist Mono 11px; entrance wipe.
- Signal strip: large mono `BUY / SELL / HOLD` badge (gain/loss/muted) + confidence + date;
  value-flashes on update.
- MetricsCards: hero `Num` numbers + NumberTicker + `Delta` chips; drawdown always loss.
- EquityCurve: strategy amber 2px; benchmark `--chart-2` steel-cyan dashed 1.5px; amber
  gradient area 12%→0; tooltip `--popover`; mono legend.
- TradesTable: `Delta` P&L; exit-reason muted chip; "Show N trades" amber ghost toggle.
- RunHistory: mono run ids and dates; hover rows.

### Loading

- New shared `Skeleton`: surface-ladder base + 6% white shimmer sweep (tone-matched; never a
  bright spinner). Tables/cards/charts use it; pipeline = tower loader; inline saves = mini
  tower. Reduced motion → static block.

### Icons & accessibility

- lucide only; 16px default / 14px dense; `strokeWidth={1.75}`; decorative `aria-hidden`;
  icon-only buttons `aria-label` (unchanged rules).
- Every color signal has shape/sign redundancy (`Delta`). Contrast test guards tokens. Focus
  rings always visible. Loops stop under reduced motion.

## Phase 1.5 interaction

- Land order: theme v2 (this spec) → Phase 1.5 as planned.
- Rebaseline edits to `plan/phase-1.5/frontend.md` (wording only): "emerald tokens only" →
  "vault/amber tokens only"; DESIGN.md references remain valid (DESIGN.md is rewritten in
  place). Phase 1.5's "No new dependencies" constraint stands — the mono font is added by
  theme v2 before 1.5 starts.
- `StairTowerLoader` needs no changes: it reads `var(--primary)`/`var(--chart-1)` and turns
  amber automatically.

## Rollout

| # | Task | Scope |
|---|---|---|
| T0 | Foundation | Add `@fontsource-variable/geist-mono` + `tokens:sync` script; `tokens.ts`; `tokens.sync.mjs`; rewrite `index.css` token block, add `--font-mono`, motion vars, texture classes; `system.ts` v2 (amber + gain/loss, drop emerald); update `src/theme/system.test.ts`; new parity + contrast tests; rewrite `DESIGN.md` v2 |
| T1 | Shell | `App.tsx` nav v2 + `StatusContext` + `StatusRail.tsx` (+ marquee), texture layer, `ThemeToggle` wipe, focus-ring utility, `Num`/`Delta` components |
| T2 | Motion kit | `ValueFlash`, NumberTicker v2, `Skeleton`, BlurFade retune, BorderBeam retint, reduced-motion tests |
| T3 | Fundamentals re-skin | RunCard (elapsed timer + amber tower), CriteriaPanel chips, ShortlistTable (mono numerals, chips, selected row); update affected tests |
| T4 | Ambient v2 | AmbientField embers retint/tuning; verify WebGL gates + chunk isolation |
| T5 | Phase 1.5 rebaseline | Wording edits in `plan/phase-1.5/frontend.md`; no structural change |
| T6 | Verify + docs | Full suite, build, greps, manual checklist, `FRONTEND.md` sync, graphify update |

Six PR-sized tasks; each leaves `npm run test` green and `npm run build` clean.

## Verification

- **New tests:** `tokens.parity.test.ts` (index.css block === `renderTokenBlock(tokens)`);
  `contrast.test.ts` (text pairs ≥ 4.5:1: foreground/background, card-foreground/card,
  popover-foreground/popover, primary-foreground/primary, muted-foreground/background,
  muted-foreground/card, gain/background, gain/card, loss/background, loss/card both modes;
  graphics ≥ 3:1: chart-1..5 vs card, primary vs background; both modes);
  reduced-motion tests for each new animated component.
- **Existing:** all vitest suites green; testids unchanged unless a test is updated in the
  same commit; build assertion that `three` appears only in the AmbientField chunk.
- **Greps:** no `emerald` references outside the gain-token lineage note; no hex color
  literals in chart components; no `colorPalette="emerald"`.
- **Manual:** both modes × three pages; reduced-motion pass; density spot-check; toggle wipe;
  rail marquee overflow/pause.
- Commands: `npm run test`, `npm run build` (from `frontend/`); `graphify update .` at root.

## Risks

| Risk | Mitigation |
|---|---|
| Amber + green + red goes garish | amber never encodes polarity; hairlines + muted surfaces; 0.85 conditional density; contrast test |
| Light-mode amber fails AA | darker anchor `#B45309`; contrast test gates release, values tune until pass |
| Motion creep | stretch tier explicit; loop whitelist; reduced-motion tests |
| Token drift returns | sync script + parity test |
| 3D/bundle weight | existing WebGL/visibility gates; chunk isolation assertion |
| Phase 1.5 conflicts | rebaseline task (wording only); loader auto-inherits amber |

## Non-goals

- No backend, API, route, or feature changes; no density/row-height changes.
- No removal of light mode; no equal-depth parity effort either (dark-first by decision).
- No new component library, chart library, or animation library.
- No scroll effects, parallax, sound, or magnetic interactions.

## Acceptance

- Parity + contrast tests pass; all existing tests pass; build clean; `three` chunk isolated.
- DESIGN.md v2, FRONTEND.md, and the Phase 1.5 plan agree with the shipped UI.
- Both modes read as Phosphor Vault: amber attention, green/red polarity with sign/arrow,
  mono numerals, hairlines, ember ambient, calm data areas.
