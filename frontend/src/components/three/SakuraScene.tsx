import { useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { cn } from '@/lib/utils'
import { hasWebGL } from '@/lib/webgl'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { useColorMode } from '@/components/ui/color-mode'
import { scenePalette, scenePaletteFor, type ScenePalette } from '@/theme/tokens'
import {
  TREE_SEED,
  buildTree,
  mulberry32,
  petalPose,
  petalSeeds,
  treeBounds,
  treePlacement,
  withAlpha,
  type TreeSpec,
} from './sakuraTree'

const FALLBACK_PETALS = 12
/** Petals hang behind the blossom dome so the canopy reads as the top of the tree. */
const PETAL_DEPTH = -0.5
/** Seconds into the fall used for the frozen (reduced-motion) frame. */
const STILL_TIME = 41.7

/**
 * A rounded petal: six outline vertices fanned around a raised centre, so the
 * silhouette reads as a petal rather than a card.
 */
function petalGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  const width = 0.04
  const height = 0.065
  const fold = 0.012
  const outline: Array<[number, number, number]> = [
    [0, 0, 0],
    [-width, height * 0.42, fold],
    [-width * 0.5, height * 0.8, fold * 0.5],
    [0, height, 0.01],
    [width * 0.5, height * 0.8, fold * 0.5],
    [width, height * 0.42, fold],
  ]
  const centre: [number, number, number] = [0, height * 0.45, fold * 1.6]
  const positions = new Float32Array([...outline.flat(), ...centre])
  const index: number[] = []
  for (let index_ = 0; index_ < outline.length; index_ += 1) {
    index.push(index_, (index_ + 1) % outline.length, outline.length)
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

interface SceneProps {
  palette: ScenePalette
  night: boolean
}

function Tree({ tree, palette, reduced }: { tree: TreeSpec; palette: ScenePalette; reduced: boolean }) {
  const branches = useRef<THREE.InstancedMesh>(null)
  const blossoms = useRef<THREE.InstancedMesh>(null)
  const root = useRef<THREE.Group>(null)
  const elapsed = useRef(0)

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()
    const colour = new THREE.Color()
    const bark = new THREE.Color(palette.bark)
    const blossomLight = new THREE.Color(palette.blossomLight)
    const blossomDeep = new THREE.Color(palette.blossomDeep)

    tree.segments.forEach((segment, index) => {
      const start = new THREE.Vector3(...segment.start)
      const end = new THREE.Vector3(...segment.end)
      const direction = end.clone().sub(start)
      dummy.position.copy(start).add(end).multiplyScalar(0.5)
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize())
      dummy.scale.set(segment.radius, direction.length(), segment.radius)
      dummy.updateMatrix()
      branches.current?.setMatrixAt(index, dummy.matrix)
      colour.copy(bark).lerp(blossomLight, segment.tone * 0.16)
      branches.current?.setColorAt(index, colour)
    })

    tree.blossoms.forEach((blossom, index) => {
      dummy.position.set(...blossom.position)
      dummy.quaternion.identity()
      dummy.scale.setScalar(blossom.size)
      dummy.updateMatrix()
      blossoms.current?.setMatrixAt(index, dummy.matrix)
      // Bias towards the light end of the ramp: lit blossom, not bark.
      colour.copy(blossomDeep).lerp(blossomLight, 0.5 + 0.5 * blossom.tone)
      blossoms.current?.setColorAt(index, colour)
    })

    if (branches.current !== null) {
      branches.current.instanceMatrix.needsUpdate = true
      if (branches.current.instanceColor !== null) branches.current.instanceColor.needsUpdate = true
    }
    if (blossoms.current !== null) {
      blossoms.current.instanceMatrix.needsUpdate = true
      if (blossoms.current.instanceColor !== null) blossoms.current.instanceColor.needsUpdate = true
    }
  }, [tree, palette])

  useFrame((_, delta) => {
    if (document.hidden || reduced) return
    elapsed.current += delta
    const time = elapsed.current
    if (root.current !== null) {
      root.current.rotation.z = 0.014 * Math.sin(time * 0.32)
      root.current.rotation.x = 0.008 * Math.sin(time * 0.21 + 1.3)
    }
  })

  return (
    <group ref={root} position={[0, -0.9, 0]}>
      <instancedMesh
        ref={branches}
        args={[undefined, undefined, tree.segments.length]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[1, 0.62, 1, 8]} />
        <meshStandardMaterial flatShading roughness={0.85} metalness={0} toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        ref={blossoms}
        args={[undefined, undefined, tree.blossoms.length]}
        frustumCulled={false}
      >
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial flatShading roughness={0.7} metalness={0} toneMapped={false} />
      </instancedMesh>
    </group>
  )
}

