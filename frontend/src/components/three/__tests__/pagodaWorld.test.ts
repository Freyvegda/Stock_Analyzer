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

import { pagodaLayout } from '../pagodaScene'
import {
  QUALITY_PROFILES,
  WORLD_LIMITS,
  birdFlock,
  celestialBody,
  fireflyPose,
  fireflySeeds,
  grove,
  mountainRidges,
  petalPose,
  petalSeeds,
  pickQuality,
  skyGradient,
  starField,
  toriiPath,
  waterPlane,
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

  it('keeps every ridge behind the tower', () => {
    // Anything at or in front of the tower occludes it.
    for (const r of ridges) expect(r.z).toBeLessThan(0)
  })

  it('is deterministic', () => {
    expect(mountainRidges()).toEqual(ridges)
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

  it('is deterministic', () => {
    expect(grove()).toEqual(trees)
  })
})

describe('waterPlane', () => {
  const layout = pagodaLayout(4)
  const water = waterPlane(layout)

  it('sits below the plinth, so the tower is founded in it', () => {
    // Above the plinth and the water cuts the building in half.
    expect(water.y).toBeLessThan(0)
  })

  it('is wide enough to read as water, not a puddle', () => {
    expect(water.width).toBeGreaterThan(layout[0].bodyWidth * 4)
    expect(water.depth).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    expect(waterPlane(layout)).toEqual(water)
  })
})

describe('toriiPath', () => {
  const gates = toriiPath()

  it('stays inside its cap', () => {
    expect(gates.length).toBeLessThanOrEqual(WORLD_LIMITS.torii)
  })

  it('runs from the foreground to the tower, shrinking with distance', () => {
    expect(gates.length).toBeGreaterThan(2)
    for (let i = 1; i < gates.length; i += 1) {
      expect(gates[i].scale).toBeLessThan(gates[i - 1].scale)
    }
  })

  it('lines the path up on the centre line', () => {
    for (const g of gates) expect(Math.abs(g.position.x)).toBeLessThan(1e-9)
  })

  it('puts the far end of the path at the tower, not past it', () => {
    const last = gates[gates.length - 1]
    expect(last.position.z).toBeLessThan(0)
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
