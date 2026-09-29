import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  SphereGeometry,
} from 'three'

import { pagodaPalette } from '@/theme/tokens'
import { TOWER_TIERS } from '@/content/tower'
import {
  grove,
  mountainRidges,
  petalPose,
  fireflyPose,
  skyGradient,
  toriiPath,
  waterPlane,
  worldPlan,
  type Quality,
} from './pagodaWorld'
import { pagodaLayout, type TierGeometry } from './pagodaScene'

/**
 * The world the pagoda stands in.
 *
 * Thin renderer, on purpose. Every decision — which celestial body, which layers
 * exist, how dense they are, whether anything moves — comes from `worldPlan()`;
 * every position and count from `pagodaWorld.ts`; every colour from
 * `pagodaPalette`, so `components/three/**` stays hex-free.
 *
 * Three things keep this cheap enough for a modest laptop or a phone:
 *
 * 1. The repeated fields are single `InstancedMesh`es. Ninety stars cost one
 *    draw call, not ninety.
 * 2. Static repeated geometry (the grove, the gates, the ridge strips) is merged
 *    into one buffer per material.
 * 3. The animation writes instance matrices and never calls `setState`. A React
 *    re-render per frame rebuilds the whole tree, which is the classic way an r3f
 *    scene ends up choppy.
 *
 * There is deliberately no mist. See the note in `pagodaWorld.ts`.
 */
