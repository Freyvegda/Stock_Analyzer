# Pagoda scene and landing flow — design

Date: 2026-09-29
Phase: 1.8
Status: approved in conversation, written here for review

## Problem

The landing page's pagoda is technically correct and visually poor. Four stacked
boxes with two-band pyramid roofs, four 0.075-unit cubes for lanterns, and no
anything around it — no sky, no sun or moon, no ground, no depth. The scene is
also small: `towerPose` tops out at `scale` 0.56 in a camera at `z` 6.4, so the
tower reads as a detail rather than a hero. The page's story section is three
static cards in a grid, and two of the four storeys carry a "In progress" badge
whose CTA still links to a stub route.

The user has supplied a reference illustration: a flat, outlined, red-and-indigo
five-storey pagoda with upturned eaves, corner columns, railings, a double-leaf
door, lattice window screens, a stepped plinth, red lanterns hanging on strings
from the eave tips, and a finial. It is the structural brief, not the palette.

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Scenery | Full scene: mountains + mist, ground + water, torii path + stone lanterns, atmosphere (petals/fireflies/birds) | Gives the tower somewhere to be |
| Accordions | Hover-open, scroll-linked | One shared state, so DOM and 3D cannot disagree |
| Flow changes | All five: honest routes, storey rail, clickable overview ToC, honest unbuilt storeys, scroll memory | Each was requested |
| Sun/moon | Fixed in the sky, themed; light = sun, dark = moon | A real sky, not a scroll gimmick |
| Unbuilt storeys | Marked, CTA not a link, secondary link to a working storey | No dead ends, no pretending |
| Art direction | Reference *structure*, site sakura/plum palette | Keeps the identity `DESIGN.md` locks in |
| `DESIGN.md` loop rule | Amend to a zone budget | The old "no second loop" wording makes the scene illegal |

## Art direction

The reference's *anatomy* is adopted wholesale — upturned eaves with tile
courses, corner columns, veranda with balusters, lattice screens, hanging
lanterns on visible cords, stepped plinth with balustrade, a finial. Its
*colours* are not. Everything reads through `pagodaPalette`, which stays outside
`ThemeTokens` so `components/three/**` remains hex-free and `vault-rules.test.ts`
needs no exception.

No element ever encodes gain or loss. A roof tinted by "did this stock pass"
would break the site's core rule, and `Pagoda.test.tsx` pins this.

## The tower

Four storeys, matching `TOWER_TIERS.length` so the scene and the page cannot
disagree about the storey count. `content/tower.ts` stays the single source of
truth for that number.

Per storey:

- Plastered body, corner columns inset inside the wall line.
- Veranda deck between body and eave, with a railing and balusters.
- Roof built on the existing `pagodaRoofVertices` (apex, concave sag, upturned
  corners) plus **tile courses**, four **hip ridges**, **eave tile-ends**, and a
  bracketed soffit.
- **Lanterns hung on visible cords** from the eave tips — the detail the
  reference is most specific about. Each lantern is a ribbed paper body with top
  and bottom caps, emissive, plus a point light.
- The **ground storey** gets the most detail, matching the reference: a
  double-leaf door with frame and ring pulls, a threshold step, and lattice
  window screens flanking it.

Finial: stacked rings over a rod (exists), plus a tip jewel with a soft additive
glow sprite and a hanging wind-bell below.

Plinth: three stepped stone tiers (exists) plus a stone balustrade and two stone
lanterns flanking the steps.

### Light budget

Lanterns are numerous, so only the **two most forward-facing per storey** carry a
real `pointLight`. The rest are emissive-only. `pagodaScene.ts` owns the cap and
the test asserts it. This is the main cost control on the tower.

### Motion

All eased, all frozen to a single still frame under reduced motion.

- **Eave sway** — corner tips lag the body, so the building breathes.
- **Lantern pendulum** — each lantern swings on its own seeded phase, damped, and
  its emissive flickers on the swing so light pools on the wall behind it.
- **Storey reveal** — the open storey's roof rises *and* tilts ~6° while its
  lanterns swing harder, then settles. Reads as the storey being pulled open,
  not slid.

The scroll story is unchanged: one storey open at a time, one `MotionValue`
drives both the scene and the DOM.

## The world

All on **one shared clock** so it reads as a single weather system rather than
several animations.

**Sky.** Full-screen gradient dome. Plum night fading to deep indigo at the
zenith; pale paper to soft sakura in light. ~90 seeded stars, denser near the
zenith, twinkling on the shared clock. A thin cloud layer.

**Celestial body.** Fixed top-left, matching the login scene's convention.
Light = warm sun disc with a corona, positioned to agree with the existing
shadow-casting `directionalLight` so the visible disc and the shadows match.
Dark = cool moon disc with crescent shading, layered halo and faint crater
mottling, with a slow cloud shadow crossing it. Both crossfade on theme change
over ~300ms, like the palette.

