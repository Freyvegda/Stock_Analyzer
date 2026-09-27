import { describe, expect, it } from 'vitest'
import {
  BONFIRE_SEED,
  EMBER_BASE,
  EMBER_COUNT,
  EMBER_LIMITS,
  EMBER_MOUTH,
  EMBER_PIXEL,
  emberPose,
  emberSeeds,
  motionFor,
} from '../emberField'

/** Flattened numeric signature — deep-equalling 220 seed objects is a vitest footgun. */
function signature(seeds: ReturnType<typeof emberSeeds>): string {
  return seeds
    .flatMap((seed) => [seed.x, seed.z, seed.speed, seed.phase, seed.swayAmp, seed.swayPhase, seed.drift])
    .join(',')
}

describe('emberSeeds', () => {
  it('produces the same field on every call', () => {
    expect(signature(emberSeeds(BONFIRE_SEED))).toBe(signature(emberSeeds()))
  })

  it('spawns every ember inside the flame mouth', () => {
    for (const seed of emberSeeds()) {
      expect(Math.abs(seed.x)).toBeLessThanOrEqual(EMBER_MOUTH.x)
      expect(Math.abs(seed.z)).toBeLessThanOrEqual(EMBER_MOUTH.z)
      expect(seed.phase).toBeGreaterThanOrEqual(0)
      expect(seed.phase).toBeLessThan(1)
      expect(seed.depthAmp).toBeGreaterThanOrEqual(0.2)
      expect(seed.depthAmp).toBeLessThanOrEqual(2.2)
      expect(seed.size).toBeGreaterThanOrEqual(0.6)
      expect(seed.size).toBeLessThanOrEqual(1.6)
      expect(Math.abs(seed.deepDrift)).toBeLessThanOrEqual(1.6)
      expect(seed.hot).toBeGreaterThanOrEqual(0)
      expect(seed.hot).toBeLessThanOrEqual(1)
    }
  })

  it('sends some embers deep enough to sell the 3D', () => {
    expect(Math.max(...emberSeeds().map((seed) => seed.depthAmp))).toBeGreaterThanOrEqual(2)
  })

  it('fans the embers out across the viewport while crowding them near the fire', () => {
    const reach = emberSeeds().map((seed) => seed.swayAmp + Math.abs(seed.drift))
    expect(Math.min(...reach)).toBeGreaterThan(0)
    expect(Math.max(...reach)).toBeGreaterThanOrEqual(6)
    expect(Math.max(...reach)).toBeLessThanOrEqual(14)
    const wide = reach.filter((distance) => distance > 3).length / reach.length
    expect(wide).toBeGreaterThan(0.1)
    expect(wide).toBeLessThan(0.3)
  })

  it('sends most of the sparks into the page, away from the corner', () => {
    const seeds = emberSeeds()
    const leftward = seeds.filter((seed) => seed.drift < 0).length / seeds.length
    expect(leftward).toBeGreaterThan(0.5)
  })

  it('keeps a real tail of wanderers that can cross the screen', () => {
    const reach = emberSeeds().map((seed) => seed.swayAmp + Math.abs(seed.drift))
    expect(reach.filter((distance) => distance > 6).length).toBeGreaterThanOrEqual(35)
    expect(reach.filter((distance) => distance > 8).length).toBeGreaterThanOrEqual(18)
  })

  it('keeps the field inside its instance budget', () => {
    expect(emberSeeds().length).toBe(EMBER_COUNT)
    expect(EMBER_COUNT).toBeLessThanOrEqual(300)
    expect(EMBER_COUNT).toBeLessThanOrEqual(EMBER_LIMITS.maxEmbers)
  })

  it('keeps every ember as a really small square pixel', () => {
    expect(EMBER_PIXEL).toBeGreaterThan(0)
    expect(EMBER_PIXEL).toBeLessThanOrEqual(0.016)
  })
})

describe('motionFor', () => {
  it('gives the night fire a slower, brighter burn than the day fire', () => {
    const night = motionFor('dark')
    const day = motionFor('light')
    expect(night.rise).toBeLessThan(day.rise)
    expect(night.emberOpacity).toBeGreaterThan(day.emberOpacity)
    expect(night.flickerAmp).toBeGreaterThan(day.flickerAmp)
  })

  it('falls back to the day fire otherwise', () => {
    expect(motionFor(undefined)).toEqual(motionFor('light'))
    expect(motionFor('system')).toEqual(motionFor('light'))
  })

  it('keeps the burn slow enough to read as cosy', () => {
    expect(motionFor('dark').rise).toBeLessThanOrEqual(0.25)
    expect(motionFor('light').rise).toBeLessThanOrEqual(0.3)
  })
})

describe('emberPose', () => {
  const profile = motionFor('dark')
  const span = 4.6
  const seed = { ...emberSeeds()[0], phase: 0, speed: 1, hot: 1 }

  it('is deterministic', () => {
    expect(emberPose(seed, 12.3, profile, span)).toEqual(emberPose(seed, 12.3, profile, span))
  })

  it('rises over time and never leaves the span', () => {
    const a = emberPose(seed, 0.5 / profile.rise, profile, span)
    const b = emberPose(seed, 0.55 / profile.rise, profile, span)
    expect(b.y).toBeGreaterThan(a.y)
    for (const time of [0, 0.7, 2.4, 9.9]) {
      const pose = emberPose(seed, time, profile, span)
      expect(pose.y).toBeGreaterThanOrEqual(0)
      expect(pose.y).toBeLessThan(span)
    }
  })

  it('stays bright most of the climb and dies out before the top', () => {
    const candle = (cycle: number) => emberPose(seed, cycle / profile.rise, profile, span).alpha
    expect(candle(0)).toBe(0)
    expect(candle(0.5)).toBe(1)
    expect(candle(0.7)).toBe(1)
    expect(candle(0.95)).toBeLessThan(0.3)
    expect(candle(0.999)).toBeLessThan(0.05)
  })

  it('sways and drifts around the spawn point, never flying off', () => {
    const pose = emberPose(seed, 3.1, profile, span)
    const reach = seed.swayAmp + Math.abs(seed.drift)
    expect(Math.abs(pose.x - seed.x)).toBeLessThanOrEqual(reach)
    expect(Math.abs(pose.z - seed.z)).toBeLessThanOrEqual(seed.depthAmp)
  })

  it('moves through depth as it climbs', () => {
    const early = emberPose(seed, 2, profile, span)
    const late = emberPose(seed, 7.5, profile, span)
    expect(early.z).not.toBe(late.z)
    const travel = seed.depthAmp + Math.abs(seed.deepDrift)
    expect(Math.abs(early.z - seed.z)).toBeLessThanOrEqual(travel)
  })

  it('is born inside the flame mouth — the bonfire is the only source', () => {
    for (const seed of emberSeeds()) {
      const pose = emberPose({ ...seed, phase: 0 }, 0, profile, span)
      expect(pose.x).toBeCloseTo(seed.x, 6)
      expect(pose.z).toBeCloseTo(seed.z, 6)
      expect(pose.y).toBeCloseTo(EMBER_BASE, 6)
    }
  })

  it('burns hotter near the flame and cools as it climbs', () => {
    const near = emberPose(seed, 0.05 / profile.rise, profile, span)
    const far = emberPose(seed, 0.55 / profile.rise, profile, span)
    expect(near.heat).toBeGreaterThan(far.heat)
    expect(far.heat).toBeGreaterThanOrEqual(0)
    expect(near.heat).toBeLessThanOrEqual(1)
  })
})
