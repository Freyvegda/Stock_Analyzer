/**
 * Ribbon Rail — bookmarked criteria as low-poly ribbons on a shared glass rail.
 *
 * One lazy canvas for the whole editor: each bookmark is a ribbon that slides
 * into place; unbookmarking lets the remaining ribbons reflow to close the gap
 * (one-shot easing per change, no loop). Clicking a ribbon selects its criterion
 * (the sr-only button list mirrors this for keyboard/AT). Gates match the 3D kit:
 * lazy chunk, WebGL probe once per mount, desktop-only, static under reduced
 * motion.
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

export interface RibbonRailItem {
  key: string
  label: string
}

const RIBBON_WIDTH = 0.34
const RIBBON_HEIGHT = 0.86
const RIBBON_GAP = 0.52
/** New ribbons drop in from just above the rail. */
const ENTRY_LIFT = 0.65

function ribbonGeometry(): THREE.ShapeGeometry {
  const half = RIBBON_WIDTH / 2
  const shape = new THREE.Shape()
  shape.moveTo(-half, RIBBON_HEIGHT / 2)
  shape.lineTo(half, RIBBON_HEIGHT / 2)
  shape.lineTo(half, -RIBBON_HEIGHT / 2)
  shape.lineTo(0, -RIBBON_HEIGHT / 2 + 0.16)
  shape.lineTo(-half, -RIBBON_HEIGHT / 2)
  shape.closePath()
  const geometry = new THREE.ShapeGeometry(shape)
  geometry.computeVertexNormals()
  return geometry
}

function RibbonScene({
  items,
  primary,
  highlight,
  dim,
  reduced,
  onSelect,
}: {
  items: RibbonRailItem[]
  primary: string
  highlight: string
  dim: string
  reduced: boolean
  onSelect?: (key: string) => void
}) {
  const geometry = useMemo(ribbonGeometry, [])
  const groups = useRef(new Map<string, THREE.Group>())

  useFrame((_, delta) => {
    groups.current.forEach((group, key) => {
      const index = items.findIndex((item) => item.key === key)
      if (index === -1) return
      const targetX = (index - (items.length - 1) / 2) * RIBBON_GAP
      if (reduced) {
        group.position.set(targetX, 0, 0)
        return
      }
      // Frame-rate independent ease toward the slot; settles within ~0.3 s.
      const ease = 1 - Math.pow(0.0005, delta)
      group.position.x += (targetX - group.position.x) * ease
      group.position.y += (0 - group.position.y) * ease
    })
  })

  return (
    <>
      <hemisphereLight color={highlight} groundColor={dim} intensity={1.2} />
      <directionalLight position={[2, 3, 4]} color={highlight} intensity={1.7} />
      {items.map((item) => (
        <group
          key={item.key}
          ref={(node) => {
            if (node === null) {
              groups.current.delete(item.key)
            } else {
              groups.current.set(item.key, node)
            }
          }}
          position={[0, ENTRY_LIFT, 0]}
        >
          <mesh
            geometry={geometry}
            onClick={() => onSelect?.(item.key)}
            onPointerOver={(event) => event.stopPropagation()}
          >
            <meshStandardMaterial
              color={primary}
              emissive={primary}
              emissiveIntensity={0.18}
              flatShading
              roughness={0.5}
              metalness={0}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
      <mesh position={[0, -RIBBON_HEIGHT / 2 - 0.14, 0]}>
        <boxGeometry args={[Math.max(items.length, 1) * RIBBON_GAP + 0.7, 0.05, 0.14]} />
        <meshBasicMaterial color={highlight} transparent opacity={0.35} toneMapped={false} />
      </mesh>
    </>
  )
}

export function RibbonRail({
  items,
  onSelect,
  className,
}: {
  items: RibbonRailItem[]
  onSelect?: (key: string) => void
  className?: string
}) {
  const reduced = usePrefersReducedMotion()
  const { colorMode } = useColorMode()
  const palette = paletteFor(colorMode)
  const isDesktop = useIsDesktop()
  // Probe once per mount — the editor re-renders on every keystroke.
  const hasGl = useMemo(() => hasWebGL(), [])

  if (!hasGl || !isDesktop || items.length === 0) return null

  return (
    <div
      data-testid="ribbon-rail"
      data-motion={reduced ? 'static' : 'animated'}
      className={cn('relative h-20 w-full', className)}
    >
      <div className="sr-only">
        {items.map((item) => (
          <button key={item.key} type="button" onClick={() => onSelect?.(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
      <Canvas
        frameloop={reduced ? 'demand' : 'always'}
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 3.1], fov: 36 }}
        gl={{ antialias: false, powerPreference: 'low-power', alpha: true }}
        style={{ width: '100%', height: '100%' }}
      >
        <RibbonScene
          items={items}
          primary={palette.primary}
          highlight={palette.foreground}
          dim={palette.background}
          reduced={reduced}
          onSelect={onSelect}
        />
      </Canvas>
    </div>
  )
}

export default RibbonRail
