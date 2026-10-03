import { describe, expect, it } from 'vitest'
import { BoxGeometry } from 'three'

import { mountainRidges, toriiPath } from '../pagodaWorld'
import { groundSheet } from '../pagodaWorld'
import { pathPlan } from '../pagodaScene'
import { mergePlaced, pavingGeometry, ribbonStrip, ridgeStrip, toriiParts } from '../worldGeometry'

/**
 * The world's geometry assembly.
 *
 * A hand-rolled index buffer that is subtly wrong does not throw — it renders as
 * garbage triangles across the middle of the frame. These tests check the
 * triangle data itself, which is the only way to tell.
 */
function triangles(geometry: {
  getAttribute: (n: string) => { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number } | undefined
  getIndex: () => { count: number; getX: (i: number) => number } | null
}) {
  const pos = geometry.getAttribute('position')!
  const index = geometry.getIndex()!
  const out: Array<[number[], number[], number[]]> = []
  for (let t = 0; t < index.count; t += 3) {
    const v = (k: number) => {
      const i = index.getX(t + k)
      return [pos.getX(i), pos.getY(i), pos.getZ(i)]
    }
    out.push([v(0), v(1), v(2)] as [number[], number[], number[]])
  }
  return out
}

function area([a, b, c]: [number[], number[], number[]]): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const cx = ab[1] * ac[2] - ab[2] * ac[1]
  const cy = ab[2] * ac[0] - ab[0] * ac[2]
  const cz = ab[0] * ac[1] - ab[1] * ac[0]
  return Math.hypot(cx, cy, cz) / 2
}

describe('ridgeStrip', () => {
  const points = [0, 0, 1, 4, 2, 8, 3, 4, 4, 0]

  it('emits two triangles per span, and none between spans', () => {
    const strip = ridgeStrip(points, -10)
    const count = points.length / 2
    expect(strip.getIndex()!.count).toBe((count - 1) * 6)
  })

  it('emits no degenerate triangle', () => {
    // A zero-area triangle is a sliver: it renders as a flickering line, which
    // is exactly the striping a broken index buffer produces.
    for (const tri of triangles(ridgeStrip(points, -10))) {
      expect(area(tri)).toBeGreaterThan(1e-6)
    }
  })

  it('covers the full width of the ridge, both top and bottom', () => {
    const strip = ridgeStrip(points, -10)
    const bb = strip.boundingBox!
    expect(bb.min.x).toBeCloseTo(0, 6)
    expect(bb.max.x).toBeCloseTo(4, 6)
    expect(bb.max.y).toBeCloseTo(8, 6)
    expect(bb.min.y).toBeCloseTo(-10, 6)
  })

  it('closes every triangle inside the vertex buffer', () => {
    const strip = ridgeStrip(points, -10)
    const vertices = strip.getAttribute('position').count
    const index = strip.getIndex()!
    for (let i = 0; i < index.count; i += 1) {
      expect(index.getX(i)).toBeGreaterThanOrEqual(0)
      expect(index.getX(i)).toBeLessThan(vertices)
    }
  })

  it('refuses a malformed point list rather than rendering garbage', () => {
    expect(() => ridgeStrip([0, 1, 2], -10)).toThrow()
    expect(() => ridgeStrip([0], -10)).toThrow()
  })

  it('builds a sane strip for every real ridge', () => {
    for (const ridge of mountainRidges()) {
      const strip = ridgeStrip(ridge.points, -90)
      for (const tri of triangles(strip)) {
        expect(area(tri)).toBeGreaterThan(1e-4)
      }
    }
  })

  it('buries the lower edge below the frame, even for the furthest ridge', () => {
    // The camera sits at z = 6.4 with a 45 degree vertical field of view, so a
    // ridge at z has a visible half-height of about 0.414 * (6.4 - z). A base
    // shallower than that leaves a hard horizontal line across the mountains.
    const base = -90
    for (const ridge of mountainRidges()) {
      const visibleHalfHeight = 0.414 * (6.4 - ridge.z)
      expect(Math.abs(base), `ridge at z=${ridge.z}`).toBeGreaterThan(visibleHalfHeight + 4)
    }
  })
})

/** A two-station ribbon: one quad, four vertices. */
const quad = [
  -1, 0, 1, 1, 0, 1,
  -1, 0, -1, 1, 0, -1,
]

