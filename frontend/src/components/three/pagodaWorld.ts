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

import { PAGODA_SEED, clamp, pathCentre, pathPlan, smoothstep } from './pagodaScene'

/**
 * Hard caps on every population in the scene.
 *
 * These are the frame budget, stated in one place. The renderer reads them; the
 * tests assert every generator respects them.
 */
export const WORLD_LIMITS = {
  ridges: 3,
  trees: 4,
  torii: 4,
  stars: 90,
  petals: 40,
  fireflies: 8,
  birds: 4,
} as const

/**
 * Quality tiers, chosen from the device's own capability.
 *
 * The scene has to run on a five-year-old laptop and a phone as well as a
 * desktop, so the populations and the pixel ratio are scaled together rather
 * than fixed. `low` is not a broken scene — it is the same picture with fewer
 * particles and no shadows.
 */
export type Quality = 'low' | 'medium' | 'high'

interface QualityProfile {
  /** Scale on every particle population. */
  particleScale: number
  /** Scale on the star field. */
  starScale: number
  /** Renderer pixel ratio ceiling. */
  dpr: number
  shadows: boolean
  /** The grove and the torii gates, which cost geometry rather than fill. */
  scenery: boolean
}

export const QUALITY_PROFILES: Record<Quality, QualityProfile> = {
  low: { particleScale: 0.35, starScale: 0.4, dpr: 1, shadows: false, scenery: false },
  medium: { particleScale: 0.7, starScale: 0.75, dpr: 1.25, shadows: true, scenery: true },
  high: { particleScale: 1, starScale: 1, dpr: 1.5, shadows: true, scenery: true },
}

/**
 * Pick a tier from what the browser is willing to tell us.
 *
 * `deviceMemory` is Chrome-only and `hardwareConcurrency` is a poor proxy for a
 * GPU, so neither is trusted alone: the lowest signal wins, and a device that
 * reports nothing gets `medium` rather than the benefit of the doubt.
 */
export function pickQuality(hints?: {
  deviceMemory?: number
  hardwareConcurrency?: number
  coarsePointer?: boolean
}): Quality {
  const memory = hints?.deviceMemory
  const cores = hints?.hardwareConcurrency
  if (typeof memory === 'number' && memory > 0 && memory <= 4) return 'low'
  if (typeof cores === 'number' && cores > 0 && cores <= 4) return 'low'
  // A touch device is usually a phone or a tablet on battery. It gets the middle
  // tier even when it reports strong hardware, because the budget is thermal.
  if (hints?.coarsePointer) return 'medium'
  if (typeof memory === 'number' && memory >= 8 && typeof cores === 'number' && cores >= 8) {
    return 'high'
  }
  return 'medium'
}

/**
 * The scene camera. Stated here because the world's geometry has to be sized
 * against it: a ridge whose edges fall inside the frustum shows a hard vertical
 * line where the silhouette stops, and how far it must reach is decided by the
 * camera's distance and field of view, not by taste.
 */
export const CAMERA_Z = 6.4
export const CAMERA_FOV = 45
/** Widest aspect the scene is laid out for, so an ultrawide still has no edge. */
export const MAX_ASPECT = 3.2

/** Visible half-height at a given depth, for the scene camera. */
export function visibleHalfHeight(z: number): number {
  return Math.tan((CAMERA_FOV * Math.PI) / 360) * (CAMERA_Z - z)
}

/** How far a ridge must reach sideways to cover the widest supported frame. */
export function ridgeReach(z: number): number {
  return visibleHalfHeight(z) * MAX_ASPECT
}

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

