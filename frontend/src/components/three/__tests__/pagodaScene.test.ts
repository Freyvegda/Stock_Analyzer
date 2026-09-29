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
  pagodaLayout,
  pagodaRoofVertices,
  smoothstep,
  stageAt,
  stageProgress,
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
      expect(layout[i].y).toBeGreaterThanOrEqual(top)
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

  it('closes the ring: the last triangle rejoins the first', () => {
    const apexIndices = roof.indices.filter((i) => i === 0).length
    expect(apexIndices).toBe(roof.indices.length / 3)
    const maxIndex = Math.max(...roof.indices)
    expect(maxIndex).toBeLessThan(roof.positions.length / 3)
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

  it('reaches full size by the overview stage', () => {
    const pose = towerPose(1 / SCROLL_SPAN)
    expect(pose.scale).toBeGreaterThan(0.9)
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
