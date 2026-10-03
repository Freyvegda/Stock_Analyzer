# Pagoda scene and landing flow — implementation plan

Spec: `docs/superpowers/specs/2026-09-29-pagoda-scene-and-landing-flow-design.md`

## Order

Pure geometry and maths first, with their tests, because everything else is a
renderer over them. DOM work after the 3D, because the accordion and the ToC
read the same stage hook the scene does.

### 1. `content/tower.ts` — status and fallback
- Add `status: 'built' | 'in-progress'` per tier, `fallbackRoute` for unbuilt.
- `Pagoda.test.tsx`: unique-id assertion replaces unique-route; assert every
  in-progress tier has a `fallbackRoute`.

### 2. `three/pagodaScene.ts` — storey detail + pose
- `towerDetail(tier)`: door, lattice screens, roof tile courses, balusters,
  lantern cord anchors, wind-bell, plinth balustrade, point-light cap.
- `towerPose`: tilt on open, ripple amplitude, per-lantern sway phases.
- Extend `pagodaScene.test.ts` with real assertions.

### 3. `three/pagodaWorld.ts` — the world, pure
- `skyGradient`, `celestialBody`, `mountainRidges`, `mistBands`, `grove`,
  `toriiPath`, `waterPlane`, `starField`, `petalSeeds`/`petalPose`,
  `fireflySeeds`/`fireflyPose`, `birdFlock`, `WORLD_LIMITS`.
- New `pagodaWorld.test.ts`.

### 4. `theme/tokens.ts` — world palette
- New `pagodaPalette` keys, identical in both modes.

### 5. Renderers
- `three/PagodaStorey.tsx` — extracted from `Pagoda.tsx`, with the new detail.
- `three/PagodaWorld.tsx` — the environment.
- `Pagoda.tsx` — wire up, theme crossfade, shared clock, perf reduction.
- Extend `Pagoda.test.tsx`.

### 6. DOM
- `lib/useLandingStage.ts`, `lib/scrollMemory.ts`.
- `components/TowerAccordion.tsx`, `components/TowerRail.tsx`.
- `pages/Landing.tsx` — ToC, rail, accordion, honest CTAs, scroll restore.
- Update `Landing.test.tsx`, add `TowerAccordion.test.tsx`.

### 7. Contracts
- `DESIGN.md` loop-rule amendment + Pagoda section.
- `FRONTEND.md` file map.

### 8. Verify
- `npm run build` clean, `vitest run` green.

## Status

- [x] 1. content/tower.ts
- [x] 2. pagodaScene.ts
- [x] 3. pagodaWorld.ts
- [x] 4. tokens.ts
- [x] 5. Renderers
- [x] 6. DOM
- [x] 7. Contracts
- [ ] 8. Verify

## Revision 2 — user feedback after the first build

- [x] Remove the drifting mist entirely (`pagodaWorld.ts` note, environment,
      tests, `DESIGN.md`).
- [x] Fix the choppy motion: every pose value is damped toward its target in the
      frame loop instead of being written straight from raw scroll, camera
      included, and the per-storey lift, tilt and brightness with it.
- [x] Fix the buggy storey reveal: only the **roof** lifts and leans, so a storey
      opens instead of leaving a gap in the stack. The roof tile courses moved
      into roof-local space, where they travel with the roof.
- [x] Cut the draw calls and the RAM: merged geometry per material
      (`storeyGeometry.ts`), one material set per storey instead of one per mesh,
      instanced particle fields, no `setState` per frame, and buffers and
      materials disposed on unmount.
- [x] Scale to modest laptops and phones: `pickQuality` + `QUALITY_PROFILES`,
      covering particles, `dpr`, shadows and whether the geometry-heavy scenery
      draws at all.
- [x] Theme selector on the landing page (`ColorModeButton` in the nav).
- [x] Integrate with the rest of the frontend: the real `glass-nav` and
      `glass-panel` classes, the existing `useIsDesktop` / `useFinePointer` /
      `usePrefersReducedMotion` hooks, and the lazy scene chunk preserved.

### Known issue

The suite is flaky under parallel load: unrelated `waitFor`s in
`App.test.tsx`, `CriteriaDialog.test.tsx` and `ScreeningCriteria.test.tsx`
intermittently time out when the whole suite runs, and pass in isolation. It
predates this work but was made worse by the added tests; the geometry tests are
now memoised, which cut the worst of it.

## Revision 3 — defects found by looking at the rendered page

Every item here was invisible to the test suite and obvious on screen. Recorded
because they are the class of bug the pure-module tests cannot catch.

- [x] Storeys were all stacked at y=0 (the tier group's position was dropped in a
      rewrite), so the tower rendered as a single overlapping heap.
- [x] The torii path ran to z=6.2 against a camera at z=6.4 — a gate at the lens.
- [x] The near ridge sat at z=-6 with an 8-unit peak: a black wall across the
      frame. Ranges are now pushed back, and their *apparent* size (peak ÷
      distance) decreases with distance, which is the actual depth cue.
