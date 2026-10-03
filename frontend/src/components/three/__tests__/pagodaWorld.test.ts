/**
 * The pagoda's world — sky, celestial body, ridges, mist, grove, water, torii and
 * atmosphere — tested with no WebGL and no three.js, the same split
 * `pagodaScene.test.ts` uses for the tower.
 *
 * No `Math.random` anywhere: every population is seeded from `PAGODA_SEED`, so
 * the scene is byte-identical on every load. The determinism tests below are
 * what would catch a stray `Math.random` creeping in.
 */
import { describe, expect, it } from 'vitest'

import {
  SCROLL_SPAN,
  pathCentre,
  pathPlan,
  pathSlabs,
  tierStage,
  towerPose,
} from '../pagodaScene'
import { TOWER_TIERS } from '@/content/tower'
import {
  QUALITY_PROFILES,
  WORLD_LIMITS,
  WORLD_LAYER_ORDER,
  GATE_BLUR_PX,
  GATE_SOFT_REACH,
  RIVER_MEANDER,
  birdFlock,
  celestialBody,
  fireflyPose,
  fireflySeeds,
  gateBlur,
  gateSoftness,
  grove,
  groundSheet,
  mountainRidges,
  petalPose,
  petalSeeds,
  pickQuality,
  ridgeReach,
  riverBand,
  riverCentre,
  riverRibbon,
  skyGradient,
  starField,
  toriiPath,
  CAMERA_Z,
  visibleHalfHeight,
  worldPlan,
} from '../pagodaWorld'

describe('skyGradient', () => {
  it('runs from a zenith to a horizon, in that order', () => {
    const g = skyGradient()
    expect(g.zenith.y).toBeGreaterThan(g.horizon.y)
    expect(g.zenith.y).toBeGreaterThan(0)
  })

  it('spans the whole scene', () => {
    const g = skyGradient()
    // Big enough to sit behind everything and never show an edge.
    expect(g.radius).toBeGreaterThan(20)
    expect(Number.isFinite(g.radius)).toBe(true)
  })

  it('keeps the gradient on the dome rather than on a coplanar band', () => {
    // The bug this pins: a separate horizon plane has to pick a depth, and at
    // the near ridge's depth the two z-fight — which drew as vertical striping
    // across the lower frame. The gradient is baked into the dome, so there is
    // no second surface to fight with.
    const g = skyGradient()
    expect(g.zenith.role).toBe('skyTop')
    expect(g.horizon.role).toBe('skyHorizon')
    expect(Object.keys(g)).not.toContain('horizonZ')
  })
})

describe('celestialBody', () => {
  it('is a sun by day and a moon by night', () => {
    expect(celestialBody('light').kind).toBe('sun')
    expect(celestialBody('dark').kind).toBe('moon')
  })

  it('sits in the same place in both modes', () => {
    // If the position moved on theme change the disc would slide across the sky
    // during the 300ms crossfade, which reads as a bug rather than a sunrise.
    expect(celestialBody('light').position).toEqual(celestialBody('dark').position)
  })

  it('sits high and off-axis, in the upper right', () => {
    // Same quadrant as the shadow-casting sun (see the test below): a disc that
    // disagreed with its own shadows would be the more obvious bug.
    const c = celestialBody('light')
    expect(c.position.y).toBeGreaterThan(0)
    expect(c.position.x).toBeGreaterThan(0)
    expect(c.radius).toBeGreaterThan(0)
  })

  it('agrees with the shadow-casting sun by day', () => {
    // The visible disc and the light that casts the shadows must be the same
    // sun, so they have to share a quadrant.
    const disc = celestialBody('light')
    expect(Math.sign(disc.position.x)).toBe(Math.sign(3.4))
    expect(Math.sign(disc.position.y)).toBe(Math.sign(6.2))
  })

  it('gives the moon a halo and the sun a corona', () => {
    expect(celestialBody('dark').halo).toBeGreaterThan(0)
    expect(celestialBody('light').halo).toBeGreaterThan(0)
  })
})

