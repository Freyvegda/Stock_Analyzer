# Design Set — Stock Analyzer (Sakura Vault)

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

## Palette — Sakura Vault

Plum-ink near-black, sakura blossom primary, green/red status. Dark is the designed canvas
("Moonlit Sakura"); light ("Petal Paper") is a tuned sibling, not an inversion.

**The rule that protects everything: the brand hue never encodes polarity.** Sakura = brand,
focus, attention, selection, live/current position. Gain/loss is always green/red **plus** a
sign or arrow (`Delta`). Never colour a positive number sakura, never render a gain without an
indicator.

| Role | Dark | Light |
|---|---|---|
| background | `#0C080B` | `#FBF6F8` |
| card (surface-1) | `#140F13` | `#FFFFFF` |
| panel (floating overlay, auth card) | `#201821` | `#FDF2F6` |
| popover (surface-3, overlays) | `#201821` | `#FFFFFF` |
| muted | `#120D11` | `#F5EDF0` |
| secondary / accent (surface-2, hover) | `#1A1219` | `#F3E7EC` |
| border | `#2C2129` | `#E7D8DF` |
| input | `#2C2129` | `#DCC9D2` |
| foreground | `#F2EAF0` | `#1A1116` |
| muted-foreground | `#A4939E` | `#6E5F68` |
| primary (sakura) | `#FFA9C6` | `#B0336A` |
| primary-foreground | `#2B0D1A` | `#FFF6FA` |
| gain | `#3DD68C` | `#15803D` |
| loss / destructive | `#FF6B7A` | `#B91C1C` |
| ring | `#FFA9C6` | `#B0336A` |

Sakura scale (`colorPalette="sakura"` in Chakra): 50 `#FFF5F8` · 100 `#FFE7EF` · 200 `#FFC9DD` ·
300 `#FFA9C6` · 400 `#FF8FB5` · 500 `#F472A5` · 600 `#DB4E8A` · 700 `#B0336A` · 800 `#8C2753` ·
900 `#6B1D40` · 950 `#4A1029`.

Rules:

- Never hardcode palette classes or hex in components; use semantic tokens
  (`bg-background`, `text-muted-foreground`, `border-border`, Chakra `brand`/`gain`/`loss`/
  `fg.muted`/`bg.panel`). `vault-rules.test.ts` also bans the legacy amber hexes and tints.
- Elevation = lighter surface, not shadow. Page is flat; overlays only (`popover` + 1px border
  + shadow). Four-step ladder: background → card → secondary/accent → popover. The liquid-glass
  navbar and the fundamentals side rail are the sanctioned overlay shadow surfaces (see below).
- Selected/active signature: sakura 12% tint + 1px sakura left border (rows) or the glass pill
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
- Backdrop texture: scanlines (1.5% white) + blossom radial glow (dark) / faint petal grain
  (light), fixed, `aria-hidden`, `pointer-events-none`, `-z-10`, DOM-ordered before
  `Bonfire`; disabled under `prefers-contrast: more`. The page colour is painted by
  **`html`, never `body`** (see the `index.css` base layer): a `body` background paints above
  negative-`z-index` layers, which silently hid the backdrop, the particle field and the garden.

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
9. Navbar — pointer sheen, hover brighten, spring active pill, one-shot entrance; no tilt or
   movement on pointer move (see the navbar section).

**Loops — complete whitelist:** Sakura Leaf loader, status-rail marquee (overflow only),
last-run status dot pulse, Bonfire flame + embers (signed-in app), Sakura Garden falling
petals (login only). Max one loop per viewport zone; `/login` swaps the bonfire out for the
garden. Loops never render inside tables, summaries, or chart interiors.

- Honouring `prefers-reduced-motion: reduce` is mandatory: final state instantly or nothing
  runs. Use `usePrefersReducedMotion`; every animated component ships a reduced-motion test.

## Liquid-glass 3D navbar

`components/GlassNav.tsx` is the app chrome: a sticky, detached glass capsule (page-gutter
inset, `--radius`-derived rounding) holding the brand, three route links, the username, logout
and the theme toggle.

- Surface: `.glass-nav` in `index.css` — token-derived `color-mix` gradient over
  `backdrop-filter: blur(14px) saturate(1.35)`, 1px mixed border, inset top highlight and a
  soft drop shadow. This is one of the sanctioned overlay shadow surfaces.
- Pointer response: **sheen only.** A `::after` radial gradient in 14% `--primary` follows the
  pointer through `--sheen-x`/`--sheen-y` (written straight onto the node; no re-render) and
  fades with `--sheen-opacity`. The capsule never tilts, rotates, scales or translates toward
  the cursor (owner ruling, 2026-09-27).
- Hover: border and inner top highlight brighten toward the brand hue, and inactive links take
  a faint 8% sakura tint — colour only.
