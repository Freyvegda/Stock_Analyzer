import { useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { cn } from '@/lib/utils'
import { hasWebGL } from '@/lib/webgl'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { useColorMode } from '@/components/ui/color-mode'
import { bonfirePaletteFor, type BonfirePalette } from '@/theme/tokens'
import {
  BONFIRE_SEED,
  EMBER_COUNT,
  EMBER_PIXEL,
  EMBER_RISE,
  STILL_TIME,
  emberPose,
  emberSeeds,
  motionFor,
  type EmberPose,
  type MotionProfile,
} from './emberField'
import { mulberry32 } from './sakuraTree'

/** How far the fire sits from the viewport corner, in world units. */
const CORNER = { x: 1.15, y: 0.3 }
/** Everything fire-side is authored small and lifted to campfire size in one place. */
const FIRE_SCALE = 1.9
const STONE_COUNT = 9

/**
 * A campfire, painted back to front: a dim pink shell, two thin licks leaning off
 * the sides, then the amber body and the cream heart. Each mesh carries its own
 * turn, lean, wobble and flicker phase so the fire moves like fire instead of
 * pulsing as one block. `tone` runs 0 = tip (sakura) → 0.5 = mid (amber) → 1 = core.
 */
const FLAME_LAYERS = [
  { width: 0.19, height: 0.5, opacity: 0.26, lean: 0.04, phase: 0, wobble: 1, offset: 0, tone: 0, turn: 0.3 },
  { width: 0.05, height: 0.3, opacity: 0.4, lean: -0.16, phase: 2.6, wobble: 1.6, offset: -0.1, tone: 0.12, turn: 1.1 },
  { width: 0.055, height: 0.34, opacity: 0.4, lean: 0.14, phase: 4.4, wobble: 1.8, offset: 0.09, tone: 0.18, turn: 2.2 },
  { width: 0.15, height: 0.44, opacity: 0.52, lean: -0.03, phase: 1.2, wobble: 1.15, offset: 0.01, tone: 0.5, turn: 0.8 },
  { width: 0.1, height: 0.36, opacity: 0.68, lean: 0.02, phase: 3.2, wobble: 1.4, offset: -0.01, tone: 0.75, turn: 1.7 },
  { width: 0.055, height: 0.22, opacity: 0.88, lean: 0, phase: 5.1, wobble: 1.9, offset: 0, tone: 1, turn: 2.8 },
]

const LOGS: Array<{
  position: [number, number, number]
  rotation: [number, number, number]
  length: number
}> = [
  { position: [-0.05, 0.045, 0.03], rotation: [0.08, 0.6, Math.PI / 2 - 0.06], length: 0.44 },
  { position: [0.06, 0.04, -0.03], rotation: [-0.08, -0.55, Math.PI / 2 + 0.08], length: 0.4 },
  { position: [0.02, 0.075, 0], rotation: [0.2, 1.3, Math.PI / 2 - 0.5], length: 0.3 },
]

/**
 * A wonky low-poly flame: ring vertices jittered, tip pushed off-axis, and a baked
 * alpha ramp that is opaque at the logs and dies out towards the tip. RGB is written
 * per frame so the fire can crossfade with the theme.
 */
function flameGeometry(width: number, height: number, seed: number): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(width, height, 7, 1, true)
  geometry.translate(0, height / 2, 0)
  const random = mulberry32(seed)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const points = position.array as Float32Array
  for (let index = 0; index < points.length; index += 3) {
    const y = points[index + 1]
    if (y >= height - 1e-4) {
      points[index] += (random() - 0.5) * width * 1.1
      points[index + 2] += (random() - 0.5) * width * 1.1
    } else if (y > 1e-4) {
      const scale = 0.8 + random() * 0.4
      points[index] *= scale
      points[index + 2] *= scale
    }
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()

  const colours = new Float32Array(position.count * 4)
  for (let index = 0; index < position.count; index += 1) {
    const t = Math.min(1, Math.max(0, points[index * 3 + 1] / height))
    colours[index * 4 + 3] = 1 - Math.pow(t, 1.15) * 0.92
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 4))
  return geometry
}

/** A soft radial bloom, generated in code — no image asset, no network fetch. */
function glowTexture(): THREE.Texture | null {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context === null) return null
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.4)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

interface FireProps {
  night: boolean
  reduced: boolean
}