describe('mountainRidges', () => {
  const ridges = mountainRidges()

  it('returns far to near, receding in depth', () => {
    expect(ridges.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < ridges.length; i += 1) {
      expect(ridges[i].depth).toBeLessThan(ridges[i - 1].depth)
    }
  })

  it('builds each ridge taller as it comes nearer', () => {
    // The array is far-to-near, so the near ridge is the taller one. A set of
    // ridges all the same height reads as a flat collage.
    for (let i = 1; i < ridges.length; i += 1) {
      expect(ridges[i].peak).toBeGreaterThan(ridges[i - 1].peak)
    }
  })

  it('builds every ridge as a closed, finite strip', () => {
    for (const r of ridges) {
      expect(r.points.length).toBeGreaterThan(2)
      expect(r.points.length % 2).toBe(0) // pairs: (x, y)
      expect(r.points.every(Number.isFinite)).toBe(true)
    }
  })

  it('reaches past the edge of the frame at every aspect it supports', () => {
    // A ridge whose silhouette ends inside the frustum shows a hard vertical
    // edge — a stuck rectangle rather than a mountain. The reach is derived from
    // the camera, so this is the relationship being pinned.
    for (const r of ridges) {
      const half = Math.max(...r.points.filter((_, i) => i % 2 === 0).map(Math.abs))
      const visible = visibleHalfHeight(r.z)
      expect(half, `ridge at z=${r.z}`).toBeGreaterThan(visible * 2.2)
    }
  })

  it('falls away to ground well before its own edge, so width is margin not mass', () => {
    // The extra width has to be off-screen margin. If the arch still carried
    // height at the strip's edge, every ridge would read as a plateau.
    for (const r of ridges) {
      const ys = r.points.filter((_, i) => i % 2 === 1)
      const edge = Math.max(ys[0], ys[ys.length - 1])
      const middle = Math.max(...ys)
      expect(edge).toBeLessThan(middle * 0.25)
    }
  })

  it('never lets a nearer range subtend a smaller angle than a further one', () => {
    // Apparent size, not raw height: a tall range twice as far away is still
    // smaller on screen. This is the cue that reads as depth.
    const apparent = ridges.map((r) => r.peak / Math.abs(r.z))
    for (let i = 1; i < apparent.length; i += 1) {
      expect(apparent[i], `ridge ${i} recedes`).toBeGreaterThan(apparent[i - 1])
    }
  })

  it('is deterministic', () => {
    expect(mountainRidges()).toEqual(ridges)
  })
})

describe('ridgeReach and visibleHalfHeight', () => {
  it('grows with distance, because a further ridge needs to be wider', () => {
    expect(visibleHalfHeight(-70)).toBeGreaterThan(visibleHalfHeight(-30))
    expect(ridgeReach(-70)).toBeGreaterThan(ridgeReach(-30))
    for (const z of [-70, -50, -30]) {
      expect(ridgeReach(z)).toBeGreaterThan(visibleHalfHeight(z))
    }
  })

  it('agrees with the camera it is derived from', () => {
    // tan(22.5 degrees) at a distance of `CAMERA_Z - z`.
    expect(visibleHalfHeight(0)).toBeCloseTo(0.41421356 * 6.4, 5)
  })
})

describe('grove', () => {
  const trees = grove()

  it('stays inside its cap', () => {
    expect(trees.length).toBeLessThanOrEqual(WORLD_LIMITS.trees)
  })

  it('keeps the trees clear of the tower\'s centre', () => {
    // A tree directly behind the tower hides the thing the page is about.
    const limit = 1.15
    for (const t of trees) {
      expect(Math.abs(t.position.x), `tree at x=${t.position.x}`).toBeGreaterThan(limit)
    }
  })

  it('stands every tree on the ground and gives it a canopy wider than tall', () => {
    for (const t of trees) {
      expect(t.canopy).toBeGreaterThan(0)
      expect(t.canopy).toBeGreaterThan(t.height)
      expect(Number.isFinite(t.position.y)).toBe(true)
    }
  })

  it('stands the trees on the banks, never in the river', () => {
    // The river is a band across the scene now; a tree in it would float.
    const band = riverBand()
    for (const t of trees) {
      const edge = riverCentre(t.position.x, 0)
      const clearance = Math.abs(t.position.z - edge) - band.width / 2
      // outside the band, on either bank
      expect(clearance, `tree at z=${t.position.z}`).toBeGreaterThan(0.5)
    }
  })

  it('is deterministic', () => {
    expect(grove()).toEqual(trees)
  })
})