/**
 * The dome behind everything. Big enough that its edge never enters frame.
 *
 * The renderer paints this dome with a **vertex-colour gradient** rather than
 * putting a separate horizon plane in front of it. That is not a style choice:
 * a separate band has to pick a depth, and at the near ridge's depth the two are
 * coplanar and z-fight, which drew as vertical striping across the lower frame.
 * A gradient baked into the dome cannot fight with anything.
 */
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
    // Pushed well back and scaled with distance so each range subtends a
    // *smaller* angle than the one behind it. The first version sat the near
    // range at z = -6 with an eight-unit peak, which put a black wall across the
    // whole frame and hid the tower.
    const depth = 84 - 40 * at
    const peak = 12 + 3 * at
    const z = -70 + 40 * at
    // Wide enough that the ridge never ends inside the frame, whatever the
    // window's aspect. A silhouette that stops mid-screen reads as a stuck
    // rectangle, not a mountain.
    const halfSpan = ridgeReach(z)
    const points: number[] = []
    // An odd number of segments so the ridge has a peak in the middle and reads
    // as a mountain rather than a plateau.
    const segments = 17
    for (let s = 0; s < segments; s += 1) {
      const t = s / (segments - 1)
      const x = (t - 0.5) * 2 * halfSpan
      // A narrow arch on a wide base: the peak sits in the middle and the range
      // falls away to flat ground well before the strip's own edge, so the
      // extra width is off-screen margin rather than a wider mountain.
      const arch = Math.exp(-((t - 0.5) ** 2) / (2 * 0.17 ** 2))
      const roughness = 0.82 + rand() * 0.36
      points.push(x, peak * arch * roughness)
    }
    ridges.push({ index: i, depth, peak, z, points, colourRole: roles[i] })
  }
  return ridges
}

// --- mist removed -----------------------------------------------------------
//
// There was a band of drifting haze here, between the ridges. It is gone: the
// user asked for it out. The scene does not need it — the ridges already recede
// by value, and the haze was costing six additive transparent quads across the
// whole width of the frame, which is exactly the kind of full-screen fill that
// hurts on integrated graphics. Do not reintroduce it without saying so.

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
 * Blossom trees on the river's banks.
 *
 * Never within 1.15 units of the centre line: a tree directly behind the tower
 * hides the thing the page is about, and the centre of frame is where the storey
 * copy sits. Two stand on the near bank, two beyond the water, so the river has
 * depth on both sides.
 */