export function PagodaEnvironment({
  night,
  reduced,
  clock,
  ripple = 0.35,
  quality = 'high',
  tiers,
}: {
  night: boolean
  reduced: boolean
  /** Seconds since the scene started. One clock for every layer. */
  clock: number
  /** Water motion, from `towerPose.ripple`. */
  ripple?: number
  quality?: Quality
  tiers?: TierGeometry[]
}) {
  const layout = useMemo(() => tiers ?? pagodaLayout(TOWER_TIERS.length), [tiers])
  const plan = useMemo(() => worldPlan(night, reduced, quality), [night, reduced, quality])

  const sky = useMemo(() => skyGradient(), [])
  const ridges = useMemo(() => mountainRidges(), [])
  const trees = useMemo(() => grove(), [])
  const gates = useMemo(() => toriiPath(), [])
  const water = useMemo(() => waterPlane(layout), [layout])

  const dark = pagodaPalette.dark
  const light = pagodaPalette.light
  const mix = useMemo(
    () => (a: string, b: string) => new Color(a).lerp(new Color(b), night ? 1 : 0),
    [night],
  )

  const t = plan.still ? 0 : clock

  // Each ridge keeps its own mesh: they carry three different colours, and that
  // value progression *is* the depth cue. Merging them would flatten the scene
  // into one silhouette.
  const ridgeGeometry = useMemo(
    () => ridges.map((r) => ridgeStrip(r.points, -10)),
    [ridges],
  )

  const gateGeometry = useMemo(
    () => (plan.scenery ? mergePlaced(gates.flatMap((g) => toriiParts(g))) : null),
    [gates, plan.scenery],
  )

  const groveGeometry = useMemo(() => {
    if (!plan.scenery) return null
    type Part = {
      geometry: BufferGeometry
      offset: readonly [number, number, number]
      scale: number
    }
    const canopyLobes: Part[] = []
    for (const tree of trees) {
      canopyLobes.push({
        geometry: new SphereGeometry(tree.canopy * 0.5, 7, 5),
        offset: [tree.position.x, tree.height * 0.78, tree.position.z],
        scale: 1,
      })
      // A second lobe off to one side, so the grove does not read as clones.
      canopyLobes.push({
        geometry: new SphereGeometry(tree.canopy * 0.3, 6, 4),
        offset: [
          tree.position.x + tree.canopy * 0.22,
          tree.height * 0.62,
          tree.position.z - tree.canopy * 0.12,
        ],
        scale: 1,
      })
    }
    const trunks: Part[] = trees.map((tree) => ({
      geometry: new CylinderGeometry(0.03 * tree.height, 0.06 * tree.height, tree.height * 0.6, 5),
      offset: [tree.position.x, tree.height * 0.3, tree.position.z],
      scale: 1,
    }))
    return { trunk: mergePlaced(trunks), canopy: mergePlaced(canopyLobes) }
  }, [trees, plan.scenery])
  return (
    <group>
      {/* Sky. A back-faced sphere: the camera sees its inside. */}
      <mesh scale={[sky.radius, sky.radius, sky.radius]}>
        <sphereGeometry args={[1, 20, 12]} />
        <meshBasicMaterial
          color={mix(light.skyTop, dark.skyTop)}
          side={BackSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* The horizon band, so the sky is not one flat colour top to bottom. */}
      <mesh position={[0, sky.horizon.y, -sky.radius * 0.5]}>
        <planeGeometry args={[sky.radius * 4, sky.radius * 0.8]} />
        <meshBasicMaterial
          color={mix(light.skyHorizon, dark.skyHorizon)}
          transparent
          opacity={0.85}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <Celestial plan={plan} night={night} clock={t} halo={mix(light.halo, dark.halo)} />

      {/* Stars: one draw call for the whole field. */}
      {plan.stars.length > 0 ? (
        <InstancedField
          count={plan.stars.length}
          geometry={<planeGeometry args={[0.03, 0.03]} />}
          colour={dark.star}
          opacity={0.85}
          at={(i) => {
            const s = plan.stars[i]
            // Twinkle, so the sky is not a dead texture.
            const twinkle = plan.still
              ? 0.8
              : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.4 + s.phase))
            return { x: s.position.x, y: s.position.y, z: s.position.z, scale: s.size * 0.9 * twinkle }
          }}
        />
      ) : null}

      {/* Ranges, far to near, each with its own value. */}
      {plan.scenery
        ? ridges.map((r, i) => (
            <mesh key={r.index} geometry={ridgeGeometry[i]} position={[0, -0.5, r.z]}>
              <meshBasicMaterial
                color={mix(light[r.colourRole], dark[r.colourRole])}
                side={DoubleSide}
                toneMapped={false}
              />
            </mesh>
          ))
        : null}

      {groveGeometry ? (
        <group>
          <mesh geometry={groveGeometry.trunk}>
            <meshStandardMaterial color={mix(light.bark, dark.bark)} roughness={0.9} />
          </mesh>
          <mesh geometry={groveGeometry.canopy}>
            <meshStandardMaterial color={mix(light.foliage, dark.foliage)} roughness={0.85} />
          </mesh>
        </group>
      ) : null}

      <Water plane={water} colour={mix(light.water, dark.water)} ripple={ripple} />

      {gateGeometry ? (
        <mesh geometry={gateGeometry}>
          <meshStandardMaterial
            color={mix(light.torii, dark.torii)}
            roughness={0.7}
            emissive={mix(light.torii, dark.torii)}
            emissiveIntensity={night ? 0.25 : 0}
          />
        </mesh>
      ) : null}

      {/* Petals: one draw call. */}
      {plan.petals.length > 0 ? (
        <InstancedField
          count={plan.petals.length}
          geometry={<circleGeometry args={[0.04, 5]} />}
          colour={mix(light.foliage, dark.foliage)}
          opacity={0.85}
          at={(i) => {
            const pose = petalPose(plan.petals[i], t)
            return { ...pose.position, scale: plan.petals[i].size }
          }}
        />
      ) : null}

      {/* Fireflies: one draw call, additive so they read as light. */}
      {plan.fireflies.length > 0 ? (
        <InstancedField
          count={plan.fireflies.length}
          geometry={<sphereGeometry args={[0.025, 5, 4]} />}
          colour={dark.lantern}
          opacity={0.9}
          additive
          at={(i) => {
            const pose = fireflyPose(plan.fireflies[i], t)
            return { ...pose.position, scale: pose.glow }
          }}
        />
      ) : null}

      {plan.birds.length > 0 ? (
        <InstancedField
          count={plan.birds.length}
          geometry={<planeGeometry args={[0.16, 0.06]} />}
          colour={light.bark}
          opacity={1}
          at={(i) => {
            const b = plan.birds[i]
            const x = plan.still ? b.phase * 20 - 10 : ((t * b.rate + b.phase) % 1) * 30 - 15
            return {
              x,
              y: b.position.y + Math.sin(t * 0.7 + b.phase) * 0.2,
              z: b.position.z,
              scale: 1,
            }
          }}
        />
      ) : null}
    </group>
  )
}

interface Placement {
  x: number
  y: number
  z: number
  scale: number
}

/**
 * One instanced field.
 *
 * The whole point is that the matrices are written here, imperatively, and the
 * component never re-renders — so a field of ninety stars is one draw call and
 * zero React work per frame.
 */
function InstancedField({
  count,
  geometry,
  colour,
  opacity,
  additive = false,
  at,
}: {
  count: number
  geometry: React.ReactNode
  colour: Color | string
  opacity: number
  additive?: boolean
  at: (index: number) => Placement
}) {
  const ref = useRef<InstancedMesh>(null)
  const matrix = useMemo(() => new Matrix4(), [])

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < count; i += 1) {
      const p = at(i)
      matrix.makeScale(p.scale, p.scale, p.scale)
      matrix.setPosition(p.x, p.y, p.z)
      mesh.setMatrixAt(i, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      {geometry}
      <meshBasicMaterial
        color={colour}
        transparent={opacity < 1}
        opacity={opacity}
        side={DoubleSide}
        blending={additive ? AdditiveBlending : undefined}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  )
}

/**
 * The sun or the moon, with its halo.
 *
 * The halo is a larger additive disc behind the body, not a post-process bloom:
 * the scene has no post-processing by rule, and at this scale the two are
 * indistinguishable for a fraction of the cost.
 */
