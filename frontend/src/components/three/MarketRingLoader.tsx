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
const WAVE_AMPLITUDE = 0.16
const HARMONIC_AMPLITUDE = 0.07
const ROTATION_SPEED = 0.18
/** Arc counter-rotates against the ring: 0.25 - 0.18 = 0.07 rad/s the other way. */
const ARC_ROTATION_SPEED = 0.25
const FLARE_SPEED = 1.1
const FLARE_WIDTH = 0.45

/** Angular distance between two angles, wrapped to [0, π]. */
function angularDistance(a: number, b: number): number {
  const wrapped = Math.abs(a - b) % (Math.PI * 2)
  return wrapped > Math.PI ? Math.PI * 2 - wrapped : wrapped
}

/**
 * Gaussian flare brightness at `angle` for a highlight centred on `sweep`.
 * 1 at the centre, ~0 on the far side of the ring; continuous across the 2π seam.
 */
export function flareIntensity(angle: number, sweep: number, width: number): number {
  const distance = angularDistance(angle, sweep)
  return Math.exp(-(distance * distance) / (2 * width * width))
}

interface CandleSeed {
  angle: number
  base: number
  phase: number
  /** Deterministic 0..0.8 tone step for the brand brightness ladder. */
  tone: number
}

interface RingSceneProps {
  seeds: CandleSeed[]
  primary: string
  highlight: string
  reduced: boolean
}

function RingScene({ seeds, primary, highlight, reduced }: RingSceneProps) {
  const group = useRef<THREE.Group>(null)
  const arc = useRef<THREE.Group>(null)
  const baseMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const bodies = useRef<THREE.InstancedMesh>(null)
  const wicks = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const primaryColor = useMemo(() => new THREE.Color(primary), [primary])
  const highlightColor = useMemo(() => new THREE.Color(highlight), [highlight])
  const elapsed = useRef(0)

  useFrame((_, delta) => {
    if (document.hidden) return
    if (!reduced) elapsed.current += delta
    const time = elapsed.current
    const bodyMesh = bodies.current
    const wickMesh = wicks.current
    if (bodyMesh === null || wickMesh === null) return

    const sweep = (time * FLARE_SPEED) % (Math.PI * 2)

    seeds.forEach((seed, index) => {
      const flare = flareIntensity(seed.angle, sweep, FLARE_WIDTH)
      const height = reduced
        ? seed.base
        : seed.base +
          WAVE_AMPLITUDE * Math.sin(time * 1.4 + seed.phase) +
          HARMONIC_AMPLITUDE * Math.sin(time * 0.6 + seed.phase * 0.5)

      color.copy(primaryColor).lerp(highlightColor, Math.min(0.9, seed.tone * 0.22 + flare * 0.65))

      dummy.position.set(Math.cos(seed.angle) * RADIUS, height / 2, Math.sin(seed.angle) * RADIUS)
      dummy.rotation.set(0, -seed.angle, 0)
      dummy.scale.set(0.085 + flare * 0.025, height, 0.085 + flare * 0.025)
      dummy.updateMatrix()
      bodyMesh.setMatrixAt(index, dummy.matrix)
      bodyMesh.setColorAt(index, color)

      dummy.position.set(
        Math.cos(seed.angle) * RADIUS,
        height + 0.06,
        Math.sin(seed.angle) * RADIUS,
      )
      dummy.scale.set(0.014, 0.12, 0.014)
      dummy.updateMatrix()
      wickMesh.setMatrixAt(index, dummy.matrix)
      wickMesh.setColorAt(index, color)
    })

    bodyMesh.instanceMatrix.needsUpdate = true
    wickMesh.instanceMatrix.needsUpdate = true
    if (bodyMesh.instanceColor !== null) bodyMesh.instanceColor.needsUpdate = true
    if (wickMesh.instanceColor !== null) wickMesh.instanceColor.needsUpdate = true

    if (reduced) return

    if (group.current !== null) {
      group.current.rotation.y += delta * ROTATION_SPEED
      group.current.position.y = 0.04 * Math.sin(time * 0.5)
    }
    if (arc.current !== null) arc.current.rotation.y -= delta * ARC_ROTATION_SPEED
    if (baseMaterial.current !== null) {
      baseMaterial.current.opacity = 0.3 + 0.1 * Math.sin(time * 0.6)
    }
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
        <meshBasicMaterial
          ref={baseMaterial}
          color={primary}
          transparent
          opacity={0.35}
          toneMapped={false}
        />
      </mesh>
      <group ref={arc}>
        <mesh rotation-x={-Math.PI / 2} position-y={-0.02}>
          <torusGeometry args={[RADIUS + 0.22, 0.004, 8, 64, Math.PI * 0.7]} />
          <meshBasicMaterial color={primary} transparent opacity={0.22} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

/**
 * Market Ring — 48 instanced candlesticks in a slowly rotating ring whose heights
 * breathe as a travelling wave with a slow harmonic. A brand-hued highlight flares
 * around the ring while a thin arc counter-rotates beneath it; everything is one
 * hue (no gain/loss candles). Static frozen skyline under reduced motion; CSS
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
      Array.from({ length: CANDLE_COUNT }, (_, index) => ({
        angle: (index / CANDLE_COUNT) * Math.PI * 2,
        base: 0.24 + 0.16 * Math.abs(Math.sin(index * 2.7)),
        phase: index * 0.9,
        tone: ((index * 7) % 5) / 5,
      })),
    [],
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
        <RingScene
          seeds={seeds}
          primary={palette.primary}
          highlight={palette.foreground}
          reduced={reduced}
        />
      </Canvas>
    </div>
  )
}

export default MarketRingLoader
