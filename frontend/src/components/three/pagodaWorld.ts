/**
 * Pure layout for the world the pagoda stands in.
 *
 * Sky, sun or moon, mountain ridges, mist, the grove, the water, the torii path
 * and the atmosphere. No three.js in this file, on purpose, and no colour
 * either: `components/three/**` is hex-free by rule, so every hue here is a
 * *role* that `PagodaWorld.tsx` resolves against `pagodaPalette`.
 *
 * Every population is seeded from `PAGODA_SEED`. No `Math.random` anywhere — the
 * scene has to be byte-identical on every load, and a stray `Math.random` is
 * the one thing that would silently break that.
 */

import { PAGODA_SEED, type TierGeometry } from './pagodaScene'

/**
 * Hard caps on every population in the scene.
 *
 * These are the frame budget, stated in one place. The renderer reads them; the
 * tests assert every generator respects them.
 */
export const WORLD_LIMITS = {
  ridges: 3,
  mist: 6,
  trees: 4,
  torii: 8,
  stars: 90,
  petals: 40,
  fireflies: 18,
  birds: 7,
} as const

// --- the seeded generator ---------------------------------------------------

/**
 * A tiny deterministic PRNG. `mulberry32`: same seed, same sequence, forever.
 * Returned values are in [0, 1).
 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- sky --------------------------------------------------------------------

export interface SkyGradient {
  /** Zenith colour role, e.g. `'skyTop'`. */
  zenith: { role: string; y: number }
  horizon: { role: string; y: number }
  radius: number
}

/** The dome behind everything. Big enough that its edge never enters frame. */
export function skyGradient(): SkyGradient {
  return {
    zenith: { role: 'skyTop', y: 16 },
    horizon: { role: 'skyHorizon', y: -2 },
    radius: 60,
  }
}

// --- sun / moon -------------------------------------------------------------

export type CelestialKind = 'sun' | 'moon'

export interface CelestialBody {
  kind: CelestialKind
  /** World position. Identical in both modes, so a theme change never moves it. */
  position: { x: number; y: number; z: number }
  radius: number
  /** Corona by day, halo by night. */
  halo: number
  /** Colour roles, resolved by the renderer. */
  discRole: string
  haloRole: string
}

/**
 * The one celestial body, in the top-left like the login scene.
 *
 * Light gives a sun, dark gives a moon, and the *position is the same either
 * way* — a disc that slid across the sky during the 300ms theme crossfade would
 * read as a bug. By day it is also the same sun as the shadow-casting
 * directional light in `lightingRig`, which is why it sits high and to the
 * right of the tower: the shadows have to agree with the light you can see.
 */
export function celestialBody(mode: 'dark' | 'light'): CelestialBody {
  return {
    kind: mode === 'light' ? 'sun' : 'moon',
    // Same quadrant and same ordering as lightingRig's sun [3.4, 6.2, ...]: the
    // disc you can see and the light casting the shadows are one sun.
    position: { x: 3.4, y: 6.2, z: -14 },
    radius: 0.62,
    halo: mode === 'light' ? 2.1 : 2.9,
    discRole: mode === 'light' ? 'sun' : 'moon',
    haloRole: 'halo',
  }
}

// --- mountains --------------------------------------------------------------

export interface Ridge {
  index: number
  /** Distance from the camera. Larger is further away. */
  depth: number
  /** Height of the highest point. */
  peak: number
  z: number
  /** Flat (x, y) pairs, left to right. */
  points: number[]
  colourRole: 'ridgeNear' | 'ridgeMid' | 'ridgeFar'
}

/**
 * Three ridges, far to near, all behind the tower.
 *
 * Each nearer ridge is taller and more saturated, and each further one is
 * flatter and closer in value to the sky. That progression *is* the depth cue —
 * a set of ridges all at the same height reads as a flat collage.
 */
export function mountainRidges(): Ridge[] {
  const rand = rng(PAGODA_SEED ^ 0x51ed)
  const ridges: Ridge[] = []
  const roles: Ridge['colourRole'][] = ['ridgeFar', 'ridgeMid', 'ridgeNear']

  for (let i = 0; i < WORLD_LIMITS.ridges; i += 1) {
    const at = i / (WORLD_LIMITS.ridges - 1) // 0 far, 1 near
    const depth = 26 - 16 * at
    const peak = 4.2 + 3.4 * at
    const z = -22 + 16 * at
    const halfSpan = depth * 0.62
    const points: number[] = []
    // An odd number of segments so the ridge has a peak in the middle and reads
    // as a mountain rather than a plateau.
    const segments = 13
    for (let s = 0; s < segments; s += 1) {
      const t = s / (segments - 1)
      const x = (t - 0.5) * 2 * halfSpan
      // A broad arch, roughened. The arch is what makes it a ridge; the
      // roughness is what makes it rock.
      const arch = Math.sin(t * Math.PI) ** 0.7
      const roughness = 0.82 + rand() * 0.36
      points.push(x, peak * arch * roughness)
    }
    ridges.push({ index: i, depth, peak, z, points, colourRole: roles[i] })
  }
  return ridges
}

