import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { cn } from '@/lib/utils'
import { hasWebGL } from '@/lib/webgl'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { useColorMode } from '@/components/ui/color-mode'
import { paletteFor } from '@/theme/tokens'

const CANDLE_COUNT = 48
const RADIUS = 1.2
const WAVE_AMPLITUDE = 0.18
const ROTATION_SPEED = 0.18

interface CandleSeed {
  angle: number
  base: number
  phase: number
  color: string
}

interface RingSceneProps {
  seeds: CandleSeed[]
  amber: string
  reduced: boolean
}

function RingScene({ seeds, amber, reduced }: RingSceneProps) {
  const group = useRef<THREE.Group>(null)
  const bodies = useRef<THREE.InstancedMesh>(null)
  const wicks = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const elapsed = useRef(0)

  useFrame((_, delta) => {
    if (document.hidden) return
    if (!reduced) elapsed.current += delta
    const time = elapsed.current
    const bodyMesh = bodies.current
    const wickMesh = wicks.current
    if (bodyMesh === null || wickMesh === null) return

    seeds.forEach((seed, index) => {
      const height = reduced
        ? seed.base
        : seed.base + WAVE_AMPLITUDE * Math.sin(time * 1.4 + seed.phase)

      dummy.position.set(Math.cos(seed.angle) * RADIUS, height / 2, Math.sin(seed.angle) * RADIUS)
      dummy.rotation.set(0, -seed.angle, 0)
      dummy.scale.set(0.085, height, 0.085)
      dummy.updateMatrix()
      bodyMesh.setMatrixAt(index, dummy.matrix)
      bodyMesh.setColorAt(index, color.set(seed.color))

      dummy.position.set(
        Math.cos(seed.angle) * RADIUS,
        height + 0.06,
        Math.sin(seed.angle) * RADIUS,
      )
      dummy.scale.set(0.014, 0.12, 0.014)
      dummy.updateMatrix()
      wickMesh.setMatrixAt(index, dummy.matrix)
      wickMesh.setColorAt(index, color.set(seed.color))
    })

    bodyMesh.instanceMatrix.needsUpdate = true
    wickMesh.instanceMatrix.needsUpdate = true
    if (bodyMesh.instanceColor !== null) bodyMesh.instanceColor.needsUpdate = true
    if (wickMesh.instanceColor !== null) wickMesh.instanceColor.needsUpdate = true

    if (group.current !== null && !reduced) group.current.rotation.y += delta * ROTATION_SPEED
  })

  return (
    <group ref={group}>
      <instancedMesh ref={bodies} args={[undefined, undefined, CANDLE_COUNT]} frustumCulled={false}>
        <boxGeometry />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={wicks} args={[undefined, undefined, CANDLE_COUNT]} frustumCulled={false}>
        <boxGeometry />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.02}>
        <torusGeometry args={[RADIUS, 0.006, 8, 96]} />
        <meshBasicMaterial color={amber} transparent opacity={0.35} toneMapped={false} />
      </mesh>
    </group>
  )
}

/**
 * Market Ring — 48 instanced candlesticks in a slowly rotating ring whose heights
 * breathe as a travelling wave. Static frozen skyline under reduced motion; CSS
 * vault-pulse ring when WebGL is unavailable. The only sanctioned 3D loop besides
 * the ambient field (DESIGN.md).
 */
export function MarketRingLoader({
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

  const seeds = useMemo<CandleSeed[]>(
    () =>
      Array.from({ length: CANDLE_COUNT }, (_, index) => {
        const lossMask = index % 13 === 0
        const gainMask = !lossMask && index % 11 === 0
        return {
          angle: (index / CANDLE_COUNT) * Math.PI * 2,
          base: 0.24 + 0.16 * Math.abs(Math.sin(index * 2.7)),
          phase: index * 0.9,
          color: lossMask ? palette.loss : gainMask ? palette.gain : palette.primary,
        }
      }),
    [palette],
  )

  const frameProps = {
    style: { width: '100%', height: '100%' },
  }

  if (!hasGl || !isDesktop) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="market-ring-loader"
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
      data-testid="market-ring-loader"
      data-reduced={reduced ? 'true' : undefined}
      className={cn('inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <span className="sr-only">{label}</span>
      <Canvas
        className="pointer-events-none"
        frameloop={reduced ? 'demand' : 'always'}
        dpr={[1, 1.5]}
        camera={{ position: [0, 1.6, 3.2], fov: 40 }}
        gl={{ antialias: false, powerPreference: 'low-power', alpha: true }}
        {...frameProps}
      >
        <RingScene seeds={seeds} amber={palette.primary} reduced={reduced} />
      </Canvas>
    </div>
  )
}

export default MarketRingLoader
