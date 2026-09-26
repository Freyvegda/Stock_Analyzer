/**
 * Sakura Leaf — the app loader (DESIGN.md → 3D and the loader).
 *
 * A low-poly sakura leaf flies downwind: it sways on gusting air, dives and climbs, and
 * banks its nose into every rise and fall. Behind it streams a tape of candlesticks — the
 * leaf's own flight path chopped into slots (open at the slot's start, close at its end,
 * wicks from the extremes). Candles stay on the brand hue ladder: brighter while the leaf
 * climbs, dimmer while it falls, fading out down the tail. Gates match the 3D kit: lazy
 * chunk, WebGL-gated (CSS `vault-pulse` fallback), desktop-only, paused while the tab is
 * hidden, and a frozen static frame under reduced motion.
 */

import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { cn } from '@/lib/utils'
import { hasWebGL } from '@/lib/webgl'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { useColorMode } from '@/components/ui/color-mode'
import { paletteFor } from '@/theme/tokens'
import {
  candleOffset,
  candleSlots,
  CANDLE_COUNT,
  LEAF_ANCHOR_X,
  leafOutline,
  leafPose,
  leafSurfaceZ,
  lighterTone,
  PRICE_TO_WORLD,
  TAPE_SPAN,
  tapeFade,
} from './leafTrace'

/** World scale of the blade (its local span is 2 units, base to tip). */
const LEAF_SCALE = 0.33
const LEAF_TILT = 0.16
const LEAF_YAW_BASE = -0.34
const LEAF_YAW_SWING = 0.2
const LEAF_YAW_RATE = 0.42
const BODY_WIDTH = 0.045
const WICK_WIDTH = 0.012
/** Flat candles still get a visible tick of a body. */
const MIN_BODY = 0.012
/** Frozen pose for the reduced-motion still: mid-flight, tape drawn behind. */
const FROZEN_TIME = 6.4

