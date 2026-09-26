/**
 * Pure, deterministic data for the Sakura Leaf loader (see DESIGN.md → 3D and the loader).
 *
 * No three.js here. The leaf blade, its surface curl, the wind clock, the price curve it
 * draws and the candle tape all come out as plain numbers, so they stay unit-testable in
 * jsdom and the scene component remains a thin renderer.
 *
 * The model: the leaf flies downwind; its height above the tape is a seeded harmonic
 * price curve sampled against *distance travelled*, so the trail of candles behind it is
 * simply that curve chopped into fixed-width slots — open at the slot's start, close at
 * its end, wicks from the extremes between. Every candle is the leaf's own path.
 */

import { mulberry32 } from './sakuraTree'

/** Deterministic seed — the same leaf path and candles on every load. */
export const LEAF_SEED = 20261002

/* Blade, in local units: base at x = -1, tip at x = +1. */
export const LEAF_HALF_WIDTH = 0.34
export const OUTLINE_SEGMENTS = 16

/* Tape and price scale. */
export const PRICE_RANGE = 0.42
export const PRICE_TO_WORLD = 1
export const CANDLE_COUNT = 18
export const CANDLE_SPACING = 0.085
export const TAPE_SPAN = CANDLE_COUNT * CANDLE_SPACING

/* Wind: a steady push plus a slow gust swell, monotonic (gust rate × amplitude < speed). */
export const WIND_SPEED = 0.34
export const GUST_AMPLITUDE = 0.35
export const GUST_RATE = 0.45

/* The leaf leads the tape, swaying on the wind but never leaving its band. */
export const LEAF_ANCHOR_X = 0.52
export const SWAY_AMPLITUDE = 0.06
export const SURGE_AMPLITUDE = 0.05

const WIDTH_SHAPE = 0.72
const ARCH = 0.05
const CUP = 0.55
const SWAY_RATE = 0.6
const SURGE_RATE = 0.21
const SLOPE_STEP = 0.05
const BANK_RESPONSE = 0.9
const FLAP_AMPLITUDE = 0.16
const FLAP_SPEED = 2.1
const BODY_SAMPLES = 4
/** Climb (in price units) that saturates the brand brightness ladder. */
const TONE_CLIMB = 0.16
const FADE_START_FRACTION = 0.78

export interface Point2 {
  x: number
  y: number
}

export interface LeafPose {
  /** Distance travelled downwind, in tape units. */
  u: number
  x: number
  y: number
  /** Vertical slope of the price curve under the leaf, in world units per tape unit. */
  slope: number
  /** Nose tilt: positive while climbing. */
  bank: number
  /** Flutter angle. */
  flap: number
}

export interface CandleSlot {
  index: number
  open: number
  close: number
  high: number
  low: number
  /** 0..1 brand brightness ladder — above 0.5 while the leaf climbs, below while it falls. */
  tone: number
}

/** Half-width of the blade at `u` (0 base → 1 tip): fuller toward the base, pointed tip. */
export function leafHalfWidth(u: number): number {
  const clamped = Math.min(1, Math.max(0, u))
  return LEAF_HALF_WIDTH * Math.sin(Math.PI * clamped ** WIDTH_SHAPE) ** 0.9
}

/** Closed blade loop: the upper side base→tip, then the lower side back again. */
export function leafOutline(segments = OUTLINE_SEGMENTS): Point2[] {
  const upper: Point2[] = []
  const lower: Point2[] = []
  for (let index = 0; index <= segments; index += 1) {
    const u = index / segments
    const width = leafHalfWidth(u)
    const x = -1 + u * 2
    upper.push({ x, y: width })
    lower.push({ x, y: -width })
  }
  // Base and tip are single points; the loop never repeats them.
  return [...upper, ...lower.slice(1, -1).reverse()]
}

/** Depth of the blade surface: a ridge along the midrib, arching slightly along its length. */
export function leafSurfaceZ(x: number, y: number): number {
  const along = (x + 1) / 2
  return ARCH * Math.sin(Math.PI * Math.min(1, Math.max(0, along))) - CUP * y * y
}

/**
 * The price curve, as a function of distance travelled: four seeded harmonics, normalised
 * so the curve can never leave ±PRICE_RANGE however long the leaf flies.
 */