- [x] The horizon band was a plane at the near ridge's own depth. Coplanar
      surfaces z-fight; it drew as vertical striping across the lower frame. The
      gradient is now baked into the sky dome as vertex colours.
- [x] The ridge strips ended inside the frustum (hard vertical edge). Their reach
      is derived from the camera's field of view and a maximum aspect.
- [x] The open roof lifted a whole storey height, clearing the wall and floating
      into the storey above. It now lifts a fraction of that, and leans.
- [x] The water plane's near edge cut across the foreground.

## Revision 5 — user feedback after the rendered v1 build

The visitor's walk, rebuilt from user direction: the pagoda is the far thing you approach, one
gate per feature, and the sign-up presents it whole.

- [x] **Fewer night particles.** Fireflies 18 → 8, birds 7 → 4, clamped by `WORLD_LIMITS`, and
      fireflies pulled in to a ≤ 2.8-unit radius around the base. Tests pin both ceilings and the
      clustering.
- [x] **The moon is never painted over.** The disc writes no depth and opaque ridges behind it in
      the queue drew straight over it. `WORLD_LAYER_ORDER` puts the celestial body after the
      scenery; a test pins sky < scenery < celestial.
- [x] **The river flows sideways and meanders.** It was a straight strip under the gates — and,
      by day, a near-black slab (metalness 0.6 with no environment map). Now: `riverBand` +
      `riverRibbon`, a band across the frame behind the pagoda, meandering on one sine and
      drifting with the clock, rewritten at the shared 8 Hz tick on a geometry built once, with a
      ≤ 200-vertex cap and no reflections (diffuse material plus a faint night emissive).
- [x] **A walkway, and the gates stand on it.** `pathPlan` / `pathCentre` / `pathRibbon` (in
      `pagodaScene.ts`, because the camera is the walker): one static ribbon from the viewer to
      the plinth, bowing out and back to the building's axis. `toriiPath` places each gate on
      that centre line, so the camera passes *through* every gate rather than beside it; the row
      sits well away from the pagoda (z 5.5 → 2.8), matching "the gates are a bit far away".
- [x] **One gate per feature, felt as a softening.** `towerPose` walks one rest point per stage
      (5.05, 4.15, 3.25, 2.35 — each just past its gate) and the sign-up steps back out to 5.1,
      off the path onto the building's axis, framing the whole pagoda. `gateSoftness` peaks at
      each crossing and is zero at every rest, weighted by distance; the renderer maps it to a few
      pixels of CSS blur on the canvas, only while walking inward, and only on medium/high tiers
      and outside reduced motion (`gateBlur`).
- [x] **The building never comes apart.** The roof lift and lean are gone: storeys stay in their
      stack, only their light changes, and the dim floor rose to 0.58 so a closed storey never
      reads as a silhouette. Tests pin the pose's exact per-storey fields, the walk, the gate
      passage and the rest-point clearances.
- [x] **Rail ticks, one size.** The old pills were sized by their own hidden labels — four
      different "bookmarks" — and the inactive dot was `bg-border`, invisible in dark. Now one
      fixed-size dot button per storey with an absolutely positioned label, muted-foreground dots,
      tested for identical classes and the marker colour.
- [x] **Copy is legible in both themes.** Feature copy, the overview list and the sign-up panel
      sit on token-derived translucent surfaces (`bg-background/70` + blur + hairline border); a
      test pins the scrim on every storey's copy.
- [x] **Budgets held.** River ≤ 200 vertices, walkway ≤ 80, all rewritten at the existing tick or
      not at all; the gate blur is a gated full-screen pass; no new materials beyond one bank, one
      water, one path; nothing else per frame changed. Low tier and reduced motion stay
      sharp-and-cheap.

### Still outstanding

- The walk's feel — the damping, the blur pulse and the arrival framing — has been watched at
  rest points and mid-crossing, not yet at full scroll speed on a slow device.
- The rail's clearance from the copy column is still pinned by reasoning and max-widths, not by a
  placement test (unlike `treePlacement` for the login scene).

## Revision 4 — the interactive pass

Driven in a real browser: all seven stages, both themes, and 390x844.

- [x] **Corrected an earlier mistake of mine.** I reported the hero as blank and
      the 3D as not drawing. It was drawing. I had been screenshotting
      immediately after navigation, before the lazy three.js chunk had landed.
      The 3D is a lazy chunk by design, so the first frame after a cold load is
      legitimately empty; the DOM content is there throughout.
- [x] Found and fixed: every storey was dimmed to 0.35 whenever *no* storey was
      open, so the tower was near-black on the hero, the overview and the cta —
      the three screens with no open storey to contrast against.
- [x] Found and fixed: the sky dome's gradient exponent put the zenith colour
      over almost the whole dome, so the night sky was one flat near-black field
      with the horizon glow pushed off the bottom of the screen.
- [x] Verified: hero, overview, all four storeys and the cta render; the tower
      slides left and the copy sits right with no overlap; the accordion opens
      and closes; both themes render; the phone width gets no 3D chunk, complete
      content, the accordion and no rail.