// --- mist -------------------------------------------------------------------

export interface MistBand {
  index: number
  y: number
  z: number
  width: number
  height: number
  /** Drift speed. Every band differs, or the mist moves as one sheet. */
  speed: number
  opacity: number
}

/** Horizontal strips of haze drifting between the ridges. */
export function mistBands(): MistBand[] {
  const rand = rng(PAGODA_SEED ^ 0x7a1d)
  const bands: MistBand[] = []
  for (let i = 0; i < WORLD_LIMITS.mist; i += 1) {
    const at = i / (WORLD_LIMITS.mist - 1)
    bands.push({
      index: i,
      y: 0.4 + at * 3.4,
      // Between the ridges, always behind the tower.
      z: -18 + at * 9,
      width: 34 - at * 8,
      height: 1.5 + rand() * 0.9,
      speed: 0.08 + rand() * 0.22,
      opacity: 0.1 + rand() * 0.1,
    })
  }
  return bands
}

// --- grove ------------------------------------------------------------------

export interface Tree {
  index: number
  position: { x: number; y: number; z: number }
  height: number
  /** Canopy spread. Always wider than the tree is tall. */
  canopy: number
  tone: number
}

/**
 * Blossom trees, off to the sides.
 *
 * Never within 1.15 units of the centre line: a tree directly behind the tower
 * hides the thing the page is about, and the centre of frame is where the storey
 * copy sits.
 */
export function grove(): Tree[] {
  const rand = rng(PAGODA_SEED ^ 0x33b7)
  const trees: Tree[] = []
  for (let i = 0; i < WORLD_LIMITS.trees; i += 1) {
    // Alternate sides, and push each one further out than the last.
    const side = i % 2 === 0 ? -1 : 1
    const rank = Math.floor(i / 2)
    const height = 1.5 + rand() * 0.8
    trees.push({
      index: i,
      position: {
        x: side * (1.9 + rank * 1.5 + rand() * 0.4),
        y: 0,
        z: -3.4 - rand() * 4.5,
      },
      height,
      // Wider than tall, the way the login tree is: a canopy, not a spike.
      canopy: height * (1.25 + rand() * 0.3),
      tone: 0.6 + rand() * 0.4,
    })
  }
  return trees
}

// --- water ------------------------------------------------------------------

export interface WaterPlane {
  y: number
  z: number
  width: number
  depth: number
}

/**
 * The pool the tower is founded in.
 *
 * The y is negative on purpose: above the plinth and the water cuts the building
 * in half.
 */
export function waterPlane(tiers: TierGeometry[]): WaterPlane {
  const base = tiers[0]?.bodyWidth ?? 1.34
  return {
    y: -0.16,
    z: -0.4,
    width: base * 9,
    depth: 13,
  }
}

// --- torii path -------------------------------------------------------------

export interface Torii {
  index: number
  position: { x: number; y: number; z: number }
  scale: number
  lit: boolean
}

/**
 * A row of gates running from the foreground to the tower's steps.
 *
 * Shrinking with distance does the perspective work for free, and every gate
 * carries a small lantern that lights at night.
 */
export function toriiPath(): Torii[] {
  const rand = rng(PAGODA_SEED ^ 0x5c4d)
  const gates: Torii[] = []
  for (let i = 0; i < WORLD_LIMITS.torii; i += 1) {
    const at = i / (WORLD_LIMITS.torii - 1)
    gates.push({
      index: i,
      // Dead on the centre line: this is a path, and it has to read as one.
      position: { x: 0, y: -0.16, z: 6.2 - at * 8.4 },
      scale: 1 - at * 0.62 + (rand() - 0.5) * 0.03,
      lit: true,
    })
  }
  return gates
}

// --- stars ------------------------------------------------------------------

export interface Star {
  index: number
  position: { x: number; y: number; z: number }
  size: number
  phase: number
}

/** The night sky. Denser toward the zenith, which is what reads as depth. */
export function starField(): Star[] {
  const rand = rng(PAGODA_SEED ^ 0x2f19)
  const stars: Star[] = []
  for (let i = 0; i < WORLD_LIMITS.stars; i += 1) {
    // Bias y upward so the zenith carries the density.
    const y = Math.pow(rand(), 0.45) * 26 + 1
    const spread = 14 + y * 0.9
    stars.push({
      index: i,
      position: {
        x: (rand() - 0.5) * 2 * spread,
        y,
        z: -20 - rand() * 8,
      },
      size: 0.5 + rand() * 1.6,
      // Every star its own phase, or the whole sky blinks in unison.
      phase: rand() * Math.PI * 2,
    })
  }
  return stars
}

