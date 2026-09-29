import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Color, DoubleSide, type Group, type MeshStandardMaterial } from 'three'
import type { MotionValue } from 'motion/react'

import { pagodaPalette } from '@/theme/tokens'
import { hasWebGL } from '@/lib/webgl'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { useColorMode } from '@/components/ui/color-mode'
import {
  finialLayout,
  lightingRig,
  pagodaLayout,
  pagodaRoofVertices,
  plinthLayout,
  tierDetail,
  towerPose,
  type LightMode,
  type RoofGeometry,
  type TierGeometry,
} from './pagodaScene'
import { TOWER_TIERS } from '@/content/tower'
import { cn } from '@/lib/utils'

/**
 * The landing page's pagoda.
 *
 * Decorative, and it owns no application state: it samples the scroll
 * `MotionValue` inside the frame loop. The DOM sections read the same value, so
 * the tower and the cards cannot disagree about which storey is open.
 *
 * Lighting is theme-driven. After dark the lanterns are the light source —
 * low cool ambient, a warm frontal fill, a point light per lantern and an
 * emissive panel, and deliberately no sun. In daylight a shadow-casting sun
 * takes over and the lanterns drop to a whisper. `lightingRig` holds the
 * numbers; the colours come from `pagodaPalette`, because `components/three/**`
 * is hex-free by rule.
 *
 * Gates: lazy chunk (three must never be in the initial bundle), `hasWebGL()`,
 * hidden below `md`, paused when the tab is hidden, frozen under reduced motion,
 * aria-hidden and pointer-events-none behind the content.
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
  const glSupported = useWebGLOnce()

  const night = colorMode === 'dark'
  // Below `md` there is no WebGL at all — the DOM story carries the content on
  // its own, so we never request the three.js chunk for a phone.
  if (glSupported === false || !isDesktop) return null

  const mode: LightMode = night ? 'dark' : 'light'
  const rig = lightingRig(mode)

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
        shadows={rig.shadows}
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

/** Probe WebGL once. In the render body it would leak a context per re-render. */
function useWebGLOnce(): boolean | null {
  const [ok, setOk] = useStateOnce<boolean | null>(null)
  useEffect(() => setOk(hasWebGL()), [])
  return ok
}

