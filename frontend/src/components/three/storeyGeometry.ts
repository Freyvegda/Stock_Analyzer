/**
 * Assembles one storey's geometry, merged per material.
 *
 * Why this file exists: built naively as JSX, a storey is ~97 meshes and a tower
 * is ~388, each with its own material instance — ~400 draw calls before the
 * world is drawn at all, which is what made the scene choppy and RAM-hungry.
 * Here every part that shares a material is merged into one buffer, so a storey
 * costs a handful of draw calls instead of a hundred.
 *
 * Geometry only: no renderer, no colours, no hex. Unit-tested on vertex counts,
 * bounds and part counts.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import {
  hangingLanterns,
  pagodaRoofVertices,
  roofCourses,
  storeyOpenings,
  type HangingLantern,
  type TierGeometry,
} from './pagodaScene'

/** Move (and optionally rotate) a geometry in place. */
function place(
  geometry: BufferGeometry,
  [x, y, z]: [number, number, number],
  [rx, ry, rz]: [number, number, number] = [0, 0, 0],
): BufferGeometry {
  const matrix = new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromEuler(new Euler(rx, ry, rz)),
    new Vector3(1, 1, 1),
  )
  geometry.applyMatrix4(matrix)
  return geometry
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rotY = 0,
): BufferGeometry {
  return place(new BoxGeometry(w, h, d), [x, y, z], [0, rotY, 0])
}

function cyl(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments: number,
  x: number,
  y: number,
  z: number,
): BufferGeometry {
  return place(new CylinderGeometry(radiusTop, radiusBottom, height, segments), [x, y, z])
}

/**
 * A ring, laid flat and centred.
 *
 * `rotX = π/2` lays the torus into the horizontal plane, applied on its own
 * rather than folded into an Euler with the others: three composes XYZ as
 * `Rx·Ry·Rz`, so a spin passed alongside it would be applied *first* and tip the
 * ring out of plane. A ring is rotationally symmetric anyway, so there is
 * nothing to spin.
 */
function pull(radius: number, tube: number, x: number, y: number, z: number): BufferGeometry {
  // Left in the XY plane: a pull hangs on the door's face, so it is *not* laid
  // flat the way a roof course is.
  return place(new TorusGeometry(radius, tube, 4, 10), [x, y, z], [0, 0, 0])
}

/**
 * A ring laid into the horizontal plane.
 *
 * The flatten is a rotation about X applied on its own, never folded into an
 * Euler with a spin alongside it: three composes XYZ as `Rx·Ry·Rz`, so a spin
 * passed with it would be applied *first* and would tip the ring out of plane. A
 * ring is rotationally symmetric, so there is nothing to spin anyway.
 */
function layFlat(geometry: TorusGeometry, at: [number, number, number]): BufferGeometry {
  return place(geometry, at, [Math.PI / 2, 0, 0])
}

/**
 * Merge geometries, normalising the inputs first.
 *
 * `mergeGeometries` returns null when handed nothing and refuses inputs whose
 * attributes disagree, so anything it could trip on is removed before the call
 * rather than allowed to take the whole scene down.
 */
function merge(parts: BufferGeometry[]): BufferGeometry | null {
  const usable = parts.filter((g) => g.getAttribute('position') !== undefined)
  if (usable.length === 0) return null
  for (const g of usable) {
    if (g.getIndex() === null) {
      const count = g.getAttribute('position').count
      g.setIndex(Array.from({ length: count }, (_, i) => i))
    }
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    // `mergeGeometries` needs every input to agree on groups.
    g.clearGroups()
  }
  return mergeGeometries(usable, false)
}

export interface StoreyGeometry {
  body: BufferGeometry
  /** Corner posts, door frame and pulls, screens, rails, balusters. */
  trim: BufferGeometry | null
  /** Door leaves and lattice bars — the trim in shadow. */
  soffit: BufferGeometry | null
  roof: BufferGeometry
  /** The underside plate that gives the roof thickness. */
  eave: BufferGeometry
  /**
   * Tile courses and hip ridges, in **roof-local** space.
   *
   * Separate from `trim` for a reason that is a bug if it is ever merged back:
   * these are measured from the eave line, and they have to lift with the roof.
   * Merged into the body's trim they sit at the wrong height and stay put when
   * the roof opens.
   */
  roofTrim: BufferGeometry | null
  deck: BufferGeometry
  /** One entry per lantern, each merged into a single geometry. */
  lanterns: Array<{ geometry: BufferGeometry; spec: HangingLantern }>
}

/**
 * Build one storey as a handful of merged geometries.
 *
 * Every part is a *position* from `pagodaScene.ts`; this function only turns
 * those positions into buffers.
 */
