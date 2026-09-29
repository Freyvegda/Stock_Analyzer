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
}

/** The spire on top: stacked rings over a rod, tipped with a jewel. */
export function finialLayout(): FinialLayout {
  const rings = 5
  const rodHeight = 0.5
  return {
    rings,
    ringY: Array.from({ length: rings }, (_, i) => 0.16 * i),
    rodHeight,
    baseY: 0.04,
    tipY: rodHeight + 0.09,
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

// --- lighting --------------------------------------------------------------

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

// --- the scroll pose -------------------------------------------------------

export interface TierPose {
  /** 1 when this is the storey being shown. */
  emphasis: number
  /** How far its roof has lifted off the stack, in world units. */
  lift: number
  /** 0 dimmed, 1 full. */
  brightness: number
}

export interface TowerPose {
  scale: number
  /** -1 left, 0 centred. */
  x: number
  y: number
  cameraZ: number
  tiers: TierPose[]
  activeTier: number
}

const DIMMED = 0.35

/**
 * The whole scroll story, as one function of progress.
 *
 * hero -> tower small and low; overview -> full size, centred; tier i -> the
 * tower slides left and that storey's roof lifts off the stack to reveal it;
 * cta -> closed and re-centred.
 */
export function towerPose(p: number): TowerPose {
  const s = stageProgress(p)
  const n = TOWER_TIERS.length
  const tiers: TierPose[] = Array.from({ length: n }, () => ({
    emphasis: 0,
    lift: 0,
    brightness: DIMMED,
  }))

  const hero = smoothstep(s / 1.2)
  // The tower is ~4.4 world units tall; at full scale it must still clear the
  // frame, so the working scale tops out well below 1.
  const scale = 0.32 + 0.24 * hero
  // Hero sits the tower low in the frame, under the headline, as the brief asks.
  const y = -1.5 + 0.45 * hero
  const cameraZ = 6.4 - 0.25 * hero

  // Overview (stage 1) hands over to tier 0 (stage 2).
  // Centre again once the last tier's window closes, so the cta reads as a
  // whole tower rather than one caught mid-slide.
  const shiftIn = smoothstep((s - 1) / 1.15)
  const ctaStart = 2 + n - 1 + 0.5
  const shiftOut = smoothstep((s - ctaStart) / 0.45)
  const shift = shiftIn * (1 - shiftOut)
  const x = -1.55 * shift

  // Windows must not overlap: the falloff has to reach zero before the next
  // tier's window opens, or two storeys lift at once and the tower comes apart.
  const SPAN = 0.5
  for (let i = 0; i < n; i += 1) {
    const centre = tierStage(i)
    // `radius` is the half-width of this tier's window: 0.5 sits the windows
    // edge to edge, so a tier is fully closed as the next one begins.
    const near = 1 - clamp(Math.abs(s - centre) / SPAN, 0, 1)
    const e = smoothstep(near)
    tiers[i] = {
      emphasis: e,
      lift: 0.62 * e,
      brightness: DIMMED + (1 - DIMMED) * e,
    }
  }

  // The cta owns the far end: by p=1 the last tier's window has closed again,
  // so the tower returns to whole. -1 whenever nothing is open.
  const openIndex = tiers.findIndex((t) => t.emphasis > 0.001)
  const activeTier = shift > 0.02 && openIndex !== -1 ? openIndex : -1

  return { scale, x, y, cameraZ, tiers, activeTier }
}
