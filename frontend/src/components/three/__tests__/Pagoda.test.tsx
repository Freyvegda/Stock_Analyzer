import { render, screen } from '@testing-library/react'
import type { MotionValue } from 'motion/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { pagodaPalette } from '@/theme/tokens'
import { TOWER_TIERS } from '@/content/tower'

const env = vi.hoisted(() => ({ webgl: true, desktop: true, reduced: false, mode: 'dark' }))

vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="pagoda-canvas" />,
  useFrame: () => {},
  useThree: () => ({ camera: { position: { z: 6.4 } } }),
}))

vi.mock('@/lib/webgl', () => ({ hasWebGL: () => env.webgl }))
vi.mock('@/lib/useIsDesktop', () => ({ useIsDesktop: () => env.desktop }))
vi.mock('@/lib/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => env.reduced }))
vi.mock('@/components/ui/color-mode', () => ({ useColorMode: () => ({ colorMode: env.mode }) }))

const { Pagoda } = await import('../Pagoda')

const progress = { get: () => 0.5, current: 0.5 } as unknown as MotionValue<number>

function renderPagoda() {
  return render(<Pagoda progress={progress} />)
}

beforeEach(() => {
  env.webgl = true
  env.desktop = true
  env.reduced = false
  env.mode = 'dark'
})

describe('Pagoda gates', () => {
  it('renders nothing without WebGL', () => {
    env.webgl = false
    renderPagoda()
    expect(screen.queryByTestId('pagoda')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pagoda-canvas')).not.toBeInTheDocument()
  })

  it('renders nothing below md', () => {
    // The house rule gates every WebGL layer below md, and the landing page
    // keeps it: a phone gets the DOM story, not a hot battery.
    env.desktop = false
    renderPagoda()
    expect(screen.queryByTestId('pagoda-canvas')).not.toBeInTheDocument()
  })

  it('renders on desktop with WebGL', () => {
    renderPagoda()
    expect(screen.getByTestId('pagoda')).toBeInTheDocument()
    expect(screen.getByTestId('pagoda-canvas')).toBeInTheDocument()
  })

  it('is decorative: hidden from assistive tech and from the pointer', () => {
    renderPagoda()
    const node = screen.getByTestId('pagoda')
    expect(node).toHaveAttribute('aria-hidden', 'true')
    expect(node.className).toContain('pointer-events-none')
    expect(node.className).toContain('-z-10')
  })

  it('marks reduced motion so the frame loop can freeze', () => {
    env.reduced = true
    renderPagoda()
    expect(screen.getByTestId('pagoda')).toHaveAttribute('data-reduced', 'true')
  })

  it('reports the colour mode it is rendering for', () => {
    env.mode = 'light'
    renderPagoda()
    expect(screen.getByTestId('pagoda')).toHaveAttribute('data-mode', 'light')
  })
})

describe('pagodaPalette', () => {
  it('defines both modes with the same keys', () => {
    expect(Object.keys(pagodaPalette.dark).sort()).toEqual(
      Object.keys(pagodaPalette.light).sort(),
    )
  })

  it('covers every world colour role the scene asks for', () => {
    // Every role `pagodaWorld.ts` names must resolve here, or the renderer has
    // to invent a colour — which is exactly what the hex-free rule forbids.
    const roles = [
      ...Object.keys(pagodaPalette.dark),
      'skyTop',
      'skyHorizon',
      'ridgeNear',
      'ridgeMid',
      'ridgeFar',
      'mist',
      'water',
      'foliage',
      'bark',
      'star',
      'sun',
      'moon',
      'halo',
      'torii',
    ]
    for (const mode of ['dark', 'light'] as const) {
      for (const role of roles) {
        expect(
          (pagodaPalette[mode] as Record<string, string>)[role],
          `${mode}.${role} is missing`,
        ).toMatch(/^#[0-9A-Fa-f]{6}$/)
      }
    }
  })

  it('keeps the lit trim inside the sakura family in both modes', () => {
    // The pagoda is brand, not status: nothing here may read as gain or loss.
    for (const mode of ['dark', 'light'] as const) {
      expect(pagodaPalette[mode].trim).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
    expect(pagodaPalette.dark.trim.toLowerCase()).toBe('#ffa9c6')
  })

  it('puts the sun and the moon on opposite sides of the light range', () => {
    // The sun is a hot bright disc, the moon a cool one. If they read the same
    // the theme change would be invisible in the sky.
    const luminance = (hex: string) => {
      const v = hex.replace('#', '')
      const ch = (i: number) => parseInt(v.slice(i, i + 2), 16) / 255
      const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      return 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(2)) + 0.0722 * lin(ch(4))
    }
    // The moon is cooler: more blue than red.
    const moon = pagodaPalette.dark.moon.replace('#', '')
    const moonR = parseInt(moon.slice(0, 2), 16)
    const moonB = parseInt(moon.slice(4, 6), 16)
    expect(moonB).toBeGreaterThanOrEqual(moonR)
    // The sun is warm: more red than blue.
    const sun = pagodaPalette.light.sun.replace('#', '')
    expect(parseInt(sun.slice(0, 2), 16)).toBeGreaterThan(parseInt(sun.slice(4, 6), 16))
    // And both are actually bright enough to read as a light source.
    expect(luminance(pagodaPalette.dark.moon)).toBeGreaterThan(0.4)
    expect(luminance(pagodaPalette.light.sun)).toBeGreaterThan(0.4)
  })

  it('recedes the ridges toward the sky', () => {
    // The depth progression is a value progression: near ridges are darker and
    // further ones sit closer to the sky behind them. Without it the mountains
    // read as a flat collage of the same shape.
    const lum = (hex: string) => {
      const v = hex.replace('#', '')
      const ch = (i: number) => parseInt(v.slice(i, i + 2), 16) / 255
      const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      return 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(2)) + 0.0722 * lin(ch(4))
    }
    for (const mode of ['dark', 'light'] as const) {
      const p = pagodaPalette[mode]
      expect(lum(p.ridgeNear), `${mode} near/far`).toBeLessThan(lum(p.ridgeFar))
      expect(lum(p.ridgeFar), `${mode} far/sky`).toBeGreaterThan(lum(p.skyHorizon))
    }
  })
})

describe('tier coverage', () => {
  it('has one entry per pagoda storey', () => {
    expect(TOWER_TIERS).toHaveLength(4)
  })

  it('gives every tier a route, a heading and a one-line tagline', () => {
    for (const t of TOWER_TIERS) {
      expect(t.route).toMatch(/^\//)
      expect(t.heading.length).toBeGreaterThan(0)
      expect(t.tagline.length).toBeGreaterThan(0)
      expect(t.tagline.length).toBeLessThan(90)
      expect(t.cards.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('marks the routes that are not built yet', () => {
    const unbuilt = TOWER_TIERS.filter((t) => t.status === 'in-progress')
    expect(unbuilt).toHaveLength(2)
    for (const t of unbuilt) expect(t.badge).toBe('In progress')
  })

  it('gives every tier a valid route and unique ids', () => {
    // Unique ids, not unique routes: two unbuilt storeys legitimately share a
    // fallback destination, so requiring unique routes would forbid honest copy.
    for (const t of TOWER_TIERS) expect(t.route).toMatch(/^\//)
    expect(new Set(TOWER_TIERS.map((t) => t.id)).size).toBe(TOWER_TIERS.length)
  })

  it('points every unbuilt storey at a fallback that exists', () => {
    // The anti-dead-end rule: a storey that is not built must offer somewhere
    // real to go instead.
    const built = new Set(
      TOWER_TIERS.filter((t) => t.status === 'built').map((t) => t.route),
    )
    const unbuilt = TOWER_TIERS.filter((t) => t.status === 'in-progress')
    expect(unbuilt.length).toBeGreaterThan(0)
    for (const t of unbuilt) {
      expect(t.fallbackRoute, `${t.id} has no fallback`).toMatch(/^\//)
      expect(built.has(t.fallbackRoute!), `${t.id} falls back to a dead route`).toBe(true)
    }
  })

  it('gives built storeys no fallback, so the CTA stays a plain link', () => {
    for (const t of TOWER_TIERS) {
      if (t.status === 'built') expect(t.fallbackRoute).toBeUndefined()
    }
  })
})