import { useState as useStateOnce } from 'react'

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
  const lanternRefs = useRef<Array<Array<Group | null>>>([])
  const fillLight = useRef<Group>(null)
  const finialGlow = useRef<Group>(null)
  const sunRef = useRef<Group>(null)
  const { camera } = useThree()

  const layout = useMemo(() => pagodaLayout(TOWER_TIERS.length), [])
  const finial = useMemo(() => finialLayout(), [])
  const plinth = useMemo(() => plinthLayout(layout), [layout])
  const details = useMemo(() => layout.map(tierDetail), [layout])
  const rig = useMemo(() => lightingRig(night ? 'dark' : 'light'), [night])

  // Both palettes are built once and crossfaded in the frame loop, the way the
  // bonfire swaps its burn profile. A thresholded `blend >= 0.5` pick is not a
  // crossfade — it flips the colour prop and clobbers the per-frame dimming.
  const palette = useMemo(() => {
    const p = pagodaPalette
    return {
      dark: {
        body: new Color(p.dark.body),
        roof: new Color(p.dark.roof),
        trim: new Color(p.dark.trim),
        plinth: new Color(p.dark.plinth),
        deck: new Color(p.dark.deck),
        soffit: new Color(p.dark.soffit),
        lantern: new Color(p.dark.lantern),
        ambient: new Color(p.dark.ambient),
        fill: new Color(p.dark.fill),
        sun: new Color(p.dark.sun),
      },
      light: {
        body: new Color(p.light.body),
        roof: new Color(p.light.roof),
        trim: new Color(p.light.trim),
        plinth: new Color(p.light.plinth),
        deck: new Color(p.light.deck),
        soffit: new Color(p.light.soffit),
        lantern: new Color(p.light.lantern),
        ambient: new Color(p.light.ambient),
        fill: new Color(p.light.fill),
        sun: new Color(p.light.sun),
      },
    }
  }, [])

  // Crossfade state lives in a ref: a `setState` inside `useFrame` re-renders
  // the whole scene every animation frame, recreating every material.
  const mix = useRef({ v: night ? 1 : 0, base: night ? 1 : 0, body: new Color(), roof: new Color(), trim: new Color(), plinth: new Color(), deck: new Color(), lantern: new Color(), ambient: new Color(), fill: new Color(), sun: new Color() })
  mix.current.base = night ? 1 : 0
  if (mix.current.v === undefined) mix.current.v = night ? 1 : 0

  const tint = useRef(new Map<MeshStandardMaterial, Color>())
  const idleRef = useRef({ t: 0 })

  useFrame((_, delta) => {
    // One gate for the whole frame: both the pose and the crossfade stop when
    // the tab is hidden. r3f does not pause for us.
    if (typeof document !== 'undefined' && document.hidden) return

    const m = mix.current
    const target = m.base
    // ~300ms crossfade; instant under reduced motion.
    const rate = reduced ? 1 : Math.min(1, delta * 3.3)
    m.v = Math.abs(m.v - target) < 0.002 ? target : m.v + (target - m.v) * rate
    const t = m.v

    m.body.copy(palette.light.body).lerp(palette.dark.body, t)
    m.roof.copy(palette.light.roof).lerp(palette.dark.roof, t)
    m.trim.copy(palette.light.trim).lerp(palette.dark.trim, t)
    m.plinth.copy(palette.light.plinth).lerp(palette.dark.plinth, t)
    m.deck.copy(palette.light.deck).lerp(palette.dark.deck, t)
    m.lantern.copy(palette.light.lantern).lerp(palette.dark.lantern, t)
    m.ambient.copy(palette.light.ambient).lerp(palette.dark.ambient, t)
    m.fill.copy(palette.light.fill).lerp(palette.dark.fill, t)
    m.sun.copy(palette.light.sun).lerp(palette.dark.sun, t)

    // Repaint every material we registered, dimming by the pose.
    for (const [mat, base] of tint.current) {
      mat.color.copy(base)
    }

    const pose = towerPose(progress.get())
    // Idle motion, so the tower is never dead still: a slow sway about the base
    // and a few degrees of turn read as a standing structure catching the air.
    // `t` accumulates delta, so it is frame-rate independent, and it does not
    // advance under reduced motion.
    idleRef.current.t += reduced ? 0 : delta
    const clock = idleRef.current.t

    if (root.current) {
      root.current.position.set(pose.x, pose.y, 0)
      root.current.scale.setScalar(pose.scale)
      root.current.rotation.z = Math.sin(clock * 0.55) * 0.012
      root.current.rotation.y = Math.sin(clock * 0.18) * 0.05
    }
    camera.position.z += (pose.cameraZ - camera.position.z) * 0.15

    layout.forEach((tier, i) => {
      const g = tierRefs.current[i]
      if (!g) return
      const tp = pose.tiers[i]
      // The roof lifts off the stack to reveal the storey underneath it.
      g.position.y = tier.y + tp.lift
      // Dim floor: the closed storeys must still read as a building, not voids.
      const dim = 0.68 + 0.32 * tp.brightness
      g.traverse((child) => {
        const mesh = child as unknown as { isMesh?: boolean; material?: MeshStandardMaterial; userData?: { base?: Color } }
        if (!mesh.isMesh || !mesh.material) return
        const base = mesh.userData?.base
        if (base) mesh.material.color.copy(base).multiplyScalar(dim)
      })
      // The storey's own lanterns come up with it.
      const lamps = lanternRefs.current[i]
      if (lamps) {
        for (const lamp of lamps) {
          if (!lamp) continue
          // Lanterns come up with their storey and flicker gently on top of it.
          const flicker = 1 + Math.sin(clock * 2.6 + i * 1.7) * 0.06
          lamp.scale.setScalar((0.55 + 0.45 * tp.emphasis) * flicker)
        }
      }
    })

    if (fillLight.current) {
      const l = fillLight.current.children[0] as unknown as { intensity: number; color: Color } | undefined
      if (l) {
        l.intensity = rig.fillIntensity
        l.color.copy(m.fill)
      }
    }
    if (sunRef.current) {
      const l = sunRef.current.children[0] as unknown as { intensity: number; color: Color } | undefined
      if (l) {
        l.intensity = rig.sun ? rig.sun.intensity * (1 - t) : 0
        l.color.copy(m.sun)
      }
    }
    if (finialGlow.current) {
      const mesh = finialGlow.current.children[0] as unknown as { material?: MeshStandardMaterial } | undefined
      if (mesh?.material) {
        mesh.material.emissiveIntensity = rig.finialGlow
        mesh.material.emissive.copy(m.lantern)
      }
    }
  })

  const register = (mat: MeshStandardMaterial | null, base: Color) => {
    if (mat) tint.current.set(mat, base)
  }

  return (
    <group ref={root} data-testid="pagoda-root">
      {/* Lighting rig. Ambient always; fill always; sun only by day. */}
      <ambientLight color={palette[night ? 'dark' : 'light'].ambient} intensity={rig.ambientIntensity} />
      <group ref={fillLight}>
        <directionalLight position={[2.4, 1.6, 4.2]} intensity={rig.fillIntensity} color={palette[night ? 'dark' : 'light'].fill} />
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

      <Plinth layout={plinth} color={palette[night ? 'dark' : 'light'].plinth} />

      {layout.map((tier, i) => (
        <group
          key={tier.index}
          ref={(node) => {
            tierRefs.current[i] = node
          }}
        >
          <Storey
            tier={tier}
            detail={details[i]}
            paletteKey={night ? 'dark' : 'light'}
            colours={palette[night ? 'dark' : 'light']}
            register={register}
            lanternRefs={lanternRefs.current[i] ?? (lanternRefs.current[i] = [])}
            rig={rig}
            lanternColour={palette[night ? 'dark' : 'light'].lantern}
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

function Plinth({ layout, color }: { layout: ReturnType<typeof plinthLayout>; color: Color }) {
  return (
    <group position={[0, -layout.height, 0]}>
      {layout.stepWidths.map((w, i) => (
        <mesh key={i} position={[0, layout.height / 2 + (layout.height * i) / 1.6, 0]} receiveShadow castShadow>
          <boxGeometry args={[w, layout.height, w]} />
          <meshStandardMaterial color={color} roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}

function Storey({
  tier,
  detail,
  colours,
  register,
  lanternRefs,
  rig,
  lanternColour,
}: {
  tier: TierGeometry
  detail: ReturnType<typeof tierDetail>
  paletteKey: LightMode
  colours: Record<string, Color>
  register: (mat: MeshStandardMaterial | null, base: Color) => void
  lanternRefs: Array<Group | null>
  rig: ReturnType<typeof lightingRig>
  lanternColour: Color
}) {
  const bodyMat = useRef<MeshStandardMaterial>(null)
  const roofMat = useRef<MeshStandardMaterial>(null)
  const deckMat = useRef<MeshStandardMaterial>(null)

  useEffect(() => {
    register(bodyMat.current, colours.body)
    register(roofMat.current, colours.roof)
    register(deckMat.current, colours.deck)
  }, [register, colours])

  const roof = useMemo<BufferGeometry>(() => {
    const g: RoofGeometry = pagodaRoofVertices({
      halfSpan: tier.roofHalfSpan,
      rise: tier.roofRise,
      // A gentle flick, not a spike: a quarter of the rise, ramped in over most
      // of the side. Any more and the corners read as horns.
      eaveLift: tier.roofRise * 0.26,
      cornerSpan: 0.58,
      segs: 6,
    })
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(g.positions), 3))
    geometry.setIndex(g.indices)
    geometry.computeVertexNormals()
    return geometry
  }, [tier])

  return (
    <group>
      {/* Body */}
      <mesh position={[0, tier.bodyHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[tier.bodyWidth, tier.bodyHeight, tier.bodyWidth]} />
        <meshStandardMaterial ref={bodyMat} color={colours.body} roughness={0.88} metalness={0.02} />
      </mesh>

      {/* Corner posts */}
      {detail.columns.map((c, i) => (
        <mesh key={i} position={c} castShadow>
          <boxGeometry args={[0.045, tier.bodyHeight, 0.045]} />
          <meshStandardMaterial color={colours.trim} roughness={0.55} />
        </mesh>
      ))}

      {/* Veranda deck and its railing */}
      <mesh position={[0, detail.balconyY, 0]} receiveShadow castShadow>
        <boxGeometry args={[detail.balconyWidth, 0.028, detail.balconyWidth]} />
        <meshStandardMaterial ref={deckMat} color={colours.deck} roughness={0.8} />
      </mesh>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}-${sz}`}
            position={[sx * (detail.balconyWidth / 2), detail.balconyY + detail.railingHeight / 2, sz * (detail.balconyWidth / 2)]}
            castShadow
          >
            <boxGeometry args={[0.018, detail.railingHeight, detail.balconyWidth]} />
            <meshStandardMaterial color={colours.trim} roughness={0.6} />
          </mesh>
        )),
      )}

      {/* The lanterns: emissive panels plus a real point light each. */}
      {detail.lanterns.map((l, i) => (
        <group
          key={i}
          ref={(node) => {
            lanternRefs[i] = node
          }}
          position={l}
        >
          <mesh>
            <boxGeometry args={[0.075, 0.1, 0.075]} />
            <meshStandardMaterial
              color={lanternColour}
              emissive={lanternColour}
              emissiveIntensity={rig.emissiveIntensity}
              roughness={0.5}
            />
          </mesh>
          <pointLight
            color={lanternColour}
            intensity={rig.lanternIntensity}
            distance={rig.lanternDistance}
            decay={2}
          />
        </group>
      ))}

      {/* Roof: the upturned square, then a darker soffit so it has thickness. */}
      <group position={[0, tier.bodyHeight, 0]}>
        <mesh geometry={roof} castShadow receiveShadow>
          <meshStandardMaterial
            ref={roofMat}
            color={colours.roof}
            roughness={0.62}
            metalness={0.08}
            side={DoubleSide}
          />
        </mesh>
        <mesh position={[0, -0.016, 0]} receiveShadow>
          <boxGeometry args={[tier.roofHalfSpan * 1.86, 0.03, tier.roofHalfSpan * 1.86]} />
          {/* The soffit is the roof in shadow, not a bright accent. */}
          <meshStandardMaterial color={colours.soffit} roughness={0.8} />
        </mesh>
        {/* Ridge cap along both diagonals, which is what makes the roof read as tiled. */}
        {[0, Math.PI / 2].map((rot) => (
          <mesh key={rot} position={[0, tier.roofRise * 0.42, 0]} rotation={[0, rot, 0]} castShadow>
            <boxGeometry args={[tier.roofHalfSpan * 1.5, 0.022, 0.05]} />
            <meshStandardMaterial color={colours.trim} roughness={0.5} metalness={0.15} />
          </mesh>
        ))}
      </group>
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
  top: TierGeometry
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
          <torusGeometry args={[0.062 - i * 0.009, 0.011, 6, 14]} />
          <meshStandardMaterial color={colour} roughness={0.35} metalness={0.35} />
        </mesh>
      ))}
      {/* The jewel at the tip: the brightest thing on the tower after dark. */}
      <group ref={glowRef} position={[0, layout.tipY, 0]}>
        <mesh>
          <sphereGeometry args={[0.05, 12, 10]} />
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
