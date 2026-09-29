/**
 * Geometry assembly for the world layer: the ridge strips, the torii gates, and
 * the merge that turns a field of placed parts into one buffer.
 *
 * Pure geometry, no renderer, no colours. Kept out of `PagodaEnvironment.tsx` so
 * the renderer stays thin and — more to the point — so the index maths can be
 * tested. A hand-rolled index buffer that is subtly wrong renders as garbage
 * triangles at the centre of the frame, and no amount of looking at the scene
 * tells you which triangle is at fault.
 */

import { BoxGeometry, BufferAttribute, BufferGeometry } from 'three'

/** A geometry with a position and a uniform scale, ready to merge. */
export interface PlacedPart {
  geometry: BufferGeometry
  offset: readonly [number, number, number]
  scale: number
}

/**
 * A ridge as a filled strip under its jagged top edge.
 *
 * Two triangles per span, wound consistently, with the lower edge pinned well
 * below every peak so the strip always closes and the mountain reads as ground
 * rather than a floating ribbon.
 */
export function ridgeStrip(points: number[], base: number): BufferGeometry {
  if (points.length % 2 !== 0) throw new Error('ridge points must come in (x, y) pairs')
  const topCount = points.length / 2
  if (topCount < 2) throw new Error('a ridge needs at least two points')

  const positions: number[] = []
  const indices: number[] = []

  // Top edge first, then the matching bottom edge, so index `i` and index
  // `topCount + i` are vertically the same column.
  for (let i = 0; i < topCount; i += 1) positions.push(points[i * 2], points[i * 2 + 1], 0)
  for (let i = 0; i < topCount; i += 1) positions.push(points[i * 2], base, 0)

  for (let i = 0; i < topCount - 1; i += 1) {
    const topLeft = i
    const topRight = i + 1
    const bottomLeft = topCount + i
    const bottomRight = topCount + i + 1
    // Both triangles share the topLeft -> bottomRight diagonal, which is what
    // makes the pair a quad instead of two slivers.
    indices.push(topLeft, bottomLeft, bottomRight)
    indices.push(topLeft, bottomRight, topRight)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setIndex(indices)
  geometry.computeBoundingBox()
  return geometry
}

/**
 * Merge placed parts into a single buffer.
 *
 * Written by hand rather than with `mergeGeometries`, because these parts differ
 * in attribute sets and `mergeGeometries` refuses those outright. Baking every
 * transform into one buffer is what gets a grove or a row of gates down to one
 * draw call.
 */
export function mergePlaced(parts: PlacedPart[]): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  let vertexOffset = 0

  for (const part of parts) {
    const g = part.geometry
    const pos = g.getAttribute('position')
    if (!pos) continue
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    if (g.getIndex() === null) {
      g.setIndex(Array.from({ length: pos.count }, (_, i) => i))
    }
    const nor = g.getAttribute('normal')
    const index = g.getIndex()!

    for (let i = 0; i < pos.count; i += 1) {
      positions.push(
        pos.getX(i) * part.scale + part.offset[0],
        pos.getY(i) * part.scale + part.offset[1],
        pos.getZ(i) * part.scale + part.offset[2],
      )
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i))
    }
    // The offset has to be the count of vertices pushed *so far*, which is the
    // bug this line exists to not have: using `pos.count` instead accumulates
    // wrongly from the second part onward and folds every later part back onto
    // the first, which is what produced garbage triangles at frame centre.
    for (let i = 0; i < index.count; i += 1) indices.push(index.getX(i) + vertexOffset)
    vertexOffset += pos.count
  }

  const merged = new BufferGeometry()
  merged.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  merged.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  merged.setIndex(indices)
  return merged
}

/**
 * A torii gate: two uprights, a tie beam, and the lintel that oversails them.
 *
 * Four boxes rather than a torus, because a half-torus is a horseshoe and a gate
 * is not.
 */
export function toriiParts(gate: {
  position: { x: number; y: number; z: number }
  scale: number
}): PlacedPart[] {
  const s = gate.scale
  const height = 1.15 * s
  const spread = 0.42 * s
  const parts: PlacedPart[] = []
  for (const side of [-1, 1]) {
    parts.push({
      geometry: new BoxGeometry(0.09 * s, height, 0.09 * s),
      offset: [gate.position.x + side * spread, height / 2, gate.position.z],
      scale: 1,
    })
  }
  // The tie beam and the lintel are what make the shape read as a gate. Thin
  // ones vanish at distance and leave two bare posts hanging in front of the
  // tower.
  parts.push({
    geometry: new BoxGeometry(spread * 2.3, 0.12 * s, 0.1 * s),
    offset: [gate.position.x, height * 0.8, gate.position.z],
    scale: 1,
  })
  parts.push({
    geometry: new BoxGeometry(spread * 3, 0.17 * s, 0.16 * s),
    offset: [gate.position.x, height, gate.position.z],
    scale: 1,
  })
  return parts
}
