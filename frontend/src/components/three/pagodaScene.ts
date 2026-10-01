/**
 * Pure geometry and scroll maths for the pagoda.
 *
 * No three.js in this file, on purpose. Every number the scene needs is
 * computed here so it can be unit-tested in jsdom — the same split
 * `emberField.ts` uses for the Bonfire. `Pagoda.tsx` is a thin renderer and
 * computes no shape of its own.
 */

import { TOWER_TIERS } from '@/content/tower'

/** Seeded so the scene is byte-identical on every load. No `Math.random`. */
export const PAGODA_SEED = 20260929

// --- stage maths -----------------------------------------------------------

/** hero, overview, one per tier, cta. */
export const STAGE_COUNT = 2 + TOWER_TIERS.length + 1
/** Scroll distance expressed in stages: the first and last share a boundary. */
export const SCROLL_SPAN = STAGE_COUNT - 1

/** The stage whose content is on screen at scroll progress `p` (0..1). */
export function stageProgress(p: number): number {
  if (!Number.isFinite(p)) return 0
  return Math.min(1, Math.max(0, p)) * SCROLL_SPAN
}

export function stageAt(p: number): number {
  return Math.min(SCROLL_SPAN, Math.floor(stageProgress(p) + 1e-9))
}

/** Tier `i` owns stage `2 + i`; anything else is hero / overview / cta. */
export function tierStage(i: number): number {
  return 2 + i
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Smoothstep on [0,1] — the same easing the CSS side uses. */
export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

// --- geometry --------------------------------------------------------------

export interface TierGeometry {
  index: number
  /** y of the tier's base (the underside of its roof). */
  y: number
  bodyWidth: number
  bodyHeight: number
  roofHalfSpan: number
  roofRise: number
}

/**
 * A pagoda tapers: every storey is narrower than the one below it, which is what
 * makes the silhouette read as a pagoda rather than a stack of boxes.
 */
export function pagodaLayout(n: number): TierGeometry[] {
  const tiers: TierGeometry[] = []
  let y = 0
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 0 : i / (n - 1)
    // A pagoda is slender: tall walls under wide, overhanging roofs, tapering
    // gently. Heavier taper reads as a stack of shrinking boxes instead.
    const taper = 1 - 0.11 * t
    const bodyWidth = 1.34 * taper
    const bodyHeight = 0.66 * (1 - 0.08 * t)
    const roofHalfSpan = 0.95 * taper
    const roofRise = 0.6 * (1 - 0.08 * t)
    tiers.push({ index: i, y, bodyWidth, bodyHeight, roofHalfSpan, roofRise })
    y += bodyHeight + roofRise
  }
  return tiers
}

export interface RoofOptions {
  halfSpan: number
  rise: number
  /** How far the corners lift above the eave line. */
  eaveLift: number
  /** Fraction of each side, at each end, over which the lift ramps in. */
  cornerSpan: number
  segs: number
  jitter?: number
}

export interface RoofGeometry {
  positions: number[]
  indices: number[]
}

/**
 * A pagoda roof is concave with upturned corners; `ConeGeometry(r, h, 4)` is a
 * pyramid and reads wrong. This builds an apex plus a square eave ring whose
 * corners rise, which is the shape that reads as "pagoda" at silhouette scale.
 */