- Active link: `.glass-nav-pill` (12% tint, 30% border, soft glow) springs between links via
  `layoutId="nav-active-pill"`; a static highlight under reduced motion.
- Entrance: one-shot 320ms fade + 8px rise + blur clear. Not a loop.
- Gates: sheen off for coarse pointers (`(pointer: fine)` only) and under reduced motion
  (`data-sheen="on|off"` for tests); `aria-label="Primary"` landmark; pills are decorative.
- Nav stock search: `.glass-field` in `index.css` extends the same recipe — translucent
  `color-mix` gradient over `backdrop-filter: blur(10px) saturate(1.2)`, 1px mixed border,
  inset top highlight; `:hover`/`:focus-within` brighten the border toward sakura (colour
  only). Always visible at every width (own row on narrow screens; no icon trigger), and
  Ctrl/Cmd+K focuses it. The results panel (`.glass-panel`) keeps the perspective entrance
  and pointer sheen described above.

### Fundamentals side rail

`components/FundamentalNav.tsx` renders the fundamentals section rail inside the page content:
a `.glass-rail` capsule on the same glass recipe as the navbar, no sheen. It reads as
**floating** (owner request, 2026-09-27) — detached from the page edges and the content column,
with a larger, softer drop shadow than the capsule; hover brightens the border and inner top
highlight toward sakura (colour only, never movement). Dark mode carries its own depth recipe
(`.dark .glass-rail`): a drop shadow dies on the near-black page, so the capsule gets a lifted
surface mix with a specular top sheen, an inner bevel (top highlight, bottom shadow, side rims)
and a faint sakura under-glow; dark hover brightens the same edges toward sakura. One-shot
entrance: 320 ms fade + 12 px slide-from-left + blur clear. The active child link carries the
same glass pill (`layoutId="fundamental-nav-pill"`, static highlight under reduced motion,
`data-motion="animated|static"` on the rail). No loop animation — the whitelist above is
unchanged.

## 3D and the loader

- **Sakura Leaf** (`components/three/SakuraLeafLoader.tsx`) is the app loader: a low-poly
  sakura leaf flies downwind on gusting air, swaying in x, climbing and diving in y, banking
  its nose into every rise and fall and fluttering as it goes. It leads a streaming tape of
  candlesticks: the leaf's own flight path chopped into fixed-width slots — open at the
  slot's start, close at its end, wicks from the extremes between — so a rising leaf writes
  rising candles and a diving leaf writes falling ones. The tape stays on the brand ladder:
  climbing candles brighten toward the palette's light pole, falling candles dim, and the
  tail fades out as it streams past. Brand-only is deliberate — the loader never introduces
  gain/loss polarity (green/red stays reserved for real data); direction reads as brightness.
  Blade outline, surface curl, wind clock, price curve, candle slots, offset and fade are
  pure, seeded helpers in `three/leafTrace.ts` (three-free, unit-tested); the scene component
  is a thin renderer. Contexts: run card 120 (centred with hint + elapsed timer beneath while
  a screen run is in flight), login 120, criteria dialog 80. During a screen run this is the
  only running animation: the run button swaps to "Running…" + disables, and no border crawl
  plays around the card.
- Gates: lazy chunk, `hasWebGL()` else the CSS `vault-pulse` ring; hidden below `md`; paused
  when the tab is hidden; `role="status"` + sr-only label; reduced motion → frozen static
  frame (no flight, bank, flutter, sway or streaming).
- **Nav search** (`components/NavSearch.tsx`) is the one 3D overlay surface beyond the
  capsule: `.glass-panel` in `index.css` reuses the capsule's token-derived glass recipe with
  a denser popover mix for readability, enters with a perspective tilt
  (`rotateX(8→0)`, fade, 200 ms), staggers its rows 16 ms and carries the same pointer sheen.
  The search input expands in place (200 ms width + fade). Inside the capsule the search is a
  passive item: no tilt, no movement. Gates: sheen only for fine pointers
  (`data-sheen="on|off"`), everything static under reduced motion (`data-motion`), rows sit
  above the sheen, and the panel closes on Escape/outside click.
- **Candle Ridge** (retired 2026-09-27): the stock detail hero was removed with its helpers
  and tests; the page is data-first again (description | verdict halves, then the chart).
  The retired implementation lived in `three/CandleRidge.tsx` + `three/ridgeGeometry.ts`.
