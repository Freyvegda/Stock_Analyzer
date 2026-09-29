import { describe, expect, it } from 'vitest'
import {
  DIAL_CENTER,
  DIAL_GAP,
  DIAL_HOLE_AT,
  DIAL_HOLE_RADIUS,
  DIAL_INNER,
  DIAL_NOTCH,
  DIAL_OUTER,
  DIAL_VIEW,
  countArc,
  countArcPath,
  holePoint,
  markRadius,
  polarPoint,
  rotationFor,
  segmentAngle,
  segmentCenter,
  wedgeCorners,
  wedgePath,
} from './dial'
import type { DialPoint } from './dial'

function radius(point: DialPoint): number {
  return Math.hypot(point.x - DIAL_CENTER, point.y - DIAL_CENTER)
}

/** Degrees clockwise from 12 o'clock. */
function angleOf(point: DialPoint): number {
  const degrees = (Math.atan2(point.x - DIAL_CENTER, DIAL_CENTER - point.y) * 180) / Math.PI
  return (degrees + 360) % 360
}

describe('segmentAngle / segmentCenter', () => {
  it('splits the full turn evenly', () => {
    expect(segmentAngle(4)).toBe(90)
    expect(segmentAngle(10)).toBe(36)
  })

  it('puts the first centre at half a step and advances clockwise from 12 o’clock', () => {
    expect(segmentCenter(0, 4)).toBe(45)
    expect(segmentCenter(1, 4)).toBe(135)
    expect(segmentCenter(2, 4)).toBe(225)
    expect(segmentCenter(3, 4)).toBe(315)
  })
})

describe('rotationFor', () => {
  it('turns the chosen wedge under the bottom notch', () => {
    expect(DIAL_NOTCH).toBe(180)
    expect(rotationFor(0, 4)).toBe(135)
    expect(rotationFor(1, 4)).toBe(45)
    expect(rotationFor(2, 4)).toBe(-45)
    expect(rotationFor(3, 4)).toBe(-135)
  })

  it('stays inside (-180, 180] for any index', () => {
    for (let index = 0; index < 11; index += 1) {
      const rotation = rotationFor(index, 11)
      expect(rotation).toBeGreaterThan(-180)
      expect(rotation).toBeLessThanOrEqual(180)
    }
  })
})

describe('polarPoint', () => {
  it('measures 0 at 12 o’clock and grows clockwise', () => {
    expect(polarPoint(0, 100)).toEqual({ x: DIAL_CENTER, y: DIAL_CENTER - 100 })
    expect(polarPoint(90, 100).x).toBeCloseTo(DIAL_CENTER + 100, 6)
    expect(polarPoint(90, 100).y).toBeCloseTo(DIAL_CENTER, 6)
    expect(polarPoint(180, 100).y).toBeCloseTo(DIAL_CENTER + 100, 6)
  })
})

describe('wedgeCorners', () => {
  it('runs outer-start → outer-end → inner-end → inner-start inside the viewBox', () => {
    const corners = wedgeCorners(0, 4)
    expect(corners).toHaveLength(4)
    expect(radius(corners[0])).toBeCloseTo(DIAL_OUTER, 6)
    expect(radius(corners[1])).toBeCloseTo(DIAL_OUTER, 6)
    expect(radius(corners[2])).toBeCloseTo(DIAL_INNER, 6)
    expect(radius(corners[3])).toBeCloseTo(DIAL_INNER, 6)
    expect(corners[0].y).toBeLessThan(DIAL_CENTER)
    for (const point of corners) {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(DIAL_VIEW)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(DIAL_VIEW)
    }
  })

  it('insets every wedge edge by half the gap', () => {
    expect(DIAL_GAP).toBeGreaterThan(0)
    const first = wedgeCorners(0, 4)[0]
    const inset = polarPoint(DIAL_GAP / 2, DIAL_OUTER)
    expect(first.x).toBeCloseTo(inset.x, 6)
    expect(first.y).toBeCloseTo(inset.y, 6)
    expect(radius(first)).toBeGreaterThan(radius(polarPoint(0, DIAL_INNER)))
  })
})

describe('holePoint', () => {
  it('sits on the wedge centre angle, inside the band and clear of the rim mark', () => {
    const hole = holePoint(1, 4)
    expect(angleOf(hole)).toBeCloseTo(segmentCenter(1, 4), 6)
    expect(radius(hole)).toBeCloseTo(DIAL_HOLE_AT, 6)
    expect(DIAL_HOLE_AT - DIAL_HOLE_RADIUS).toBeGreaterThan(DIAL_INNER)
    expect(DIAL_HOLE_AT + DIAL_HOLE_RADIUS).toBeLessThan(markRadius())
  })
})

describe('wedgePath', () => {
  it('returns a closed donut wedge', () => {
    const path = wedgePath(0, 4)
    expect(path.startsWith('M ')).toBe(true)
    expect(path.endsWith(' Z')).toBe(true)
    expect(path).toContain(' A ')
  })

  it('is deterministic and distinct per index', () => {
    expect(wedgePath(1, 5)).toBe(wedgePath(1, 5))
    expect(wedgePath(1, 5)).not.toBe(wedgePath(2, 5))
  })
})

describe('countArc', () => {
  it('runs just inside the rim, clear of the finger holes', () => {
    const [start, end] = countArc(1, 4, 0.5)
    expect(radius(start)).toBeCloseTo(markRadius(), 6)
    expect(radius(end)).toBeCloseTo(markRadius(), 6)
    expect(markRadius()).toBeGreaterThan(DIAL_HOLE_AT + DIAL_HOLE_RADIUS)
  })

  it('starts at the wedge lead edge and grows clockwise', () => {
    const [start, end] = countArc(1, 4, 0.5)
    expect(angleOf(start)).toBeCloseTo(angleOf(wedgeCorners(1, 4)[0]), 6)
    expect(angleOf(end)).toBeGreaterThan(angleOf(start))
  })

  it('sweeps exactly the requested share of the wedge', () => {
    const wedgeSpan = segmentAngle(4) - DIAL_GAP
    const [start, end] = countArc(1, 4, 0.5)
    const chord = Math.hypot(end.x - start.x, end.y - start.y)
    const expected = 2 * markRadius() * Math.sin(((wedgeSpan * 0.5) / 2) * (Math.PI / 180))
    expect(chord).toBeCloseTo(expected, 6)
  })

  it('returns nothing for an empty share and clamps a share above one', () => {
    expect(countArc(1, 4, 0)).toEqual([])
    expect(countArc(1, 4, 2)).toEqual(countArc(1, 4, 1))
  })
})

describe('countArcPath', () => {
  it('draws nothing for an empty share and clamps a share above one', () => {
    expect(countArcPath(1, 4, 0)).toBe('')
    expect(countArcPath(1, 4, 2)).toBe(countArcPath(1, 4, 1))
  })

  it('returns an open arc just inside the rim between the two mark points', () => {
    const path = countArcPath(1, 4, 0.5)
    expect(path).toMatch(
      new RegExp(
        `^M -?\\d+(?:\\.\\d+)? -?\\d+(?:\\.\\d+)? A ${markRadius()} ${markRadius()} 0 0 1 -?\\d+(?:\\.\\d+)? -?\\d+(?:\\.\\d+)?$`,
      ),
    )
    expect(path).not.toContain('Z')
  })
})