export function pagodaRoofVertices(opts: RoofOptions): RoofGeometry {
  const { halfSpan, rise, eaveLift, cornerSpan, segs } = opts
  const jitter = opts.jitter ?? 0
  const perSide = Math.max(2, Math.floor(segs))

  // The four corners, in order. Each side is a straight run from one corner to
  // the next, so the ring is a square by construction. Deriving the sides
  // arithmetically instead (sweep x while marching z) produces a fan that
  // shoots out the back of the tower — see the square tests in the suite.
  const corners: Array<[number, number]> = [
    [-halfSpan, -halfSpan],
    [halfSpan, -halfSpan],
    [halfSpan, halfSpan],
    [-halfSpan, halfSpan],
  ]

  // A roof is not one slope but two: an upper concave sweep from the ridge, then
  // the lower flare out to the eave. `profile` is the fraction of the way from
  // ridge to eave, and `SAG` (>1) pushes each band *below* the straight cone —
  // that droop is what stops the roof reading as a flat plate.
  const SAG = 1.55
  const BANDS: Array<{ at: number; flare: number }> = [
    { at: 0.46, flare: 0.3 },
    { at: 1, flare: 1 },
  ]

  const positions: number[] = [0, rise, 0] // apex / ridge
  const rings: number[][] = []

  for (let b = 0; b < BANDS.length; b += 1) {
    const band = BANDS[b]
    const isEave = band.at >= 1
    const ring: number[] = []
    for (let side = 0; side < 4; side += 1) {
      const [ax, az] = corners[side]
      const [bx, bz] = corners[(side + 1) % 4]
      for (let s = 0; s < perSide; s += 1) {
        const t = s / perSide
        const x = (ax + (bx - ax) * t) * band.at
        const z = (az + (bz - az) * t) * band.at
        // Only the eave ring flicks up; the upper band stays on the curve.
        const lift = isEave ? eaveLift * Math.max(bump(t, cornerSpan), bump(1 - t, cornerSpan)) : 0
        const y = rise * Math.pow(1 - band.at, SAG) + lift
        const j = jitter * wobble(side, s)
        const index = positions.length / 3
        positions.push(x + j, y, z)
        ring.push(index)
      }
    }
    rings.push(ring)
  }

  const indices: number[] = []
  // ridge -> first band
  for (let i = 0; i < rings[0].length; i += 1) {
    const a = rings[0][i]
    const b = rings[0][(i + 1) % rings[0].length]
    indices.push(0, a, b)
  }
  // band -> band
  for (let r = 0; r < rings.length - 1; r += 1) {
    const inner = rings[r]
    const outer = rings[r + 1]
    for (let i = 0; i < inner.length; i += 1) {
      const n = (i + 1) % inner.length
      indices.push(inner[i], outer[i], outer[n])
      indices.push(inner[i], outer[n], inner[n])
    }
  }
  return { positions, indices }
}

/** 0 away from a corner, 1 at it, smooth across the last `span` of the side. */
function bump(t: number, span: number): number {
  const start = 1 - clamp(span, 0, 1)
  if (t <= start) return 0
  return smoothstep((t - start) / (1 - start))
}

/** Deterministic per-vertex offset so the roof is not machine-perfect. */
function wobble(side: number, s: number): number {
  return (((side * 31 + s * 17) % 7) - 3) * 0.002
}

export interface FinialLayout {
  rings: number
  ringY: number[]
  rodHeight: number
  baseY: number
  /** y of the jewel at the very top, which carries the night glow. */
  tipY: number
  /** y of the wind-bell that hangs beneath the tip. */
  bellY: number
}

/** The spire on top: stacked rings over a rod, tipped with a jewel. */
export function finialLayout(): FinialLayout {
  const rings = 5
  const rodHeight = 0.5
  const tipY = rodHeight + 0.09
  return {
    rings,
    ringY: Array.from({ length: rings }, (_, i) => 0.16 * i),
    rodHeight,
    baseY: 0.04,
    tipY,
    // Below the jewel, clear of the rings.
    bellY: tipY - 0.17,
  }
}

// --- detail geometry -------------------------------------------------------

export interface PlinthLayout {
  width: number
  height: number
  steps: number
  stepWidths: number[]
}

/** The stone base. Wide and stepped, so the tower is founded rather than floating. */
export function plinthLayout(tiers: TierGeometry[]): PlinthLayout {
  const base = tiers[0]?.bodyWidth ?? 1.5
  const steps = 3
  const stepWidths = Array.from({ length: steps }, (_, i) => base * (1.34 - 0.11 * i))
  return { width: stepWidths[0], height: 0.13, steps, stepWidths }
}

export interface TierDetail {
  /** Corner posts on the body footprint: [x, y, z]. */
  columns: Array<[number, number, number]>
  /** Lantern boxes hung under the eave: [x, y, z]. */
  lanterns: Array<[number, number, number]>
  balconyY: number
  balconyWidth: number
  railingHeight: number
  balusters: number
}

