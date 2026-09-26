import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { cn } from '@/lib/utils'
import { hasWebGL } from '@/lib/webgl'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'

const PARTICLE_COUNT = 800
const SPREAD = 12

function ParticleField() {
  const points = useRef<THREE.Points>(null)
  const positions = useMemo(() => {
    const array = new Float32Array(PARTICLE_COUNT * 3)
    for (let i = 0; i < array.length; i += 1) {
      array[i] = (Math.random() - 0.5) * SPREAD
    }
    return array
  }, [])

  useFrame((_, delta) => {
    if (document.hidden || !points.current) return
    points.current.rotation.y += delta * 0.03
    points.current.rotation.x += delta * 0.01
  })

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#10b981"
        size={0.02}
        sizeAttenuation
        transparent
        opacity={0.35}
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

  if (!hasWebGL() || reduced) return null

  return (
    <Canvas
      aria-hidden
      className={cn(className)}
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 6], fov: 45 }}
      gl={{ antialias: false, powerPreference: 'low-power' }}
    >
      <ParticleField />
    </Canvas>
  )
}