**Layers back to front** — perspective gives parallax for free:

1. Three mountain ridges at increasing depth, seeded and jagged, each flatter
   and closer in value to the sky as it recedes.
2. Mist bands — soft horizontal strips drifting at different speeds, additive.
3. A sakura grove, off to the sides so it never sits behind the tower's centre.
4. Water at the base: a flipped, squashed, darkened copy of the tower group with
   a horizontal ripple distortion in the vertex shader. **Not** a real reflection
   pass — too expensive. Ripple amplitude rises when a storey opens.
5. A receding row of torii gates from the foreground to the steps, each with a
   small lantern lit at night.
6. Stone lanterns flanking the tower's steps (from the tower section), lit at
   night with a warm flicker.
7. Atmosphere: falling petals (light), fireflies on a Lissajous path pulsing
   (dark), a small flock crossing the sky (light only).

### Budgets

Capped, no textures, no post-processing, no new dependency: 3 ridges, 6 mist
planes, 4 trees, 2 instanced meshes for petals and fireflies, 8 torii, 6 stone
lanterns, ~90 stars. `dpr` `[1, 1.5]`, `antialias: false`.

If frame time is missed for a sustained window, grove, mist and torii thin out
before petals and fireflies do.

Under reduced motion the whole scene renders **one still frame** at the
atmosphere's neutral time: sky, moon/sun, water and grove all present, nothing
moving.

## Page flow

Flow is **unchanged**: hero → overview → four storeys → CTA, still seven stages,
still one storey open at a time. Everything new is inside it.

**Overview becomes a table of contents.** The four-row list is real navigation:
each row is a button, hover raises it and reveals the tagline, click scrolls to
that storey, and the currently-open storey's row is highlighted. Arrow keys move
between rows, Enter jumps.

**Storey rail** in the existing glass side-rail language: four vertical ticks,
current one filled, name on hover, click to jump.

Its side is forced by the pose, and getting it wrong puts it on top of the
tower. `towerPose` slides the tower **left** (`pose.x` reaches `-1.55`) and the
storey copy sits **right** (`ml-auto`, `md:max-w-[46%]`). So the left edge belongs
to the tower and the right half to the copy. The rail therefore goes on the
**right edge**, outside the copy column, and the copy column narrows to
`md:max-w-[42%]` with a page-gutter inset so the two never overlap at any width
from `md` to 2560px — a placement test pins the clearance, the same way
`treePlacement` does for the login scene. Hidden below `md`, where the overview
ToC already does the job, and hidden whenever the 3D is absent.

**The accordion** replaces the flat card grid. One row per card: title
collapsed, body expanded.

- One row open at a time, from a single `openRow` state.
- Hover opens it on a fine pointer (`useFinePointer` already exists for this);
  click/tap always works, so touch and keyboard are never hover-dependent.
- The open row's storey is what the tower has open. Hovering a card in storey 2
  lifts storey 2's roof. Precedence between the two inputs is explicit, because
  "which one wins" is the whole question: **scroll wins while scroll velocity is
  non-zero, and a hover takes over only after scroll has been still for
  180ms.** No velocity heuristics beyond that, and the 180ms is a named constant
  so a test can pin it.
- Height animates with `motion` (auto height + opacity), staggered 40ms per row.
  Instant under reduced motion.
- Keyboard: up/down between rows, Enter/Space to open, Escape to close.

**Honest routes.** `content/tower.ts` gains an explicit `status` per storey —
`'built' | 'in-progress'` — replacing the implicit "has a `badge`" test, and a
`fallbackRoute` for the storeys that are not built. A built storey links to its
route, or to `/login` when signed out. An unbuilt storey shows "Not built yet" as
a **non-link**, and instead offers "See the screen that works" →
`fallbackRoute`, which is `/fundamentals/criteria` for both. The storey is still
fully described in its accordion, so the roadmap stays visible. No dead links, no
pretending.

This deliberately relaxes an existing assertion: `Pagoda.test.tsx` currently
requires every tier to have a **unique** `route`, which cannot hold once two
storeys legitimately share a fallback destination. The test becomes unique `id`s
plus a valid `route` per tier, and a separate assertion that every in-progress
tier's `fallbackRoute` resolves to a route that exists.

**Scroll memory.** On mount, a stage stored in `sessionStorage` for this session
is restored, and a small "Back to the top" affordance appears instead of
re-running the hero. Cleared when the user returns to the top or closes the tab.
Falls back to the hero with no stored value. **Never `localStorage`** — the auth
token store forbids it.

## Architecture

The split `DESIGN.md` already enforces is kept: geometry and maths pure,
three-free, unit-tested in jsdom; `Pagoda.tsx` a thin renderer.

