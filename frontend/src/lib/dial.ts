/**
 * Rotary-dial geometry for the criteria category selector (`CategoryDial`).
 *
 * A "dialling telephone" ring: wedges cut out of a short, fat donut, drawn from
 * 12 o'clock clockwise in user units of a 240×240 viewBox. The bottom notch is
 * the finger stop — `rotationFor` returns the turn that brings a wedge under it.
 * Pure and unit-tested, so the component stays a thin renderer.
 */

export const DIAL_VIEW = 240
export const DIAL_CENTER = DIAL_VIEW / 2
export const DIAL_OUTER = 112
export const DIAL_INNER = 64
/** The finger stop: 180° is 6 o'clock, straight down from the hub. */
export const DIAL_NOTCH = 180
/** Breathing space between neighbouring wedges, in degrees. */
export const DIAL_GAP = 1.5
/** Rotary finger holes: where they sit and how big they are. */
export const DIAL_HOLE_AT = DIAL_INNER + 30
export const DIAL_HOLE_RADIUS = 8

export interface DialPoint {
  x: number
  y: number
}

/** The enabled-share mark hugs the rim, outside the finger holes. */
export function markRadius(): number {
  return DIAL_OUTER - 4
}

export function segmentAngle(count: number): number {
  return 360 / count
}

/** Degrees clockwise from 12 o'clock. */
export function segmentCenter(index: number, count: number): number {
  const step = segmentAngle(count)
  return index * step + step / 2
}

/** The turn that brings segment `index` under the notch, inside (-180, 180]. */
export function rotationFor(index: number, count: number): number {
  const raw = DIAL_NOTCH - segmentCenter(index, count)
  return ((((raw + 180) % 360) + 360) % 360) - 180
}

export function polarPoint(angle: number, radius: number): DialPoint {
  const radians = (angle * Math.PI) / 180
  return {
    x: DIAL_CENTER + radius * Math.sin(radians),
    y: DIAL_CENTER - radius * Math.cos(radians),
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function draw(point: DialPoint): string {
  return `${round2(point.x)} ${round2(point.y)}`
}

function wedgeStart(index: number, count: number): number {
  return index * segmentAngle(count) + DIAL_GAP / 2
}

function wedgeSpan(count: number): number {
  return segmentAngle(count) - DIAL_GAP
}

/** Outer lead → outer trail → inner trail → inner lead. */
export function wedgeCorners(index: number, count: number): DialPoint[] {
  const start = wedgeStart(index, count)
  const end = start + wedgeSpan(count)
  return [
    polarPoint(start, DIAL_OUTER),
    polarPoint(end, DIAL_OUTER),
    polarPoint(end, DIAL_INNER),
    polarPoint(start, DIAL_INNER),
  ]
}

export function wedgePath(index: number, count: number): string {
  const [outerStart, outerEnd, innerEnd, innerStart] = wedgeCorners(index, count)
  const large = segmentAngle(count) > 180 ? 1 : 0
  return [
    `M ${draw(outerStart)}`,
    `A ${DIAL_OUTER} ${DIAL_OUTER} 0 ${large} 1 ${draw(outerEnd)}`,
    `L ${draw(innerEnd)}`,
    `A ${DIAL_INNER} ${DIAL_INNER} 0 ${large} 0 ${draw(innerStart)}`,
    'Z',
  ].join(' ')
}

/** Centre of a wedge's finger hole, at the wedge's mid angle. */
export function holePoint(index: number, count: number): DialPoint {
  return polarPoint(segmentCenter(index, count), DIAL_HOLE_AT)
}

/**
 * The two ends of the enabled-share mark for a wedge, just inside the rim. An
 * empty share draws nothing; shares above one clamp to the wedge.
 */
export function countArc(index: number, count: number, fraction: number): DialPoint[] {
  const share = Math.max(0, Math.min(1, fraction))
  if (share === 0) return []
  const start = wedgeStart(index, count)
  const end = start + wedgeSpan(count) * share
  return [polarPoint(start, markRadius()), polarPoint(end, markRadius())]
}

export function countArcPath(index: number, count: number, fraction: number): string {
  const marks = countArc(index, count, fraction)
  const [start, end] = marks
  if (start === undefined || end === undefined) return ''
  const radius = markRadius()
  return `M ${draw(start)} A ${radius} ${radius} 0 0 1 ${draw(end)}`
}
