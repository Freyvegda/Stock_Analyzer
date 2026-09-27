/**
 * Pure, deterministic emission data for the Bonfire layer (see DESIGN.md → Bonfire).
 *
 * No three.js here: this module only produces numbers, which keeps the emission
 * math unit-testable in jsdom and lets `Bonfire.tsx` stay a component file
 * (so React Fast Refresh keeps working).
 */

import { mulberry32 } from './sakuraTree'

/** Deterministic field seed — the same embers rise on every load. */
export const BONFIRE_SEED = 20260928
export const EMBER_COUNT = 280

/** Hard instance budgets — the corner fire must stay a cheap corner of the GPU. */
export const EMBER_LIMITS = {
  maxEmbers: 320,
  maxStones: 10,
  maxLogs: 4,
  maxFlames: 6,
}

/**
 * Embers render as square pixels this many world units across (about 2–3 screen
 * pixels on a full-height viewport) — pixel spark, not a glow dot.
 */
export const EMBER_PIXEL = 0.013

/** The flame mouth embers are born in, in local units (x right, z towards the camera). */
export const EMBER_MOUTH = { x: 0.22, z: 0.16 }

/** Height above the logs where an ember lifts off, in local units. */
export const EMBER_BASE = 0.18

/** Vertical span an ember climbs through, in local units, before respawning. */
export const EMBER_RISE = 4.6

/** Seconds into the rise used for the frozen (reduced-motion) frame. */
export const STILL_TIME = 12.7

export interface EmberSeed {
  x: number
  z: number
  /** Rise cycles per second at `rise` 1. */
  speed: number
  /** 0..1 offset along the rise. */
  phase: number
  /** Lateral wander as the ember climbs. */
  swayAmp: number
  swayPhase: number
  /**
   * One-way sideways drift across the whole climb, biased into the page (leftward,
   * away from the corner). Most embers carry a little, a tail carries a lot — that
   * is what spreads them across the screen without losing the crowd around the fire.
   */
  drift: number
  /** 0..1 — how hot this ember burns (ember → emberHot). */
  hot: number
  /** Pixel scale — depth plus size variety sells the 3D. */
  size: number
  /** Depth (z) wander amplitude, world units. */
  depthAmp: number
  depthPhase: number
  /** One-way depth travel across the climb, towards or away from the camera. */
  deepDrift: number
}

/** Seeded ember field: spawn points inside the flame mouth, one rise arc each. */
export function emberSeeds(seed = BONFIRE_SEED, count = EMBER_COUNT): EmberSeed[] {
  const random = mulberry32(seed)
  return Array.from({ length: count }, () => {
    // Two populations: a dense crowd that stays with the fire, and a thin tail of
    // wanderers that carries sparks across the whole screen.
    const wanderer = random() < 0.28
    const local = random() ** 3
    return {
      x: (random() - 0.5) * 2 * EMBER_MOUTH.x,
      z: (random() - 0.5) * 2 * EMBER_MOUTH.z,
      speed: 0.3 + random() * 0.45,
      phase: random(),
      swayAmp: 0.15 + random() * 0.55,
      swayPhase: random() * Math.PI * 2,
      drift: wanderer
        ? -(1.6 + random() * 10)
        : (0.3 - random() * 1.3) * (0.5 + 1.8 * local),
      hot: random(),
      size: 0.6 + random(),
      depthAmp: 0.4 + random() * 1.8,
      depthPhase: random() * Math.PI * 2,
      deepDrift: (random() - 0.5) * 3.2,
    }
  })
}

/**
 * How the fire burns for a colour mode. The night fire is the slow, bright one;
 * the day fire is finer, calmer and quicker — both derived from the same field.
 */
export interface MotionProfile {
  /** Vertical speed multiplier. */
  rise: number
  /** Lateral sway multiplier. */
  sway: number
  /** Sideways drift multiplier. */
  drift: number
  /** Flame height / width flicker. */
  flickerAmp: number
  flickerSpeed: number
  /** Ground bloom peak opacity. */
  glowOpacity: number
  /** Ember particle opacity. */
  emberOpacity: number
  /** Fire light flicker intensity. */
  lightIntensity: number
}

const PROFILES: { dark: MotionProfile; light: MotionProfile } = {
  dark: {
    // A slow, cosy climb: a full rise takes 7–18 seconds.
    rise: 0.16,
    sway: 0.8,
    drift: 1,
    flickerAmp: 0.14,
    flickerSpeed: 2.6,
    glowOpacity: 0.36,
    emberOpacity: 0.95,
    lightIntensity: 2.6,
  },
  light: {
    rise: 0.2,
    sway: 0.65,
    drift: 0.8,
    flickerAmp: 0.08,
    flickerSpeed: 3.6,
    glowOpacity: 0.18,
    emberOpacity: 0.75,
    lightIntensity: 1.7,
  },
}

/** Selects the burn profile for a resolved colour mode (day until proven night). */
export function motionFor(colorMode: string | undefined): MotionProfile {
  return colorMode === 'dark' ? PROFILES.dark : PROFILES.light
}

export interface EmberPose {
  x: number
  y: number
  z: number
  /** 0..1 — fades in at the flame mouth and dies out before the top. */
  alpha: number
  /** 0..1 — heat drops as the ember climbs away from the flame. */
  heat: number
}

/**
 * Where one ember sits at `time` seconds into the burn. Embers climb `span` local
 * units per cycle, wander sideways and through depth as they rise, and respawn at
 * the flame mouth. Pass `out` to reuse a pose object in per-frame loops.
 */
export function emberPose(
  seed: EmberSeed,
  time: number,
  profile: MotionProfile,
  span: number,
  out?: EmberPose,
): EmberPose {
  const pose = out ?? { x: 0, y: 0, z: 0, alpha: 0, heat: 0 }
  const cycle = (seed.phase + time * seed.speed * profile.rise) % 1
  const climb = cycle * span
  const sway = Math.sin(time * profile.sway * 1.7 + seed.swayPhase)
  const fadeIn = Math.min(1, cycle / 0.08)
  const fadeOut = 1 - Math.max(0, (cycle - 0.72) / 0.28)
  pose.x = seed.x + sway * seed.swayAmp * cycle + seed.drift * profile.drift * cycle
  pose.y = EMBER_BASE + climb * (1 - EMBER_BASE / span)
  pose.z = seed.z + (Math.sin(time * 0.23 + seed.depthPhase) * seed.depthAmp + seed.deepDrift) * cycle
  pose.alpha = fadeIn * fadeOut
  pose.heat = seed.hot * (1 - 0.55 * cycle)
  return pose
}