/**
 * The parts that make a storey read as a building rather than a box: corner
 * posts, the veranda deck between the body and the roof, its railing, and the
 * lanterns hung under the eave (which are the tower's own light source at night).
 */
export function tierDetail(tier: TierGeometry): TierDetail {
  const half = tier.bodyWidth / 2
  const post = half * 0.92
  const columnHeight = tier.bodyHeight

  const columns: Array<[number, number, number]> = [
    [post, columnHeight / 2, post],
    [-post, columnHeight / 2, post],
    [post, columnHeight / 2, -post],
    [-post, columnHeight / 2, -post],
  ]

  // Lanterns sit in the shadow of the eave, just above the balcony rail.
  const lanternY = tier.bodyHeight + tier.roofRise * 0.34
  const lx = tier.roofHalfSpan * 0.62
  const lanterns: Array<[number, number, number]> = [
    [lx, lanternY, 0],
    [-lx, lanternY, 0],
    [0, lanternY, lx],
    [0, lanternY, -lx],
  ]

  return {
    columns,
    lanterns,
    balconyY: tier.bodyHeight * 0.92,
    balconyWidth: tier.roofHalfSpan * 1.78,
    railingHeight: 0.075,
    balusters: 7,
  }
}

// --- storey openings, tiles, hanging lanterns, base --------------------------

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Screen {
  centre: Vec3
  width: number
  height: number
  /** Lattice bars across the screen. More bars, finer the grid. */
  bars: number
}

export interface Door {
  centre: Vec3
  width: number
  height: number
  /** Ring pulls, one per leaf. */
  pulls: Array<[number, number, number]>
}

export interface StoreyOpenings {
  door: Door | null
  screens: Screen[]
}

/**
 * What is in a storey's walls.
 *
 * `centre` is the opening's centre **on the wall face it sits in**, and the
 * wall face is named by which axis it is mounted on: a `z` face is the front
 * wall, an `x` face a side wall. So the ground storey's door reads `x: 0` and
 * `z: half` — centred across the building, on the front wall — and an upper
 * storey reads `z: half, x: 0` for its front band and `x: half, z: 0` for its
 * side band.
 *
 * The reference spends its detail budget on the ground floor — a double-leaf
 * door with ring pulls, lattice screens either side — so `ground` swaps the
 * door for a plain window band on the upper storeys. Kept pure so the layout is
 * testable without a canvas.
 */
export function storeyOpenings(tier: TierGeometry, ground: boolean): StoreyOpenings {
  const half = tier.bodyWidth / 2
  // A door that fills the wall reads as a hole, not a door. Roughly a third of
  // the wall width, and its leaves meet on the centre line.
  const doorWidth = tier.bodyWidth * 0.34
  const doorHeight = tier.bodyHeight * 0.72

  if (ground) {
    const screenWidth = tier.bodyWidth * 0.2
    const screenHeight = tier.bodyHeight * 0.5
    // Screens sit between the door's edge and the corner, not hard against the
    // corner, or the wall reads as a frame with nothing in it.
    const offset = doorWidth / 2 + screenWidth / 2 + tier.bodyWidth * 0.06
    return {
      door: {
        centre: { x: 0, y: doorHeight / 2, z: half },
        width: doorWidth,
        height: doorHeight,
        // One pull per leaf, just inside the meeting stile.
        pulls: [
          [-doorWidth * 0.08, doorHeight * 0.52, half + 0.01],
          [doorWidth * 0.08, doorHeight * 0.52, half + 0.01],
        ],
      },
      screens: [
        {
          centre: { x: -offset, y: screenHeight / 2 + tier.bodyHeight * 0.16, z: half },
          width: screenWidth,
          height: screenHeight,
          bars: 5,
        },
        {
          centre: { x: offset, y: screenHeight / 2 + tier.bodyHeight * 0.16, z: half },
          width: screenWidth,
          height: screenHeight,
          bars: 5,
        },
      ],
    }
  }

  // Upper storeys: a band of lattice across the front wall, and one down the
  // side the camera can see. Both are inset from the corner so they never
  // overhang the storey they belong to.
  const screenWidth = tier.bodyWidth * 0.46
  const screenHeight = tier.bodyHeight * 0.34
  const y = tier.bodyHeight * 0.34
  // The side band is centred on its own wall, so its across-the-wall offset is
  // 0; only the front band's x is a real offset.
  return {
    door: null,
    screens: [
      { centre: { x: 0, y, z: half }, width: screenWidth, height: screenHeight, bars: 7 },
      { centre: { x: half, y, z: 0 }, width: screenWidth, height: screenHeight, bars: 7 },
    ],
  }
}