export function buildStorey(tier: TierGeometry, ground: boolean): StoreyGeometry {
  const openings = storeyOpenings(tier, ground)
  const half = tier.bodyWidth / 2
  const post = half * 0.92
  const balconyWidth = tier.roofHalfSpan * 1.78
  const balconyY = tier.bodyHeight * 0.92

  const body = place(new BoxGeometry(tier.bodyWidth, tier.bodyHeight, tier.bodyWidth), [
    0,
    tier.bodyHeight / 2,
    0,
  ])

  const trim: BufferGeometry[] = []
  const soffit: BufferGeometry[] = []

  // Corner posts, inset inside the wall line.
  for (const [x, z] of [
    [post, post],
    [-post, post],
    [post, -post],
    [-post, -post],
  ]) {
    trim.push(box(0.045, tier.bodyHeight, 0.045, x, tier.bodyHeight / 2, z))
  }

  // The door: frame, two leaves, two ring pulls.
  if (openings.door) {
    const d = openings.door
    const z = d.centre.z
    trim.push(box(d.width, d.height, 0.03, 0, d.height / 2, z + 0.008))
    soffit.push(box(d.width / 2 - 0.012, d.height - 0.02, 0.02, -d.width / 4, d.height / 2, z + 0.028))
    soffit.push(box(d.width / 2 - 0.012, d.height - 0.02, 0.02, d.width / 4, d.height / 2, z + 0.028))
    for (const p of d.pulls) {
      trim.push(pull(0.018, 0.005, p[0], p[1], p[2]))
    }
  }

  // Lattice screens: a frame of four rails, plus the bars. A screen mounted on a
  // side wall is rotated onto it, which is what `Math.abs(x) > 0` decides.
  for (const s of openings.screens) {
    const rotY = Math.abs(s.centre.x) > 0 ? Math.PI / 2 : 0
    const { x: cx, y: cy, z: cz } = s.centre
    trim.push(box(s.width, 0.012, 0.012, cx, cy + s.height / 2, cz, rotY))
    trim.push(box(s.width, 0.012, 0.012, cx, cy - s.height / 2, cz, rotY))
    trim.push(box(0.012, s.height, 0.012, cx - s.width / 2, cy, cz, rotY))
    trim.push(box(0.012, s.height, 0.012, cx + s.width / 2, cy, cz, rotY))
    const rows = Math.max(2, Math.round(s.bars * 0.7))
    for (let b = 0; b < s.bars; b += 1) {
      const t = ((b + 1) / (s.bars + 1) - 0.5) * s.width
      soffit.push(
        box(0.008, s.height * 0.94, 0.006, cx + (rotY ? 0 : t), cy, cz + (rotY ? t : 0.01), rotY),
      )
    }
    for (let b = 0; b < rows; b += 1) {
      const t = ((b + 1) / (rows + 1) - 0.5) * s.height
      soffit.push(box(s.width * 0.94, 0.008, 0.006, cx, cy + t, cz + (rotY ? 0 : 0.01), rotY))
    }
  }

  // Veranda rails and their balusters.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      trim.push(
        box(
          0.018,
          0.09,
          balconyWidth,
          sx * (balconyWidth / 2),
          balconyY + 0.045,
          sz * (balconyWidth / 2),
        ),
      )
    }
  }
  for (let b = 0; b < 5; b += 1) {
    const x = ((b + 1) / 6 - 0.5) * balconyWidth
    trim.push(box(0.012, 0.06, 0.012, x, balconyY + 0.03, balconyWidth / 2))
  }

  // The roof surface.
  const roofParts = pagodaRoofVertices({
    halfSpan: tier.roofHalfSpan,
    rise: tier.roofRise,
    eaveLift: tier.roofRise * 0.26,
    cornerSpan: 0.58,
    segs: 6,
  })
  const roof = new BufferGeometry()
  roof.setAttribute('position', new BufferAttribute(new Float32Array(roofParts.positions), 3))
  roof.setIndex(roofParts.indices)
  roof.computeVertexNormals()

  const eave = box(tier.roofHalfSpan * 1.86, 0.03, tier.roofHalfSpan * 1.86, 0, -0.016, 0)

  // Courses and hip ridges. Roof-local: measured from the eave line, and lifted
  // with the roof.
  const roofTrim: BufferGeometry[] = []
  for (const c of roofCourses(tier.roofHalfSpan)) {
    roofTrim.push(layFlat(new TorusGeometry(c.radius * 0.7, c.step * 0.35, 4, 4), [0, c.y, 0]))
  }
  for (const rot of [0, Math.PI / 2]) {
    roofTrim.push(box(tier.roofHalfSpan * 1.5, 0.022, 0.05, 0, tier.roofRise * 0.42, 0, rot))
  }

  // Lanterns stay separate: each swings on its own phase, so they cannot be
  // merged into the static storey buffer. Each lantern's parts are merged into
  // one geometry, and the whole thing is offset so the *cord top* is the origin
  // — that way the swing pivots at the eave, not at the lantern's middle.
  const lanterns = hangingLanterns(tier).map((spec) => {
    const cordLength = spec.cordTop.y - spec.cordBottom.y
    const parts: BufferGeometry[] = [
      cyl(0.004, 0.004, cordLength, 4, spec.cordTop.x, spec.cordTop.y - cordLength / 2, spec.cordTop.z),
      place(
        new CylinderGeometry(spec.radius, spec.radius * 0.86, spec.height, 10),
        [spec.body.x, spec.body.y, spec.body.z],
      ),
      cyl(spec.radius * 0.55, spec.radius * 0.8, 0.014, 8, spec.body.x, spec.body.y + spec.height / 2, spec.body.z),
      cyl(spec.radius * 0.8, spec.radius * 0.5, 0.012, 8, spec.body.x, spec.body.y - spec.height / 2, spec.body.z),
    ]
    const mergedGeometry = merge(parts)
    if (mergedGeometry) {
      // Re-origin at the cord top.
      place(mergedGeometry, [-spec.cordTop.x, -spec.cordTop.y, -spec.cordTop.z])
    }
    return { geometry: mergedGeometry ?? parts[1], spec }
  })

  return {
    body,
    trim: merge(trim),
    soffit: merge(soffit),
    roof,
    eave,
    roofTrim: merge(roofTrim),
    deck: box(balconyWidth, 0.028, balconyWidth, 0, balconyY, 0),
    lanterns,
  }
}

/** Free a storey's buffers. Called when the scene unmounts. */
export function disposeStorey(storey: StoreyGeometry): void {
  storey.body.dispose()
  storey.trim?.dispose()
  storey.soffit?.dispose()
  storey.roof.dispose()
  storey.eave.dispose()
  storey.roofTrim?.dispose()
  storey.deck.dispose()
  for (const l of storey.lanterns) l.geometry.dispose()
}
