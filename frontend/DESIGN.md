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
10. Category dial — the criteria editor's rotor turns under its finger stop with a slight
    overshoot (420 ms, `cubic-bezier(0.34, 1.32, 0.5, 1)` — the one sanctioned overshoot, a
    real dial snapping home); the plate enters with a shallow perspective tilt. A turn is a
    selection response, not a loop.

**Loops - complete whitelist:** Sakura Leaf loader, status-rail marquee (overflow only),
last-run status dot pulse, Bonfire flame + embers (signed-in app), Sakura Garden falling
petals (login only), Pagoda tower (landing page only). Max one loop per viewport zone;
`/login` swaps the bonfire out for the garden, and `/` swaps it out for the pagoda. Loops
never render inside tables, summaries, or chart interiors.

The landing page is allowed one *primary* loop (the tower: sway, lantern swing, roof
reveal) plus a **shared atmosphere loop** (petals, fireflies, birds and the water, all
driven off the same clock so they read as one weather system rather than four unrelated
animations). No other loop mounts in the landing viewport.

6. **Pagoda tower** (landing page `/` only) - scroll-linked, four storeys, one open at a
   time; a slow finial and eave sway is its only autonomous motion. Under reduced motion it
   renders a single static frame; below `md` a static inline SVG mark replaces it and the 3D
   chunk is never requested. The landing page carries the primary loop and the shared
   atmosphere loop, and nothing else.

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
- Screen tabs (criteria page): `.glass-tab`/`.tab-strip` in `index.css` continue the glass
  family — glass tab shapes; the active tab takes a 12% sakura tint, 35% border and a soft
  under-glow and merges into the connected panel below (no bottom border; the panel drops its
  top rounding). The strip scrolls horizontally with an edge mask; tabs are focus-visible
  ringed; an unsaved draft marks the active tab with a sakura dot plus an sr-only
  "(unsaved changes)" description. Naming happens inside the strip: `+` spawns a dashed draft
  tab whose textbox is temporary (strict tablist semantics trade-off, accepted), the pencil
  flips the active tab into rename-in-place. Inactive labels sit brighter than muted body text
  (`foreground` 68% mixed with `muted-foreground`) so a resting tab still reads as available.
  Rename and close controls are **always visible** (hover only brightens them) and each tab
  reserves their width — `pr-12` on the active tab for both, `pr-7` elsewhere for close only —
  so a control never lands on the label. No new colours, no loops.
- Criterion flashcards: `.glass-card` continues the same recipe (55% card → 40% background
  gradient, inset top highlight, soft shadow); hover/focus-within brighten toward sakura;
  bookmarked cards carry a 2px sakura left edge; disabled cards dim with a dashed border; the
  editor's add tile is the dashed variant.
- Criteria stack and rotor dial (2026-09-29/30): the screen tab strip, the enabled-ratio
  summary and the criteria editor read as ONE card stack — the shell owns the frame, keeps a
  small gap between the tab row and the summary, and drops its bottom edge; the editor
  accordion drops its top edge. Breathing room is deliberate on a 4px grid: page title →
  stack 24px, tab row inset 16px, tab row → summary 20px, editor trigger 16px. The dial (`.dial-plate`/`.dial-rotor`/`.dial-wedge`/
  `.dial-hole`) is the "dialling telephone" control: a raised glass plate carrying a short,
  fat rotor ring cut into one wedge per category, a recessed finger hole per wedge, a fixed
  finger-stop notch at 6 o'clock and a hub that names the chosen category. The rotor is a
  plain element turned by a **CSS transform** — rotating an SVG `<g>` repaints geometry every
  frame, which is what made the first cut choppy — with `will-change: transform` and the
  overshoot curve above. Wedges tint toward sakura on hover and hold a 22% wash plus a soft
  glow while chosen; the enabled share is a sakura arc just inside the rim. Focus-visible on a
  wedge strokes the wedge itself: `outline` paints a rectangle around an SVG path's bounding
  box, which read as a stray square around the dial. Everything is static under reduced
  motion (no entrance, instant turn).
- Editor motion: the add-criterion dropdown enters with the nav-search recipe
  (`.combobox-pop`: rotateX 8→0 + fade 200 ms, 16 ms option stagger), accordion content
  animates height + fade 200 ms (`--height` keyframes), flashcards stagger 12 ms (cap 8). All
  of it is static under reduced motion.
- Focus-ring exception (2026-09-29): `.glass-tab` uses `outline-offset: -2px` so the ring sits
  inside the glass silhouette; every other surface keeps the 2px offset.