function Celestial({
  plan,
  night,
  clock,
  halo,
}: {
  plan: ReturnType<typeof worldPlan>
  night: boolean
  clock: number
  halo: Color
}) {
  const body = plan.celestial
  // A slow cloud shadow crossing the moon. Not the sun, which outshines any
  // cloud worth drawing.
  const drift = body.kind === 'moon' && !plan.still ? 0.5 + 0.5 * Math.sin(clock * 0.06) : 0

  return (
    <group position={[body.position.x, body.position.y, body.position.z]}>
      <mesh>
        <circleGeometry args={[body.radius * body.halo, 24]} />
        <meshBasicMaterial
          color={halo}
          transparent
          opacity={0.22 - drift * 0.1}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0, 0.02]}>
        <circleGeometry args={[body.radius, 24]} />
        <meshBasicMaterial
          color={pagodaPalette[night ? 'dark' : 'light'][night ? 'moon' : 'sun']}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

/** The pool. Low roughness and some metalness, so it catches the sky. */
function Water({
  plane,
  colour,
  ripple,
}: {
  plane: { y: number; z: number; width: number; depth: number }
  colour: Color
  ripple: number
}) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, plane.y, plane.z]}>
      {/* Few segments: the ripple is carried by how the material answers the
          light, so a dense grid here was vertex cost for nothing. */}
      <planeGeometry args={[plane.width, plane.depth, 8, 8]} />
      <meshStandardMaterial
        color={colour}
        roughness={0.12 + ripple * 0.06}
        metalness={0.6}
        transparent
        opacity={0.86}
      />
    </mesh>
  )
}

/**
 * A ridge as a filled strip under its jagged top edge.
 *
 * The lower edge is pinned well below every peak, so the strip always closes and
 * the mountain reads as ground rather than a floating ribbon.
 */
function ridgeStrip(points: number[], base: number): BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  const topCount = points.length / 2
  for (let i = 0; i < topCount; i += 1) positions.push(points[i * 2], points[i * 2 + 1], 0)
  for (let i = 0; i < topCount; i += 1) positions.push(points[i * 2], base, 0)
  for (let i = 0; i < topCount - 1; i += 1) {
    indices.push(i, topCount + i, topCount + i + 1)
    indices.push(i, topCount + i + 1, i + 1)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.setIndex(indices)
  return g
}

/**
 * A torii gate: two uprights, a tie beam, and the top lintel that oversails them.
 *
 * Built from four boxes rather than a torus, because a half-torus is a horseshoe
 * and a gate is not.
 */
function toriiParts(gate: {
  position: { x: number; y: number; z: number }
  scale: number
}): Array<{
  geometry: BufferGeometry
  offset: readonly [number, number, number]
  scale: number
}> {
  const s = gate.scale
  const h = 1.15 * s
  const spread = 0.42 * s
  const parts: Array<{
    geometry: BufferGeometry
    offset: readonly [number, number, number]
    scale: number
  }> = []
  for (const side of [-1, 1]) {
    parts.push({
      geometry: new BoxGeometry(0.055 * s, h, 0.055 * s),
      offset: [gate.position.x + side * spread, h / 2, gate.position.z],
      scale: 1,
    })
  }
  // The tie beam, just under the lintel.
  parts.push({
    geometry: new BoxGeometry(spread * 2.1, 0.06 * s, 0.05 * s),
    offset: [gate.position.x, h * 0.82, gate.position.z],
    scale: 1,
  })
  // The lintel, oversailing both uprights — the shape that says "torii".
  parts.push({
    geometry: new BoxGeometry(spread * 2.7, 0.085 * s, 0.09 * s),
    offset: [gate.position.x, h, gate.position.z],
    scale: 1,
  })
  return parts
}

/**
 * Merge geometries that each carry an offset and a uniform scale.
 *
 * Written by hand rather than with `mergeGeometries`, because these parts differ
 * in attribute sets and `mergeGeometries` refuses those outright. Baking every
 * transform into one buffer is what gets a grove or a row of gates down to a
 * single draw call.
 */
function mergePlaced(
  parts: Array<{
    geometry: BufferGeometry
    offset: readonly [number, number, number]
    scale: number
  }>,
): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  let offset = 0

  for (const part of parts) {
    const g = part.geometry
    if (!g.getAttribute('position')) continue
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    if (g.getIndex() === null) {
      g.setIndex(Array.from({ length: g.getAttribute('position').count }, (_, i) => i))
    }
    const pos = g.getAttribute('position')
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
    for (let i = 0; i < index.count; i += 1) indices.push(index.getX(i) + offset)
    offset += pos.count
    g.dispose()
  }

  const merged = new BufferGeometry()
  merged.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  merged.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  merged.setIndex(indices)
  return merged
}

export default PagodaEnvironment
