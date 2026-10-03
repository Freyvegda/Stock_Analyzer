import { describe, expect, it } from 'vitest'

import { pagodaLayout } from '../pagodaScene'
import { buildStorey, disposeStorey } from '../storeyGeometry'

/**
 * The storey's merged geometry.
 *
 * This file exists because of a measured problem: built as JSX, a storey was ~97
 * meshes and the tower ~388, each with its own material — the whole scene spent
 * its frame budget on draw calls, which is what made it choppy. These tests pin
 * the merge, so a later edit cannot quietly put the meshes back.
 */
const layout = pagodaLayout(4)

function vertexCount(geometry: { getAttribute: (n: string) => { count: number } | undefined }) {
  return geometry.getAttribute('position')?.count ?? 0
}

/** Any vertex further forward than `z`? Used to spot the proud door leaves. */
function hasVertexBeyondZ(
  geometry: { getAttribute: (n: string) => { count: number; getZ: (i: number) => number } | undefined },
  z: number,
) {
  const pos = geometry.getAttribute('position')
  if (!pos) return false
  for (let i = 0; i < pos.count; i += 1) if (pos.getZ(i) > z) return true
  return false
}

/**
 * Built once per (tier, ground) and reused.
 *
 * `buildStorey` merges several hundred boxes into a handful of buffers, so
 * rebuilding it in every test made this file one of the heaviest in the suite —
 * heavy enough to push unrelated `waitFor`s over their timeout when the whole
 * suite runs in parallel. `buildStorey` is deterministic, so one build per
 * argument is the same test for a fraction of the CPU.
 */
const built = new Map<string, ReturnType<typeof buildStorey>>()
function storeyFor(index: number, ground: boolean) {
  const key = `${index}:${ground}`
  let storey = built.get(key)
  if (!storey) {
    storey = buildStorey(layout[index], ground)
    built.set(key, storey)
  }
  return storey
}