**New pure modules** (no three.js, no hex, all unit-tested):

- `three/pagodaScene.ts` — extended with `towerDetail()` (door, lattice screens,
  roof tiles, balusters, lantern cord positions, wind-bell, balustrade),
  `roofCourses()`, the lantern point-light cap, and a richer `towerPose` (tilt
  on open, ripple amplitude, per-lantern sway phases).
- `three/pagodaWorld.ts` — new. `skyGradient()`, `celestialBody()`, `mountainRidges()`,
  `mistBands()`, `grove()`, `toriiPath()`, `waterPlane()`, `starField()`,
  `petalSeeds()`/`petalPose()`, `fireflySeeds()`/`fireflyPose()`,
  `birdFlock()`, and `WORLD_LIMITS`.

All seeded from `PAGODA_SEED`. No `Math.random`. The scene is byte-identical on
every load.

**New renderers:**

- `three/PagodaWorld.tsx` — sky dome, celestial body, ridges, mist, grove, water,
  torii, atmosphere. Takes `night` and `reduced`.
- `three/PagodaStorey.tsx` — extracted from the inline `Storey`, so a 130-line
  function does not stay inside a 500-line file.
- `components/TowerAccordion.tsx` — DOM only, no three.js.
- `components/TowerRail.tsx` — the storey rail.
- `lib/useLandingStage.ts` — scroll → active stage and open row, one hook both
  consumers read.
- `lib/scrollMemory.ts` — the sessionStorage restore.

**`tokens.ts`.** `pagodaPalette` gains `skyTop`, `skyHorizon`, `ridgeNear`,
`ridgeMid`, `ridgeFar`, `mist`, `water`, `foliage`, `bark`, `star`, `sun`,
`moon`, `halo`, `torii`. Same key set in both modes — the existing test enforces
this.

**State flow.** `useLandingStage` owns `activeStage` (from scroll) and `openRow`
(from hover/click, overridden by scroll). It produces one `MotionValue` for
progress that the scene samples in `useFrame`, and plain indices for the DOM.
Neither side computes the other's value, so they cannot disagree.

## Testing

Real assertions, not finiteness checks — the existing `pagodaScene.test.ts` is
the model to follow.

- `pagodaScene.test.ts` — extended. The door is centred and narrower than the
  body; lattice bars sit inside their frame; lantern cords attach at the eave and
  each lantern hangs below its cord; roof course radii decrease; lantern sway
  phases are distinct; `towerPose` never tilts two storeys at once; the
  point-light cap holds.
- `pagodaWorld.test.ts` — new. Ridges recede in depth and in contrast;
  `celestialBody` returns a sun for light and a moon for dark **at the same
  position**, so a theme crossfade never moves it; every seed array is
  deterministic and inside its `WORLD_LIMITS` cap; petals wrap rather than
  teleport; water sits below the plinth and above the ground.
- `Pagoda.test.tsx` — the world renders only with WebGL and on desktop; both
  palettes have identical key sets; nothing encodes gain or loss.
- `TowerAccordion.test.tsx` — one row open at a time; opens on hover with a fine
  pointer; opens on click regardless; `Escape` closes; arrows move; reduced
  motion is instant; focus is never stolen.
- `Landing.test.tsx` — updated for the ToC, rail, honest routes (unbuilt storeys
  have no dead link and keep their badge), scroll restore, and that every word is
  still present with the 3D and hover both off.

`npm run build` clean, `vitest run` green, all tests offline with network mocked.

## Gates (carried forward, unchanged)

Lazy scene chunk; `hasWebGL()` else nothing; hidden below `md`; paused when the
tab is hidden; `aria-hidden`; `pointer-events-none`; `-z-10`; a single static
frame under reduced motion. The accordion and ToC carry the full content on their
own whenever the 3D is absent.

## Contract amendments

`DESIGN.md`, the loop whitelist:

> The landing page is allowed one *primary* loop (the tower) plus a **shared
> atmosphere loop** (mist, petals, fireflies and water, all driven off the same
> clock so they read as one weather system rather than four animations). No other
> loop mounts in the landing viewport.

This keeps the original intent — nothing else competing for attention — while
making the scene legal. `DESIGN.md`'s Pagoda section is updated to describe the
storey detail, the light budget, the world layer stack and the budgets.

`FRONTEND.md`'s file map gains `PagodaWorld.tsx`, `PagodaStorey.tsx`,
`pagodaWorld.ts`, `TowerAccordion.tsx`, `TowerRail.tsx`, `useLandingStage.ts`,
`scrollMemory.ts`.

## Out of scope

- No backend work. The unbuilt storeys need no new table, endpoint or form.
- No new dependency. Everything is built from three.js primitives and code.
- No change to `/login`, the app shell, or the auth token store.
- No change to the number of storeys.