export interface RoofCourse {
  /** Distance from the ridge, along the slope. */
  radius: number
  /** Height of the course above the eave line. */
  y: number
  /** Tile step depth. */
  step: number
}

/** How many concentric tile courses a roof carries. */
const ROOF_COURSES = 5

/**
 * The concentric tile courses laid over a roof.
 *
 * A pagoda roof reads as tiled precisely because the slope is stepped, not
 * because it is a smooth cone. `radius` shrinks and `y` rises toward the ridge,
 * which is the direction the test pins.
 */
export function roofCourses(halfSpan: number): RoofCourse[] {
  // Eave first, ridge last, so a caller's straight walk inward sees the radius
  // shrink and the height rise — the direction the courses are actually laid.
  return Array.from({ length: ROOF_COURSES }, (_, i) => {
    const at = 1 - (i + 1) / ROOF_COURSES
    return {
      radius: halfSpan * at,
      // Matches the SAG curve the roof itself uses, so a course sits *on* the
      // slope rather than floating above it.
      y: halfSpan * 0.5 * Math.pow(1 - at, 1.55),
      step: halfSpan * 0.06,
    }
  })
}

/** Lanterns hung under one storey's eave. The count is capped. */
export const LANTERN_LIMIT = 8
/** How many of them may carry a real point light. The cost control. */
export const MAX_LANTERN_LIGHTS = 2

export interface HangingLantern {
  /** Where the cord meets the eave. */
  cordTop: Vec3
  /** Where the cord ends and the lantern begins. */
  cordBottom: Vec3
  /** The lantern's own centre. */
  body: Vec3
  radius: number
  height: number
  /** Carries a real point light (and only the first few do). */
  lit: boolean
  /** Its own swing phase, so the row never moves as one block. */
  phase: number
}

/**
 * The lanterns, hung on visible cords from the eave tips.
 *
 * This is the detail the reference is most specific about: red lanterns dangling
 * on strings from the corner of each roof. So the cord is modelled, the lantern
 * hangs *below* it, and the anchor sits out at the eave rather than tucked in
 * under the roof where the old four cubes lived.
 */
export function hangingLanterns(tier: TierGeometry): HangingLantern[] {
  const span = tier.roofHalfSpan
  // Hung just under the eave line, from the corner tips: the four diagonals and
  // the four side mid-points.
  const eaveY = tier.bodyHeight + tier.roofRise * 0.16
  const all: Array<[number, number]> = [
    [span * 0.86, span * 0.86],
    [-span * 0.86, span * 0.86],
    [span * 0.86, -span * 0.86],
    [-span * 0.86, -span * 0.86],
    [0, span * 0.92],
    [0, -span * 0.92],
    [span * 0.92, 0],
    [-span * 0.92, 0],
  ]
  const anchors = all.slice(0, LANTERN_LIMIT)

  const lanternHeight = 0.11
  const cordLength = 0.075 + (tier.index % 3) * 0.012

  return anchors.map(([x, z], i) => {
    // Phase walks the golden-ish irrational step so no two lanterns are in
    // step, and no two are exactly a half-cycle apart either.
    const phase = ((i * 2.399963) % (2 * Math.PI))
    return {
      cordTop: { x, y: eaveY, z },
      cordBottom: { x, y: eaveY - cordLength, z },
      body: {
        x,
        y: eaveY - cordLength - lanternHeight / 2,
        z,
      },
      radius: 0.05 - (i % 2) * 0.006,
      height: lanternHeight,
      // The two most forward-facing get a real light; the rest are emissive only.
      lit: z > 0 && i < MAX_LANTERN_LIGHTS,
      phase,
    }
  })
}