const HARMONICS = (() => {
  const random = mulberry32(LEAF_SEED)
  const harmonics = Array.from({ length: 4 }, () => ({
    amplitude: 0.14 + random() * 0.16,
    frequency: 0.8 + random() * 2.6,
    phase: random() * Math.PI * 2,
  }))
  return {
    harmonics,
    total: harmonics.reduce((sum, harmonic) => sum + harmonic.amplitude, 0),
  }
})()

export function priceCurve(u: number): number {
  let value = 0
  for (const harmonic of HARMONICS.harmonics) {
    value += harmonic.amplitude * Math.sin(harmonic.frequency * u + harmonic.phase)
  }
  return (value / HARMONICS.total) * PRICE_RANGE
}

/** Distance the leaf has travelled downwind by `t` seconds — never reverses. */
export function windDistance(t: number): number {
  return WIND_SPEED * t + GUST_AMPLITUDE * Math.sin(t * GUST_RATE)
}

/** Where the leaf is, how fast it is climbing and how it is tilted, at `t` seconds. */
export function leafPose(t: number): LeafPose {
  const u = windDistance(t)
  const slope =
    ((priceCurve(u + SLOPE_STEP) - priceCurve(u - SLOPE_STEP)) / (2 * SLOPE_STEP)) * PRICE_TO_WORLD
  return {
    u,
    x:
      LEAF_ANCHOR_X +
      SWAY_AMPLITUDE * Math.sin(t * SWAY_RATE) +
      SURGE_AMPLITUDE * Math.sin(t * SURGE_RATE),
    y: priceCurve(u) * PRICE_TO_WORLD,
    slope,
    bank: Math.atan(slope) * BANK_RESPONSE,
    flap: FLAP_AMPLITUDE * Math.sin(t * FLAP_SPEED),
  }
}

/**
 * The candle tape as of `frontier` (the leaf's travelled distance): the newest slot is the
 * one the leaf is closing right now, older slots trail behind it.
 */
export function candleSlots(
  frontier: number,
  count = CANDLE_COUNT,
  spacing = CANDLE_SPACING,
): CandleSlot[] {
  const newest = Math.floor(frontier / spacing)
  const slots: CandleSlot[] = []
  for (let step = 0; step < count; step += 1) {
    const index = newest - step
    const start = index * spacing
    const open = priceCurve(start)
    const close = priceCurve(start + spacing)
    let high = Math.max(open, close)
    let low = Math.min(open, close)
    for (let sample = 1; sample < BODY_SAMPLES; sample += 1) {
      const value = priceCurve(start + (sample / BODY_SAMPLES) * spacing)
      high = Math.max(high, value)
      low = Math.min(low, value)
    }
    const climb = close - open
    slots.push({
      index,
      open,
      close,
      high,
      low,
      tone: 0.5 + 0.5 * Math.max(-1, Math.min(1, climb / TONE_CLIMB)),
    })
  }
  return slots
}

/** How far a candle trails behind the leaf's frontier, in tape units. */
export function candleOffset(index: number, frontier: number, spacing = CANDLE_SPACING): number {
  return frontier - index * spacing
}

/** Opacity of the brand ladder at `offset` behind the leaf: full near it, gone past the tail. */
export function tapeFade(offset: number, span = TAPE_SPAN): number {
  const start = span * FADE_START_FRACTION
  if (offset <= start) return 1
  if (offset >= span) return 0
  const progress = (offset - start) / (span - start)
  return 1 - progress * progress * (3 - 2 * progress)
}

/** Relative luminance of a #rrggbb tone (WCAG coefficients). */
function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const [red, green, blue] = [0, 2, 4].map((offset) =>
    parseInt(value.slice(offset, offset + 2), 16) / 255,
  )
  const linear = [red, green, blue].map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

/**
 * The lighter of two palette tones. The candle ladder brightens toward a palette's light
 * pole (`foreground` in dark mode, `background` in light mode), so climbing candles read
 * as highlights whichever side of the theme the tape sits on — never a hue literal.
 */
export function lighterTone(first: string, second: string): string {
  return luminance(second) > luminance(first) ? second : first
}