function Fire({ night, reduced }: FireProps) {
  const { viewport } = useThree()
  const paletteDark = bonfirePaletteFor('dark')
  const paletteLight = bonfirePaletteFor('light')
  const darkProfile = motionFor('dark')
  const lightProfile = motionFor('light')

  const seeds = useMemo(() => emberSeeds(), [])
  const texture = useMemo(() => glowTexture(), [])
  // Cone bases sit on the logs and stretch upward as they flicker.
  const flameGeometries = useMemo(
    () =>
      FLAME_LAYERS.map(({ width, height }, index) =>
        flameGeometry(width, height, BONFIRE_SEED ^ (0x9e37 * (index + 1))),
      ),
    [],
  )
  const emberGeometry = useMemo(
    () => new THREE.PlaneGeometry(EMBER_PIXEL, EMBER_PIXEL),
    [],
  )

  const stones = useMemo(() => {
    const random = mulberry32(BONFIRE_SEED ^ 0x51a7e3)
    return Array.from({ length: STONE_COUNT }, (_, index) => {
      const angle = (index / STONE_COUNT) * Math.PI * 2 + (random() - 0.5) * 0.5
      return {
        position: [Math.cos(angle) * 0.26, 0, Math.sin(angle) * 0.17] as [number, number, number],
        rotation: [
          random() * Math.PI,
          random() * Math.PI,
          random() * Math.PI,
        ] as [number, number, number],
        scale: 0.042 + random() * 0.032,
      }
    })
  }, [])

  const anchor: [number, number, number] = [
    viewport.width / 2 - CORNER.x,
    -viewport.height / 2 + CORNER.y,
    0,
  ]
  const span = Math.min(EMBER_RISE, viewport.height - CORNER.y - 0.05)

  /** 0 = day fire, 1 = night fire. Crossfades on theme change, like the garden's sun/moon. */
  const value = useRef(night ? 1 : 0)
  /** Latest theme target; written from effects only, never during render. */
  const target = useRef(night ? 1 : 0)

  const flameMeshes = useRef<(THREE.Mesh | null)[]>([])
  const logMaterials = useRef<(THREE.MeshStandardMaterial | null)[]>([])
  const stoneMaterials = useRef<(THREE.MeshStandardMaterial | null)[]>([])
  const embers = useRef<THREE.InstancedMesh>(null)
  const emberMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const glowMaterial = useRef<THREE.SpriteMaterial>(null)
  const fireLight = useRef<THREE.PointLight>(null)
  const elapsed = useRef(0)

  // Both palettes stay resident so the theme change is a crossfade, not a pop.
  const ramp = useMemo(() => {
    const rampFor = (palette: BonfirePalette) => ({
      core: new THREE.Color(palette.flameCore),
      mid: new THREE.Color(palette.flameMid),
      tip: new THREE.Color(palette.flameTip),
      ember: new THREE.Color(palette.ember),
      emberHot: new THREE.Color(palette.emberHot),
      log: new THREE.Color(palette.log),
      stone: new THREE.Color(palette.stone),
      glow: new THREE.Color(palette.glow),
    })
    return {
      dark: rampFor(paletteDark),
      light: rampFor(paletteLight),
      mix: {
        core: new THREE.Color(),
        mid: new THREE.Color(),
        tip: new THREE.Color(),
        ember: new THREE.Color(),
        emberHot: new THREE.Color(),
        log: new THREE.Color(),
        stone: new THREE.Color(),
        glow: new THREE.Color(),
      },
    }
  }, [paletteDark, paletteLight])

  /** The burn profile is a mutable ref: the frame loop eases it between the two modes. */
  const burn = useRef<MotionProfile>({ ...lightProfile })

  const paint = useMemo(() => {
    const pose: EmberPose = { x: 0, y: 0, z: 0, alpha: 0, heat: 0 }
    const dummy = new THREE.Object3D()
    const tint = new THREE.Color()
    const layerColours = FLAME_LAYERS.map(() => new THREE.Color())
    const flameBase = new THREE.Color()

    return (time: number, delta: number) => {
      if (delta > 0) {
        value.current += (target.current - value.current) * Math.min(1, delta * 3.2)
      }
      const v = value.current
      const profile = burn.current

      ramp.mix.core.copy(ramp.dark.core).lerp(ramp.light.core, v)
      ramp.mix.mid.copy(ramp.dark.mid).lerp(ramp.light.mid, v)
      ramp.mix.tip.copy(ramp.dark.tip).lerp(ramp.light.tip, v)
      ramp.mix.ember.copy(ramp.dark.ember).lerp(ramp.light.ember, v)
      ramp.mix.emberHot.copy(ramp.dark.emberHot).lerp(ramp.light.emberHot, v)
      ramp.mix.log.copy(ramp.dark.log).lerp(ramp.light.log, v)
      ramp.mix.stone.copy(ramp.dark.stone).lerp(ramp.light.stone, v)
      ramp.mix.glow.copy(ramp.dark.glow).lerp(ramp.light.glow, v)

      const ease = (day: number, nightValue: number) => day + (nightValue - day) * v
      profile.rise = ease(lightProfile.rise, darkProfile.rise)
      profile.sway = ease(lightProfile.sway, darkProfile.sway)
      profile.drift = ease(lightProfile.drift, darkProfile.drift)
      profile.flickerAmp = ease(lightProfile.flickerAmp, darkProfile.flickerAmp)
      profile.flickerSpeed = ease(lightProfile.flickerSpeed, darkProfile.flickerSpeed)
      profile.glowOpacity = ease(lightProfile.glowOpacity, darkProfile.glowOpacity)
      profile.emberOpacity = ease(lightProfile.emberOpacity, darkProfile.emberOpacity)
      profile.lightIntensity = ease(lightProfile.lightIntensity, darkProfile.lightIntensity)

      // Tip → mid → core, driven by each layer's own tone.
      layerColours.forEach((colour, index) => {
        const tone = FLAME_LAYERS[index].tone
        if (tone < 0.5) colour.copy(ramp.mix.tip).lerp(ramp.mix.mid, tone * 2)
        else colour.copy(ramp.mix.mid).lerp(ramp.mix.core, (tone - 0.5) * 2)
      })

      flameMeshes.current.forEach((mesh, index) => {
        if (mesh === null) return
        const layer = FLAME_LAYERS[index]
        const wave = Math.sin(time * profile.flickerSpeed * layer.wobble + layer.phase)
        // Vertical gradient: hotter and brighter at the logs, the layer's own
        // colour (and thin air) at the tip.
        const geometry = mesh.geometry as THREE.BufferGeometry
        const colourAttribute = geometry.getAttribute('color') as THREE.BufferAttribute
        const positionAttribute = geometry.getAttribute('position') as THREE.BufferAttribute
        const rgba = colourAttribute.array as Float32Array
        const points = positionAttribute.array as Float32Array
        const tip = layerColours[index]
        flameBase.copy(tip).lerp(ramp.mix.core, 0.25 + 0.55 * (1 - layer.tone))
        for (let vertex = 0; vertex < colourAttribute.count; vertex += 1) {
          const t = Math.min(1, points[vertex * 3 + 1] / layer.height)
          rgba[vertex * 4] = flameBase.r + (tip.r - flameBase.r) * t
          rgba[vertex * 4 + 1] = flameBase.g + (tip.g - flameBase.g) * t
          rgba[vertex * 4 + 2] = flameBase.b + (tip.b - flameBase.b) * t
        }
        colourAttribute.needsUpdate = true
        mesh.scale.set(
          1 - 0.3 * profile.flickerAmp * wave,
          1 + profile.flickerAmp * wave,
          1 - 0.3 * profile.flickerAmp * wave,
        )
        mesh.rotation.set(
          0,
          layer.turn,
          layer.lean +
            0.14 *
              profile.flickerAmp *
              Math.sin(time * profile.flickerSpeed * layer.wobble * 0.6 + layer.phase),
        )
        mesh.position.x = layer.offset + 0.02 * wave
      })

      const flick =
        Math.sin(time * profile.flickerSpeed) * 0.6 +
        Math.sin(time * profile.flickerSpeed * 2.3 + 1.7) * 0.4

      for (const material of logMaterials.current) material?.color.copy(ramp.mix.log)
      for (const material of stoneMaterials.current) material?.color.copy(ramp.mix.stone)

      if (fireLight.current !== null) {
        fireLight.current.color.copy(ramp.mix.mid)
        fireLight.current.intensity = profile.lightIntensity * (1 + 0.7 * profile.flickerAmp * flick)
      }
      if (glowMaterial.current !== null) {
        glowMaterial.current.color.copy(ramp.mix.glow)
        glowMaterial.current.opacity = profile.glowOpacity * (1 + 0.25 * flick)
      }
      if (emberMaterial.current !== null) emberMaterial.current.opacity = profile.emberOpacity

      const streak = embers.current
      if (streak !== null) {
        for (let index = 0; index < seeds.length; index += 1) {
          const seed = seeds[index]
          const ember = emberPose(seed, time, profile, span, pose)
          // Axis-aligned squares never turn: depth gives them size, haze and layering.
          dummy.position.set(ember.x, ember.y, ember.z)
          dummy.scale.setScalar(seed.size)
          dummy.updateMatrix()
          streak.setMatrixAt(index, dummy.matrix)
          // The hottest embers sit in the flame; everything cools amber as it climbs.
          // Far embers dim like smoke haze; nights fade to black, paper days stay dark.
          tint.copy(ramp.mix.ember).lerp(ramp.mix.emberHot, ember.heat)
          tint.multiplyScalar(1 - (0.3 * Math.max(0, -ember.z)) / 3.2)
          tint.multiplyScalar(1 - v + v * ember.alpha)
          streak.setColorAt(index, tint)
        }
        streak.instanceMatrix.needsUpdate = true
        if (streak.instanceColor !== null) streak.instanceColor.needsUpdate = true
      }
    }
  }, [seeds, ramp, burn, darkProfile, lightProfile, span])

  useLayoutEffect(() => {
    target.current = night ? 1 : 0
    if (reduced) {
      // Frozen frame: the fire is lit, the embers hang still, and a theme change
      // swaps palettes instantly (no crossfade to watch).
      value.current = target.current
      paint(STILL_TIME, 0)
    } else {
      // Mount paint only; theme changes keep crossfading through the frame loop.
      paint(0, 0)
    }
  }, [paint, reduced, night])

  useFrame((_, delta) => {
    if (document.hidden || reduced) return
    elapsed.current += delta
    paint(elapsed.current, delta)
  })

  return (
    <group position={anchor}>
      <group scale={FIRE_SCALE}>
        <sprite position={[0, 0.26, -0.2]} scale={[1.3, 0.8, 1]}>
          <spriteMaterial
            ref={glowMaterial}
            map={texture ?? undefined}
            color={paletteDark.glow}
            transparent
            depthWrite={false}
            toneMapped={false}
            blending={night ? THREE.AdditiveBlending : THREE.NormalBlending}
            opacity={0}
          />
        </sprite>

        {stones.map((stone, index) => (
          <mesh
            key={`stone-${index}`}
            position={stone.position}
            rotation={stone.rotation}
            scale={stone.scale}
          >
            <dodecahedronGeometry args={[1, 0]} />
            <meshStandardMaterial
              ref={(material) => {
                stoneMaterials.current[index] = material
              }}
              flatShading
              roughness={0.95}
              metalness={0}
              toneMapped={false}
            />
          </mesh>
        ))}

        {LOGS.map((log, index) => (
          <mesh key={`log-${index}`} position={log.position} rotation={log.rotation}>
            <cylinderGeometry args={[0.042, 0.036, log.length, 6]} />
            <meshStandardMaterial
              ref={(material) => {
                logMaterials.current[index] = material
              }}
              flatShading
              roughness={0.9}
              metalness={0}
              toneMapped={false}
            />
          </mesh>
        ))}

        {FLAME_LAYERS.map((layer, index) => (
          <mesh
            key={`flame-${index}`}
            ref={(mesh) => {
              flameMeshes.current[index] = mesh
            }}
            position={[layer.offset, 0, 0]}
            renderOrder={index}
          >
            <primitive object={flameGeometries[index]} attach="geometry" />
            <meshBasicMaterial
              vertexColors
              transparent
              opacity={layer.opacity}
              side={THREE.DoubleSide}
              depthWrite={false}
              toneMapped={false}
              blending={night ? THREE.AdditiveBlending : THREE.NormalBlending}
            />
          </mesh>
        ))}

        <pointLight
          ref={fireLight}
          position={[0, 0.32, 0.18]}
          distance={2.4}
          decay={2}
          intensity={0}
        />
      </group>

      <instancedMesh ref={embers} args={[undefined, undefined, EMBER_COUNT]} frustumCulled={false}>
        <primitive object={emberGeometry} attach="geometry" />
        <meshBasicMaterial
          ref={emberMaterial}
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
          opacity={0}
          blending={night ? THREE.AdditiveBlending : THREE.NormalBlending}
        />
      </instancedMesh>
    </group>
  )
}

