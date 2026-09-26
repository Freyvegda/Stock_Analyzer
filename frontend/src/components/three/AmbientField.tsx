import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { cn } from '@/lib/utils'
import { hasWebGL } from '@/lib/webgl'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { useColorMode } from '@/components/ui/color-mode'
import { paletteFor } from '@/theme/tokens'

const PARTICLE_COUNT = 500
const SPREAD = 12

function ParticleField({ color }: { color: string }) {
  const points = useRef<THREE.Points>(null)
  const positions = useMemo(() => {
    const array = new Float32Array(PARTICLE_COUNT * 3)
    for (let i = 0; i < array.length; i += 1) {
      array[i] = (Math.random() - 0.5) * SPREAD
    }
    return array
  }, [])

  useFrame((state, delta) => {
    if (document.hidden || !points.current) return
    points.current.rotation.y += delta * 0.03
    points.current.rotation.x += delta * 0.01

    // Embers rise with a slow sway, wrapped back to the floor when they float away.
    const attribute = points.current.geometry.getAttribute('position') as THREE.BufferAttribute
    const array = attribute.array as Float32Array
    const time = state.clock.elapsedTime
    for (let i = 0; i < array.length; i += 3) {
      array[i] += Math.sin(time * 0.2 + i) * delta * 0.01
      array[i + 1] += delta * 0.03
      if (array[i + 1] > SPREAD / 2) array[i + 1] = -SPREAD / 2
    }
    attribute.needsUpdate = true
  })

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={0.02}
        sizeAttenuation
        transparent
        opacity={0.3}
        depthWrite={false}
      />
    </points>
  )
}

export default function AmbientField({
  className = 'pointer-events-none fixed inset-0 -z-10 hidden md:block',
}: {
  className?: string
}) {
  const reduced = usePrefersReducedMotion()
  const { colorMode } = useColorMode()
  const isDesktop = useIsDesktop()
  const hasGl = useMemo(() => hasWebGL(), [])

  if (!hasGl || reduced || !isDesktop) return null

  return (
    <div aria-hidden className={cn(className)}>
      <Canvas
        style={{ pointerEvents: 'none' }}
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 6], fov: 45 }}
        gl={{ antialias: false, powerPreference: 'low-power' }}
      >
        <ParticleField color={paletteFor(colorMode).primary} />
      </Canvas>
    </div>
  )
}