describe('the river band', () => {
  const band = riverBand()

  it('flows sideways, in the distance behind the pagoda', () => {
    // User direction: the gates and the walkway stand on dry ground. The river
    // crosses the frame as scenery — it is never the path.
    expect(band.centreZ).toBeLessThan(-2)
    expect(band.centreZ + band.width / 2).toBeLessThan(0)
  })

  it('reaches past the widest frame at its own depth', () => {
    // Its ends must never show inside the frustum, or the river stops mid-screen.
    expect(band.length / 2).toBeGreaterThan(ridgeReach(band.centreZ))
  })

  it('keeps the water diffuse, not metal, so it reads without an environment map', () => {
    // The invisibility bug: metalness 0.6 with no env map renders the surface
    // close to black, whatever its colour. A river has to be lit diffusely.
    expect(band.metalness).toBeGreaterThanOrEqual(0)
    expect(band.metalness).toBeLessThan(0.35)
    expect(band.roughness).toBeGreaterThan(0.2)
    expect(band.roughness).toBeLessThan(0.8)
  })

  it('is deterministic', () => {
    expect(riverBand()).toEqual(band)
  })
})

describe('groundSheet', () => {
  const ground = groundSheet()

  it('sits under the river and reaches past the widest frame', () => {
    expect(ground.y).toBeLessThan(riverBand().y)
    expect(ground.edgeZ).toBeGreaterThan(CAMERA_Z)
    expect(ground.width / 2).toBeGreaterThan(ridgeReach(ground.farZ))
  })

  it('is deterministic', () => {
    expect(groundSheet()).toEqual(ground)
  })
})

describe('the river meander', () => {
  const band = riverBand()

  it('never brings the water near the pagoda or the walkway', () => {
    // The nearside water edge has to stay well behind the tower footprint.
    for (let x = -50; x <= 50; x += 0.5) {
      for (const t of [0, 3.1, 7.7]) {
        expect(riverCentre(x, t) + band.width / 2, `x=${x} t=${t}`).toBeLessThan(-1)
      }
    }
  })

  it('wanders across the frame rather than running as a ruled line', () => {
    let reach = 0
    for (let x = -40; x <= 40; x += 0.25) {
      reach = Math.max(reach, Math.abs(riverCentre(x, 0) - band.centreZ))
    }
    expect(reach).toBeGreaterThan(RIVER_MEANDER * 0.6)
    expect(reach).toBeLessThanOrEqual(RIVER_MEANDER + 1e-9)
  })

  it('drifts over time, so the river reads as moving water', () => {
    expect(Math.abs(riverCentre(5, 0) - riverCentre(5, 6))).toBeGreaterThan(0.1)
  })

  it('keeps the water surface continuous — no step between stations', () => {
    for (let x = -20; x <= 30; x += 0.25) {
      const step = Math.abs(riverCentre(x + 0.25, 0) - riverCentre(x, 0))
      expect(step).toBeLessThan(0.1)
    }
  })
})

describe('riverRibbon', () => {
  const band = riverBand()
  const ribbon = riverRibbon(band, 0)

  it('lays two edge vertices per station, ordered across the frame', () => {
    expect(ribbon.length % 6).toBe(0)
    const stations = ribbon.length / 6
    expect(stations).toBeGreaterThan(8)
    for (let s = 1; s < stations; s += 1) {
      expect(ribbon[s * 6], `station ${s}`).toBeGreaterThan(ribbon[(s - 1) * 6])
    }
  })

  it('keeps the full width at every station and sits on the water line', () => {
    for (let s = 0; s < ribbon.length / 6; s += 1) {
      const near = ribbon[s * 6 + 2]
      const far = ribbon[s * 6 + 5]
      expect(far - near).toBeCloseTo(band.width, 6)
      expect(ribbon[s * 6 + 1]).toBeCloseTo(band.y, 6)
      expect(ribbon[s * 6 + 4]).toBeCloseTo(band.y, 6)
    }
  })

  it('animates without re-cutting the mesh — same stations, different water', () => {
    const later = riverRibbon(band, 5)
    expect(later).toHaveLength(ribbon.length)
    expect(later).not.toEqual(ribbon)
    // x is untouched, so callers can index the same vertices every frame.
    for (let s = 0; s < ribbon.length / 6; s += 1) {
      expect(later[s * 6]).toBeCloseTo(ribbon[s * 6], 6)
    }
  })

  it('stays inside a vertex budget a low-end device can carry', () => {
    // The whole animation is a rewrite of these positions at the shared tick,
    // so the cap is what keeps it cheap. Raising it is a decision, not a tweak.
    expect(ribbon.length / 3).toBeLessThanOrEqual(200)
  })

  it('is deterministic', () => {
    expect(riverRibbon(band, 0)).toEqual(ribbon)
  })
})

