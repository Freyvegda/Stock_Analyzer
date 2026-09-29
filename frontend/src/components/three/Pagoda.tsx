import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial } from 'three'
import type { MotionValue } from 'motion/react'

import { pagodaPalette } from '@/theme/tokens'
import { hasWebGL } from '@/lib/webgl'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { useColorMode } from '@/components/ui/color-mode'
import {
  finialLayout,
  pagodaLayout,
  pagodaRoofVertices,
  towerPose,
  type RoofGeometry,
} from './pagodaScene'
import { TOWER_TIERS } from '@/content/tower'
import { cn } from '@/lib/utils'

/**
 * The landing page's pagoda.
 *
 * Deliberately decorative and deliberately dumb about state: it reads the
 * scroll `MotionValue` in the frame loop and owns nothing. The DOM sections
 * read the same value, so the tower and the cards cannot disagree about which
 * storey is open.
 *
 * Gates, matching every other 3D layer in the app: lazy chunk (three must never
 * be in the initial bundle), `hasWebGL()`, hidden below `md`, paused when the
 * tab is hidden, frozen under reduced motion, aria-hidden and pointer-events-none
 * behind the content, and both palettes resident with a crossfade on theme change.
 */
export function Pagoda({
  progress,
  className,
}: {
  progress: MotionValue<number>
  className?: string
}) {
  const reduced = usePrefersReducedMotion()
  const { colorMode } = useColorMode()
  const isDesktop = useIsDesktop()
  const [gl, setGl] = useState<boolean | null>(null)

  useEffect(() => {
    setGl(hasWebGL())
  }, [])

  const night = colorMode === 'dark'
  // Below `md` there is no WebGL at all — the DOM story carries the content on
  // its own, so we never request the three.js chunk for a phone.
  if (gl === false || !isDesktop) return null

  return (
    <div
      data-testid="pagoda"
      data-mode={night ? 'dark' : 'light'}
      data-reduced={reduced ? 'true' : undefined}
      aria-hidden="true"
      className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}
    >
      <Canvas
        style={{ pointerEvents: 'none' }}
        frameloop={reduced ? 'demand' : 'always'}
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 6.4], fov: 45 }}
        gl={{ antialias: false, powerPreference: 'low-power', alpha: true }}
      >
        <Scene progress={progress} night={night} reduced={reduced} />
      </Canvas>
    </div>
  )
}

function Scene({
  progress,
  night,
  reduced,
}: {
  progress: MotionValue<number>
  night: boolean
  reduced: boolean
}) {
  const root = useRef<Group>(null)
  const tierRefs = useRef<Array<Group | null>>([])
  const { camera } = useThree()

  const layout = useMemo(() => pagodaLayout(TOWER_TIERS.length), [])
  const finial = useMemo(() => finialLayout(), [])

  // Both palettes are built up front and crossfaded per frame, the way the
  // bonfire swaps its burn profile — so a theme change is never a hard cut.
  const palettes = useMemo(() => {
    const p = pagodaPalette
    return {
      dark: { body: new Color(p.dark.body), roof: new Color(p.dark.roof), trim: new Color(p.dark.trim) },
      light: { body: new Color(p.light.body), roof: new Color(p.light.roof), trim: new Color(p.light.trim) },
    }
  }, [])

  const [blend, setBlend] = useState(night ? 1 : 0)

  useFrame((_, delta) => {
    if (root.current) {
      // Paused while the tab is hidden: no point burning battery off-screen.
      if (typeof document !== 'undefined' && document.hidden) return
    }
    // 300ms-ish crossfade, instant under reduced motion.
    const target = night ? 1 : 0
    const rate = reduced ? 1 : Math.min(1, delta * 3.3)
    setBlend((b) => (Math.abs(b - target) < 0.002 ? target : b + (target - b) * rate))
  })

  useFrame(() => {
    const pose = towerPose(progress.get())

    if (root.current) {
      root.current.position.set(pose.x, pose.y, 0)
      root.current.scale.setScalar(pose.scale)
    }
    camera.position.z += (pose.cameraZ - camera.position.z) * 0.15

    layout.forEach((tier, i) => {
      const g = tierRefs.current[i]
      if (!g) return
      const tp = pose.tiers[i]
      // The roof lifts off the stack to reveal the storey underneath it.
      g.position.y = tier.y + tp.lift
      const dim = 0.55 + 0.45 * tp.brightness
      g.traverse((child) => {
        const mesh = child as Mesh
        if (!(mesh as { isMesh?: boolean }).isMesh) return
        const mat = mesh.material as MeshStandardMaterial
        const base = mat.userData.baseColor as Color | undefined
        if (!base) return
        const target = base.clone().multiplyScalar(dim)
        mat.color.lerp(target, 0.2)
      })
    })
  })

  const body = blend >= 0.5 ? palettes.dark.body : palettes.light.body
  const roof = blend >= 0.5 ? palettes.dark.roof : palettes.light.roof
  const trim = blend >= 0.5 ? palettes.dark.trim : palettes.light.trim

  return (
    <group ref={root} data-testid="pagoda-root">
      {layout.map((tier, i) => (
        <group
          key={tier.index}
          ref={(node) => {
            tierRefs.current[i] = node
          }}
        >
          <Body tier={tier} color={body} />
          <Roof tier={tier} color={roof} trim={trim} />
        </group>
      ))}
      <Finial layout={finial} top={layout[layout.length - 1]} color={trim} />
    </group>
  )
}