export function grove(): Tree[] {
  const rand = rng(PAGODA_SEED ^ 0x33b7)
  const trees: Tree[] = []
  for (let i = 0; i < WORLD_LIMITS.trees; i += 1) {
    // Alternate sides, and push each one further out than the last.
    const side = i % 2 === 0 ? -1 : 1
    const rank = Math.floor(i / 2)
    const height = 1.5 + rand() * 0.8
    // First pair on the near bank, between the walk and the water; second pair
    // on the far bank, beyond it.
    const nearBank = i < 2
    trees.push({
      index: i,
      position: {
        x: side * (1.9 + rank * 1.5 + rand() * 0.4),
        y: 0,
        z: nearBank ? -2.2 - rand() * 0.8 : -9.2 - rand(),
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

export interface RiverBand {
  y: number
  /** Along the river, across the frame. */
  length: number
  /** Across the river, along the walk. */
  width: number
  /** The centre line's z with the meander at zero. */
  centreZ: number
  /** Surface dials for the renderer. Kept here so the tests can pin them. */
  roughness: number
  metalness: number
}

/**
 * The river: a band running across the frame behind the pagoda.
 *
 * User direction: the river flows sideways, well away from the gate path and
 * the building, and is scenery seen at a distance rather than the ground the
 * walk happens on. Its length reaches past the widest supported frame at its
 * own depth, so its ends can never show.
 */
export function riverBand(): RiverBand {
  return {
    y: -0.18,
    length: 120,
    width: 2.8,
    centreZ: -6,
    // Diffuse-dominant: the scene has no environment map, and a metal surface
    // with nothing to reflect renders near-black whatever its colour.
    roughness: 0.32,
    metalness: 0.12,
  }
}

export interface GroundSheet {
  y: number
  width: number
  depth: number
  centreZ: number
  edgeZ: number
  farZ: number
}

/**
 * The ground under everything.
 *
 * One sheet rather than two banks beside the water: adjacent planes at
 * different heights leave a seam that reads as a wall at grazing angles, and a
 * sheet *under* the river cannot fight with it. Wide enough that its lateral
 * edge never enters the frame at the horizon.
 */
export function groundSheet(): GroundSheet {
  const depth = 90
  return {
    y: -0.24,
    width: 170,
    depth,
    centreZ: 0,
    edgeZ: depth / 2,
    farZ: -depth / 2,
  }
}

/**
 * How far the river may wander from its centre line, in world units.
 */
export const RIVER_MEANDER = 0.7
/** Distance between ribbon stations along the flow. */
export const RIVER_STEP = 1.5

/**
 * The river's centre line at `x`, at time `t`.
 *
 * One slow sine along the flow, drifting with `t`: the water snakes across the
 * frame and moves along it. The near edge is kept well clear of the pagoda and
 * the walkway by construction (see the tests), so no amount of meander puts
 * water under the gate path.
 */
export function riverCentre(x: number, t: number): number {
  const band = riverBand()
  const wave = Math.sin((x / 16) * Math.PI * 2 + t * 0.5)
  return band.centreZ + RIVER_MEANDER * wave
}

/**
 * The water as a ribbon, left to right, as flat (x, y, z) triples: two vertices
 * per station, near edge then far. Meant to be turned into one `BufferGeometry`
 * whose *positions* are rewritten as `t` advances — the station xs never change,
 * so the index buffer is built once and the whole animation is a small array
 * write at the shared tick, which is what keeps it affordable on a weak device.
 */
export function riverRibbon(band: RiverBand, t: number): number[] {
  const stations = Math.floor(band.length / RIVER_STEP) + 1
  const out: number[] = []
  for (let s = 0; s < stations; s += 1) {
    const x = -band.length / 2 + s * RIVER_STEP
    const centre = riverCentre(x, t)
    out.push(x, band.y, centre - band.width / 2, x, band.y, centre + band.width / 2)
  }
  return out
}

// --- the walkway lives in pagodaScene.ts -------------------------------------
//
// `pathPlan`, `pathCentre` and `pathSlabs` are exported from `pagodaScene.ts`
// with the scroll story: the camera *is* the walker, and the gates below stand
// on that line. They are not re-declared here — one definition, one direction
// of import.

/**
 * Draw order for the world layers.
 *
 * The sky is behind everything; the scattered scenery (ridges, grove, gates,
 * river) is the opaque middle; the celestial body is drawn last and on top.
 * That last point is the fix for the moon being painted over by a ridge: the
 * disc writes no depth (it is a transparent-ish light), and without an explicit
 * order the opaque ridge behind it in the queue simply overdraws it.
 */
export const WORLD_LAYER_ORDER = {
  sky: -2,
  scenery: 0,
  celestial: 2,
} as const

// --- torii path -------------------------------------------------------------

export interface Torii {
  index: number
  position: { x: number; y: number; z: number }
  scale: number
  lit: boolean
}

/**
 * A row of gates standing in the middle distance, in front of the pagoda.
 *
 * The user's picture: the walk goes from one gate to the next, and the pagoda
 * is seen in the distance beyond them. So the row is finite and clustered —
 * the camera advances one rest point per storey (see `towerPose`) and each
 * gate sits between two rests, every move passing through exactly one. A gate
 * behind the hero camera would loom at the lens; one nearer the building would
 * stop the row reading as distance.
 */
export function toriiPath(): Torii[] {
  const rand = rng(PAGODA_SEED ^ 0x5c4d)
  const gates: Torii[] = []
  const near = 5.6
  const far = 3.5
  for (let i = 0; i < WORLD_LIMITS.torii; i += 1) {
    const at = i / (WORLD_LIMITS.torii - 1)
    const z = near - at * (near - far)
    gates.push({
      index: i,
      // On the walkway's own centre line, so walking the path walks through
      // every gate. The gates are the path's milestones, not a fence.
      position: { x: pathCentre(z), y: pathPlan().y, z },
      scale: 0.45 - at * 0.15 + (rand() - 0.5) * 0.03,
      lit: true,
    })
  }
  return gates
}

/** How far along the path a gate's softness reaches. Under half a gate gap. */
export const GATE_SOFT_REACH = 0.28

/**
 * How soft the vista is as the camera crosses a gate, 0..1.
 *
 * A pulse centred on each gate — zero at every section rest point — scaled by
 * how far the gate is from the pagoda, because the building is further away
 * when you walk through the outer gates. The renderer turns this into a small
 * CSS blur; see `gateBlur`.
 */
export function gateSoftness(cameraZ: number): number {
  if (!Number.isFinite(cameraZ)) return 0
  let pulse = 0
  for (const gate of toriiPath()) {
    const near = 1 - clamp(Math.abs(cameraZ - gate.position.z) / GATE_SOFT_REACH, 0, 1)
    pulse = Math.max(pulse, smoothstep(near))
  }
  return pulse * clamp(cameraZ / CAMERA_Z, 0, 1)
}

/** The most the canvas may be blurred, in CSS pixels. */
export const GATE_BLUR_PX = 3

/**
 * The blur to put on the canvas for a given softness, 0 when the device or the
 * visitor should not pay for it.
 *
 * This is a full-screen pass over the WebGL canvas, so it is deliberately the
 * first thing dropped: the `low` tier and `prefers-reduced-motion` get the
 * scene sharp rather than an effect their device cannot carry.
 */
export function gateBlur(softness: number, quality: Quality, reduced: boolean): number {
  if (reduced || quality === 'low') return 0
  return clamp(softness, 0, 1) * GATE_BLUR_PX
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
    // Kept close to the base on purpose. The first build scattered them to a
    // radius of nearly five units, which on screen read as dust on the lens.
    const reach = 0.9 + rand() * 1.6
    return {
      index,
      // Around the tower's base, never out in the sky.
      home: {
        x: Math.cos(angle) * reach,
        y: 0.2 + rand() * 1.6,
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

// --- the plan ---------------------------------------------------------------

export interface WorldPlan {
  /** Which celestial body is in the sky. */
  celestial: CelestialBody
  /** Whether the star field is drawn. */
  stars: Star[]
  /** Drifting petals. Present in both modes; sparse by day. */
  petals: PetalSeed[]
  fireflies: FireflySeed[]
  birds: Bird[]
  /** Whether the water ripples on the shared clock. */
  waterMoves: boolean
  /** Ridges, grove and torii. Off at the lowest tier, which is geometry cost. */
  scenery: boolean
  /** The tier this plan was built for, for the renderer's own settings. */
  quality: Quality
  dpr: number
  shadows: boolean
  /** True when the scene is drawn but frozen. */
  still: boolean
}

/**
 * What the world layer should draw, for a mode, a motion preference and a
 * quality tier.
 *
 * This is the whole decision surface of `PagodaEnvironment.tsx`, kept here so it
 * can be tested without a canvas — r3f elements are not DOM nodes, so a renderer
 * test in jsdom can only ever assert that something was passed down, not what.
 * Everything that branches lives in this function; the renderer just executes it.
 *
 * Night gets stars, fireflies and a moving moon; day gets birds and a sparser
 * petal drift. Reduced motion keeps every layer and freezes the clock — the
 * "final state instantly" rule, not a strip-down.
 */
export function worldPlan(
  night: boolean,
  reduced: boolean,
  quality: Quality = 'high',
): WorldPlan {
  const profile = QUALITY_PROFILES[quality]
  const take = <T>(all: T[], scale: number): T[] => all.slice(0, Math.ceil(all.length * scale))

  return {
    celestial: celestialBody(night ? 'dark' : 'light'),
    stars: night ? take(starField(), profile.starScale) : [],
    // Petals fall in both modes, but a bright day needs fewer of them or the
    // frame fills with confetti.
    petals: take(petalSeeds(), profile.particleScale * (night ? 1 : 0.6)),
    fireflies: night ? take(fireflySeeds(), profile.particleScale) : [],
    birds: night ? [] : take(birdFlock(), profile.particleScale),
    waterMoves: !reduced,
    scenery: profile.scenery,
    quality,
    dpr: profile.dpr,
    shadows: profile.shadows,
    still: reduced,
  }
}