- `Bonfire` (the signed-in background fire and the app's ember source) keeps the gates of the
  ambient field it replaced: lazy chunk, WebGL-gated, hidden below `md`, paused when hidden,
  frozen under reduced motion. Three.js must never appear in the initial bundle chunk.
- Decorative 3D never obscures or competes with data.

## Bonfire

`components/three/Bonfire.tsx` is the signed-in app's decorative layer, replacing the old
`AmbientField` particle wash: a campfire in the bottom-right corner of the viewport that is
also the source of every ambient ember. A stone ring and three crossed logs sit under six
low-poly flame layers — a dim sakura shell, two thin licks leaning off the sides, the amber
body and the cream heart — all grown as wonky jittered cones with a baked alpha ramp (opaque
at the logs, thin at the tips) and an RGB gradient written per frame, plus a code-generated
soft bloom and a flickering point light on the ring. The 280-ember field is seeded
(`mulberry32`, `BONFIRE_SEED`) and deterministic: every ember is born inside the flame mouth
(that is the only source), climbs the viewport slowly and drifts through depth as it rises,
staying bright for most of the climb and dying out overhead. Depth travel is climb-scaled, so
the fire is always where an ember starts; per-ember pixel size and a far-haze dim sell the 3D.
Two populations keep the picture: a dense crowd that hugs the fire and a thin tail of
wanderers that carries sparks across the whole screen. `emberSeeds`, `emberPose`, `motionFor`,
`EMBER_LIMITS`, `EMBER_PIXEL` and the still-frame time live in `three/emberField.ts`
(three-free, unit-tested), so the scene component stays a thin renderer and
`components/three/**` stays hex-free.

- Theme: colours come from `bonfirePalette` (`tokens.ts`, a sibling of `scenePalette`, outside
  `ThemeTokens`) and the burn profile from `motionFor`. The night fire is slower and brighter,
  flickers harder and carries an additive bloom; the day fire is finer, calmer and quicker, and
  its bloom becomes a soft blush veil (normal blending) instead of glow. Palette and profile
  crossfade over roughly 300ms on theme change, the way the garden crossfades moon→sun; under
  reduced motion the swap is instant.
- Gates: identical to the ambient field it replaced — lazy chunk, `hasWebGL()` else nothing,
  hidden below `md`, paused when the tab is hidden, `aria-hidden`, `pointer-events-none`,
  `-z-10`. Reduced motion freezes a still frame (`frameloop="demand"`) rather than removing the
  fire.
- Budgets: 280 embers (cap 320, one instanced mesh of axis-aligned square pixel quads,
  `EMBER_PIXEL` ≈ 2–3 screen px before per-ember scale), 9 stones, 3 logs, 6 flame layers, one
  bloom sprite, one 128px canvas texture — no assets, no new dependency.
- The fire is never interactive and never carries text; toasts (also bottom-end) render above
  it.

## Sakura Garden (login only)

`components/three/SakuraScene.tsx` is the `/login` backdrop. Sakura is now the site-wide brand
hue; what stays **login-only** is the garden itself — the tree, the blossom canopy and the
falling petal field never appear anywhere else. The scene's colours live in `scenePalette`
(`src/theme/tokens.ts`), deliberately **not** part of `ThemeTokens` — it never becomes a CSS
variable, never enters the synced `index.css` block, and reaches three.js as props, so
`components/three/**` stays hex-free and `vault-rules.test.ts` needs no exception.

- Scene: sky gradient (blue zenith fading to warm sand in light, plum night in dark),
  **moon in dark mode / sun in light mode** in the top-left corner, and a procedurally
  grown low-poly cherry tree in the right-hand band. Both celestial bodies exist in the
  scene and crossfade with the theme, so switching modes reads as sunrise/sunset rather
  than a DOM swap.
- The auth card floats on `bg.panel`: a dedicated overlay surface (light `#FDF2F6`, a blush
  petal tint rather than card white; dark `#201821`) defined in `tokens.ts` and mapped in
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
- Gates: identical to the Sakura Leaf loader — lazy chunk, `hasWebGL()` else the CSS fallback,
  hidden below `md`, paused when the tab is hidden, `frameloop="demand"` with a still,
  spread-out petal field under reduced motion, `aria-hidden`, `pointer-events-none`, `-z-10`.
- Below `md` / no WebGL: the CSS fallback (sky gradient, lit disc, `.vault-petal` petals)
  keeps the same picture without a canvas.
- Only the auth card sits above the scene, and the card is opaque: no text or data is ever
  rendered over 3D.
- `Bonfire` does not mount on `/login` — one decorative loop per viewport zone. The Sakura Leaf
  loader appears only during the `loading` phase, before the garden is drawn.

The tree and petal field are the only sakura *motifs*; the rest of the app carries the sakura
*palette* through the semantic tokens. Polarity stays green/red plus sign everywhere.

## Icons and accessibility

- Library: `lucide-react` only. 16px default, 14px dense, `strokeWidth={1.75}`.
- Decorative icons `aria-hidden="true"`; icon-only buttons always `aria-label`.
- Colour is never the only signal: `Delta` pairs colour with arrow + sign everywhere.
- Focus: visible brand ring, 2px, offset 2px, both modes.
- Contrast test (`src/theme/__tests__/contrast.test.ts`) is the gate; do not bypass it.
