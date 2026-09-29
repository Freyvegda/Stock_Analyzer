import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Color,
  MeshStandardMaterial,
  type Group,
  type Object3D,
} from 'three'
import type { MotionValue } from 'motion/react'

import { pagodaPalette } from '@/theme/tokens'
import { hasWebGL } from '@/lib/webgl'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { useFinePointer } from '@/lib/useFinePointer'
import { useColorMode } from '@/components/ui/color-mode'
import {
  QUALITY_PROFILES,
  pickQuality,
  type Quality,
} from './pagodaWorld'
import {
  baseDetail,
  finialLayout,
  hangingLanterns,
  lightingRig,
  pagodaLayout,
  plinthLayout,
  towerPose,
  type LightMode,
} from './pagodaScene'
import { PagodaStorey, type StoreyMaterials } from './PagodaStorey'
import { PagodaEnvironment } from './PagodaEnvironment'
import { TOWER_TIERS } from '@/content/tower'
import { cn } from '@/lib/utils'

/**
 * The landing page's pagoda, standing in its world.
 *
 * Decorative, and it owns no application state beyond the quality tier it picks
 * for itself: it samples the scroll `MotionValue` inside the frame loop, so the
 * tower and the DOM sections read the same value and cannot disagree about which
 * storey is open.
 *
 * **Motion.** Two things were wrong before and are fixed here. The pose was
 * written straight from raw scroll, which is what made the tower choppy — every
 * scroll jitter became tower jitter, one frame later. And the *whole storey*
 * lifted to reveal itself, which opened a gap in the stack and read as the tower
 * coming apart. Now every pose value is damped toward its target, and only the
 * roof lifts and leans, so a storey opens rather than detaching.
 *
 * **Cost.** One material set per storey instead of one per mesh, merged geometry
 * per material, instanced particle fields, and a quality tier picked from the
 * device. A weak laptop gets fewer particles and no shadows; it never gets a
 * broken picture.
 *
 * Gates: lazy chunk, `hasWebGL()`, hidden below `md`, paused when the tab is
 * hidden, frozen under reduced motion, aria-hidden, pointer-events-none.
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
  const finePointer = useFinePointer()
  const glSupported = useWebGLOnce()
  const quality = useQuality(isDesktop, finePointer)

  const night = colorMode === 'dark'
  // Below `md` there is no WebGL at all — the DOM story carries the content on
  // its own, so we never request the three.js chunk for a phone.
  if (glSupported === false || !isDesktop) return null

  const mode: LightMode = night ? 'dark' : 'light'
  const rig = lightingRig(mode)
  const profile = QUALITY_PROFILES[quality]

  return (
    <div
      data-testid="pagoda"
      data-mode={night ? 'dark' : 'light'}
      data-quality={quality}
      data-reduced={reduced ? 'true' : undefined}
      aria-hidden="true"
      className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}
    >
      <Canvas
        style={{ pointerEvents: 'none' }}
        shadows={rig.shadows && profile.shadows}
        frameloop={reduced ? 'demand' : 'always'}
        dpr={[1, profile.dpr]}
        camera={{ position: [0, 0, 6.4], fov: 45 }}
        gl={{ antialias: false, powerPreference: 'low-power', alpha: true }}
      >
        <Scene progress={progress} night={night} reduced={reduced} quality={quality} />
      </Canvas>
    </div>
  )
}

/** Probe WebGL once. In the render body it would leak a context per re-render. */
function useWebGLOnce(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => setOk(hasWebGL()), [])
  return ok
}

/**
 * Pick the quality tier once, from the device's own hints.
 *
 * Read through a `useState` initialiser rather than in the render body so the
 * probe happens once, not on every stage change.
 */
function useQuality(isDesktop: boolean, finePointer: boolean): Quality {
  const [quality] = useState<Quality>(() => {
    if (typeof navigator === 'undefined') return 'medium'
    const nav = navigator as Navigator & { deviceMemory?: number }
    return pickQuality({
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
      // A coarse pointer is a touch device, which usually means battery.
      coarsePointer: !finePointer,
    })
  })
  return isDesktop ? quality : 'low'
}