/**
 * Bonfire — the one background loop of the signed-in app (DESIGN.md → Bonfire).
 *
 * A campfire in the bottom-right corner of the viewport: stone ring, crossed logs,
 * five low-poly flame layers and a seeded field of amber ember streaks that drift
 * slowly across the screen and die out overhead. Colours and burn profile belong to
 * the lit theme and crossfade on theme change. Lazy-loaded, WebGL-gated,
 * desktop-only, frozen under reduced motion, paused when the tab hides, and never
 * interactive: it lives at `-z-10`, behind the data. `/login` swaps this layer out
 * for the Sakura Garden.
 */
export function Bonfire({ className }: { className?: string }) {
  const reduced = usePrefersReducedMotion()
  const { colorMode } = useColorMode()
  const isDesktop = useIsDesktop()
  const hasGl = useMemo(() => hasWebGL(), [])
  const night = colorMode === 'dark'

  if (!hasGl || !isDesktop) return null

  return (
    <div
      data-testid="bonfire"
      data-mode={night ? 'dark' : 'light'}
      data-reduced={reduced ? 'true' : undefined}
      aria-hidden="true"
      className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}
    >
      <Canvas
        style={{ pointerEvents: 'none' }}
        frameloop={reduced ? 'demand' : 'always'}
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 6], fov: 45 }}
        gl={{ antialias: false, powerPreference: 'low-power', alpha: true }}
      >
        <Fire night={night} reduced={reduced} />
      </Canvas>
    </div>
  )
}

export default Bonfire
