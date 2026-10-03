/**
 * The pagoda's geometry and scroll maths, tested with no WebGL and no three.js.
 *
 * The import in `pagodaScene.ts` is a type-only re-export of `Card`; if this
 * suite ever needs to change, check the module still exports what it claims.
 */
import { describe, expect, it } from 'vitest'

import { TOWER_TIERS } from '@/content/tower'
import { GATE_SOFT_REACH, toriiPath, CAMERA_FOV } from '../pagodaWorld'
import {
  LANTERN_LIMIT,
  MAX_LANTERN_LIGHTS,
  SCROLL_SPAN,
  STAGE_COUNT,
  VERANDA_PROJECTION,
  baseDetail,
  clamp,
  finialLayout,
  hangingLanterns,
  lightingRig,
  pagodaLayout,
  pagodaRoofVertices,
  pathCentre,
  plinthLayout,
  roofCourses,
  smoothstep,
  stageAt,
  stageProgress,
  storeyOpenings,
  tierDetail,
  tierStage,
  towerPose,
} from '../pagodaScene'

/**
 * The roof's mid-side profile, as specified: two straight bands meeting at
 * 0.46 of the way from ridge to eave, with the bend at half the rise.
 * Hand-coded from the design, not read from the module under test.
 */
function roofProfile(rise: number, at: number): number {
  const bendAt = 0.46
  const bendY = 0.5 * rise
  if (at <= bendAt) return rise - (rise - bendY) * (at / bendAt)
  return (bendY * (1 - at)) / (1 - bendAt)
}

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

  it('seats each balcony floor on the roof below, with the roof rising against the wall', () => {
    // The bug this replaces: a storey whose base sat on the roof's *apex*, so
    // its bottom corners hung in the air over the slope. The floor rests on the
    // roof at the veranda edge, and the roof keeps rising past it to meet the
    // wall — the wall is pierced by its own foundation roof, not balanced on it.
    for (let i = 1; i < layout.length; i += 1) {
      const prev = layout[i - 1]
      const verandaAt = (layout[i].roofHalfSpan * VERANDA_PROJECTION) / prev.roofHalfSpan
      const expected = prev.y + prev.bodyHeight + roofProfile(prev.roofRise, verandaAt)
      expect(layout[i].y, `storey ${i} not seated on the roof below`).toBeCloseTo(expected, 9)
      // the roof surface at the wall is above the storey's floor: the roof
      // wraps the base of the wall rather than stopping at the balcony edge
      const wallAt = layout[i].bodyWidth / 2 / prev.roofHalfSpan
      const wallSurface = prev.y + prev.bodyHeight + roofProfile(prev.roofRise, wallAt)
      expect(wallSurface, `tier ${i} roof does not reach the wall`).toBeGreaterThan(layout[i].y)
    }
  })

  it('tucks each roof ridge inside the storey above, never below it', () => {
    // The roof wraps the base of the storey above: its ridge is buried in that
    // storey, not left poking out under the floor.
    for (let i = 1; i < layout.length; i += 1) {
      const prev = layout[i - 1]
      const ridge = prev.y + prev.bodyHeight + prev.roofRise
      expect(ridge, `tier ${i} roof ridge below its floor`).toBeGreaterThan(layout[i].y)
      expect(ridge, `tier ${i} roof ridge above its ceiling`).toBeLessThan(
        layout[i].y + layout[i].bodyHeight,
      )
    }
  })

  it('gives every roof a deep eave, nearly twice the wall half-width', () => {
    // Shallow eaves make the roof read as a lid on the box. A pagoda roof is a
    // wide skirt: its half-span is about twice the wall's.
    for (let i = 0; i < layout.length; i += 1) {
      const wallHalf = layout[i].bodyWidth / 2
      expect(layout[i].roofHalfSpan / wallHalf, `tier ${i} eave`).toBeGreaterThanOrEqual(1.8)
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
    expect(pose.scale).toBeGreaterThan(0.37)
  })

  it('holds one eye line through every storey — the walk does not climb the tower', () => {
    const layout = pagodaLayout(n)
    const poses = TOWER_TIERS.map((_, i) => towerPose(tierStage(i) / SCROLL_SPAN))
    // One look height for all four sections, and it is not any storey's centre:
    // the reveal is the walk past the gates, seen from a distance, not a climb
    // up the tower.
    for (const pose of poses) expect(pose.cameraY).toBeCloseTo(poses[0].cameraY, 9)
    const centres = poses.map(
      (pose, i) => (layout[i].y + layout[i].bodyHeight / 2) * pose.scale + pose.y,
    )
    // The storey centres really do differ, but the eye line is one value: it
    // cannot be sitting on each of them in turn the way the old climb did.
    expect(Math.max(...centres) - Math.min(...centres)).toBeGreaterThan(0.5)
    const distanceToCentres = centres.reduce((sum, c) => sum + Math.abs(poses[0].cameraY - c), 0)
    expect(distanceToCentres).toBeGreaterThan(0.5)
    for (let i = 0; i < n; i += 1) {
      const pose = poses[i]
      // one storey at a time is still the rule; only the camera's behaviour changed
      expect(pose.activeTier).toBe(i)
      expect(pose.tiers[i].emphasis).toBeCloseTo(1, 5)
    }
    // and the eye line sits below the tower's ridge, so the whole building is
    // in front of the camera, not behind it
    const top = (layout[n - 1].y + layout[n - 1].bodyHeight + layout[n - 1].roofRise) * poses[0].scale + poses[0].y
    expect(poses[0].cameraY).toBeLessThan(top)
    for (const pose of poses) {
      expect(pose.x, 'the tower has not slid left for the copy column').toBeLessThan(-0.4)
      expect(pose.activeTier).toBeGreaterThanOrEqual(0)
    }
  })

  it('keeps its distance: every rest is outside the gate line, with the pagoda whole', () => {
    // The complaint this fixes: the camera used to end inside the gate line at
    // z = 2.35, where the tower filled the frame and the top storeys were
    // cropped. The walk now stops well short of the building.
    const rests = TOWER_TIERS.map((_, i) => towerPose(tierStage(i) / SCROLL_SPAN).cameraZ)
    expect(Math.min(...rests)).toBeGreaterThan(3)
  })

  it('frames the whole tower at every rest — base and ridge both inside', () => {
    const layout = pagodaLayout(n)
    const top = (layout[n - 1].y + layout[n - 1].bodyHeight + layout[n - 1].roofRise)
    for (let i = 0; i < n; i += 1) {
      const pose = towerPose(tierStage(i) / SCROLL_SPAN)
      const half = Math.tan((CAMERA_FOV * Math.PI) / 360) * pose.cameraZ
      const base = pose.y
      const ridge = pose.y + top * pose.scale
      expect(base, `tier ${i} base below the frame`).toBeGreaterThan(pose.cameraY - half)
      expect(ridge, `tier ${i} ridge above the frame`).toBeLessThan(pose.cameraY + half)
    }
  })

  it('never opens two storeys at once', () => {
    // One storey at a time is the whole reveal. Two emphasises at once would
    // read as the tower coming apart.
    for (let step = 0; step <= 200; step += 1) {
      const pose = towerPose(step / 200)
      const open = pose.tiers.filter((t) => t.emphasis > 0.01).length
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

  it('leaves the whole tower at full strength when nothing is open', () => {
    // The hero, the overview and the cta have no open storey, so there is
    // nothing to contrast against. Dimming unconditionally made the tower almost
    // black on the very first screen a visitor sees.
    for (const p of [0, 1 / SCROLL_SPAN, 1]) {
      const pose = towerPose(p)
      expect(pose.activeTier).toBe(-1)
      for (const t of pose.tiers) expect(t.brightness).toBe(1)
    }
  })

  it('dims only as much as the open storey demands', () => {
    // Half-way into a storey, that storey is at full strength and the others are
    // part-way down, not already at the floor.
    const pose = towerPose((tierStage(1) + 0.25) / SCROLL_SPAN)
    const open = pose.tiers[1].brightness
    for (let i = 0; i < n; i += 1) {
      if (i === 1) continue
      expect(pose.tiers[i].brightness).toBeLessThan(open)
      expect(pose.tiers[i].brightness).toBeGreaterThan(0.5)
    }
  })

  it('never dims a closed storey into a silhouette', () => {
    // The first build multiplied the body colour down to 0.35, which read as
    // the roof being swallowed by the storey below. The floor is a lighting
    // change, not a shadow: the building must stay a building.
    for (let i = 0; i < n; i += 1) {
      const pose = towerPose(tierStage(i) / SCROLL_SPAN)
      for (const t of pose.tiers) expect(t.brightness).toBeGreaterThanOrEqual(0.55)
    }
  })

  it('keeps every storey fixed in the stack — roofs never detach', () => {
    // The reveal is the camera moving, not the building coming apart. A pose
    // that carries any per-storey displacement is the old bug back again.
    const pose = towerPose(tierStage(0) / SCROLL_SPAN)
    for (const t of pose.tiers) {
      expect(Object.keys(t).sort()).toEqual(['brightness', 'emphasis'])
    }
  })

  it('steers the walk: deeper with every storey, then frames the pagoda', () => {
    const rests = TOWER_TIERS.map((_, i) => towerPose(tierStage(i) / SCROLL_SPAN).cameraZ)
    for (let i = 1; i < rests.length; i += 1) {
      expect(rests[i], `tier ${i} is not deeper than tier ${i - 1}`).toBeLessThan(rests[i - 1])
    }
    // The sign-up steps back to present the building whole, on its axis.
    const cta = towerPose(1)
    expect(cta.cameraZ).toBeGreaterThan(3.5)
    expect(cta.cameraZ).toBeLessThan(5.5)
    expect(cta.cameraY).toBeGreaterThan(0.3)
    expect(Math.abs(cta.cameraX)).toBeLessThan(0.1)
  })

  it('walks the walkway centre line, so every gate is passed through', () => {
    // Until the sign-up's step-back, the camera is on the walk's own line.
    for (const stage of [0, 1, ...TOWER_TIERS.map((_, i) => tierStage(i))]) {
      const pose = towerPose(stage / SCROLL_SPAN)
      expect(pose.cameraX, `stage ${stage}`).toBeCloseTo(pathCentre(pose.cameraZ), 6)
    }
    // Arrival: off the path and onto the building's axis.
    expect(Math.abs(towerPose(1).cameraX)).toBeLessThan(0.1)
  })

  it('parks the camera past a gate on every move between storeys', () => {
    // The fly-through, as a scroll property: between one storey's rest point
    // and the next, at least one torii must have gone by the lens.
    const gates = toriiPath().map((g) => g.position.z)
    const rests = TOWER_TIERS.map((_, i) => towerPose(tierStage(i) / SCROLL_SPAN))
    for (let i = 1; i < rests.length; i += 1) {
      const passed = gates.filter((z) => z < rests[i - 1].cameraZ && z > rests[i].cameraZ)
      expect(passed.length, `no gate on the way to storey ${i}`).toBeGreaterThanOrEqual(1)
    }
    // and the deepest rest is past the last gate: the walk gets all the way in
    const lastGate = Math.min(...gates)
    expect(rests[rests.length - 1].cameraZ).toBeLessThan(lastGate)
  })

  it('never rests within a gate’s blur reach, or inside the tower', () => {
    const gates = toriiPath().map((g) => g.position.z)
    const plinth = plinthLayout(pagodaLayout(n))
    const front = plinth.width / 2
    const stages = [1, ...TOWER_TIERS.map((_, i) => tierStage(i)), SCROLL_SPAN]
    for (const stage of stages) {
      const pose = towerPose(stage / SCROLL_SPAN)
      const nearestAhead = Math.max(...gates.filter((z) => z < pose.cameraZ), -Infinity)
      if (Number.isFinite(nearestAhead)) {
        expect(
          pose.cameraZ - nearestAhead,
          `gate within blur reach at stage ${stage}`,
        ).toBeGreaterThanOrEqual(GATE_SOFT_REACH)
      }
      expect(pose.cameraZ - front, `camera inside the plinth on stage ${stage}`).toBeGreaterThan(0.55)
    }
  })

  it('holds the hero camera wide, low and on the path line', () => {
    const pose = towerPose(0)
    expect(pose.cameraZ).toBeCloseTo(6.4, 1)
    expect(pose.cameraY).toBeCloseTo(0, 3)
    // At the top of the page the walk has barely started, so the camera is
    // near the centre line even though the path bows out further down.
    expect(Math.abs(pose.cameraX)).toBeLessThan(0.45)
  })

  it('returns to centre and frames the whole pagoda for the call to action', () => {
    const pose = towerPose(1)
    expect(pose.activeTier).toBe(-1)
    expect(pose.x).toBeCloseTo(0, 5)
    // Stepped back from the walk: the pagoda centred, in frame, sharp.
    expect(pose.cameraZ).toBeGreaterThan(3.5)
    expect(Math.abs(pose.cameraX)).toBeLessThan(0.1)
  })

  it('keeps every pose value finite across the whole scroll', () => {
    for (let step = 0; step <= 400; step += 1) {
      const pose = towerPose(step / 400)
      for (const v of [pose.scale, pose.x, pose.y, pose.cameraZ, pose.cameraX, pose.cameraY]) {
        expect(Number.isFinite(v)).toBe(true)
      }
      for (const t of pose.tiers) {
        expect(Number.isFinite(t.emphasis)).toBe(true)
        expect(t.emphasis).toBeGreaterThanOrEqual(0)
        expect(t.emphasis).toBeLessThanOrEqual(1)
        expect(t.brightness).toBeGreaterThan(0)
        expect(t.brightness).toBeLessThanOrEqual(1)
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

  it('sits the veranda at the storey floor, just above the roof below', () => {
    // The balconies belong at the *bottom* of each storey — its floor, above
    // the roof below — as in the reference. Sited under the storey's own eave
    // they read as a shelf on the wall instead of a balcony you could stand on.
    const d = tierDetail(layout[2])
    expect(d.balconyY).toBeGreaterThan(0)
    expect(d.balconyY).toBeLessThan(layout[2].bodyHeight * 0.2)
    // It projects past the wall, but stays inside the eave that shelters it.
    expect(d.balconyWidth).toBeGreaterThan(layout[2].bodyWidth)
    expect(d.balconyWidth).toBeLessThan(layout[2].roofHalfSpan * 2)
    expect(d.railingHeight).toBeGreaterThan(0)
  })
})

describe('storey openings', () => {
  const layout = pagodaLayout(TOWER_TIERS.length)

  it('puts a door on the ground storey, centred on the front wall', () => {
    // The reference spends its detail budget on the ground floor, so that is
    // where the door goes. "Centred" means centred *across* the front wall, and
    // the front wall is the one at z = +half — not the middle of the building.
    const ground = storeyOpenings(layout[0], true)
    expect(ground.door).not.toBeNull()
    const { x, z } = ground.door!.centre
    expect(x).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(layout[0].bodyWidth / 2, 6)
    expect(ground.door!.width).toBeGreaterThan(0)
    expect(ground.door!.width).toBeLessThan(layout[0].bodyWidth)
    expect(ground.door!.height).toBeLessThan(layout[0].bodyHeight)
  })

  it('gives the ground storey lattice screens flanking the door', () => {
    const ground = storeyOpenings(layout[0], true)
    expect(ground.screens).toHaveLength(2)
    for (const s of ground.screens) {
      // A screen sits off-centre, to the side of the door, and inside the wall.
      expect(Math.abs(s.centre.x)).toBeGreaterThan(0)
      expect(Math.abs(s.centre.x)).toBeLessThan(layout[0].bodyWidth / 2)
      expect(s.bars).toBeGreaterThan(1)
    }
    // one either side, mirrored
    expect(Math.sign(ground.screens[0].centre.x)).toBe(
      -Math.sign(ground.screens[1].centre.x),
    )
  })

  it('gives an upper storey a window instead of a door', () => {
    const upper = storeyOpenings(layout[2], false)
    expect(upper.door).toBeNull()
    expect(upper.screens.length).toBeGreaterThan(0)
  })

  it('puts every screen inside the wall it is mounted on', () => {
    // A screen that overhangs the storey it belongs to is the failure a
    // finiteness check would never catch. Which wall a screen sits in is decided
    // by which axis is at the wall plane; the *across* offset is the other one.
    for (let i = 0; i < layout.length; i += 1) {
      const half = layout[i].bodyWidth / 2
      const o = storeyOpenings(layout[i], i === 0)
      for (const s of o.screens) {
        const onFront = Math.abs(s.centre.z - half) < 1e-9
        const onSide = Math.abs(s.centre.x - half) < 1e-9
        expect(onFront || onSide, `tier ${i} screen on no wall`).toBe(true)
        // The across-the-wall offset is what must stay inside the storey.
        const across = onFront ? s.centre.x : s.centre.z
        expect(Math.abs(across), `tier ${i} across`).toBeLessThan(half)
        // and the screen's own width must not push it past the corner either
        expect(Math.abs(across) + s.width / 2, `tier ${i} edge`).toBeLessThanOrEqual(half + 1e-9)
        expect(s.height, `tier ${i} h`).toBeLessThan(layout[i].bodyHeight)
      }
    }
  })

  it('is deterministic', () => {
    expect(storeyOpenings(layout[0], true)).toEqual(storeyOpenings(layout[0], true))
  })
})

describe('roof courses', () => {
  const layout = pagodaLayout(TOWER_TIERS.length)

  it('narrows toward the ridge', () => {
    // Tile courses are concentric and stacked; if the radius did not shrink the
    // roof would read as one flat plate again.
    const courses = roofCourses(layout[1].roofHalfSpan, layout[1].roofRise)
    expect(courses.length).toBeGreaterThan(2)
    for (let i = 1; i < courses.length; i += 1) {
      expect(courses[i].radius).toBeLessThan(courses[i - 1].radius)
      expect(courses[i].y).toBeGreaterThan(courses[i - 1].y)
    }
  })

  it('lays every course on the roof surface, not sunk beneath it', () => {
    // The bug this pins: courses were placed by an older profile, so every ring
    // sat under the roof it was supposed to tile and was never visible. Each
    // course must lie on the surface at its own radius — never sunk, and never
    // floating more than the ridge's own thickness above it.
    for (const t of layout) {
      for (const c of roofCourses(t.roofHalfSpan, t.roofRise)) {
        const surface = roofProfile(t.roofRise, c.radius / t.roofHalfSpan)
        expect(c.y, `course at radius ${c.radius} is sunk`).toBeGreaterThanOrEqual(surface - 1e-9)
        expect(c.y, `course at radius ${c.radius} floats`).toBeLessThanOrEqual(surface + 0.02)
      }
    }
  })

  it('keeps every course inside the roof it tiles', () => {
    for (const t of layout) {
      for (const c of roofCourses(t.roofHalfSpan, t.roofRise)) {
        expect(c.radius).toBeLessThanOrEqual(t.roofHalfSpan + 1e-9)
        expect(c.y).toBeGreaterThanOrEqual(0)
        // a hair proud of the surface, so the ring's tube clears the slope
        expect(c.y).toBeLessThanOrEqual(t.roofRise + 0.01)
      }
    }
  })

  it('is deterministic', () => {
    expect(roofCourses(0.9, 0.5)).toEqual(roofCourses(0.9, 0.5))
  })
})

describe('hanging lanterns', () => {
  const layout = pagodaLayout(TOWER_TIERS.length)

  it('hangs each lantern from a cord attached at the eave', () => {
    // The reference detail: the lanterns dangle on visible strings from the
    // corner tips. A cord with no top, or a lantern above its own cord, is the
    // failure this pins.
    for (const h of hangingLanterns(layout[1])) {
      expect(h.cordTop.y).toBeGreaterThan(h.cordBottom.y)
      expect(h.body.y).toBeLessThanOrEqual(h.cordBottom.y)
      // anchored out at the eave, not tucked in under the roof
      expect(Math.max(Math.abs(h.cordTop.x), Math.abs(h.cordTop.z))).toBeGreaterThan(
        layout[1].bodyWidth / 2,
      )
    }
  })

  it('hangs them below the roof and above the deck', () => {
    for (const tier of layout) {
      for (const h of hangingLanterns(tier)) {
        expect(h.body.y).toBeGreaterThan(tier.bodyHeight * 0.2)
        expect(h.cordTop.y).toBeLessThan(tier.bodyHeight + tier.roofRise)
      }
    }
  })

  it('caps the number of real point lights per storey', () => {
    // The cost control: many lanterns, few actual lights. The cap is what keeps
    // the scene inside a frame budget.
    for (const tier of layout) {
      const h = hangingLanterns(tier)
      expect(h.length).toBeGreaterThan(0)
      expect(h.length).toBeLessThanOrEqual(LANTERN_LIMIT)
      const lit = h.filter((l) => l.lit)
      expect(lit.length).toBeLessThanOrEqual(MAX_LANTERN_LIGHTS)
      expect(lit.length).toBeGreaterThan(0)
    }
  })

  it('gives every lantern a distinct sway phase', () => {
    // Identical phases make the whole row swing as one rigid block, which is
    // the giveaway that it is a loop rather than a building.
    const h = hangingLanterns(layout[1])
    expect(new Set(h.map((l) => l.phase.toFixed(4))).size).toBe(h.length)
    for (const l of h) {
      expect(l.phase).toBeGreaterThanOrEqual(0)
      expect(l.phase).toBeLessThan(2 * Math.PI)
    }
  })

  it('is deterministic', () => {
    expect(hangingLanterns(layout[1])).toEqual(hangingLanterns(layout[1]))
  })
})

describe('base and finial detail', () => {
  const layout = pagodaLayout(TOWER_TIERS.length)

  it('balustrades the plinth and flanks it with two stone lanterns', () => {
    const base = baseDetail(layout)
    expect(base.balusters.length).toBeGreaterThan(2)
    expect(base.stoneLanterns).toHaveLength(2)
    for (const s of base.stoneLanterns) {
      // On the plinth, not floating: below the first storey's mid-wall.
      expect(s[1]).toBeLessThan(layout[0].bodyHeight / 2)
      expect(s[1]).toBeLessThan(layout[0].bodyHeight)
    }
    // one either side of the entrance
    expect(Math.sign(base.stoneLanterns[0][0])).toBe(-Math.sign(base.stoneLanterns[1][0]))
  })

  it('hangs a wind-bell under the finial tip', () => {
    const f = finialLayout()
    expect(f.bellY).toBeLessThan(f.tipY)
    expect(f.bellY).toBeGreaterThan(0)
  })
})

describe('camera fly-through', () => {
  it('swings the open storey lanterns harder than the closed ones', () => {
    const pose = towerPose(tierStage(2) / SCROLL_SPAN)
    expect(pose.swayGain).toBeGreaterThan(1)
    const closed = towerPose(1 / SCROLL_SPAN)
    expect(closed.swayGain).toBeCloseTo(1, 5)
  })

  it('ripples the water when a storey opens, and calms it at rest', () => {
    const open = towerPose(tierStage(1) / SCROLL_SPAN)
    const rest = towerPose(0)
    expect(open.ripple).toBeGreaterThan(rest.ripple)
    expect(rest.ripple).toBeGreaterThanOrEqual(0)
  })

  it('keeps every new pose value finite across the whole scroll', () => {
    for (let step = 0; step <= 400; step += 1) {
      const pose = towerPose(step / 400)
      expect(Number.isFinite(pose.ripple)).toBe(true)
      expect(Number.isFinite(pose.swayGain)).toBe(true)
      expect(Number.isFinite(pose.cameraX)).toBe(true)
      expect(Number.isFinite(pose.cameraY)).toBe(true)
    }
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
