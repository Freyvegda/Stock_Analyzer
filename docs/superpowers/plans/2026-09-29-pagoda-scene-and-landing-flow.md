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
- [ ] 5. Renderers
- [ ] 6. DOM
- [ ] 7. Contracts
- [ ] 8. Verify