/** Sampled blade outline → flat shape → vertices pushed onto the blade's own curl. */
function buildLeafGeometry(): THREE.ShapeGeometry {
  const outline = leafOutline()
  const shape = new THREE.Shape()
  shape.moveTo(outline[0].x, outline[0].y)
  for (const point of outline.slice(1)) shape.lineTo(point.x, point.y)
  shape.closePath()

  const geometry = new THREE.ShapeGeometry(shape)
  const position = geometry.attributes.position
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    position.setZ(index, leafSurfaceZ(x, y))
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

interface LeafSceneProps {
  primary: string
  highlight: string
  dim: string
  reduced: boolean
}

function LeafScene({ primary, highlight, dim, reduced }: LeafSceneProps) {
  const leaf = useRef<THREE.Group>(null)
  const bodies = useRef<THREE.InstancedMesh>(null)
  const wicks = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(buildLeafGeometry, [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const base = useMemo(() => new THREE.Color(primary), [primary])
  const lit = useMemo(() => new THREE.Color(lighterTone(highlight, dim)), [highlight, dim])
  const shade = useMemo(() => new THREE.Color(dim), [dim])
  const elapsed = useRef(0)

  useFrame((_, delta) => {
    if (document.hidden) return
    if (!reduced) elapsed.current += delta
    const time = reduced ? FROZEN_TIME : elapsed.current
    const pose = leafPose(time)
    const bodyMesh = bodies.current
    const wickMesh = wicks.current
    if (bodyMesh === null || wickMesh === null) return

    const slots = candleSlots(pose.u)
    slots.forEach((slot, position) => {
      const offset = candleOffset(slot.index, pose.u)
      const fade = tapeFade(offset, TAPE_SPAN)
      const x = LEAF_ANCHOR_X - offset
      const openY = slot.open * PRICE_TO_WORLD
      const closeY = slot.close * PRICE_TO_WORLD
      const highY = slot.high * PRICE_TO_WORLD
      const lowY = slot.low * PRICE_TO_WORLD

      // Brand ladder only: climb brightens toward the light pole, fall dims toward the page.
      color.copy(base).lerp(lit, 0.12 + 0.72 * slot.tone).lerp(shade, 1 - fade)

      dummy.position.set(x, (openY + closeY) / 2, 0)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(BODY_WIDTH, Math.max(Math.abs(closeY - openY), MIN_BODY), BODY_WIDTH)
      dummy.updateMatrix()
      bodyMesh.setMatrixAt(position, dummy.matrix)
      bodyMesh.setColorAt(position, color)

      dummy.position.set(x, (highY + lowY) / 2, 0)
      dummy.scale.set(WICK_WIDTH, Math.max(highY - lowY, MIN_BODY), WICK_WIDTH)
      dummy.updateMatrix()
      wickMesh.setMatrixAt(position, dummy.matrix)
      wickMesh.setColorAt(position, color)
    })
    bodyMesh.instanceMatrix.needsUpdate = true
    wickMesh.instanceMatrix.needsUpdate = true
    if (bodyMesh.instanceColor !== null) bodyMesh.instanceColor.needsUpdate = true
    if (wickMesh.instanceColor !== null) wickMesh.instanceColor.needsUpdate = true

    if (leaf.current !== null) {
      leaf.current.position.set(pose.x, pose.y, 0)
      // Nose banks into the climb; the slow yaw keeps the blade in a readable 3/4 view.
      leaf.current.rotation.set(
        LEAF_TILT + pose.flap,
        LEAF_YAW_BASE + LEAF_YAW_SWING * Math.sin(time * LEAF_YAW_RATE),
        pose.bank,
      )
    }
  })

  return (
    <>
      <hemisphereLight color={highlight} groundColor={dim} intensity={1.25} />
      <directionalLight position={[2.4, 3, 3.6]} color={highlight} intensity={1.9} />
      <group
        ref={leaf}
        position={[LEAF_ANCHOR_X, 0, 0]}
        rotation={[LEAF_TILT, LEAF_YAW_BASE, 0]}
      >
        <group scale={LEAF_SCALE}>
          <mesh geometry={geometry}>
            <meshStandardMaterial
              color={primary}
              emissive={primary}
              emissiveIntensity={0.12}
              flatShading
              roughness={0.5}
              metalness={0}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0.02, 0, 0.058]}>
            <boxGeometry args={[1.2, 0.02, 0.012]} />
            <meshBasicMaterial color={highlight} transparent opacity={0.5} toneMapped={false} />
          </mesh>
          <mesh position={[-1.08, -0.03, 0]} rotation-z={0.25}>
            <boxGeometry args={[0.26, 0.018, 0.012]} />
            <meshBasicMaterial color={primary} toneMapped={false} />
          </mesh>
        </group>
      </group>
      <instancedMesh ref={bodies} args={[undefined, undefined, CANDLE_COUNT]} frustumCulled={false}>
        <boxGeometry />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={wicks} args={[undefined, undefined, CANDLE_COUNT]} frustumCulled={false}>
        <boxGeometry />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </>
  )
}

/**
 * Sakura Leaf loader — `size` is the square the scene renders into; `label` is the
 * sr-only status text. Same contexts as the rest of the kit: run card 120, login 120,
 * criteria dialog 80.
 */
export function SakuraLeafLoader({
  size = 120,
  label = 'Loading…',
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  const reduced = usePrefersReducedMotion()
  const { colorMode } = useColorMode()
  const palette = paletteFor(colorMode)
  const isDesktop = useIsDesktop()
  // Probe once per mount — the elapsed timer re-renders this component every second.
  const hasGl = useMemo(() => hasWebGL(), [])

  const frameProps = {
    style: { width: '100%', height: '100%' },
  }

  if (!hasGl || !isDesktop) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="sakura-leaf-loader"
        className={cn('inline-flex items-center justify-center', className)}
        style={{ width: size, height: size }}
      >
        <span className="sr-only">{label}</span>
        <span
          aria-hidden="true"
          data-testid="vault-pulse"
          className="vault-pulse"
          style={{ width: size * 0.6, height: size * 0.6 }}
        />
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="sakura-leaf-loader"
      data-reduced={reduced ? 'true' : undefined}
      className={cn('inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <span className="sr-only">{label}</span>
      <Canvas
        className="pointer-events-none"
        frameloop={reduced ? 'demand' : 'always'}
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 2.55], fov: 40 }}
        gl={{ antialias: false, powerPreference: 'low-power', alpha: true }}
        {...frameProps}
      >
        <LeafScene
          primary={palette.primary}
          highlight={palette.foreground}
          dim={palette.background}
          reduced={reduced}
        />
      </Canvas>
    </div>
  )
}

export default SakuraLeafLoader