describe('ribbonStrip', () => {
  it('turns a pair of vertices per station into a closed quad', () => {
    const geometry = ribbonStrip(quad)
    const position = geometry.getAttribute('position')
    expect(position.count).toBe(4)
    const index = geometry.getIndex()!
    expect(index.count).toBe(6)
    for (let i = 0; i < index.count; i += 1) {
      expect(index.getX(i)).toBeLessThan(position.count)
    }
  })

  it('faces the surface up in both orientations', () => {
    // Cross product of the first triangle must point at +y: a ribbon wound the
    // wrong way is invisible from above, which reads as the water missing.
    // One ribbon runs along the walk (stations in -z), one along the river
    // (stations in +x); the index pattern has to suit both.
    const pathQuad = [-1, 0, 1, 1, 0, 1, -1, 0, -1, 1, 0, -1]
    const riverQuad = [-1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0, 1]
    for (const positions of [pathQuad, riverQuad]) {
      const geometry = ribbonStrip(positions)
      const position = geometry.getAttribute('position')
      const index = geometry.getIndex()!
      const a = index.getX(0)
      const b = index.getX(1)
      const c = index.getX(2)
      const ax = position.getX(b) - position.getX(a)
      const az = position.getZ(b) - position.getZ(a)
      const bx = position.getX(c) - position.getX(a)
      const bz = position.getZ(c) - position.getZ(a)
      // y of cross(AB, AC) with both vectors flat: az * bx - ax * bz
      expect(az * bx - ax * bz).toBeGreaterThan(0)
    }
  })

  it('refuses a vertex list that is not station pairs', () => {
    expect(() => ribbonStrip([0, 0, 0])).toThrow()
  })
})

describe('pavingGeometry', () => {
  const plan = pathPlan()
  const paving = pavingGeometry(plan)

  it('merges the whole walk into one buffer of slabs and kerbs', () => {
    const count = paving.getAttribute('position').count
    expect(count).toBeGreaterThan(24)
    expect(triangles(paving).length).toBeGreaterThan(12)
  })

  it('spans the walk from the steps to the viewer at the surface line', () => {
    paving.computeBoundingBox()
    const bb = paving.boundingBox!
    expect(bb.min.z).toBeCloseTo(plan.farZ, 6)
    expect(bb.max.z).toBeCloseTo(plan.nearZ, 6)
    // Slabs flush with the walk surface; only the kerb stands slightly proud.
    expect(bb.max.y).toBeGreaterThanOrEqual(plan.y - 1e-9)
    expect(bb.max.y).toBeLessThanOrEqual(plan.y + 0.02)
  })

  it('keeps the paving above the ground sheet, so it never sinks through', () => {
    paving.computeBoundingBox()
    expect(paving.boundingBox!.min.y).toBeGreaterThan(groundSheet().y)
  })

  it('is deterministic', () => {
    const again = pavingGeometry(pathPlan())
    expect(again.getAttribute('position').count).toBe(paving.getAttribute('position').count)
    expect(again.getIndex()!.count).toBe(paving.getIndex()!.count)
  })
})

describe('mergePlaced', () => {
  it('keeps every part at its own offset instead of folding them together', () => {
    // The bug this pins: an index offset that accumulates wrongly from the
    // second part onward folds every later part back onto the first, which puts
    // garbage triangles at frame centre.
    const merged = mergePlaced([
      { geometry: new BoxGeometry(1, 1, 1), offset: [0, 0, 0], scale: 1 },
      { geometry: new BoxGeometry(1, 1, 1), offset: [10, 0, 0], scale: 1 },
    ])
    const bb = merged.boundingBox
    merged.computeBoundingBox()
    const box = merged.boundingBox!
    expect(box.min.x).toBeCloseTo(-0.5, 5)
    expect(box.max.x).toBeCloseTo(10.5, 5)
    void bb
  })

  it('applies the part scale about the part origin', () => {
    const merged = mergePlaced([
      { geometry: new BoxGeometry(1, 1, 1), offset: [0, 0, 0], scale: 1 },
      { geometry: new BoxGeometry(1, 1, 1), offset: [5, 0, 0], scale: 2 },
    ])
    merged.computeBoundingBox()
    expect(merged.boundingBox!.max.x).toBeCloseTo(6, 5)
  })

  it('emits no degenerate triangle for a real gate field', () => {
    const merged = mergePlaced(toriiPath().flatMap((g) => toriiParts(g)))
    for (const tri of triangles(merged)) {
      expect(area(tri)).toBeGreaterThan(1e-8)
    }
  })

  it('keeps every index inside the merged vertex buffer', () => {
    const merged = mergePlaced(toriiPath().flatMap((g) => toriiParts(g)))
    const vertices = merged.getAttribute('position').count
    const index = merged.getIndex()!
    for (let i = 0; i < index.count; i += 1) {
      expect(index.getX(i)).toBeLessThan(vertices)
    }
  })

  it('is deterministic', () => {
    const a = mergePlaced([{ geometry: new BoxGeometry(1, 1, 1), offset: [1, 2, 3], scale: 1 }])
    const b = mergePlaced([{ geometry: new BoxGeometry(1, 1, 1), offset: [1, 2, 3], scale: 1 }])
    expect(a.getAttribute('position').count).toBe(b.getAttribute('position').count)
  })
})
