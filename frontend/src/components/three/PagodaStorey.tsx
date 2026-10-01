import { useEffect, useMemo } from 'react'
import { Color, type Group, type MeshStandardMaterial } from 'three'

import { buildStorey, disposeStorey } from './storeyGeometry'
import type { TierGeometry } from './pagodaScene'

/**
 * One storey of the pagoda: its body, its veranda, its lanterns and its roof.
 *
 * A thin renderer over `storeyGeometry.ts` — every part is built and merged
 * there, and this file only draws the resulting buffers.
 *
 * The roof is a group of its own so it *could* move; it deliberately does not.
 * The reveal is the camera's (see `towerPose`), and a roof that lifted off the
 * stack read as the building coming apart, which was the bug this replaced.
 *
 * Materials are shared per storey rather than per mesh. A storey used to create
 * one material per mesh, ninety-odd of them across the tower; six per storey is
 * the whole cost now, which is what took the scene from choppy to smooth.
 */

export interface StoreyColours {
  body: Color
  roof: Color
  trim: Color
  deck: Color
  soffit: Color
  lantern: Color
}

/** The material set a storey draws with. One per storey, shared by its parts. */
export interface StoreyMaterials {
  body: MeshStandardMaterial
  roof: MeshStandardMaterial
  trim: MeshStandardMaterial
  deck: MeshStandardMaterial
  soffit: MeshStandardMaterial
  lantern: MeshStandardMaterial
}

export function PagodaStorey({
  tier,
  index,
  ground,
  materials,
  lanternRefs,
  lanternIntensity,
}: {
  tier: TierGeometry
  index: number
  /** The ground storey gets the door; upper storeys get window bands. */
  ground: boolean
  materials: StoreyMaterials
  lanternRefs: Array<Group | null>
  lanternIntensity: number
}) {
  const storey = useMemo(() => buildStorey(tier, ground), [tier, ground])

  // Free the merged buffers when the storey goes away. Without this the geometry
  // of four storeys is retained for the life of the tab, which is the RAM the
  // scene was holding on to.
  useEffect(() => () => disposeStorey(storey), [storey])

  return (
    <group>
      <mesh geometry={storey.body} material={materials.body} castShadow receiveShadow />

      {/* Posts, door frame and pulls, screens, rails, balusters, ridges — one
          draw call for all of it. */}
      {storey.trim ? <mesh geometry={storey.trim} material={materials.trim} castShadow /> : null}

      {/* Door leaves and lattice bars, in the shadowed trim. */}
      {storey.soffit ? <mesh geometry={storey.soffit} material={materials.soffit} /> : null}

      {/* Veranda deck */}
      <mesh geometry={storey.deck} material={materials.deck} castShadow receiveShadow />

      {/* The lanterns, each re-origined at its own cord top in the geometry pass,
          so this group's rotation swings it from the eave rather than spinning
          it in place. */}
      {storey.lanterns.map((lamp, i) => (
        <group
          key={i}
          ref={(node) => {
            lanternRefs[i] = node
          }}
          position={[lamp.spec.cordTop.x, lamp.spec.cordTop.y, lamp.spec.cordTop.z]}
        >
          <mesh geometry={lamp.geometry} material={materials.lantern} />
          {/* Only a capped few carry a real light. This is the scene's main cost
              control: eight lanterns, two lights. */}
          {lamp.spec.lit ? (
            <pointLight
              color={materials.lantern.color}
              intensity={lanternIntensity}
              distance={1.6}
              decay={2}
            />
          ) : null}
        </group>
      ))}

      {/* The roof, fixed at the top of its storey. It never lifts: see the
          `towerPose` note — the camera does the revealing. */}
      <group position={[0, tier.bodyHeight, 0]} name={`roof-${index}`}>
        <mesh geometry={storey.roof} material={materials.roof} castShadow receiveShadow />
        <mesh geometry={storey.eave} material={materials.soffit} receiveShadow />
        {/* Courses and ridges travel with the roof, not with the body. */}
        {storey.roofTrim ? (
          <mesh geometry={storey.roofTrim} material={materials.trim} castShadow />
        ) : null}
      </group>
    </group>
  )
}

export default PagodaStorey