- Nav stock search: `.glass-field` in `index.css` extends the same recipe — translucent
  `color-mix` gradient over `backdrop-filter: blur(10px) saturate(1.2)`, 1px mixed border,
  inset top highlight; `:hover`/`:focus-within` brighten the border toward sakura (colour
  only). Always visible at every width (own row on narrow screens; no icon trigger), and
  Ctrl/Cmd+K focuses it. The results panel (`.glass-panel`) keeps the perspective entrance
  and pointer sheen described above, and spans the field's width.
- Nav layout: brand + links, then the search, then the account cluster — one row (`lg:flex-nowrap`),
  right-aligned as a group. The search takes the row's spare width, capped at 24rem and floor-ed at
  12rem, so it stays the biggest thing in the capsule without pushing the row into a second line;
  below `lg` the cluster moves to a second, full-width row. It is never centred: the capsule's
  centre is not a fixed landmark when the link labels change length, and a centred column pushed
  the links into a wrapped second line.

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
- **Ribbon Rail** (`components/three/RibbonRail.tsx`, 2026-09-29): bookmarked criteria as
  low-poly sakura ribbons on one shared glass rail at the top of the inline criteria editor.
  Each bookmark is a ribbon (label carried by the sr-only button list; the canvas mirrors it);
  bookmarking drops a ribbon onto the rail and unbookmarking lets the rest reflow to close the
  gap — one-shot easing per change, never a loop, so the whitelist above is unchanged.
  Clicking a ribbon opens its category and scrolls the row into view. Gates: lazy chunk,
  WebGL probe once per mount, desktop-only, static under reduced motion
  (`data-motion="animated|static"`).
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

## Pagoda

`components/three/Pagoda.tsx` is the landing page's scene: a four-storey pagoda at `/`, approached
on foot. The visitor walks a gate path — one torii per feature section — while the pagoda stands
in the distance, and the sign-up steps back to present it whole. It is the one marketing surface
in a tool that is otherwise dense and tabular, and it is the only place the storey metaphor is
used.

- **One source of truth.** `src/content/tower.ts` holds the tier list — id, heading, tagline,
  route, badge, cards. Both the scene and the DOM sections read it, and every geometry function
  derives from `TOWER_TIERS.length`, so the pagoda cannot end up with a different number of
  storeys than the page has sections.
- **Geometry is pure.** `pagodaLayout`, `pagodaRoofVertices`, `finialLayout`, `towerPose`,
  `storeyOpenings`, `roofCourses`, `hangingLanterns`, `baseDetail`, `pathPlan`, `pathCentre` and
  `pathRibbon` live in `three/pagodaScene.ts` — the walkway is there because the camera *is* the
  walker, and the gates stand on its line. The world's layout lives in `three/pagodaWorld.ts` —
  sky, sun or moon, ridges, grove, the sideways river, torii, stars, petals, fireflies and birds —
  and both are unit-tested with no WebGL. `storeyGeometry.ts` assembles a storey into merged
  buffers; `worldGeometry.ts` builds the ribbon strips and the gates. The renderers compute no
  shape of their own, and `components/three/**` stays hex-free. The roof is a custom
  apex-plus-eave-ring build rather than `ConeGeometry(4)`: a square pyramid does not read as a
  pagoda, and the upturned corner is the shape that does.
- **Detail** follows the reference illustration's anatomy, not its palette: corner posts, a
  veranda with balusters at each storey's floor, a ground-floor double-leaf door with ring pulls,
  lattice window screens, concentric roof tile courses with hip ridges, and lanterns hung on
  visible cords from the eave tips. Each roof's half-span is nearly twice the wall's, and the
  storey above sits on the roof *at its veranda edge*: the roof rises past the balcony to wrap
  the base of the wall, so the wall is pierced by its foundation roof rather than balanced on the
  ridge. The lanterns are the tower's own light after dark, and only a capped few carry a real
  point light — the scene's main cost control.
- **One scroll value, two consumers.** `useScroll` produces a single `MotionValue`. The scene
  samples it inside `useFrame` (continuous, no React re-render); the DOM subscribes through
  `useLandingStage` for the active stage index and the open accordion row. Neither owns the state,
  so the tower and the cards cannot disagree about which storey is open. Section pinning is CSS
  `position: sticky`.
- **One storey at a time.** Tier windows are half a stage wide so they meet edge to edge; wider
  overlaps lit two storeys at once and pulled the tower apart. The other three dim — to a floor,
  not to black: the building must stay a building.
