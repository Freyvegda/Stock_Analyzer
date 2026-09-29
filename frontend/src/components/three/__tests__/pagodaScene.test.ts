/**
 * The pagoda's geometry and scroll maths, tested with no WebGL and no three.js.
 *
 * The import in `pagodaScene.ts` is a type-only re-export of `Card`; if this
 * suite ever needs to change, check the module still exports what it claims.
 */
import { describe, expect, it } from 'vitest'

import { TOWER_TIERS } from '@/content/tower'
import {
  SCROLL_SPAN,
  STAGE_COUNT,
  clamp,
  finialLayout,
  lightingRig,
  pagodaLayout,
  pagodaRoofVertices,
  plinthLayout,
  smoothstep,
  stageAt,
  stageProgress,
  tierDetail,
  tierStage,
  towerPose,
} from '../pagodaScene'

describe('stage maths', () => {
  it('derives the stage count from the tier array', () => {
    expect(STAGE_COUNT).toBe(2 + TOWER_TIERS.length + 1)
  })

  it('spans one fewer interval than stages', () => {
    expect(SCROLL_SPAN).toBe(STAGE_COUNT - 1)
  })

  it('clamps progress at both ends', () => {
    expect(stageProgress(0)).toBe(0)
    expect(stageProgress(1)).toBe(SCROLL_SPAN)
    expect(stageProgress(-5)).toBe(0)
    expect(stageProgress(9)).toBe(SCROLL_SPAN)
  })

  it('treats non-finite progress as the top of the page', () => {
    expect(stageProgress(Number.NaN)).toBe(0)
  })

  it('maps the endpoints onto the first and last stage', () => {
    expect(stageAt(0)).toBe(0)
    expect(stageAt(1)).toBe(SCROLL_SPAN)
  })

  it('puts every tier in its own stage, in order', () => {
    const stages = TOWER_TIERS.map((_, i) => tierStage(i))
    expect(stages).toEqual([2, 3, 4, 5])
    expect(new Set(stages).size).toBe(stages.length) // no two tiers share a stage
  })
})

describe('pagodaLayout', () => {
  const layout = pagodaLayout(TOWER_TIERS.length)

  it('produces one entry per tier', () => {
    expect(layout).toHaveLength(TOWER_TIERS.length)
  })

  it('tapers upward', () => {
    for (let i = 1; i < layout.length; i += 1) {
      expect(layout[i].bodyWidth).toBeLessThan(layout[i - 1].bodyWidth)
      expect(layout[i].roofHalfSpan).toBeLessThan(layout[i - 1].roofHalfSpan)
    }
  })

  it('stacks upward without gaps or overlaps', () => {
    for (let i = 1; i < layout.length; i += 1) {
      const prev = layout[i - 1]
      const top = prev.y + prev.bodyHeight + prev.roofRise
      expect(layout[i].y).toBeGreaterThanOrEqual(top - 1e-9)
    }
  })

  it('keeps every dimension positive and finite', () => {
    for (const t of layout) {
      // `y` starts the tower at the origin, so the first tier is 0 by design.
      for (const v of [t.bodyWidth, t.bodyHeight, t.roofHalfSpan, t.roofRise]) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThan(0)
      }
      expect(Number.isFinite(t.y)).toBe(true)
      expect(t.y).toBeGreaterThanOrEqual(0)
    }
  })

  it('starts the base tier on the ground plane', () => {
    expect(layout[0].y).toBe(0)
  })

  it('is deterministic', () => {
    expect(pagodaLayout(TOWER_TIERS.length)).toEqual(layout)
  })
})