export interface BaseDetail {
  balusters: Array<[number, number, number]>
  stoneLanterns: Array<[number, number, number]>
}

/** The plinth's furniture: a balustrade and a stone lantern either side. */
export function baseDetail(tiers: TierGeometry[]): BaseDetail {
  const plinth = plinthLayout(tiers)
  const railY = -plinth.height + plinth.height * 1.1
  const balusters: Array<[number, number, number]> = []
  for (let i = 0; i < 7; i += 1) {
    const t = (i / 6 - 0.5) * plinth.width * 0.82
    balusters.push([t, railY, plinth.width * 0.42], [t, railY, -plinth.width * 0.42])
  }
  return {
    balusters,
    stoneLanterns: [
      [plinth.width * 0.56, railY, plinth.width * 0.5],
      [-plinth.width * 0.56, railY, plinth.width * 0.5],
    ],
  }
}

export type LightMode = 'dark' | 'light'

export interface SunRig {
  position: [number, number, number]
  intensity: number
  castShadow: boolean
  shadowRadius: number
  shadowMapSize: number
}

export interface LightingRig {
  ambientIntensity: number
  /** Warm fill from the front, standing in for bounce. */
  fillIntensity: number
  /** Per-lantern point lights — the tower's own light at night. */
  lanternIntensity: number
  lanternDistance: number
  emissiveIntensity: number
  finialGlow: number
  shadows: boolean
  /** `null` at night: a directional sun would flatten what the lanterns do. */
  sun: SunRig | null
}

/**
 * The two looks.
 *
 * Night: the lanterns are the light source. Low cool ambient, a warm frontal
 * fill so the silhouette still reads, and a strong per-lantern glow. No sun and
 * no shadows — hard shadows at night would fight the softness that sells it.
 *
 * Day: a shadow-casting sun does the work, ambient is high enough to read the
 * shaded sides, and the interior lanterns drop to a whisper so they read as
 * lit windows rather than as the main source.
 *
 * Colours are *not* here: `components/three/**` is hex-free by rule, so the
 * renderer reads them from `pagodaPalette` in `tokens.ts`.
 */
export function lightingRig(mode: LightMode): LightingRig {
  if (mode === 'dark') {
    return {
      // Enough ambient that the plastered walls read as walls rather than voids.
      ambientIntensity: 0.62,
      fillIntensity: 0.34,
      // The lanterns are the source, but they sit *inside* the storey they light:
      // high values here blow the roof out and swallow the whole silhouette.
      lanternIntensity: 0.85,
      lanternDistance: 1.6,
      emissiveIntensity: 0.55,
      finialGlow: 0.7,
      shadows: false,
      sun: null,
    }
  }
  return {
    ambientIntensity: 1.05,
    fillIntensity: 0.18,
    lanternIntensity: 0.22,
    lanternDistance: 1.1,
    emissiveIntensity: 0.14,
    finialGlow: 0.12,
    shadows: true,
    sun: {
      position: [3.4, 6.2, 4.6],
      intensity: 2.1,
      castShadow: true,
      shadowRadius: 3,
      shadowMapSize: 1024,
    },
  }
}

// --- the walkway ------------------------------------------------------------

export interface PathPlan {
  y: number
  halfWidth: number
  /** Where the walk starts, behind the camera. */
  nearZ: number
  /** Where it meets the plinth steps. */
  farZ: number
  /** Station spacing along the walk. */
  step: number
}

/** The most the walkway may bow away from the centre line. */
export const PATH_AMPL = 0.5
/** The bow's wavelength along the walk. */
const PATH_WAVE = 15

/**
 * The walk the camera takes, from the viewer's side to the pagoda's steps.
 *
 * It lives here rather than in `pagodaWorld.ts` because the camera *is* the
 * walker: `towerPose` follows this centre line, and the gates stand on it. One
 * direction of import keeps the two from drifting apart.
 */