- **The reveal is the walk.** The building never moves within itself: the storeys stay in their
  stack and only their light changes. The camera holds **one eye line** on the building's middle
  — it never climbs to a storey's centre or grows the tower to fill the frame — and walks the
  gate path, one rest point per storey, each just past a gate, easing between them. So scrolling
  is passing through a torii while the pagoda stays whole in the distance, and the sign-up is the
  step back that frames it whole again. Every pose value is damped toward its target in the frame
  loop, so scroll jitter cannot shake the building or kick the walk.
- **Passing through a gate softens the vista.** `gateSoftness` peaks as the camera crosses a
  torii and is zero at every section rest, weighted by distance — the pagoda is further away
  through the outer gates, so those are the softest. The renderer maps it to a few pixels of CSS
  blur on the canvas (`gateBlur`), only while walking inward, and the DOM is touched only when the
  value changes. It is a full-screen pass, so it is the first thing dropped: the `low` quality
  tier and `prefers-reduced-motion` get the scene sharp rather than an effect their device cannot
  carry. `worldGeometry.test.ts` and `pagodaWorld.test.ts` pin the reach, the peaks and the gate.
- **The river flows sideways.** `riverBand` + `riverRibbon`: a band across the frame behind the
  pagoda, meandering on one slow sine and drifting with the clock, on a single
  `BufferGeometry` whose *positions* are rewritten at the shared 8 Hz tick — the station xs never
  change, so the index buffer is built once. No reflections, deliberately: the surface answers the
  light diffusely, a faint emissive keeps it readable at night, and the meander plus the drift
  carry the read. ~160 vertices, one draw call, and a vertex-cap test pins it.
- **The walk is straight and paved.** `pathPlan`/`pathCentre` run the walk down the axis — a bowed
  path read as the ground swinging underfoot while the camera walked it, and rendered as a wedge.
  `pathSlabs` lays a jointed run of stone slabs from the plinth steps to the viewer, and
  `pavingGeometry` merges them with a kerb either side into one buffer: slabs flush with the walk
  surface the gates stand on, kerbs a touch proud, the run capped at twenty slabs.
- **Cost.** Three rules, each held by a test: geometry is merged per material, repeated fields are
  a single `InstancedMesh` each, and nothing calls `setState` per frame. A storey draws a handful
  of calls rather than ninety. `pickQuality` scales particles, `dpr` and shadows to the device, so
  a modest laptop or a touch device gets the same picture with fewer particles instead of a worse
  one. The river ribbon is budgeted and capped (≤ 200 vertices) and the paving run is capped at
  twenty merged slabs, the particle
  populations are ceilings in `WORLD_LIMITS`, and the gate blur is gated off on the low tier.
  Merged buffers, ribbon geometries and material sets are disposed on unmount. There is no
  drifting mist: the ridges recede by value, and full-width additive quads are exactly the fill
  cost that hurts integrated graphics.
- **Landing navigation.** The overview list and the storey rail both jump to a storey; the rail
  sits on the *right*, because the pose slides the tower left and a left rail would sit on top of
  it. Each tick is one fixed-size dot button with its label absolutely positioned, so a longer
  heading cannot make a wider "bookmark" and the four stay one size; the active dot is primary and
  the rest are muted-foreground, readable in both themes. Each storey's cards are a hover-open,
  keyboard-operable accordion, one row at a time, which is also what carries the content when the
  3D is absent. Storeys marked `in-progress` do not link to their own stub route: they say so and
  offer a screen that works.
- **Copy sits on glass.** Every feature block, the overview list and the sign-up panel are
  token-derived translucent surfaces (`bg-background/70` + blur + hairline border), so headings,
  taglines, rows and links stay legible over the day scene, where a pale sky and a bright river
  sit directly behind them.
- **Colour.** `pagodaPalette` (`tokens.ts`, a sibling of `bonfirePalette`, outside `ThemeTokens`).
  Both palettes are resident and crossfade over roughly 300ms, like the bonfire. The pagoda is
  brand, not status: lit surfaces use sakura and the site's own plum-ink neutrals, and **no
  element ever encodes gain or loss** — a roof tinted by "did this stock pass" would break the
  rule above. `Pagoda.test.tsx` pins this.
- **Gates:** lazy route chunk *and* lazy scene chunk (three.js is never in the initial bundle, and
  a visitor landing on `/login` never downloads it), `hasWebGL()` else nothing, hidden below `md`,
  paused when the tab is hidden, `aria-hidden`, `pointer-events-none`, `-z-10`.
- **Degradations, deliberately different.** Below `md`, without WebGL, or under reduced motion the
  DOM story carries the whole content on its own: same four sections, same cards, no 3D chunk
  requested. Reduced motion additionally renders a single static frame rather than removing the
  scene outright, which is the "final state instantly" rule.
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