function Scene({
  progress,
  night,
  reduced,
  quality,
}: {
  progress: MotionValue<number>
  night: boolean
  reduced: boolean
  quality: Quality
}) {
  const root = useRef<Group>(null)
  const tierRefs = useRef<Array<Group | null>>([])
  const roofRefs = useRef<Array<Object3D | null>>([])
  const lanternRefs = useRef<Array<Array<Group | null>>>([])
  const fillLight = useRef<Group>(null)
  const finialGlow = useRef<Group>(null)
  const sunRef = useRef<Group>(null)
  const { camera } = useThree()

  const layout = useMemo(() => pagodaLayout(TOWER_TIERS.length), [])
  const finial = useMemo(() => finialLayout(), [])
  const plinth = useMemo(() => plinthLayout(layout), [layout])
  const base = useMemo(() => baseDetail(layout), [layout])
  const rig = useMemo(() => lightingRig(night ? 'dark' : 'light'), [night])
  const lanternsPerTier = useMemo(() => layout.map(hangingLanterns), [layout])

  // One material set per storey, shared by every mesh in that storey. The old
  // build created a material per mesh — ninety-odd per storey — which is what
  // made the scene heavy and slow to shade.
  const materialSets = useMemo(() => {
    const p = pagodaPalette[night ? 'dark' : 'light']
    return layout.map(
      (): StoreyMaterials => ({
        body: new MeshStandardMaterial({ color: p.body, roughness: 0.88, metalness: 0.02 }),
        roof: new MeshStandardMaterial({ color: p.roof, roughness: 0.62, metalness: 0.08 }),
        trim: new MeshStandardMaterial({ color: p.trim, roughness: 0.55, metalness: 0.12 }),
        deck: new MeshStandardMaterial({ color: p.deck, roughness: 0.8 }),
        soffit: new MeshStandardMaterial({ color: p.soffit, roughness: 0.8 }),
        lantern: new MeshStandardMaterial({
          color: p.lantern,
          emissive: p.lantern,
          emissiveIntensity: rig.emissiveIntensity,
          roughness: 0.5,
        }),
      }),
    )
  }, [layout, night, rig.emissiveIntensity])

  // Free the material sets when the theme changes, or each flip leaks a set.
  useEffect(() => {
    return () => {
      for (const set of materialSets) {
        for (const mat of Object.values(set)) mat.dispose()
      }
    }
  }, [materialSets])

  // Both palettes resident, crossfaded. A ref, not state: a `setState` in
  // `useFrame` re-renders the whole scene every frame.
  const palette = useMemo(() => buildPalettes(), [])
  const mix = useRef({ v: night ? 1 : 0 })
  // Damped pose. Everything the frame loop drives is eased toward its target, so
  // a jittery scroll gesture cannot shake the tower.
  const damped = useRef({
    x: 0,
    y: -1.5,
    scale: 0.32,
    camZ: 6.4,
    camY: 0,
    tierLift: layout.map(() => 0),
    tierTilt: layout.map(() => 0),
    tierBright: layout.map(() => 0.35),
  })
  const clock = useRef(0)

  useFrame((_, delta) => {
    // One gate for the whole frame: pose, crossfade and weather all stop when
    // the tab is hidden. r3f does not pause for us.
    if (typeof document !== 'undefined' && document.hidden) return

    const step = Math.min(delta, 0.1)
    // Frame-rate independent damping. ~0.12s to close most of the gap, which
    // smooths scroll jitter without feeling laggy behind the wheel.
    const ease = reduced ? 1 : 1 - Math.exp(-9 * step)

    const m = mix.current
    const target = night ? 1 : 0
    const rate = reduced ? 1 : Math.min(1, step * 3.3)
    m.v = Math.abs(m.v - target) < 0.002 ? target : m.v + (target - m.v) * rate
    const t = m.v

    const pose = towerPose(progress.get())
    const d = damped.current

    d.x += (pose.x - d.x) * ease
    d.y += (pose.y - d.y) * ease
    d.scale += (pose.scale - d.scale) * ease
    d.camZ += (pose.cameraZ - d.camZ) * ease

    // The camera follows the open storey's height, so a storey is *shown* rather
    // than merely scrolled past.
    const openTier = pose.activeTier
    const focusY =
      openTier >= 0 && layout[openTier]
        ? (layout[openTier].y + layout[openTier].bodyHeight) * d.scale + d.y
        : 0
    d.camY += (focusY * 0.45 - d.camY) * ease

    clock.current += reduced ? 0 : step
    const now = clock.current

    if (root.current) {
      root.current.position.set(d.x, d.y, 0)
      root.current.scale.setScalar(d.scale)
      root.current.rotation.z = Math.sin(now * 0.55) * 0.012
      root.current.rotation.y = Math.sin(now * 0.18) * 0.05
    }
    camera.position.set(0, d.camY, d.camZ)
    camera.lookAt(0, d.camY * 0.8, 0)

    layout.forEach((tier, i) => {
      const tp = pose.tiers[i]
      d.tierLift[i] += (tp.lift - d.tierLift[i]) * ease
      d.tierTilt[i] += (tp.tilt - d.tierTilt[i]) * ease
      d.tierBright[i] += (tp.brightness - d.tierBright[i]) * ease

      // Only the roof moves. The body stays in the stack, so the tower never
      // opens a gap.
      const roof = roofRefs.current[i]
      if (roof) {
        roof.position.y = tier.bodyHeight + d.tierLift[i]
        roof.rotation.z = d.tierTilt[i]
      }

      // Lanterns swing on their own phase, and harder on the open storey — the
      // storey being pulled open disturbs the air around it.
      const lamps = lanternRefs.current[i]
      const specs = lanternsPerTier[i]
      if (lamps && specs) {
        for (let k = 0; k < lamps.length; k += 1) {
          const lamp = lamps[k]
          const spec = specs[k]
          if (!lamp || !spec) continue
          const gain = pose.swayGain
          const swing = Math.sin(now * 1.5 + spec.phase) * 0.16 * gain
          lamp.rotation.z = swing
          lamp.rotation.x = Math.cos(now * 1.1 + spec.phase) * 0.1 * gain
          const flicker = 1 + Math.sin(now * 2.6 + spec.phase) * 0.06 + Math.abs(swing) * 0.3
          lamp.scale.setScalar((0.85 + 0.15 * tp.emphasis) * flicker)
        }
      }

      // Per-storey dimming, on the storey's own shared materials. Six reads, not
      // a `traverse` over ninety meshes.
      const brightness = d.tierBright[i]
      const set = materialSets[i]
      if (set) {
        set.body.color.copy(palette.light.body).lerp(palette.dark.body, t).multiplyScalar(brightness)
        set.roof.color.copy(palette.light.roof).lerp(palette.dark.roof, t).multiplyScalar(brightness)
        set.trim.color.copy(palette.light.trim).lerp(palette.dark.trim, t).multiplyScalar(brightness)
        set.deck.color.copy(palette.light.deck).lerp(palette.dark.deck, t).multiplyScalar(brightness)
        set.soffit.color
          .copy(palette.light.soffit)
          .lerp(palette.dark.soffit, t)
          .multiplyScalar(brightness)
        set.lantern.color
          .copy(palette.light.lantern)
          .lerp(palette.dark.lantern, t)
        set.lantern.emissiveIntensity = rig.emissiveIntensity * (0.4 + 0.6 * tp.brightness)
      }
    })

    if (fillLight.current) {
      const l = fillLight.current.children[0] as unknown as
        | { intensity: number; color: Color }
        | undefined
      if (l) {
        l.intensity = rig.fillIntensity
        l.color.copy(palette.light.fill).lerp(palette.dark.fill, t)
      }
    }
    if (sunRef.current) {
      const l = sunRef.current.children[0] as unknown as
        | { intensity: number; color: Color }
        | undefined
      if (l) {
        l.intensity = rig.sun ? rig.sun.intensity * (1 - t) : 0
        l.color.copy(palette.light.sun).lerp(palette.dark.sun, t)
      }
    }
    if (finialGlow.current) {
      const mesh = finialGlow.current.children[0] as unknown as
        | { material?: MeshStandardMaterial }
        | undefined
      if (mesh?.material) {
        mesh.material.emissiveIntensity = rig.finialGlow
        mesh.material.emissive.copy(palette.light.lantern).lerp(palette.dark.lantern, t)
      }
    }
  })

  return (
    <group ref={root} data-testid="pagoda-root">
      {/* The world, behind and around the tower. It reads the same clock, so the
          weather and the tower cannot drift apart. */}
      <WorldLayer
        progress={progress}
        night={night}
        reduced={reduced}
        quality={quality}
        tiers={layout}
        clockRef={clock}
      />

      {/* Lighting rig. Ambient always; fill always; sun only by day. */}
      <ambientLight
        color={palette[night ? 'dark' : 'light'].ambient}
        intensity={rig.ambientIntensity}
      />
      <group ref={fillLight}>
        <directionalLight
          position={[2.4, 1.6, 4.2]}
          intensity={rig.fillIntensity}
          color={palette[night ? 'dark' : 'light'].fill}
        />
      </group>
      <group ref={sunRef}>
        <directionalLight
          position={rig.sun?.position ?? [3.4, 6.2, 4.6]}
          intensity={rig.sun?.intensity ?? 0}
          color={palette.light.sun}
          castShadow={rig.sun?.castShadow ?? false}
          shadow-mapSize-width={rig.sun?.shadowMapSize ?? 512}
          shadow-mapSize-height={rig.sun?.shadowMapSize ?? 512}
          shadow-radius={rig.sun?.shadowRadius ?? 1}
          shadow-bias={-0.0012}
        />
      </group>

      <Plinth layout={plinth} colour={palette[night ? 'dark' : 'light'].plinth} base={base} />

      {layout.map((tier, i) => (
        <group
          key={tier.index}
          ref={(node) => {
            tierRefs.current[i] = node
          }}
        >
          <PagodaStorey
            tier={tier}
            index={i}
            ground={i === 0}
            materials={materialSets[i]}
            lanternRefs={lanternRefs.current[i] ?? (lanternRefs.current[i] = [])}
            roofRef={(node) => {
              roofRefs.current[i] = node
            }}
            lanternIntensity={rig.lanternIntensity}
          />
        </group>
      ))}

      <Finial
        layout={finial}
        top={layout[layout.length - 1]}
        colour={palette[night ? 'dark' : 'light'].trim}
        glowRef={finialGlow}
        rig={rig}
      />
    </group>
  )
}

