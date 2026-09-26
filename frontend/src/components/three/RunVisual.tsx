import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { hasWebGL } from '@/lib/webgl'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'

function WireIcosahedron() {
  const mesh = useRef<THREE.Mesh>(null)

  useFrame((_, delta) => {
    if (document.hidden || !mesh.current) return
    mesh.current.rotation.x += delta * 0.25
    mesh.current.rotation.y += delta * 0.4
  })

  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color="#10b981" wireframe />
    </mesh>
  )
}

export default function RunVisual({ size = 160 }: { size?: number }) {
  const reduced = usePrefersReducedMotion()

  if (!hasWebGL() || reduced) return null

  return (
    <div aria-hidden style={{ width: size, height: size }}>
      <Canvas dpr={[1, 1.5]} camera={{ position: [0, 0, 4], fov: 50 }}>
        <WireIcosahedron />
      </Canvas>
    </div>
  )
}