function Petals({ palette, reduced }: { palette: ScenePalette; reduced: boolean }) {
  const seeds = useMemo(() => petalSeeds(), [])
  const geometry = useMemo(() => petalGeometry(), [])
  const mesh = useRef<THREE.InstancedMesh>(null)
  const elapsed = useRef(0)

  const paint = useMemo(() => {
    const dummy = new THREE.Object3D()
    const colour = new THREE.Color()
    const petal = new THREE.Color(palette.petal)
    const blush = new THREE.Color(palette.blossomDeep)
    return (time: number) => {
      seeds.forEach((seed, index) => {
        const pose = petalPose(seed, time)
        dummy.position.set(pose.x, pose.y, pose.z)
        dummy.rotation.set(pose.rx, pose.ry, pose.rz)
        dummy.scale.setScalar(seed.scale)
        dummy.updateMatrix()
        mesh.current?.setMatrixAt(index, dummy.matrix)
        colour.copy(petal).lerp(blush, 0.35 * Math.abs(Math.sin(seed.swayPhase + index)))
        mesh.current?.setColorAt(index, colour)
      })
      if (mesh.current !== null) {
        mesh.current.instanceMatrix.needsUpdate = true
        if (mesh.current.instanceColor !== null) mesh.current.instanceColor.needsUpdate = true
      }
    }
  }, [seeds, palette])

  useLayoutEffect(() => {
    // Frozen under reduced motion, so the first frame is a full, spread-out fall.
    paint(STILL_TIME)
  }, [paint])

  useFrame((_, delta) => {
    if (document.hidden || reduced) return
    elapsed.current += delta
    paint(elapsed.current)
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, seeds.length]} frustumCulled={false}>
      <primitive object={geometry} attach="geometry" />
      <meshBasicMaterial side={THREE.DoubleSide} toneMapped={false} />
    </instancedMesh>
  )
}

/** Moon (night) and sun (day) share the top-left corner and crossfade with the theme. */
function Celestial({ palette, night }: SceneProps) {
  const moon = useRef<THREE.Group>(null)
  const sun = useRef<THREE.Group>(null)
  const { viewport } = useThree()
  const value = useRef(night ? 1 : 0)
  const anchor: [number, number, number] = [-viewport.width / 2 + 1.15, viewport.height / 2 - 1.05, 0]
  const materials = useRef<THREE.Material[]>([])

  useFrame((_, delta) => {
    const target = night ? 1 : 0
    value.current += (target - value.current) * Math.min(1, delta * 3.2)
    for (const material of materials.current) {
      const tagged = material as THREE.Material & { userData: { night?: boolean; peak?: number } }
      const level = tagged.userData.night === true ? value.current : 1 - value.current
      tagged.opacity = (tagged.userData.peak ?? 1) * level
      tagged.visible = level > 0.01
    }
    // Offsets are local to the shared corner anchor, so moon and sun trade places.
    if (moon.current !== null) moon.current.position.y = 0.22 * value.current
    if (sun.current !== null) sun.current.position.y = -0.5 * (1 - value.current)
  })

  const collect = (material: THREE.Material | null, isNight: boolean, peak: number) => {
    if (material === null || materials.current.includes(material)) return
    material.userData = { night: isNight, peak }
    materials.current.push(material)
  }

  return (
    <group position={anchor}>
      <group ref={moon} position={[0, night ? 0.22 : 0, 0]}>
        <mesh>
          <circleGeometry args={[0.62, 40]} />
          <meshBasicMaterial
            ref={(material) => collect(material, true, 1)}
            color={palette.celestial}
            transparent
            opacity={night ? 1 : 0}
            toneMapped={false}
          />
        </mesh>
        {[
          [-0.16, 0.14, 0.1],
          [0.14, -0.1, 0.13],
          [0.04, 0.26, 0.08],
        ].map(([cx, cy, size]) => (
          <mesh key={`${cx}:${cy}`} position={[cx, cy, 0.01]}>
            <circleGeometry args={[size, 20]} />
            <meshBasicMaterial
              ref={(material) => collect(material, true, 0.7)}
              color={palette.celestialDeep}
              transparent
              opacity={night ? 0.7 : 0}
              toneMapped={false}
            />
          </mesh>
        ))}
        <mesh>
          <ringGeometry args={[0.68, 0.7, 48]} />
          <meshBasicMaterial
            ref={(material) => collect(material, true, 0.35)}
            color={palette.celestialHalo}
            transparent
            opacity={night ? 0.35 : 0}
            toneMapped={false}
          />
        </mesh>
        <mesh>
          <ringGeometry args={[0.79, 0.8, 48]} />
          <meshBasicMaterial
            ref={(material) => collect(material, true, 0.18)}
            color={palette.celestialHalo}
            transparent
            opacity={night ? 0.18 : 0}
            toneMapped={false}
          />
        </mesh>
      </group>
      <group ref={sun} position={[0, night ? 0 : -0.5, 0]}>
        <mesh>
          <circleGeometry args={[0.5, 32]} />
          <meshBasicMaterial
            ref={(material) => collect(material, false, 1)}
            color={palette.celestial}
            transparent
            opacity={night ? 0 : 1}
            toneMapped={false}
          />
        </mesh>
        <mesh>
          <ringGeometry args={[0.56, 0.6, 48]} />
          <meshBasicMaterial
            ref={(material) => collect(material, false, 0.4)}
            color={palette.celestialHalo}
            transparent
            opacity={night ? 0 : 0.4}
            toneMapped={false}
          />
        </mesh>
        <mesh>
          <ringGeometry args={[0.68, 0.71, 48]} />
          <meshBasicMaterial
            ref={(material) => collect(material, false, 0.2)}
            color={palette.celestialDeep}
            transparent
            opacity={night ? 0 : 0.2}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  )
}