// --- petals -----------------------------------------------------------------

export interface PetalSeed {
  index: number
  x: number
  z: number
  /** How long the fall takes. */
  period: number
  /** Lateral drift per cycle, and the sway on top of it. */
  drift: number
  sway: number
  swayRate: number
  phase: number
  spin: number
  size: number
}

export function petalSeeds(): PetalSeed[] {
  const rand = rng(PAGODA_SEED ^ 0x6b2c)
  return Array.from({ length: WORLD_LIMITS.petals }, (_, index) => {
    // Drift has a guaranteed magnitude and only its *sign* is random. A petal
    // whose wrap moved it by almost nothing would reappear directly above where
    // it left, which is the pop the wrap exists to avoid — so the spread is not
    // left to chance.
    const drift = (rand() < 0.5 ? -1 : 1) * (0.7 + rand() * 1.1)
    return {
      index,
      x: (rand() - 0.5) * 16,
      z: -6 + rand() * 12,
      period: 0.55 + rand() * 0.5,
      drift,
      sway: 0.18 + rand() * 0.4,
      swayRate: 1.2 + rand() * 1.8,
      phase: rand(),
      spin: (rand() - 0.5) * 6,
      size: 0.7 + rand() * 0.7,
    }
  })
}

export interface PetalPose {
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
}

/**
 * Where a petal is at time `t`, in cycles.
 *
 * `at` is the fraction through this petal's own fall, and it **wraps**: at 1 the
 * petal is off the bottom and re-enters at the top. The wrap is the whole point
 * — a field of petals that each fall once and stop looks like rain, not wind.
 *
 * The wrap carries a lateral move, which is what stops the reset reading as a
 * pop: the petal that reappears at the top is somewhere else across the frame
 * from the one that left the bottom. See the wrap tests in `pagodaWorld.test.ts`.
 */
export function petalPose(seed: PetalSeed, t: number): PetalPose {
  const at = ((t / seed.period + seed.phase) % 1 + 1) % 1
  const y = 11 - at * 12.4
  // Drift accumulates along the fall, so it resets with `at` and the wrap moves
  // the petal sideways by exactly `drift` rather than leaving it in place.
  const x = seed.x + seed.drift * at
  const z = seed.z + Math.sin(at * Math.PI) * 0.5
  return {
    position: { x, y, z },
    rotation: {
      x: at * Math.PI * 4,
      y: seed.spin * at,
      z: Math.sin(at * Math.PI * 2 * seed.swayRate) * seed.sway,
    },
  }
}

// --- fireflies --------------------------------------------------------------

export interface FireflySeed {
  index: number
  home: { x: number; y: number; z: number }
  radius: number
  rate: number
  phase: number
}

export function fireflySeeds(): FireflySeed[] {
  const rand = rng(PAGODA_SEED ^ 0x4a19)
  return Array.from({ length: WORLD_LIMITS.fireflies }, (_, index) => {
    const angle = rand() * Math.PI * 2
    const reach = 1.4 + rand() * 3.2
    return {
      index,
      // Around the tower's base, never out in the sky.
      home: {
        x: Math.cos(angle) * reach,
        y: 0.2 + rand() * 2.4,
        z: Math.sin(angle) * reach * 0.6,
      },
      radius: 0.3 + rand() * 0.7,
      rate: 0.25 + rand() * 0.5,
      phase: rand(),
    }
  })
}

export interface FireflyPose {
  position: { x: number; y: number; z: number }
  glow: number
}

/** A firefly drifting on a small figure-eight around its home, pulsing. */
export function fireflyPose(seed: FireflySeed, t: number): FireflyPose {
  const at = t * Math.PI * 2 * seed.rate + seed.phase
  return {
    position: {
      x: seed.home.x + Math.cos(at) * seed.radius,
      y: seed.home.y + Math.sin(at * 2) * seed.radius * 0.35,
      z: seed.home.z + Math.sin(at) * seed.radius * 0.6,
    },
    // Never fully out: a firefly that reaches zero glow blinks out entirely.
    glow: 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(at * 2)),
  }
}

// --- birds ------------------------------------------------------------------

export interface Bird {
  index: number
  position: { x: number; y: number; z: number }
  size: number
  rate: number
  phase: number
  /** +1 or -1. Every bird flies the same way, or the flock reads as two. */
  direction: 1 | -1
}

/** A small flock crossing the sky. Day only. */
export function birdFlock(): Bird[] {
  const rand = rng(PAGODA_SEED ^ 0x1d3f)
  return Array.from({ length: WORLD_LIMITS.birds }, (_, index) => ({
    index,
    position: { x: 0, y: 6.5 + rand() * 3, z: -15 - rand() * 4 },
    size: 0.16 + rand() * 0.12,
    rate: 0.06 + rand() * 0.04,
    phase: rand(),
    direction: 1 as const,
  }))
}