/**
 * The world layer.
 *
 * It does not advance a clock of its own: it is handed the same `clockRef` the
 * tower uses, so a frozen scene is frozen everywhere at once and the weather can
 * never drift out of step with the sway.
 *
 * A low-frequency tick re-renders it so the instanced fields' matrices are
 * rewritten — 8Hz, not per frame, because stars and petals do not need 60fps of
 * position resolution to look alive, and a React re-render per frame is exactly
 * the cost this scene was fixed for.
 */
function WorldLayer({
  progress,
  night,
  reduced,
  quality,
  tiers,
  clockRef,
}: {
  progress: MotionValue<number>
  night: boolean
  reduced: boolean
  quality: Quality
  tiers: ReturnType<typeof pagodaLayout>
  /** The scene's single clock. The world reads it; it never advances its own. */
  clockRef: React.RefObject<number>
}) {
  const [, setTick] = useState(0)
  const ripple = useRef(0.35)
  const lastPublish = useRef(0)

  useFrame(() => {
    if (typeof document !== 'undefined' && document.hidden) return
    ripple.current = towerPose(progress.get()).ripple
    const now = clockRef.current
    // 8Hz. The tower itself still animates every frame; only the particle
    // matrices refresh at this rate, and they are slow-moving by design.
    if (now - lastPublish.current > 0.125) {
      lastPublish.current = now
      setTick((n) => n + 1)
    }
  })

  return (
    <PagodaEnvironment
      night={night}
      reduced={reduced}
      clock={clockRef.current}
      ripple={ripple.current}
      quality={quality}
      tiers={tiers}
    />
  )
}