export function pathPlan(): PathPlan {
  return { y: -0.16, halfWidth: 0.55, nearZ: 6.8, farZ: 1, step: 0.35 }
}

/**
 * The walkway's centre line at `z`.
 *
 * Straight on the centre line from the plinth out to `farZ` — so the last steps
 * line up with the building — then bowing out and back over the walk.
 */
export function pathCentre(z: number): number {
  const plan = pathPlan()
  if (z <= plan.farZ) return 0
  const ramp = smoothstep((z - plan.farZ) / 5.5)
  const wave = Math.sin(((z - plan.farZ) / PATH_WAVE) * Math.PI * 2)
  return PATH_AMPL * ramp * wave
}

/**
 * The walkway as a ribbon, near to far, as flat (x, y, z) triples: two vertices
 * per station. Static: the walk does not animate, so this is built once.
 */
export function pathRibbon(plan: PathPlan): number[] {
  const stations = Math.floor((plan.nearZ - plan.farZ) / plan.step) + 1
  const out: number[] = []
  for (let s = 0; s < stations; s += 1) {
    const z = plan.nearZ - s * plan.step
    const centre = pathCentre(z)
    out.push(centre - plan.halfWidth, plan.y, z, centre + plan.halfWidth, plan.y, z)
  }
  return out
}

// --- the scroll pose -------------------------------------------------------

export interface TierPose {
  /** 1 when this is the storey being shown. */
  emphasis: number
  /** 0 dimmed, 1 full. */
  brightness: number
}

export interface TowerPose {
  scale: number
  /** -1 left, 0 centred. */
  x: number
  y: number
  /** Where the camera stands while a storey is shown. */
  cameraX: number
  cameraY: number
  cameraZ: number
  tiers: TierPose[]
  activeTier: number
  /** Multiplier on every lantern's swing. >1 while a storey is opening. */
  swayGain: number
  /** Water ripple amplitude at the base. */
  ripple: number
}

const DIMMED = 0.58

/**
 * The camera's rest points: one just past each gate, then the pagoda itself.
 *
 * The gates stand a little way off the building (user direction), so the walk
 * reads as approaching it; the call to action is the last step, at the steps.
 */
const FIRST_REST = 5.05
const LAST_REST = 2.35
/**
 * The sign-up's view: back out past the first gate, where the pagoda reads
 * whole with air around it. Chosen off every gate so the frame stays sharp.
 */
const CTA_REST = 5.1
/** Where the camera looks on arrival: the pagoda's middle, as a whole shape. */
const CTA_CAMERA_Y = 0.45

/** Sample a value across integer stage anchors, eased between them. */
function sampleStages(keys: number[], values: number[], s: number): number {
  if (s <= keys[0]) return values[0]
  for (let i = 1; i < keys.length; i += 1) {
    if (s <= keys[i]) {
      const t = smoothstep((s - keys[i - 1]) / (keys[i] - keys[i - 1]))
      return values[i - 1] + (values[i] - values[i - 1]) * t
    }
  }
  return values[values.length - 1]
}

/**
 * The whole scroll story, as one function of progress.
 *
 * hero -> tower small and low, camera wide; overview -> full size, centred;
 * tier i -> the camera walks one more rest point along the gate path toward the
 * pagoda, passing through the torii on the way and rising to the storey's
 * centre; cta -> the last step: the camera arrives at the pagoda's steps and
 * looks up at it as a whole.
 *
 * The building never moves within itself: the storeys stay in their stack and
 * only their light changes. The journey is the camera's, which is why the pose
 * carries a camera rest point per storey rather than any per-storey offset.
 */
