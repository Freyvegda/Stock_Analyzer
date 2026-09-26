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

Near-black obsidian, amber primary, green/red status. Dark is the designed canvas; light
("Parchment Vault") is a tuned sibling, not an inversion.

**The rule that protects everything: amber never encodes polarity.** Amber = brand, focus,
attention, selection, live/current position. Gain/loss is always green/red **plus** a sign or
arrow (`Delta`). Never colour a positive number amber, never render a gain without an
indicator.

| Role | Dark | Light |
|---|---|---|
| background | `#050607` | `#F6F4EF` |
| card (surface-1) | `#0C0E12` | `#FFFFFF` |
| popover (surface-3, overlays) | `#1A1D22` | `#FFFFFF` |
| muted | `#101216` | `#EFEBE3` |
| secondary / accent (surface-2, hover) | `#14171C` | `#EFEBE3` / `#EAE5DB` |
| border | `#23262E` | `#E3DDD2` |
| input | `#23262E` | `#D9D2C4` |
| foreground | `#E9EDF6` | `#14181F` |
| muted-foreground | `#868C9A` | `#6E6A62` |
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
  `AmbientField`; disabled under `prefers-contrast: more`. The page colour is painted by
  **`html`, never `body`** (see the `index.css` base layer): a `body` background paints above
  negative-`z-index` layers, which silently hid the backdrop, the ember field and the garden.

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
8. Row entrance — first load only: 12ms stagger, cap 8 rows; sorting/filtering is instant.

**Loops — complete whitelist:** Market Ring loader, status-rail marquee (overflow only),
last-run status dot pulse, Sakura Garden falling petals (login only). Max one loop per
viewport zone; `/login` swaps the ambient ember field out for the garden. Loops never
render inside tables, summaries, or chart interiors.

- Honouring `prefers-reduced-motion: reduce` is mandatory: final state instantly or nothing
  runs. Use `usePrefersReducedMotion`; every animated component ships a reduced-motion test.

## 3D and the loader

- **Market Ring** (`components/three/MarketRingLoader.tsx`) is the app loader: 48 instanced
  candlesticks in a rotating ring with an amber-only tone ladder (no gain/loss candles),
  breathing travelling wave plus a slow harmonic, a flare highlight sweeping the ring, a
  counter-rotating thin arc, and a breathing amber torus base. Contexts: run card 120 (centred
  with hint + elapsed timer beneath while a screen run is in flight), login 120, criteria
  dialog 80. During a screen run this is the only running animation: the run button swaps to
  "Running…" + disables, and no border crawl plays around the card.
- Gates: lazy chunk, `hasWebGL()` else the CSS `vault-pulse` ring; hidden below `md`; paused
  when the tab is hidden; `role="status"` + sr-only label; reduced motion → frozen static
  frame (no rotation, flare or breathing).
- `AmbientField` (decorative background embers) keeps its gates: lazy chunk, WebGL-gated,
  hidden below `md`, paused when hidden, off under reduced motion. Three.js must never appear
  in the initial bundle chunk.
- Decorative 3D never obscures or competes with data.

## Sakura Garden (login only)

`components/three/SakuraScene.tsx` is the `/login` backdrop and the **one sanctioned
exception to the amber-only rule**: it is the only surface allowed to carry the sakura
palette. Its colours live in `scenePalette` (`src/theme/tokens.ts`), which is deliberately
**not** part of `ThemeTokens` — it never becomes a CSS variable, never enters the synced
`index.css` block, and reaches three.js as props, so `components/three/**` stays hex-free
and `vault-rules.test.ts` needs no exception.

- Scene: sky gradient (blue zenith fading to warm sand in light, obsidian night in dark),
  **moon in dark mode / sun in light mode** in the top-left corner, and a procedurally
  grown low-poly cherry tree in the right-hand band. Both celestial bodies exist in the
  scene and crossfade with the theme, so switching modes reads as sunrise/sunset rather
  than a DOM swap.
- The auth card floats on `bg.panel`: a dedicated overlay surface (light `#FBF6EE`, a warm
  sand tint rather than card white; dark `#1A1D22`) defined in `tokens.ts` and mapped in
  `system.ts`. It keeps the card distinct from the page background over the 3D scene, and
  `contrast.test.ts` gates `foreground` and `muted-foreground` against it in both modes.
- Tree silhouette follows the reference blossom photograph: a short dark trunk lifting a
  broad, dense, rounded canopy that is wider than it is tall (flowers packed from the first
  canopy level out to the tips — no bare scaffolding). It is scaled to `TREE_HEIGHT_FRACTION`
  (78%) of the viewport height, so it runs the right edge top to bottom, and its left edge is
  held `CARD_GAP_PX` (24px) right of the auth card's right edge. `treePlacement` in
  `three/sakuraTree.ts` computes this from pure inputs and is unit-tested from 768px to
  2560px: the tree never touches the card's footprint, on any width.
- Composition rule: **the blossom canopy is always the top of the tree.** Petals spawn from
  inside the *lower* canopy (`PETAL_SPAN.maxY` below the canopy top — asserted in the scene
  test) and fall in a layer behind the blossom dome (`PETAL_DEPTH`), so the topmost blossom
  branch always reads above the falling petal cloud. Petals are deliberately sparse (70) —
  a few stragglers, not a blizzard.
- Determinism: tree, blossom clusters and petal field come from a seeded `mulberry32`
  stream — no `Math.random`, identical scene every load. `buildTree`, `treeBounds`,
  `treePlacement`, `petalSeeds`, `petalPose` and `withAlpha` live in `three/sakuraTree.ts`
  (three.js-free, unit-tested: budgets, bounds, taper, fall wrap, canopy-above-petals,
  card clearance, contrast).
- Budgets: `TREE_LIMITS` caps segments (420), blossoms (1100) and petals (90); one instanced
  mesh each, no textures, no post-processing, no new dependency. `dpr` up to 2 with
  `antialias: true` on the canvas, `meshStandardMaterial` + `flatShading` (8-sided branches,
  detail-1 icosahedron blossoms) for crisp low-poly facets; unlit petals.
- Gates: identical to the Market Ring — lazy chunk, `hasWebGL()` else the CSS fallback,
  hidden below `md`, paused when the tab is hidden, `frameloop="demand"` with a still,
  spread-out petal field under reduced motion, `aria-hidden`, `pointer-events-none`, `-z-10`.
- Below `md` / no WebGL: the CSS fallback (sky gradient, lit disc, `.vault-petal` petals)
  keeps the same picture without a canvas.
- Only the auth card sits above the scene, and the card is opaque: no text or data is ever
  rendered over 3D.
- `AmbientField` does not mount on `/login` — one decorative loop per viewport zone. The
  Market Ring appears only during the `loading` phase, before the garden is drawn.

Sakura pink is **scene-only**. Amber stays the only brand/attention colour and polarity
stays green/red plus sign: no pink in the shell, cards, tables, charts or status rail.

## Icons and accessibility

- Library: `lucide-react` only. 16px default, 14px dense, `strokeWidth={1.75}`.
- Decorative icons `aria-hidden="true"`; icon-only buttons always `aria-label`.
- Colour is never the only signal: `Delta` pairs colour with arrow + sign everywhere.
- Focus: visible amber ring, 2px, offset 2px, both modes.
- Contrast test (`src/theme/__tests__/contrast.test.ts`) is the gate; do not bypass it.