/** Both palettes resident, so the crossfade interpolates rather than snaps. */
function buildPalettes() {
  const p = pagodaPalette
  const build = (mode: LightMode) => ({
    body: new Color(p[mode].body),
    roof: new Color(p[mode].roof),
    trim: new Color(p[mode].trim),
    plinth: new Color(p[mode].plinth),
    deck: new Color(p[mode].deck),
    soffit: new Color(p[mode].soffit),
    lantern: new Color(p[mode].lantern),
    ambient: new Color(p[mode].ambient),
    fill: new Color(p[mode].fill),
    sun: new Color(p[mode].sun),
  })
  return { dark: build('dark'), light: build('light') }
}

function Plinth({
  layout,
  colour,
  base,
}: {
  layout: ReturnType<typeof plinthLayout>
  colour: Color
  base: ReturnType<typeof baseDetail>
}) {
  return (
    <group position={[0, -layout.height, 0]}>
      {layout.stepWidths.map((w, i) => (
        <mesh
          key={i}
          position={[0, layout.height / 2 + (layout.height * i) / 1.6, 0]}
          receiveShadow
          castShadow
        >
          <boxGeometry args={[w, layout.height, w]} />
          <meshStandardMaterial color={colour} roughness={0.95} />
        </mesh>
      ))}
      {/* Balustrade along the plinth, and the two stone lanterns flanking it. */}
      {base.balusters.map((b, i) => (
        <mesh key={`b${i}`} position={b}>
          <boxGeometry args={[0.016, 0.06, 0.016]} />
          <meshStandardMaterial color={colour} roughness={0.9} />
        </mesh>
      ))}
      {base.stoneLanterns.map((s, i) => (
        <group key={`s${i}`} position={s}>
          <mesh position={[0, 0.05, 0]}>
            <cylinderGeometry args={[0.045, 0.055, 0.1, 6]} />
            <meshStandardMaterial color={colour} roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.13, 0]}>
            <boxGeometry args={[0.1, 0.07, 0.1]} />
            <meshStandardMaterial color={colour} roughness={0.85} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function Finial({
  layout,
  top,
  colour,
  glowRef,
  rig,
}: {
  layout: ReturnType<typeof finialLayout>
  top: ReturnType<typeof pagodaLayout>[number]
  colour: Color
  glowRef: React.RefObject<Group | null>
  rig: ReturnType<typeof lightingRig>
}) {
  const base = top.y + top.bodyHeight + top.roofRise
  return (
    <group position={[0, base, 0]}>
      <mesh position={[0, layout.rodHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[0.016, 0.022, layout.rodHeight, 10]} />
        <meshStandardMaterial color={colour} roughness={0.4} metalness={0.3} />
      </mesh>
      {layout.ringY.map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <torusGeometry args={[0.062 - i * 0.009, 0.011, 6, 12]} />
          <meshStandardMaterial color={colour} roughness={0.35} metalness={0.35} />
        </mesh>
      ))}
      {/* The wind-bell, hanging under the tip. */}
      <mesh position={[0, layout.bellY, 0]}>
        <sphereGeometry args={[0.028, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
        <meshStandardMaterial color={colour} roughness={0.35} metalness={0.4} side={2} />
      </mesh>
      {/* The jewel at the tip: the brightest thing on the tower after dark. */}
      <group ref={glowRef} position={[0, layout.tipY, 0]}>
        <mesh>
          <sphereGeometry args={[0.05, 10, 8]} />
          <meshStandardMaterial
            color={colour}
            emissive={colour}
            emissiveIntensity={rig.finialGlow}
            roughness={0.2}
            toneMapped={false}
          />
        </mesh>
        <pointLight color={colour} intensity={rig.finialGlow * 0.8} distance={1.4} decay={2} />
      </group>
    </group>
  )
}

export default Pagoda