describe('pagodaRoofVertices', () => {
  const roof = pagodaRoofVertices({
    halfSpan: 1,
    rise: 0.42,
    eaveLift: 0.22,
    cornerSpan: 0.3,
    segs: 3,
  })

  it('traces an actual square, not a fan skewed off one axis', () => {
    // This is the shape the whole tower depends on. A ring that sweeps one axis
    // while marching the other sideways produces a fan that shoots out the back
    // of the building, and every test that only checks finiteness still passes.
    const xs = roof.positions.filter((_, i) => i % 3 === 0).slice(1)
    const zs = roof.positions.filter((_, i) => i % 3 === 2).slice(1)
    expect(Math.min(...xs)).toBeCloseTo(-1, 5)
    expect(Math.max(...xs)).toBeCloseTo(1, 5)
    expect(Math.min(...zs)).toBeCloseTo(-1, 5)
    expect(Math.max(...zs)).toBeCloseTo(1, 5)
  })

  it('places the ring points on all four sides of the square', () => {
    const xs = new Set(roof.positions.filter((_, i) => i % 3 === 0).slice(1).map((n) => n.toFixed(3)))
    const zs = new Set(roof.positions.filter((_, i) => i % 3 === 2).slice(1).map((n) => n.toFixed(3)))
    expect(xs.has('-1.000')).toBe(true)
    expect(xs.has('1.000')).toBe(true)
    expect(zs.has('-1.000')).toBe(true)
    expect(zs.has('1.000')).toBe(true)
  })

  it('keeps every ring point within the declared half span', () => {
    const wide = pagodaRoofVertices({
      halfSpan: 2.5,
      rise: 0.5,
      eaveLift: 0.25,
      cornerSpan: 0.3,
      segs: 4,
    })
    for (const axis of [0, 2]) {
      const values = wide.positions.filter((_, i) => i % 3 === axis).slice(1)
      expect(Math.max(...values.map(Math.abs))).toBeLessThanOrEqual(2.5 + 1e-6)
    }
  })

  it('droops between ridge and eave rather than running straight', () => {
    // A straight apex-to-eave cone reads as a flat plate. Pagoda roofs are
    // concave: the slope sags before flicking up at the corners.
    const wide = pagodaRoofVertices({
      halfSpan: 1,
      rise: 0.6,
      eaveLift: 0.2,
      cornerSpan: 0.3,
      segs: 4,
    })
    // A vertex partway up the slope must sit below the straight line from apex
    // (0, rise) to the eave mid-side (halfSpan, 0).
    const apexY = wide.positions[1]
    const midRing: number[] = []
    for (let i = 3; i < wide.positions.length; i += 3) {
      const x = wide.positions[i]
      const y = wide.positions[i + 1]
      const radial = Math.max(Math.abs(x), Math.abs(wide.positions[i + 2]))
      // the inner ring, not the eave ring
      if (radial > 0.2 * 1 && radial < 0.85) midRing.push(y - (apexY * (1 - radial)))
    }
    expect(midRing.length).toBeGreaterThan(0)
    // every one of them below the straight cone
    for (const d of midRing) expect(d).toBeLessThan(0.01)
  })

  it('flicks the corners up above the eave line', () => {
    const wide = pagodaRoofVertices({
      halfSpan: 1,
      rise: 0.6,
      eaveLift: 0.2,
      cornerSpan: 0.3,
      segs: 4,
    })
    const eaveYs: number[] = []
    for (let i = 3; i < wide.positions.length; i += 3) {
      const radial = Math.max(Math.abs(wide.positions[i]), Math.abs(wide.positions[i + 2]))
      if (radial > 0.85) eaveYs.push(wide.positions[i + 1])
    }
    expect(Math.max(...eaveYs)).toBeCloseTo(0.2, 5)
    expect(Math.min(...eaveYs)).toBeCloseTo(0, 5)
  })

  it('emits only finite numbers', () => {
    expect(roof.positions.every(Number.isFinite)).toBe(true)
    expect(roof.indices.every((i) => Number.isInteger(i))).toBe(true)
  })

  it('puts the apex above every point of the eave ring', () => {
    const apexY = roof.positions[1]
    // Skip the apex itself: positions[0..2] is the apex vertex.
    for (let i = 3; i < roof.positions.length; i += 3) {
      expect(apexY).toBeGreaterThan(roof.positions[i + 1])
    }
  })

  it('lifts the corners above the middle of each eave side', () => {
    // The upturned corner is the whole reason this is not a pyramid. Measured
    // on the ring only — the apex is taller still and would mask it.
    const ringYs: number[] = []
    for (let i = 3; i < roof.positions.length; i += 3) ringYs.push(roof.positions[i + 1])
    expect(Math.max(...ringYs)).toBeCloseTo(0.22, 5) // eaveLift at a corner
    expect(Math.min(...ringYs)).toBeCloseTo(0, 5) // flat mid-side
  })

  it('closes every band: whole triangles, no dangling vertex', () => {
    expect(roof.indices.length % 3).toBe(0)
    expect(roof.indices.length).toBeGreaterThan(0)
    const vertexCount = roof.positions.length / 3
    expect(Math.max(...roof.indices)).toBeLessThan(vertexCount)
    expect(Math.min(...roof.indices)).toBeGreaterThanOrEqual(0)
    // a closed surface uses every vertex it declares
    expect(new Set(roof.indices).size).toBe(vertexCount)
  })

  it('indexes every ring vertex', () => {
    const vertexCount = roof.positions.length / 3
    const used = new Set(roof.indices)
    expect(used.size).toBe(vertexCount)
  })

  it('is deterministic', () => {
    const again = pagodaRoofVertices({
      halfSpan: 1,
      rise: 0.42,
      eaveLift: 0.22,
      cornerSpan: 0.3,
      segs: 3,
    })
    expect(again).toEqual(roof)
  })
})

