import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BackSide,
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
import { mergePlaced, ridgeStrip, toriiParts } from './worldGeometry'

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
    // The base has to sit below the frame for the *furthest* ridge, which is the
    // one whose bottom edge comes closest to the horizon: at z = -70 the visible
    // half-height is about 32 units, so anything shallower than that shows as a
    // hard horizontal line across the mountains.
    () => ridges.map((r) => ridgeStrip(r.points, -90)),
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
      <SkyDome night={night} sky={sky} />

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
            <mesh key={r.index} geometry={ridgeGeometry[i]} position={[0, -1.2, r.z]}>
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

/**
 * The sky dome, with the gradient painted into its vertices.
 *
 * A vertex-colour gradient rather than a separate horizon plane: a separate band
 * has to pick a depth, and at the near ridge's depth the two become coplanar and
 * z-fight. A gradient baked into the dome cannot fight with anything, and it is
 * one draw call.
 */
function SkyDome({ night, sky }: { night: boolean; sky: ReturnType<typeof skyGradient> }) {
  const geometry = useMemo(() => {
    const g = new SphereGeometry(1, 24, 16)
    const position = g.getAttribute('position')
    const top = new Color(night ? pagodaPalette.dark.skyTop : pagodaPalette.light.skyTop)
    const bottom = new Color(
      night ? pagodaPalette.dark.skyHorizon : pagodaPalette.light.skyHorizon,
    )
    const blend = new Color()
    const colours = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count; i += 1) {
      // 0 at the bottom of the dome, 1 at the top. The 0.6 exponent lifts the
      // horizon glow up the dome, which is where a real sky is lightest.
      const t = Math.pow(Math.max(0, (position.getY(i) + 1) / 2), 0.6)
      blend.copy(bottom).lerp(top, t)
      colours[i * 3] = blend.r
      colours[i * 3 + 1] = blend.g
      colours[i * 3 + 2] = blend.b
    }
    g.setAttribute('color', new BufferAttribute(colours, 3))
    return g
  }, [night])

  return (
    <mesh renderOrder={-2} scale={[sky.radius, sky.radius, sky.radius]} geometry={geometry}>
      <meshBasicMaterial vertexColors side={BackSide} depthWrite={false} toneMapped={false} />
    </mesh>
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
