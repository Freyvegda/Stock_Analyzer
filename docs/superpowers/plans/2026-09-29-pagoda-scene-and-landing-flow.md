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