describe('finialLayout', () => {
  it('stacks rings upward from the base', () => {
    const f = finialLayout()
    expect(f.ringY).toHaveLength(f.rings)
    for (let i = 1; i < f.ringY.length; i += 1) {
      expect(f.ringY[i]).toBeGreaterThan(f.ringY[i - 1])
    }
  })
})

describe('towerPose', () => {
  const n = TOWER_TIERS.length

  it('starts small, low and centred at the top of the page', () => {
    const pose = towerPose(0)
    expect(pose.scale).toBeLessThan(0.5)
    expect(pose.x).toBeCloseTo(0, 5)
    expect(pose.activeTier).toBe(-1)
  })

  it('reaches its working size by the overview stage', () => {
    const pose = towerPose(1 / SCROLL_SPAN)
    expect(pose.scale).toBeGreaterThan(0.5)
  })

  it('slides left and opens exactly one storey per tier stage', () => {
    for (let i = 0; i < n; i += 1) {
      const p = tierStage(i) / SCROLL_SPAN
      const pose = towerPose(p)
      expect(pose.x).toBeLessThan(-1)
      expect(pose.activeTier).toBe(i)
      expect(pose.tiers[i].emphasis).toBeCloseTo(1, 5)
      expect(pose.tiers[i].lift).toBeGreaterThan(0.5)
    }
  })

  it('never opens two storeys at once', () => {
    // The one storey lifts off to reveal what is inside it; two at once would
    // read as the whole tower coming apart.
    for (let step = 0; step <= 200; step += 1) {
      const pose = towerPose(step / 200)
      const open = pose.tiers.filter((t) => t.lift > 0.01).length
      expect(open).toBeLessThanOrEqual(1)
    }
  })

  it('keeps every tier dimmer than the open one', () => {
    const pose = towerPose(tierStage(1) / SCROLL_SPAN)
    const open = pose.tiers[1].brightness
    for (let i = 0; i < n; i += 1) {
      if (i === 1) continue
      expect(pose.tiers[i].brightness).toBeLessThan(open)
    }
  })

  it('returns to centre and closes up for the call to action', () => {
    const pose = towerPose(1)
    expect(pose.activeTier).toBe(-1)
    expect(pose.x).toBeCloseTo(0, 5)
    for (const t of pose.tiers) expect(t.lift).toBe(0)
  })

  it('keeps every pose value finite across the whole scroll', () => {
    for (let step = 0; step <= 400; step += 1) {
      const pose = towerPose(step / 400)
      expect(Number.isFinite(pose.scale)).toBe(true)
      expect(Number.isFinite(pose.x)).toBe(true)
      expect(Number.isFinite(pose.y)).toBe(true)
      expect(Number.isFinite(pose.cameraZ)).toBe(true)
      for (const t of pose.tiers) {
        expect(Number.isFinite(t.emphasis)).toBe(true)
        expect(Number.isFinite(t.lift)).toBe(true)
        expect(t.emphasis).toBeGreaterThanOrEqual(0)
        expect(t.emphasis).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('plinth', () => {
  it('sits under the base storey and is wider than it', () => {
    const p = plinthLayout(pagodaLayout(TOWER_TIERS.length))
    const base = pagodaLayout(TOWER_TIERS.length)[0]
    expect(p.width).toBeGreaterThan(base.bodyWidth)
    expect(p.height).toBeGreaterThan(0)
    expect(p.steps).toBeGreaterThanOrEqual(1)
  })

  it('grows upward, each step narrower than the one below', () => {
    const p = plinthLayout(pagodaLayout(4))
    for (let i = 1; i < p.steps; i += 1) {
      expect(p.stepWidths[i]).toBeLessThan(p.stepWidths[i - 1])
    }
  })
})

describe('tierDetail', () => {
  const layout = pagodaLayout(TOWER_TIERS.length)

  it('gives every storey four corner columns, inset inside the wall line', () => {
    const d = tierDetail(layout[0])
    expect(d.columns).toHaveLength(4)
    const xs = d.columns.map((c) => c[0])
    const zs = d.columns.map((c) => c[2])
    const reach = Math.max(...xs.map(Math.abs))
    // square footprint: x and z reach the same distance
    expect(Math.max(...zs.map(Math.abs))).toBeCloseTo(reach, 5)
    // inset from the wall, but only slightly
    expect(reach).toBeLessThan(layout[0].bodyWidth / 2)
    expect(reach).toBeGreaterThan(layout[0].bodyWidth / 2 * 0.8)
    // and all four corners are present
    expect(new Set(xs.map((n) => Math.sign(n))).size).toBe(2)
    expect(new Set(zs.map((n) => Math.sign(n))).size).toBe(2)
  })

  it('hangs a lantern under the eave of every storey', () => {
    const d = tierDetail(layout[1])
    expect(d.lanterns.length).toBeGreaterThanOrEqual(4)
    for (const l of d.lanterns) {
      expect(l[1]).toBeGreaterThan(layout[1].bodyHeight) // above the body, under the roof
      expect(l[1]).toBeLessThan(layout[1].bodyHeight + layout[1].roofRise)
    }
  })

  it('sits the balcony between the body top and the eave', () => {
    const d = tierDetail(layout[2])
    expect(d.balconyY).toBeGreaterThan(0)
    expect(d.balconyWidth).toBeGreaterThan(layout[2].bodyWidth)
    expect(d.railingHeight).toBeGreaterThan(0)
  })
})

describe('lightingRig', () => {
  it('gives the night a lantern-driven glow and no hard sun', () => {
    const night = lightingRig('dark')
    expect(night.lanternIntensity).toBeGreaterThan(0)
    expect(night.emissiveIntensity).toBeGreaterThan(0.5)
    expect(night.finialGlow).toBeGreaterThan(0)
    // A directional sun at night would flatten the very thing the lanterns do.
    expect(night.sun).toBeNull()
    expect(night.shadows).toBe(false)
  })

  it('gives the day a shadow-casting sun and a much subtler interior glow', () => {
    const day = lightingRig('light')
    expect(day.sun).not.toBeNull()
    expect(day.shadows).toBe(true)
    // "Very subtle" is the requirement: interior light must not out-shine the sun.
    expect(day.lanternIntensity).toBeLessThan(lightingRig('dark').lanternIntensity)
    expect(day.emissiveIntensity).toBeLessThan(0.5)
  })

  it('brighter overall at night, because the lanterns carry it', () => {
    // The tower is the light source after dark; the sun is the source by day.
    const night = lightingRig('dark')
    const day = lightingRig('light')
    expect(night.lanternIntensity).toBeGreaterThan(day.lanternIntensity)
    expect(day.ambientIntensity).toBeGreaterThan(night.ambientIntensity)
  })

  it('keeps every value finite and non-negative', () => {
    for (const mode of ['dark', 'light'] as const) {
      const rig = lightingRig(mode)
      for (const [k, v] of Object.entries(rig)) {
        if (typeof v === 'number') {
          expect(Number.isFinite(v), `${mode}.${k}`).toBe(true)
          expect(v, `${mode}.${k}`).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('puts the sun high and off-axis so shadows read across the eaves', () => {
    const sun = lightingRig('light').sun
    expect(sun).not.toBeNull()
    expect(sun!.position[1]).toBeGreaterThan(0)
    expect(sun!.position[0]).not.toBe(0)
    expect(sun!.castShadow).toBe(true)
    expect(sun!.shadowRadius).toBeGreaterThan(0)
  })
})

describe('helpers', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })

  it('smoothsteps with flat ends', () => {
    expect(smoothstep(0)).toBe(0)
    expect(smoothstep(1)).toBe(1)
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 5)
    expect(smoothstep(-1)).toBe(0)
    expect(smoothstep(2)).toBe(1)
  })
})