/** Stars only exist at night; they twinkle on the same night value as the moon. */
function Stars({ palette, night, reduced }: SceneProps & { reduced: boolean }) {
  const material = useRef<THREE.PointsMaterial>(null)
  const { viewport } = useThree()
  const seeds = useMemo(() => {
    const random = mulberry32(TREE_SEED ^ 0x51ab3c)
    return Array.from({ length: 150 }, () => [
      (random() - 0.5) * viewport.width * 1.05,
      viewport.height * (0.02 + random() * 0.62),
      -0.6 - random() * 1.4,
    ] as [number, number, number])
  }, [viewport.width, viewport.height])

  const positions = useMemo(() => new Float32Array(seeds.flat()), [seeds])
  const value = useRef(night ? 1 : 0)

  useFrame((_, delta) => {
    if (material.current === null) return
    const target = night ? 1 : 0
    value.current += (target - value.current) * Math.min(1, delta * 3.2)
    const twinkle = reduced ? 0.8 : 0.65 + 0.35 * Math.sin(performance.now() * 0.0009)
    material.current.opacity = 0.75 * value.current * twinkle
    material.current.visible = value.current > 0.01
  })

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={material}
        color={palette.star}
        size={0.035}
        sizeAttenuation
        transparent
        opacity={night ? 0.75 : 0}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  )
}

function Scene({ palette, night, reduced }: SceneProps & { reduced: boolean }) {
  const { viewport, size } = useThree()
  const value = useRef(night ? 1 : 0)
  const ambient = useRef<THREE.HemisphereLight>(null)
  const key = useRef<THREE.DirectionalLight>(null)
  const tree = useMemo(() => buildTree(), [])

  // A tall column down the right edge: fitted to the full viewport height, with its
  // left edge held clear of the auth card.
  const placement = useMemo(
    () =>
      treePlacement(treeBounds(tree), {
        width: viewport.width,
        height: viewport.height,
        cssWidth: size.width,
      }),
    [tree, viewport.width, viewport.height, size.width],
  )

  useFrame((_, delta) => {
    const target = night ? 1 : 0
    value.current += (target - value.current) * Math.min(1, delta * 3.2)
    // Night is moon-lit and sculptural; day is bright and even. Crisp facet contrast.
    if (ambient.current !== null) ambient.current.intensity = 0.85 - 0.55 * value.current
    if (key.current !== null) key.current.intensity = 1.35 + 0.35 * value.current
  })

  return (
    <>
      <hemisphereLight
        ref={ambient}
        color={palette.skyBottom}
        groundColor={palette.blossomDeep}
        intensity={0.85}
      />
      <directionalLight
        ref={key}
        position={[-4, 3.5, 6]}
        color={palette.celestialHalo}
        intensity={1.35}
      />
      <Celestial palette={palette} night={night} />
      <Stars palette={palette} night={night} reduced={reduced} />
      <group position={placement.position} scale={placement.scale}>
        <group position={[0, 0, PETAL_DEPTH]}>
          <Petals palette={palette} reduced={reduced} />
        </group>
        <Tree tree={tree} palette={palette} reduced={reduced} />
      </group>
    </>
  )
}