describe('the gate path', () => {
  const plan = pathPlan()
  const slabs = pathSlabs(plan)
  const joint = (i: number) => {
    const far = slabs[i - 1]
    const near = slabs[i]
    return near.z - near.depth / 2 - (far.z + far.depth / 2)
  }

  it('runs from the viewer to the pagoda steps and arrives on the centre line', () => {
    // The walk ends at the plinth, straight on axis, so the last steps line up
    // with the building.
    expect(plan.nearZ).toBeGreaterThan(CAMERA_Z)
    expect(plan.farZ).toBeLessThan(2)
    expect(pathCentre(plan.farZ)).toBeCloseTo(0, 6)
    for (let z = plan.farZ; z >= 0; z -= 0.2) expect(pathCentre(z)).toBe(0)
  })

  it('runs straight down the middle, so the walk does not wander off the axis', () => {
    // The first build bowed the path sideways to make it "a path, not a ruler".
    // In a straight approach with the camera walking the line, the bow read as
    // the ground swinging underfoot and the paving as a wedge. The walk is a
    // straight run: every station is on the axis.
    for (let z = plan.farZ; z <= plan.nearZ; z += 0.1) {
      expect(pathCentre(z), `station at z=${z.toFixed(1)}`).toBe(0)
    }
  })

  it('lays a jointed run of stone slabs from the steps to the viewer', () => {
    expect(slabs.length).toBeGreaterThan(6)
    for (let i = 0; i < slabs.length; i += 1) {
      expect(slabs[i].depth).toBeGreaterThan(0.2)
      expect(slabs[i].halfWidth).toBeCloseTo(plan.halfWidth, 9)
      if (i > 0) {
        expect(
          slabs[i].z,
          `slab ${i} does not march from the steps toward the viewer`,
        ).toBeGreaterThan(slabs[i - 1].z)
        expect(joint(i), `joint ${i} is raggedy`).toBeGreaterThan(0)
        expect(joint(i), `joint ${i} is a canyon`).toBeLessThanOrEqual(0.05)
      }
    }
    // The run covers the whole walk: first slab at the steps, last at the camera.
    const firstEdge = slabs[0].z - slabs[0].depth / 2
    const lastEdge = slabs[slabs.length - 1].z + slabs[slabs.length - 1].depth / 2
    expect(firstEdge).toBeCloseTo(plan.farZ, 9)
    expect(lastEdge).toBeCloseTo(plan.nearZ, 9)
  })

  it('keeps the run to a slab count a low-end device can carry', () => {
    // The paving is merged into one buffer; the cap is the promise that it stays
    // one draw call's worth of stone.
    expect(slabs.length).toBeLessThanOrEqual(20)
  })

  it('is deterministic', () => {
    expect(pathSlabs(pathPlan())).toEqual(slabs)
  })
})

