# Design Set — Stock Analyzer (Phosphor Vault)

Source of truth for the frontend's visual and motion language. Every frontend change follows
this document.

**Token workflow:** `src/theme/tokens.ts` is the single source. The marked block in
`src/index.css` (`/* @vault-tokens:start/end */`) is generated from it and guarded by
`src/theme/__tests__/tokens.sync.test.ts` — **never edit the block by hand**. After changing a
value in `tokens.ts`:

```powershell
$env:VAULT_SYNC='1'; npm run tokens:sync   # rewrites the block
npm run test                                # plain run now passes
```

`src/theme/system.ts` derives Chakra tokens from the same file. `contrast.test.ts` enforces
WCAG AA (text ≥ 4.5:1, graphics ≥ 3:1) in both modes — a value change that fails contrast fails
the suite.

## Palette — Phosphor Vault

Near-black navy, amber primary, green/red status. Dark is the designed canvas; light
("Parchment Vault") is a tuned sibling, not an inversion.

**The rule that protects everything: amber never encodes polarity.** Amber = brand, focus,
attention, selection, live/current position. Gain/loss is always green/red **plus** a sign or
arrow (`Delta`). Never colour a positive number amber, never render a gain without an
indicator.

| Role | Dark | Light |
|---|---|---|
| background | `#0A0E1A` | `#F6F4EF` |
| card (surface-1) | `#111828` | `#FFFFFF` |
| popover (surface-3, overlays) | `#1F2A42` | `#FFFFFF` |
| muted | `#141D31` | `#EFEBE3` |
| secondary / accent (surface-2, hover) | `#182136` | `#EFEBE3` / `#EAE5DB` |
| border | `#232C45` | `#E3DDD2` |
| input | `#232C45` | `#D9D2C4` |
| foreground | `#E9EDF6` | `#14181F` |
| muted-foreground | `#8891A8` | `#6E6A62` |
| primary (amber) | `#FFB454` | `#B45309` |
| primary-foreground | `#201403` | `#FFF8EC` |
| gain | `#3DD68C` | `#15803D` |
| loss / destructive | `#FF6B6E` | `#B91C1C` |
| ring | `#FFB454` | `#B45309` |

Amber scale (`colorPalette="amber"` in Chakra, `amber-*` in Tailwind): 50 `#FFF9ED` · 100
`#FEF0D6` · 200 `#FCE0AE` · 300 `#F9C87B` · 400 `#FFB454` · 500 `#EE9A2F` · 600 `#D97706` ·
700 `#B45309` · 800 `#92400E` · 900 `#78350F` · 950 `#451A03`.

Rules:

- Never hardcode palette classes or hex in components; use semantic tokens
  (`bg-background`, `text-muted-foreground`, `border-border`, Chakra `brand`/`gain`/`loss`/
  `fg.muted`/`bg.panel`).
- Elevation = lighter surface, not shadow. Page is flat; overlays only (`popover` + 1px border
  + shadow). Four-step ladder: background → card → secondary/accent → popover.
- Selected/active signature: amber 12% tint + 1px amber left border (rows) or amber underline
  (nav/tabs).
- Chart colours come from `chartPalette` in `tokens.ts` — no hex literals in chart code.

## Typography

- UI: **Geist Variable**; numbers: **Geist Mono** (`--font-mono`), always `tabular-nums`.
- `Num` renders every price/ratio/score/count/date; `Delta` renders signed change + arrow in
  gain/loss/muted. If a number appears in the UI, it goes through `Num`.
- Labels (table headers, chips, status rail): 11px uppercase, `tracking-[0.08em]`, muted; mono
  for status/rail text.
- Sizes: 12 / 14 / 16 / 18 / 20–24 (base / lg / page headings).
- Conditional density: repeated table numbers render at 85% opacity
  (`color-mix(in oklab, var(--gain) 85%, transparent)` pattern); hero metrics full strength.

## Shape, texture, elevation

- Radius: 6 (sm) / 8 (md) / 10 (lg) / 14 (xl). Terminal-adjacent: squarer than consumer UI,
  softer than Bloomberg.
- Borders: 1px hairlines; colour from `--border`.
- Spacing: 4px grid; table density never changes for style.
- Backdrop texture: scanlines (1.5% white) + amber radial glow (dark) / faint warm grain
  (light), fixed, `aria-hidden`, `pointer-events-none`, `-z-10`, DOM-ordered before
  `AmbientField`; disabled under `prefers-contrast: more`.

## Motion

- Durations: `--duration-fast` 120ms (feedback) · `--duration-base` 200ms (overlays, tickers) ·
  `--duration-entrance` 320ms (entrances). One curve: `--ease-vault`
  `cubic-bezier(0.16, 1, 0.3, 1)`.
- Two classes: **narrative** (chrome/overlays — eased) vs **data** (numbers/rows — instant or
  linear, ≤ 120ms).

Signatures (the whole inventory):

1. `ValueFlash` — colour-only tint 80ms + fade 220ms on value change; never movement.
2. `NumberTicker` — hero metrics only; dense cells flash, never count up.
3. Status rail — real pipeline facts, mono; marquee only on overflow, pauses on hover/focus.
4. Chart entrance — canvas wipe / recharts draw once (320ms), markers pop staggered ≤ 10.
5. Overlays — scale 0.98→1 + fade 200ms; dialog rows stagger 16ms.
6. Route entrance — `BlurFade` 320ms, enter-only.
7. Theme toggle — View Transitions circular wipe; instant fallback.
8. `BorderBeam` — amber "scan" on the run card while running.
9. Row entrance — first load only: 12ms stagger, cap 8 rows; sorting/filtering is instant.

**Loops — complete whitelist:** Market Ring loader, status-rail marquee (overflow only),
last-run status dot pulse. Max one loop per viewport zone. Loops never render inside tables,
summaries, or chart interiors.

- Honouring `prefers-reduced-motion: reduce` is mandatory: final state instantly or nothing
  runs. Use `usePrefersReducedMotion`; every animated component ships a reduced-motion test.

## 3D and the loader

- **Market Ring** (`components/three/MarketRingLoader.tsx`) is the pipeline loader: 48
  instanced candlesticks in a rotating ring, breathing height wave, amber torus base, fixed
  gain/loss pulse candles. ≥ 96px contexts only (run card 120, login 120, dialog 80); inline
  buttons use Chakra `Spinner`.
- Gates: lazy chunk, `hasWebGL()` else the CSS `vault-pulse` ring; hidden below `md`; paused
  when the tab is hidden; `role="status"` + sr-only label; reduced motion → static single
  frame (frozen skyline).
- `AmbientField` (decorative background embers) keeps its gates: lazy chunk, WebGL-gated,
  hidden below `md`, paused when hidden, off under reduced motion. Three.js must never appear
  in the initial bundle chunk.
- Decorative 3D never obscures or competes with data.

## Icons and accessibility

- Library: `lucide-react` only. 16px default, 14px dense, `strokeWidth={1.75}`.
- Decorative icons `aria-hidden="true"`; icon-only buttons always `aria-label`.
- Colour is never the only signal: `Delta` pairs colour with arrow + sign everywhere.
- Focus: visible amber ring, 2px, offset 2px, both modes.
- Contrast test (`src/theme/__tests__/contrast.test.ts`) is the gate; do not bypass it.
