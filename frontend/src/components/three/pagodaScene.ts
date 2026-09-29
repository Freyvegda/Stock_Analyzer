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
    const taper = 1 - 0.16 * t
    const bodyWidth = 1.5 * taper
    const bodyHeight = 0.52 * (1 - 0.12 * t)
    const roofHalfSpan = 1.15 * taper
    const roofRise = 0.42 * (1 - 0.1 * t)
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
  const ring: Array<[number, number, number]> = []

  // Walk the square perimeter; each side runs from one corner to the next so the
  // lift can ramp in at both ends and dip to zero in the middle.
  for (let side = 0; side < 4; side += 1) {
    for (let s = 0; s < perSide; s += 1) {
      const t = s / perSide // 0 at this side's first corner, 1 approaching the next
      const a = -halfSpan + 2 * halfSpan * t
      const b = -halfSpan + 2 * halfSpan * side
      const ramp = Math.max(bump(t, cornerSpan), bump(1 - t, cornerSpan))
      const y = eaveLift * ramp
      ring.push([a + jitter * wobble(side, s), y, b])
    }
  }

  const positions: number[] = [0, rise, 0] // apex
  for (const [x, y, z] of ring) positions.push(x, y, z)

  const indices: number[] = []
  for (let i = 0; i < ring.length; i += 1) {
    const a = 1 + i
    const b = 1 + ((i + 1) % ring.length)
    indices.push(0, a, b)
  }
  return { positions, indices }
}

/** 0 away from a corner, 1 at it, smooth across `span`. */
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
}

/** The spire on top: stacked rings over a rod. */
export function finialLayout(): FinialLayout {
  const rings = 5
  return {
    rings,
    ringY: Array.from({ length: rings }, (_, i) => 0.16 * i),
    rodHeight: 0.5,
    baseY: 0.04,
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
  const scale = 0.42 + 0.58 * hero
  const y = -1.1 + 0.5 * hero
  const cameraZ = 6.4 - 0.7 * hero

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
  // so the tower returns to whole. `raw` is -1 whenever nothing is open.
  const raw = n === 0 ? -1 : clamp(Math.round(s - 2), -1, n - 1)
  const openIndex = tiers.findIndex((t) => t.emphasis > 0.001)
  const activeTier = shift > 0.02 && openIndex !== -1 ? openIndex : -1

  return { scale, x, y, cameraZ, tiers, activeTier }
}
