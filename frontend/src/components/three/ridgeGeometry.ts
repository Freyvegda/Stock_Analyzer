/**
 * Pure, deterministic data for the Candle Ridge hero (see DESIGN.md → 3D).
 *
 * No three.js here: the ridge's heights, brand-ladder tones, bar layout and
 * staggered entrance all come out as plain numbers, so they stay unit-testable
 * in jsdom and the scene component remains a thin renderer.
 */

/** Maximum number of bars drawn in the ridge. */
export const RIDGE_BARS = 96

/** Last ≤count closes, oldest first. */
export function ridgeValues(candles: { close: number }[], count = RIDGE_BARS): number[] {
  if (count <= 0) return []
  return candles.slice(-count).map((candle) => candle.close)
}

/** Heights normalized to 0..1; a flat series reads as a mid-height plateau. */
export function normalizeRidge(values: number[]): number[] {
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max - min < 1e-12) return values.map(() => 0.5)
  return values.map((value) => (value - min) / (max - min))
}

/**
 * Brand brightness ladder 0..1 from the step delta, 0.5-centered; the first bar
 * and a flat series sit at 0.5. Never encodes gain/loss polarity.
 */
export function ridgeTones(values: number[]): number[] {
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  return values.map((value, index) => {
    if (index === 0 || range < 1e-12) return 0.5
    const delta = value - values[index - 1]
    return Math.min(1, Math.max(0, 0.5 + delta / (2 * range)))
  })
}

/** Centered bar slots across `spanX`; each bar takes `1 - gapFraction` of its slot. */
export function barLayout(
  count: number,
  spanX: number,
  gapFraction = 0.28,
): { x: number; width: number }[] {
  if (count <= 0) return []
  const slot = spanX / count
  const width = slot * (1 - gapFraction)
  const start = -spanX / 2 + slot / 2
  return Array.from({ length: count }, (_, index) => ({ x: start + index * slot, width }))
}

/** Standard ease-out cubic, clamped to 0..1. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return 1 - (1 - clamped) ** 3
}

/** Staggered entrance progress 0..1 for bar `index` at `elapsedMs`. */
export function barProgress(
  index: number,
  count: number,
  elapsedMs: number,
  durationMs = 320,
  staggerMs = 6,
): number {
  const safeIndex = Math.min(Math.max(index, 0), Math.max(count - 1, 0))
  return easeOutCubic((elapsedMs - safeIndex * staggerMs) / durationMs)
}