function Body({ tier, color }: { tier: ReturnType<typeof pagodaLayout>[number]; color: Color }) {
  return (
    <mesh position={[0, tier.bodyHeight / 2, 0]}>
      <boxGeometry args={[tier.bodyWidth, tier.bodyHeight, tier.bodyWidth]} />
      <meshStandardMaterial color={color} roughness={0.85} userData={{ baseColor: color }} />
    </mesh>
  )
}

function Roof({
  tier,
  color,
  trim,
}: {
  tier: ReturnType<typeof pagodaLayout>[number]
  color: Color
  trim: Color
}) {
  const geometry = useMemo<BufferGeometry>(() => {
    const roof: RoofGeometry = pagodaRoofVertices({
      halfSpan: tier.roofHalfSpan,
      rise: tier.roofRise,
      eaveLift: tier.roofRise * 0.5,
      cornerSpan: 0.3,
      segs: 3,
    })
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(roof.positions), 3))
    g.setIndex(roof.indices)
    g.computeVertexNormals()
    return g
  }, [tier])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <group position={[0, tier.bodyHeight, 0]}>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color={color}
          roughness={0.7}
          side={2}
          userData={{ baseColor: color }}
        />
      </mesh>
      <mesh position={[0, -0.012, 0]}>
        <boxGeometry args={[tier.roofHalfSpan * 2.1, 0.024, tier.roofHalfSpan * 2.1]} />
        <meshStandardMaterial color={trim} roughness={0.5} userData={{ baseColor: trim }} />
      </mesh>
    </group>
  )
}

function Finial({
  layout,
  top,
  color,
}: {
  layout: ReturnType<typeof finialLayout>
  top: ReturnType<typeof pagodaLayout>[number]
  color: Color
}) {
  const base = top.y + top.bodyHeight + top.roofRise
  return (
    <group position={[0, base, 0]}>
      <mesh position={[0, layout.rodHeight / 2, 0]}>
        <cylinderGeometry args={[0.018, 0.018, layout.rodHeight, 8]} />
        <meshStandardMaterial color={color} roughness={0.4} userData={{ baseColor: color }} />
      </mesh>
      {layout.ringY.map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <torusGeometry args={[0.06 - i * 0.008, 0.012, 6, 12]} />
          <meshStandardMaterial color={color} roughness={0.35} userData={{ baseColor: color }} />
        </mesh>
      ))}
    </group>
  )
}

export default Pagoda