/** Sky gradient + horizon haze for a scene palette, as CSS background layers. */
function skyStyle(palette: ScenePalette): string {
  return [
    `radial-gradient(72% 46% at 74% 102%, ${withAlpha(palette.groundGlow, 0.4)}, transparent 70%)`,
    `radial-gradient(120% 90% at 50% 42%, transparent 42%, ${withAlpha(palette.skyTop, 0.55)} 100%)`,
    `linear-gradient(180deg, ${palette.skyTop} 0%, ${palette.skyBottom} 100%)`,
  ].join(', ')
}

/**
 * CSS-only stand-in for phones and no-WebGL browsers: same sky, a lit disc and a
 * handful of falling petals.
 */
function SakuraFallback({ palette, reduced }: { palette: ScenePalette; reduced: boolean }) {
  const petals = useMemo(() => petalSeeds(TREE_SEED ^ 0x2f1e, FALLBACK_PETALS), [])
  return (
    <div data-testid="sakura-fallback" className="absolute inset-0 overflow-hidden">
      <div
        className="absolute rounded-full"
        style={{
          top: '7%',
          left: '9%',
          width: 76,
          height: 76,
          background: palette.celestial,
          boxShadow: `0 0 70px 26px ${withAlpha(palette.celestialHalo, 0.4)}`,
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          right: '-18%',
          bottom: '-22%',
          width: '78%',
          height: '52%',
          background: `radial-gradient(closest-side, ${withAlpha(palette.blossomMid, 0.5)}, transparent)`,
        }}
      />
      <div
        className="absolute"
        style={{
          right: '13%',
          bottom: '3%',
          width: 8,
          height: '24%',
          borderRadius: 6,
          background: palette.bark,
          opacity: 0.6,
          transform: 'rotate(3deg)',
        }}
      />
      {petals.map((seed, index) => (
        <span
          key={index}
          data-testid="sakura-fallback-petal"
          className={reduced ? undefined : 'vault-petal'}
          style={{
            position: 'absolute',
            top: `${(index * 5.5) % 92}%`,
            left: `${18 + ((seed.origin[0] + 1.2) / 2.4) * 68}%`,
            width: 7,
            height: 9,
            borderRadius: '60% 40% 55% 45%',
            background: palette.petal,
            opacity: 0.7,
            animationDelay: `-${(index * 0.9).toFixed(2)}s`,
            animationDuration: `${(6.5 + seed.fallSpeed * 14).toFixed(2)}s`,
          }}
        />
      ))}
    </div>
  )
}

/**
 * Sakura Garden — the login-only decorative scene (DESIGN.md → Sakura Garden).
 *
 * Sky gradient, moon/sun in the top-left, a procedurally grown cherry tree in the
 * bottom-right and a flock of falling petals. Lazy-loaded, WebGL-gated, desktop-only,
 * frozen under reduced motion, and never interactive: it stays behind the auth card,
 * which is the only thing on the page that carries text.
 */
export function SakuraScene({ className }: { className?: string }) {
  const reduced = usePrefersReducedMotion()
  const { colorMode } = useColorMode()
  const isDesktop = useIsDesktop()
  const hasGl = useMemo(() => hasWebGL(), [])
  const palette = scenePaletteFor(colorMode)
  const night = colorMode === 'dark'

  const transition = reduced ? 'none' : 'opacity var(--duration-entrance) var(--ease-vault)'

  return (
    <div
      data-testid="sakura-scene"
      data-reduced={reduced ? 'true' : undefined}
      data-celestial={night ? 'moon' : 'sun'}
      aria-hidden="true"
      className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}
    >
      <div
        className="absolute inset-0"
        style={{ backgroundImage: skyStyle(scenePalette.dark), opacity: night ? 1 : 0, transition }}
      />
      <div
        className="absolute inset-0"
        style={{ backgroundImage: skyStyle(scenePalette.light), opacity: night ? 0 : 1, transition }}
      />
      {hasGl && isDesktop ? (
        <Canvas
          className="absolute inset-0"
          frameloop={reduced ? 'demand' : 'always'}
          dpr={[1, 2]}
          camera={{ position: [0, 0, 10], fov: 35 }}
          gl={{ antialias: true, powerPreference: 'low-power', alpha: true }}
        >
          <Scene palette={palette} night={night} reduced={reduced} />
        </Canvas>
      ) : (
        <SakuraFallback palette={palette} reduced={reduced} />
      )}
    </div>
  )
}

export default SakuraScene
