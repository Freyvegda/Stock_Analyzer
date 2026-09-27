/**
 * Candle Ridge — the stock detail hero (DESIGN.md → 3D).
 *
 * The stock's own closes rise into a low-poly ridge: bars assemble in a staggered
 * entrance, then the ridge drifts in a slow yaw. Brightness stays on the brand
 * ladder only (never gain/loss polarity). Gates match the 3D kit: lazy chunk,
 * WebGL-gated (no canvas, the strip stays empty), desktop-only, paused while the
 * tab is hidden, frozen assembled pose under reduced motion.
 */

import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { cn } from '@/lib/utils'
import { hasWebGL } from '@/lib/webgl'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { useColorMode } from '@/components/ui/color-mode'
import { paletteFor } from '@/theme/tokens'
import type { Candle } from '../../api/types'
import { barLayout, barProgress, normalizeRidge, ridgeTones, ridgeValues } from './ridgeGeometry'

/** World span of the ridge across x. */
const SPAN_X = 3.2
const BAR_DEPTH = 0.16
const MIN_HEIGHT = 0.05
const HEIGHT_SCALE = 1.15
/** Elapsed used for the frozen pose: entrance long complete, yaw held at 0. */
const FROZEN_MS = 10_000
const YAW_AMPLITUDE = 0.06
const YAW_RATE = 0.25

interface RidgeSceneProps {
  values: number[]
  tones: number[]
  primary: string
  lit: string
  dim: string
  reduced: boolean
}

function RidgeScene({ values, tones, primary, lit, dim, reduced }: RidgeSceneProps) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const group = useRef<THREE.Group>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const base = useMemo(() => new THREE.Color(primary), [primary])
  const light = useMemo(() => new THREE.Color(lit), [lit])
  const shade = useMemo(() => new THREE.Color(dim), [dim])
  const layout = useMemo(() => barLayout(values.length, SPAN_X), [values.length])
  const elapsed = useRef(0)

  useFrame((_, delta) => {
    if (document.hidden) return
    if (!reduced) elapsed.current += delta * 1000
    const time = reduced ? FROZEN_MS : elapsed.current
    const instance = mesh.current
    if (instance === null) return

    values.forEach((level, index) => {
      const progress = barProgress(index, values.length, time)
      const height = MIN_HEIGHT + HEIGHT_SCALE * level * progress
      dummy.position.set(layout[index].x, height / 2, 0)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(layout[index].width, height, BAR_DEPTH)
      dummy.updateMatrix()
      instance.setMatrixAt(index, dummy.matrix)

      // Brand ladder only: taller/delta-up bars brighten toward the light pole.
      color.copy(base).lerp(light, 0.15 + 0.7 * tones[index]).lerp(shade, 1 - progress)
      instance.setColorAt(index, color)
    })
    instance.instanceMatrix.needsUpdate = true
    if (instance.instanceColor !== null) instance.instanceColor.needsUpdate = true

    if (group.current !== null) {
      group.current.rotation.y = reduced ? 0 : Math.sin((time / 1000) * YAW_RATE) * YAW_AMPLITUDE
    }
  })

  return (
    <>
      <hemisphereLight color={lit} groundColor={dim} intensity={1.1} />
      <directionalLight position={[2, 3, 4]} color={lit} intensity={1.6} />
      <group ref={group}>
        <instancedMesh ref={mesh} args={[undefined, undefined, values.length]} frustumCulled={false}>
          <boxGeometry />
          <meshStandardMaterial toneMapped={false} flatShading />
        </instancedMesh>
      </group>
    </>
  )
}

/** Stock hero ridge — `candles` are the loaded series; closes drive the bars. */
export function CandleRidge({ candles, className }: { candles: Candle[]; className?: string }) {
  const reduced = usePrefersReducedMotion()
  const isDesktop = useIsDesktop()
  const { colorMode } = useColorMode()
  const palette = paletteFor(colorMode)
  // Probe once per mount — the page re-renders on range/interval switches.
  const hasGl = useMemo(() => hasWebGL(), [])
  const values = useMemo(() => normalizeRidge(ridgeValues(candles)), [candles])
  const tones = useMemo(() => ridgeTones(ridgeValues(candles)), [candles])

  if (!hasGl || !isDesktop || values.length < 2) return null

  return (
    <div
      aria-hidden="true"
      data-testid="candle-ridge"
      data-reduced={reduced ? 'true' : undefined}
      className={cn('pointer-events-none', className)}
    >
      <Canvas
        className="pointer-events-none"
        frameloop={reduced ? 'demand' : 'always'}
        dpr={[1, 1.5]}
        camera={{ position: [0, 0.9, 2.4], fov: 38 }}
        gl={{ antialias: false, powerPreference: 'low-power', alpha: true }}
        style={{ width: '100%', height: '100%' }}
      >
        <RidgeScene
          values={values}
          tones={tones}
          primary={palette.primary}
          lit={palette.foreground}
          dim={palette.background}
          reduced={reduced}
        />
      </Canvas>
    </div>
  )
}

export default CandleRidge