describe('gateSoftness and gateBlur', () => {
  const gates = toriiPath().map((g) => g.position.z)

  it('peaks as the camera passes a gate', () => {
    for (const z of gates) expect(gateSoftness(z), `gate at ${z}`).toBeGreaterThan(0.25)
  })

  it('softens the far gates more than the ones near the tower', () => {
    // The pagoda is further away when you walk through the outer gates, so the
    // vista through them is softer. The weight is that distance.
    for (let i = 1; i < gates.length; i += 1) {
      expect(gateSoftness(gates[i]), `gate ${i}`).toBeLessThan(gateSoftness(gates[i - 1]))
    }
  })

  it('leaves every section rest point in focus', () => {
    // Each feature section has a camera rest; a rest has to be sharp, or the
    // blur never resolves and the effect reads as a smear.
    for (const z of [CAMERA_Z, ...TOWER_TIERS_Z()]) {
      expect(gateSoftness(z), `rest at ${z}`).toBeLessThan(0.06)
    }
  })

  it('is bounded and finite along the whole path', () => {
    for (let z = 0.5; z <= 7; z += 0.05) {
      const v = gateSoftness(z)
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('costs nothing on a low-end device or under reduced motion', () => {
    // The blur is a full-screen pass on the canvas. Low tier and reduced motion
    // get the scene sharp rather than an effect they cannot afford.
    expect(gateBlur(1, 'low', false)).toBe(0)
    expect(gateBlur(1, 'high', true)).toBe(0)
    expect(gateBlur(1, 'medium', false)).toBeGreaterThan(0)
    expect(gateBlur(1, 'high', false)).toBeGreaterThan(gateBlur(0.5, 'high', false))
    expect(gateBlur(1, 'high', false)).toBeLessThanOrEqual(GATE_BLUR_PX)
  })
})

/** The camera rest depth at each feature section, straight from the scroll story. */
function TOWER_TIERS_Z(): number[] {
  return TOWER_TIERS.map((_, i) => towerPose(tierStage(i) / SCROLL_SPAN).cameraZ)
}

describe('WORLD_LAYER_ORDER', () => {
  it('draws the sky behind the scenery and the celestial body in front of it', () => {
    // The obstruction bug: the moon disc drew before the opaque ridges and
    // wrote no depth, so a nearer mountain painted straight over it. The fix is
    // an explicit order — the moon is nearer than every ridge, so it must draw
    // over them.
    expect(WORLD_LAYER_ORDER.sky).toBeLessThan(WORLD_LAYER_ORDER.scenery)
    expect(WORLD_LAYER_ORDER.celestial).toBeGreaterThan(WORLD_LAYER_ORDER.scenery)
  })
})

describe('toriiPath', () => {
  const gates = toriiPath()

  it('stays inside its cap', () => {
    expect(gates.length).toBeLessThanOrEqual(WORLD_LIMITS.torii)
  })

  it('runs from the middle distance up to the tower, shrinking with distance', () => {
    expect(gates.length).toBeGreaterThan(2)
    for (let i = 1; i < gates.length; i += 1) {
      expect(gates[i].scale).toBeLessThan(gates[i - 1].scale)
      expect(gates[i].position.z).toBeLessThan(gates[i - 1].position.z)
    }
  })

  it('keeps clear of the hero camera and of the tower', () => {
    // The camera sits at z = 6.4 on the hero. The first version ran the path to
    // z = 6.2, which put a gate at the lens: eight storey-height bars across the
    // frame. The far end must also stay well short of the plinth: the user's
    // picture is gates that stand a little way off, with the pagoda seen at
    // distance through them.
    for (const g of gates) {
      expect(g.position.z, `gate at z=${g.position.z} is too near the hero camera`).toBeLessThanOrEqual(5.6)
      expect(g.position.z, `gate at z=${g.position.z} is too near the pagoda`).toBeGreaterThan(2.5)
    }
  })

  it('stands every gate on the walkway, not beside it', () => {
    // The gates are the path's milestone markers: the camera walks the path and
    // has to pass *through* each gate, so each gate sits on the centre line of
    // the walk at its own z.
    for (const g of gates) {
      expect(g.position.x, `gate at z=${g.position.z}`).toBeCloseTo(pathCentre(g.position.z), 6)
    }
  })

  it('keeps every gate and the walkway out of the river', () => {
    const band = riverBand()
    for (const g of gates) {
      const waterEdge = riverCentre(g.position.x, 0) + band.width / 2
      expect(g.position.z - waterEdge, `gate at z=${g.position.z} stands in water`).toBeGreaterThan(1)
    }
  })

  it('spaces the gates for a fly-through, not a picket fence', () => {
    // The camera advances one rest point per storey; a rest has to fit between
    // two gates clear of the gate blur on both sides, so the gap must beat
    // twice the blur reach. Wider than that and the row stops reading as one
    // walk of gates in the distance.
    const gaps: number[] = []
    for (let i = 1; i < gates.length; i += 1) {
      gaps.push(gates[i - 1].position.z - gates[i].position.z)
    }
    const first = gaps[0]
    for (const gap of gaps) expect(gap).toBeCloseTo(first, 5)
    expect(first).toBeGreaterThan(2 * GATE_SOFT_REACH + 0.1)
    expect(first).toBeLessThan(1.2)
  })

  it('stands every gate on the paving surface, not floating over it', () => {
    // The paving slabs are flush with `pathPlan().y`; the gates are planted on
    // that same line so a gate base can never hover above the stone.
    for (const g of gates) {
      expect(g.position.y, `gate at z=${g.position.z}`).toBeCloseTo(pathPlan().y, 9)
    }
  })

  it('is deterministic', () => {
    expect(toriiPath()).toEqual(gates)
  })
})

describe('starField', () => {
  const stars = starField()

  it('stays inside its cap', () => {
    expect(stars.length).toBeLessThanOrEqual(WORLD_LIMITS.stars)
  })

  it('puts every star above the horizon', () => {
    for (const s of stars) expect(s.position.y).toBeGreaterThan(0)
  })

  it('crowds the stars toward the zenith', () => {
    // Denser high up is what reads as depth in a night sky.
    const high = stars.filter((s) => s.position.y > 8).length
    const low = stars.filter((s) => s.position.y < 4).length
    expect(high).toBeGreaterThan(low)
  })

  it('gives each star its own twinkle phase', () => {
    expect(new Set(stars.map((s) => s.phase.toFixed(4))).size).toBe(stars.length)
  })

  it('is deterministic', () => {
    expect(starField()).toEqual(stars)
  })
})

describe('petals', () => {
  const seeds = petalSeeds()

  /**
   * The first wrap after t=0, and the poses either side of it.
   *
   * The wrap is where the fall fraction resets, i.e. where `t / period + phase`
   * crosses a whole number — so it is computed rather than searched for.
   */
  function wrapWindow(seed: (typeof seeds)[number]) {
    const wrapAt = seed.period * (1 - seed.phase)
    const epsilon = seed.period * 0.002
    return [wrapAt, petalPose(seed, wrapAt - epsilon), petalPose(seed, wrapAt + epsilon)] as const
  }

  it('stays inside its cap', () => {
    expect(seeds.length).toBeLessThanOrEqual(WORLD_LIMITS.petals)
  })

  it('moves sideways as it wraps, so the reset does not read as a pop', () => {
    // The failure this pins: a petal that re-enters at the same x it left the
    // bottom at pops straight back up. Across its wrap it must have shifted by
    // its own drift, and by no more than that.
    for (const seed of seeds) {
      const [, before, after] = wrapWindow(seed)
      const shift = Math.abs(after.position.x - before.position.x)
      expect(shift, `seed ${seed.index} did not move on wrap`).toBeGreaterThan(0.05)
      expect(shift).toBeLessThanOrEqual(Math.abs(seed.drift) * 1.2 + 1e-6)
    }
  })

  it('falls steadily between wraps, never upward', () => {
    // Sampled strictly between two consecutive wraps. Each petal's phase offsets
    // where in its own fall it happens to be at any given t, so a window pinned
    // to t=0 would straddle a wrap and the petal would legitimately jump.
    for (const seed of seeds) {
      const [wrapAt] = wrapWindow(seed)
      let previous = Infinity
      for (let k = 0; k <= 20; k += 1) {
        const y = petalPose(seed, wrapAt + ((seed.period * k) / 20) * 0.98).position.y
        expect(y, `seed ${seed.index} rose at step ${k}`).toBeLessThan(previous + 1e-9)
        previous = y
      }
    }
  })

  it('returns to the top after a full period', () => {
    for (const seed of seeds) {
      const top = petalPose(seed, 0)
      const afterOnePeriod = petalPose(seed, seed.period)
      expect(afterOnePeriod.position.y).toBeCloseTo(top.position.y, 5)
    }
  })

  it('keeps every petal within a sane column', () => {
    for (const seed of seeds) {
      for (let k = 0; k <= 10; k += 1) {
        const p = petalPose(seed, (seed.period * k) / 10).position
        expect(Math.abs(p.y)).toBeLessThan(20)
        expect(Number.isFinite(p.x)).toBe(true)
        expect(Number.isFinite(p.z)).toBe(true)
      }
    }
  })

  it('is deterministic', () => {
    expect(petalSeeds()).toEqual(seeds)
  })
})

describe('fireflies', () => {
  const seeds = fireflySeeds()

  it('stays inside its cap', () => {
    expect(seeds.length).toBeLessThanOrEqual(WORLD_LIMITS.fireflies)
  })

  it('drifts around its home rather than teleporting', () => {
    for (const seed of seeds) {
      const a = fireflyPose(seed, 0)
      const b = fireflyPose(seed, 0.5)
      const distance = Math.hypot(
        b.position.x - a.position.x,
        b.position.y - a.position.y,
        b.position.z - a.position.z,
      )
      expect(distance).toBeLessThan(2.5)
    }
  })

  it('pulses between lit and dark, never to zero energy', () => {
    for (const seed of seeds) {
      for (let t = 0; t < 1; t += 0.25) {
        const p = fireflyPose(seed, t)
        expect(p.glow).toBeGreaterThan(0)
        expect(p.glow).toBeLessThanOrEqual(1)
      }
    }
  })

  it('hangs around the tower base, not out in the sky', () => {
    for (const seed of seeds) expect(seed.home.y).toBeLessThan(3)
  })

  it('crowds the tower base instead of dotting the whole frame', () => {
    // The first build scattered eighteen of them out to a radius of nearly
    // five units; on screen that read as dirt on the lens, not fireflies.
    for (const seed of seeds) {
      expect(Math.hypot(seed.home.x, seed.home.z)).toBeLessThanOrEqual(2.8)
      expect(seed.home.y).toBeLessThanOrEqual(2.2)
    }
    // Still a field, not one lamp: the furthest home has real distance on it.
    expect(Math.max(...seeds.map((s) => Math.hypot(s.home.x, s.home.z)))).toBeGreaterThan(1.4)
  })

  it('is deterministic', () => {
    expect(fireflySeeds()).toEqual(seeds)
  })
})

describe('birdFlock', () => {
  const birds = birdFlock()

  it('stays inside its cap', () => {
    expect(birds.length).toBeLessThanOrEqual(WORLD_LIMITS.birds)
  })

  it('flies one way across the sky, all of them', () => {
    // Birds drifting in opposite directions read as two unrelated animations.
    const directions = new Set(birds.map((b) => Math.sign(b.direction)))
    expect(directions.size).toBe(1)
  })

  it('keeps every bird above the horizon', () => {
    for (const b of birds) expect(b.position.y).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    expect(birdFlock()).toEqual(birds)
  })
})

describe('WORLD_LIMITS', () => {
  it('caps every population', () => {
    for (const [key, cap] of Object.entries(WORLD_LIMITS)) {
      expect(Number.isInteger(cap), `${key} is not a whole number`).toBe(true)
      expect(cap, `${key} is not positive`).toBeGreaterThan(0)
    }
  })

  it('keeps the night-only atmospheres sparse enough to read as life', () => {
    // User feedback: both fields were dense enough to read as noise. These are
    // ceilings, not targets — raising them is a decision, not a tweak.
    expect(WORLD_LIMITS.fireflies).toBeLessThanOrEqual(10)
    expect(WORLD_LIMITS.birds).toBeLessThanOrEqual(5)
  })
})

describe('worldPlan', () => {
  it('decides the whole composition, so the renderer branches on nothing', () => {
    const night = worldPlan(true, false)
    const day = worldPlan(false, false)
    expect(night.celestial.kind).toBe('moon')
    expect(day.celestial.kind).toBe('sun')
  })

  it('keeps the stars, fireflies and moon to the night', () => {
    const night = worldPlan(true, false)
    const day = worldPlan(false, false)
    expect(night.stars.length).toBeGreaterThan(0)
    expect(day.stars).toHaveLength(0)
    expect(night.fireflies.length).toBeGreaterThan(0)
    expect(day.fireflies).toHaveLength(0)
  })

  it('keeps the birds to the day', () => {
    expect(worldPlan(true, false).birds).toHaveLength(0)
    expect(worldPlan(false, false).birds.length).toBeGreaterThan(0)
  })

  it('thins the petals by day', () => {
    // Both modes drift petals, but a bright frame needs fewer of them or it
    // reads as confetti.
    const night = worldPlan(true, false)
    const day = worldPlan(false, false)
    expect(day.petals.length).toBeGreaterThan(0)
    expect(day.petals.length).toBeLessThan(night.petals.length)
    expect(day.petals.length).toBeLessThanOrEqual(WORLD_LIMITS.petals)
  })

  it('keeps every layer under reduced motion, and only stops the clock', () => {
    // "Final state instantly", not a strip-down: the still frame still shows the
    // sky, the stars and the water.
    const still = worldPlan(true, true)
    expect(still.still).toBe(true)
    expect(still.waterMoves).toBe(false)
    expect(still.stars.length).toBeGreaterThan(0)
    expect(still.fireflies.length).toBeGreaterThan(0)
  })

  it('scales the populations and the pixel ratio with the quality tier', () => {
    // The scene has to run on a modest laptop and a phone, so every population
    // scales together rather than being fixed.
    const low = worldPlan(true, false, 'low')
    const high = worldPlan(true, false, 'high')
    expect(low.stars.length).toBeLessThan(high.stars.length)
    expect(low.fireflies.length).toBeLessThan(high.fireflies.length)
    expect(low.dpr).toBeLessThan(high.dpr)
    expect(low.shadows).toBe(false)
    expect(high.shadows).toBe(true)
  })

  it('drops the geometry-heavy scenery at the lowest tier, and keeps the sky', () => {
    // A weak device loses the grove and the gates, never the picture: the sky,
    // the tower's own world and the atmosphere all survive.
    const low = worldPlan(false, false, 'low')
    expect(low.scenery).toBe(false)
    expect(low.petals.length).toBeGreaterThan(0)
    expect(low.celestial).toBeDefined()
    expect(worldPlan(false, false, 'high').scenery).toBe(true)
  })

  it('never exceeds a cap at any tier', () => {
    for (const quality of ['low', 'medium', 'high'] as const) {
      const plan = worldPlan(true, false, quality)
      expect(plan.stars.length).toBeLessThanOrEqual(WORLD_LIMITS.stars)
      expect(plan.petals.length).toBeLessThanOrEqual(WORLD_LIMITS.petals)
      expect(plan.fireflies.length).toBeLessThanOrEqual(WORLD_LIMITS.fireflies)
      expect(plan.birds.length).toBeLessThanOrEqual(WORLD_LIMITS.birds)
    }
  })

  it('is deterministic', () => {
    expect(worldPlan(true, false)).toEqual(worldPlan(true, false))
  })
})

describe('pickQuality', () => {
  it('drops to the lowest tier on a low-memory or low-core device', () => {
    expect(pickQuality({ deviceMemory: 4, hardwareConcurrency: 8 })).toBe('low')
    expect(pickQuality({ deviceMemory: 16, hardwareConcurrency: 4 })).toBe('low')
    expect(pickQuality({ deviceMemory: 2, hardwareConcurrency: 2 })).toBe('low')
  })

  it('uses the middle tier on a touch device even when it reports strong hardware', () => {
    // A phone on battery has a thermal budget, not a capability one.
    expect(pickQuality({ deviceMemory: 16, hardwareConcurrency: 12, coarsePointer: true })).toBe(
      'medium',
    )
  })

  it('only reaches the top tier on a device that reports both', () => {
    expect(pickQuality({ deviceMemory: 16, hardwareConcurrency: 12 })).toBe('high')
    // One signal alone is not enough: `hardwareConcurrency` is a poor proxy for
    // a GPU, so an unknown device gets the middle tier rather than the benefit
    // of the doubt.
    expect(pickQuality({ hardwareConcurrency: 12 })).toBe('medium')
    expect(pickQuality({ deviceMemory: 16 })).toBe('medium')
    expect(pickQuality()).toBe('medium')
  })

  it('keeps every profile self-consistent', () => {
    for (const [name, p] of Object.entries(QUALITY_PROFILES)) {
      expect(p.particleScale, name).toBeGreaterThan(0)
      expect(p.particleScale, name).toBeLessThanOrEqual(1)
      expect(p.dpr, name).toBeGreaterThan(0)
      expect(p.dpr, name).toBeLessThanOrEqual(2)
    }
    expect(QUALITY_PROFILES.low.dpr).toBeLessThan(QUALITY_PROFILES.high.dpr)
  })
})