export function towerPose(p: number): TowerPose {
  const s = stageProgress(p)
  const n = TOWER_TIERS.length
  const layout = pagodaLayout(n)
  const tiers: TierPose[] = Array.from({ length: n }, () => ({
    emphasis: 0,
    brightness: 1,
  }))

  const hero = smoothstep(s / 1.2)
  // The tower is ~4.4 world units tall; at full scale it must still clear the
  // frame, so the working scale tops out well below 1.
  const scale = 0.32 + 0.24 * hero
  // Hero sits the tower low in the frame, under the headline, as the brief asks.
  const y = -1.5 + 0.45 * hero

  // Overview (stage 1) hands over to tier 0 (stage 2).
  // Centre again once the last tier's window closes, so the cta reads as a
  // whole tower rather than one caught mid-slide.
  const shiftIn = smoothstep((s - 1) / 1.15)
  const ctaStart = 2 + n - 1 + 0.5
  const shiftOut = smoothstep((s - ctaStart) / 0.45)
  const shift = shiftIn * (1 - shiftOut)
  // A modest slide: the camera walks the path beside the building, so the copy
  // column keeps its air without the storey leaving the frame.
  const x = -0.55 * shift

  // Windows must not overlap: the falloff has to reach zero before the next
  // tier's window opens, or two storeys light at once and the tower reads wrong.
  const SPAN = 0.5
  for (let i = 0; i < n; i += 1) {
    const centre = tierStage(i)
    // `radius` is the half-width of this tier's window: 0.5 sits the windows
    // edge to edge, so a tier is fully closed as the next one begins.
    const near = 1 - clamp(Math.abs(s - centre) / SPAN, 0, 1)
    const e = smoothstep(near)
    tiers[i] = {
      emphasis: e,
      // Placeholder: brightness needs `openStrength`, which is only known once
      // every storey's emphasis has been computed. Set below.
      brightness: 1,
    }
  }

  // The cta owns the far end: by p=1 the last tier's window has closed again,
  // so the tower returns to whole. -1 whenever nothing is open.
  const openIndex = tiers.findIndex((t) => t.emphasis > 0.001)
  const activeTier = shift > 0.02 && openIndex !== -1 ? openIndex : -1
  // Brightness is relative to whether anything is open at all. `DIMMED` marks
  // the storeys that are *not* the one being shown — but with nothing open,
  // which is the hero, the overview and the cta, there is nothing to contrast
  // against and the whole tower must be at full strength. The first version
  // applied `DIMMED` unconditionally, which made the tower almost black on the
  // very first screen a visitor sees.
  const openStrength = tiers.reduce((acc, t) => Math.max(acc, t.emphasis), 0)
  const dim = (1 - DIMMED) * openStrength
  for (let i = 0; i < n; i += 1) {
    tiers[i].brightness = 1 - dim * (1 - tiers[i].emphasis)
  }

  // The camera. One rest point per stage, walked in order: the stage anchors are
  // the gates' milestones and the last one is the pagoda's steps. `sampleStages`
  // eases between them, so the walk never kicks.
  const ctaStage = 2 + n
  const restZ = (i: number) =>
    n <= 1 ? LAST_REST : FIRST_REST - (FIRST_REST - LAST_REST) * (i / (n - 1))
  const stageKeys = [0, 1, ...Array.from({ length: n }, (_, i) => 2 + i), ctaStage]
  const stageY = (i: number) => (layout[i].y + layout[i].bodyHeight / 2) * scale + y
  const cameraZ = sampleStages(
    stageKeys,
    [6.4, 6.15, ...Array.from({ length: n }, (_, i) => restZ(i)), CTA_REST],
    s,
  )
  const cameraY = sampleStages(
    stageKeys,
    [0, 0, ...Array.from({ length: n }, (_, i) => stageY(i)), CTA_CAMERA_Y],
    s,
  )
  // The camera walks the walkway's centre line, so it passes *through* every
  // gate rather than beside it; the gates stand on that same line. At the very
  // end it steps off the path onto the building's axis, so the sign-up presents
  // the pagoda dead centre rather than a few degrees off.
  const arrival = smoothstep((s - (ctaStage - 0.9)) / 0.9)
  const cameraX = pathCentre(cameraZ) * (1 - arrival)

  // How hard the lanterns swing, and how much the water moves. Both key off the
  // strongest open storey, so they rise together and fall together.
  const swayGain = 1 + 0.85 * openStrength
  const ripple = 0.35 + 1.15 * openStrength

  return { scale, x, y, cameraX, cameraY, cameraZ, tiers, activeTier, swayGain, ripple }
}