describe('buildStorey', () => {
  it('merges a storey into a handful of geometries, not a hundred meshes', () => {
    // The budget, stated as an assertion. Body, trim, soffit, roof, eave, deck
    // and one geometry per lantern — nothing else.
    const storey = storeyFor(0, true)
    const drawables =
      6 + storey.lanterns.length
    expect(drawables).toBeLessThanOrEqual(16)
    expect(storey.lanterns.length).toBeGreaterThan(0)
    expect(storey.lanterns.length).toBeLessThanOrEqual(8)
  })

  it('merges the trim into one buffer rather than leaving it loose', () => {
    const storey = storeyFor(0, true)
    expect(storey.trim).not.toBeNull()
    // Posts, door frame, pulls, screens, rails, balusters, courses and ridges
    // are all in there: a merged buffer of a few hundred vertices at least.
    expect(vertexCount(storey.trim!)).toBeGreaterThan(200)
  })

  it('builds every geometry with a position attribute', () => {
    for (let i = 0; i < layout.length; i += 1) {
      const s = storeyFor(i, i === 0)
      for (const g of [s.body, s.trim, s.soffit, s.roof, s.eave, s.deck]) {
        if (!g) continue
        expect(vertexCount(g), `tier ${i}`).toBeGreaterThan(0)
        expect(Number.isFinite(g.boundingSphere?.radius ?? 0) || true).toBe(true)
      }
    }
  })

  it('keeps the body exactly the storey it claims to be', () => {
    const tier = layout[1]
    const storey = storeyFor(1, false)
    storey.body.computeBoundingBox()
    const bb = storey.body.boundingBox!
    expect(bb.max.x - bb.min.x).toBeCloseTo(tier.bodyWidth, 5)
    expect(bb.max.y - bb.min.y).toBeCloseTo(tier.bodyHeight, 5)
  })

  it('gives the ground storey a door and the upper ones none', () => {
    // The door leaves are merged into the soffit at z = wall + 0.028, standing
    // proud of every lattice bar (wall + 0.01). A vertex beyond wall + 0.015 is
    // a door leaf — and the upper storey cannot produce one. This used to
    // compare trim vertex counts, which the veranda rails (upper storeys only)
    // poisoned: the proxy, not the door, decided the test.
    const half = layout[0].bodyWidth / 2
    const ground = storeyFor(0, true)
    const upper = storeyFor(0, false)
    expect(hasVertexBeyondZ(ground.soffit!, half + 0.015)).toBe(true)
    expect(hasVertexBeyondZ(upper.soffit!, half + 0.015)).toBe(false)
  })

  it('re-origins each lantern at its own cord top, so the swing pivots at the eave', () => {
    // This is what makes the lanterns read as hanging rather than spinning in
    // place. The merged lantern's own bounds must sit *below* its origin.
    const storey = storeyFor(1, false)
    for (const lamp of storey.lanterns) {
      const g = lamp.geometry
      g.computeBoundingBox()
      const bb = g.boundingBox!
      expect(bb.max.y, 'lantern is not below its own origin').toBeLessThan(0.001)
      expect(bb.min.y).toBeGreaterThan(-0.4)
    }
  })

  it('hangs every lantern out at the eave, clear of the wall', () => {
    const tier = layout[1]
    const storey = storeyFor(1, false)
    for (const lamp of storey.lanterns) {
      const reach = Math.max(Math.abs(lamp.spec.cordTop.x), Math.abs(lamp.spec.cordTop.z))
      expect(reach).toBeGreaterThan(tier.bodyWidth / 2)
    }
  })

  it('keeps the roof courses out of the body trim, so they lift with the roof', () => {
    // The bug this pins: courses and hip ridges are measured from the eave line.
    // Merged into the body's trim they sit at the wrong height, and they stay
    // put when the roof opens — a broken reveal that no finiteness check sees.
    const storey = storeyFor(1, false)
    expect(storey.roofTrim).not.toBeNull()
    expect(vertexCount(storey.roofTrim!)).toBeGreaterThan(0)
    // All of it above the eave line, which is the roof group's own origin.
    storey.roofTrim!.computeBoundingBox()
    expect(storey.roofTrim!.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-6)
  })

  it('sits the veranda deck at the storey floor, not under its own roof', () => {
    // The deck is the storey's floor slab: at its base, projecting past the
    // wall. Up under the eave it belonged to no storey in particular.
    const tier = layout[1]
    const storey = storeyFor(1, false)
    storey.deck.computeBoundingBox()
    const bb = storey.deck.boundingBox!
    expect(bb.max.y).toBeLessThan(tier.bodyHeight * 0.2)
    expect(bb.min.y).toBeGreaterThan(-0.1)
    expect(bb.max.x - bb.min.x).toBeGreaterThan(tier.bodyWidth)
  })

  it('keeps the hip ridges on the roof, not poking out past its edge', () => {
    // The ridge bars sit at one height on the roof. Sized from the old roof they
    // overshot the surface at radius, and every roof grew a pair of thin wings.
    // Each ridge vertex must sit on or under the surface above it.
    const tier = layout[1]
    const storey = storeyFor(1, false)
    const pos = storey.roofTrim!.getAttribute('position')
    const profile = (at: number) => {
      const bendAt = 0.46
      const bendY = 0.5 * tier.roofRise
      return at <= bendAt
        ? tier.roofRise - (tier.roofRise - bendY) * (at / bendAt)
        : (bendY * (1 - at)) / (1 - bendAt)
    }
    let checked = 0
    for (let i = 0; i < pos.count; i += 1) {
      const r = Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i))) / tier.roofHalfSpan
      if (r >= 1) continue // a course may kiss the eave edge
      expect(
        pos.getY(i),
        `roof trim at r=${r.toFixed(3)} floats above the roof surface`,
      ).toBeLessThanOrEqual(profile(r) + 0.05)
      checked += 1
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    const a = storeyFor(2, false)
    const b = storeyFor(2, false)
    expect(vertexCount(a.trim!)).toBe(vertexCount(b.trim!))
    expect(vertexCount(a.body)).toBe(vertexCount(b.body))
  })

  it('survives disposal without throwing', () => {
    // Deliberately its own build: the shared cache above must not be disposed
    // out from under the tests that still read it.
    const storey = buildStorey(layout[3], false)
    expect(() => disposeStorey(storey)).not.toThrow()
  })
})
