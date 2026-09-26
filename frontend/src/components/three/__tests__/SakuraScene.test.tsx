import { render, screen } from '@testing-library/react'
import type { CSSProperties } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const webgl = vi.hoisted(() => ({ hasWebGL: true, calls: 0 }))
const mode = vi.hoisted(() => ({ colorMode: 'dark' as string }))

vi.mock('@/lib/webgl', () => ({
  hasWebGL: () => {
    webgl.calls += 1
    return webgl.hasWebGL
  },
}))

vi.mock('@/components/ui/color-mode', () => ({
  useColorMode: () => ({
    colorMode: mode.colorMode,
    setColorMode: vi.fn(),
    toggleColorMode: vi.fn(),
  }),
}))

vi.mock('@react-three/fiber', () => ({
  Canvas: (props: { frameloop?: string; className?: string; style?: CSSProperties }) => (
    <div data-testid="sakura-canvas" data-frameloop={props.frameloop} className={props.className} />
  ),
  useFrame: () => {},
  useThree: () => ({ viewport: { width: 10, height: 6.3 } }),
}))

import {
  buildTree,
  mulberry32,
  PETAL_COUNT,
  PETAL_SPAN,
  petalPose,
  petalSeeds,
  TREE_LIMITS,
  treeBounds,
  treePlacement,
  withAlpha,
} from '../sakuraTree'
import { SakuraScene } from '../SakuraScene'

function mockMedia({ reduced = false, desktop = true }: { reduced?: boolean; desktop?: boolean } = {}) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('min-width') ? desktop : reduced,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  )
}

beforeEach(() => {
  webgl.calls = 0
  webgl.hasWebGL = true
  mode.colorMode = 'dark'
})

afterEach(() => vi.restoreAllMocks())

describe('mulberry32', () => {
  it('is deterministic and stays in [0, 1)', () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    for (let i = 0; i < 50; i += 1) {
      const value = a()
      expect(value).toBe(b())
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('buildTree', () => {
  it('keeps the blossom canopy above the petal band', () => {
    const tree = buildTree()
    const canopyTop = Math.max(...tree.blossoms.map((blossom) => blossom.position[1] + blossom.size))
    const canopyWidth = Math.max(...tree.blossoms.map((blossom) => Math.abs(blossom.position[0])))
    // Petals fall from inside the lower canopy: the dome always reads on top.
    expect(canopyTop).toBeGreaterThan(PETAL_SPAN.maxY)
    expect(canopyWidth).toBeGreaterThan(1)
  })

  it('is deterministic for a seed and differs across seeds', () => {
    expect(buildTree(11)).toEqual(buildTree(11))
    expect(buildTree(11)).not.toEqual(buildTree(12))
  })

  it('stays inside the instance budget', () => {
    const tree = buildTree()
    expect(tree.segments.length).toBeGreaterThan(8)
    expect(tree.segments.length).toBeLessThanOrEqual(TREE_LIMITS.maxSegments)
    expect(tree.blossoms.length).toBeGreaterThan(8)
    expect(tree.blossoms.length).toBeLessThanOrEqual(TREE_LIMITS.maxBlossoms)
  })

  it('keeps every branch finite, positive-radius and tapering outward', () => {
    const tree = buildTree()
    for (const segment of tree.segments) {
      for (const value of [...segment.start, ...segment.end, segment.radius]) {
        expect(Number.isFinite(value)).toBe(true)
      }
      expect(segment.radius).toBeGreaterThan(0)
      expect(segment.depth).toBeGreaterThanOrEqual(0)
    }
    const trunk = tree.segments.filter((segment) => segment.depth === 0)
    const tips = tree.segments.filter((segment) => segment.depth === TREE_LIMITS.maxDepth)
    const maxTrunk = Math.max(...trunk.map((segment) => segment.radius))
    const maxTip = Math.max(...tips.map((segment) => segment.radius))
    expect(maxTrunk).toBeGreaterThan(maxTip)
  })

  it('keeps branches and blossoms inside the local bounds', () => {
    const tree = buildTree()
    for (const segment of tree.segments) {
      for (const point of [segment.start, segment.end]) {
        expect(Math.abs(point[0])).toBeLessThanOrEqual(TREE_LIMITS.halfWidth)
        expect(Math.abs(point[2])).toBeLessThanOrEqual(TREE_LIMITS.halfWidth)
        expect(point[1]).toBeLessThanOrEqual(TREE_LIMITS.maxHeight)
      }
    }
    for (const blossom of tree.blossoms) {
      expect(Math.abs(blossom.position[0])).toBeLessThanOrEqual(TREE_LIMITS.halfWidth)
      expect(blossom.size).toBeGreaterThan(0)
    }
    expect(tree.height).toBeGreaterThan(1.5)
  })
})

describe('treeBounds', () => {
  it('describes a broad, dense blossom dome on a visible trunk', () => {
    const tree = buildTree()
    const bounds = treeBounds(tree)
    const width = bounds.maxX - bounds.minX
    const height = bounds.maxY - bounds.minY
    expect(height).toBeGreaterThan(3.2)
    expect(width).toBeGreaterThan(2.8)
    // Reference silhouette: a canopy wider than it is tall, not a column.
    expect(width / height).toBeGreaterThan(0.65)
    expect(bounds.minY).toBeLessThan(-0.8)
    // Dense flowers: the canopy is blossom, not bare branch.
    expect(tree.blossoms.length).toBeGreaterThan(400)
  })
})

describe('treePlacement', () => {
  // World units per CSS pixel = viewport width / css width; the tests use the same
  // 16:9 world/camera the scene uses (fov 35 at z=10 → 6.31 world units tall).
  const cases = [
    { cssWidth: 768, cssHeight: 720 },
    { cssWidth: 1024, cssHeight: 768 },
    { cssWidth: 1536, cssHeight: 720 },
    { cssWidth: 1920, cssHeight: 1080 },
    { cssWidth: 2560, cssHeight: 1440 },
  ]

  it('runs the tree down most of the right edge', () => {
    const bounds = treeBounds(buildTree())
    for (const { cssWidth, cssHeight } of cases) {
      const worldHeight = 6.31
      const worldWidth = (worldHeight * cssWidth) / cssHeight
      const layout = treePlacement(bounds, {
        width: worldWidth,
        height: worldHeight,
        cssWidth,
      })
      const top = layout.position[1] + layout.scale * bounds.maxY
      const bottom = layout.position[1] + layout.scale * bounds.minY
      // The trunk sits on the bottom edge and the canopy reaches up the right side.
      expect(bottom).toBeLessThan(-worldHeight / 2)
      expect(top - bottom).toBeGreaterThan(worldHeight * 0.7)
    }
  })

  it('aims the clearance line at the real card edge', () => {
    const bounds = treeBounds(buildTree())
    const worldHeight = 6.31
    // 1536×720 desktop: the card occupies 832–1280px of a 1536px viewport.
    const worldWidth = (worldHeight * 1536) / 720
    const layout = treePlacement(bounds, { width: worldWidth, height: worldHeight, cssWidth: 1536 })
    expect(layout.cardRight).toBeCloseTo((1280 / 1536 - 0.5) * worldWidth, 4)
    // The tree starts to the right of it, by roughly the 24px gap.
    expect(layout.treeLeft - layout.cardRight).toBeCloseTo((24 / 1536) * worldWidth, 4)
  })

  it('keeps the tree clear of the auth card at every width', () => {
    const bounds = treeBounds(buildTree())
    for (const { cssWidth, cssHeight } of cases) {
      const worldHeight = 6.31
      const worldWidth = (worldHeight * cssWidth) / cssHeight
      const layout = treePlacement(bounds, {
        width: worldWidth,
        height: worldHeight,
        cssWidth,
      })
      expect(layout.treeLeft).toBeGreaterThanOrEqual(layout.cardRight)
      // …and both are inside the frame: a tree pushed off the right edge would satisfy
      // the clearance check while showing nothing.
      expect(layout.treeLeft).toBeLessThan(worldWidth / 2)
      expect(layout.cardRight).toBeLessThan(worldWidth / 2)
      expect(layout.cardRight).toBeGreaterThan(-worldWidth / 2)
    }
  })
})

describe('petalSeeds', () => {
  it('is deterministic and capped', () => {
    const seeds = petalSeeds(3)
    expect(seeds).toEqual(petalSeeds(3))
    expect(seeds.length).toBe(PETAL_COUNT)
    expect(seeds.length).toBeLessThanOrEqual(TREE_LIMITS.maxPetals)
  })

  it('gives every petal a positive fall speed and finite parameters', () => {
    for (const seed of petalSeeds()) {
      expect(seed.fallSpeed).toBeGreaterThan(0)
      for (const value of [
        ...seed.origin,
        ...seed.spinAxis,
        seed.spinSpeed,
        seed.swayAmp,
        seed.swayPhase,
        seed.swaySpeed,
        seed.scale,
        seed.yPhase,
      ]) {
        expect(Number.isFinite(value)).toBe(true)
      }
      expect(seed.scale).toBeGreaterThan(0)
    }
  })
})

describe('petalPose', () => {
  it('is deterministic and bounded across a long fall', () => {
    const seeds = petalSeeds(5)
    for (const seed of seeds.slice(0, 12)) {
      for (let time = 0; time < 120; time += 0.37) {
        const pose = petalPose(seed, time)
        for (const value of [pose.x, pose.y, pose.z, pose.rx, pose.ry, pose.rz]) {
          expect(Number.isFinite(value)).toBe(true)
        }
        expect(pose.y).toBeLessThanOrEqual(PETAL_SPAN.maxY + 1e-9)
        expect(pose.y).toBeGreaterThanOrEqual(PETAL_SPAN.minY - 1e-9)
        expect(Math.abs(pose.x)).toBeLessThanOrEqual(PETAL_SPAN.maxX)
      }
    }
    const seed = seeds[0]
    expect(petalPose(seed, 1.25)).toEqual(petalPose(seed, 1.25))
    expect(petalPose(seed, 0)).not.toEqual(petalPose(seed, 1.25))
  })

  it('wraps a petal back to the canopy after one full fall', () => {
    const seed = petalSeeds(9)[0]
    const period = (PETAL_SPAN.maxY - PETAL_SPAN.minY) / seed.fallSpeed
    // Only the fall wraps: the sway keeps its own phase so petals never trace the
    // same path twice.
    expect(petalPose(seed, 2 + period).y).toBeCloseTo(petalPose(seed, 2).y, 9)
    expect(petalPose(seed, 2 + period).ry).not.toBeCloseTo(petalPose(seed, 2).ry, 3)
  })
})

describe('withAlpha', () => {
  it('converts a token hex into an rgba() string', () => {
    expect(withAlpha('#04060B', 0.4)).toBe('rgba(4, 6, 11, 0.4)')
    expect(withAlpha('#F3E2CE', 1)).toBe('rgba(243, 226, 206, 1)')
  })
})

describe('SakuraScene gates', () => {
  it('renders a continuous loop by default', () => {
    mockMedia()
    render(<SakuraScene />)
    expect(screen.getByTestId('sakura-canvas')).toHaveAttribute('data-frameloop', 'always')
  })

  it('freezes to a demand-rendered frame under reduced motion', () => {
    mockMedia({ reduced: true })
    render(<SakuraScene />)
    expect(screen.getByTestId('sakura-scene')).toHaveAttribute('data-reduced', 'true')
    expect(screen.getByTestId('sakura-canvas')).toHaveAttribute('data-frameloop', 'demand')
  })

  it('renders the CSS fallback below md — no canvas mounted', () => {
    mockMedia({ desktop: false })
    render(<SakuraScene />)
    expect(screen.getByTestId('sakura-fallback')).toBeInTheDocument()
    expect(screen.queryByTestId('sakura-canvas')).not.toBeInTheDocument()
  })

  it('renders the CSS fallback without WebGL', () => {
    webgl.hasWebGL = false
    mockMedia()
    render(<SakuraScene />)
    expect(screen.getByTestId('sakura-fallback')).toBeInTheDocument()
    expect(screen.queryByTestId('sakura-canvas')).not.toBeInTheDocument()
  })

  it('probes WebGL once, not on every render', () => {
    mockMedia()
    const { rerender } = render(<SakuraScene />)
    rerender(<SakuraScene />)
    rerender(<SakuraScene />)
    expect(webgl.calls).toBe(1)
  })

  it('picks the moon at night and the sun in the day scene', () => {
    mockMedia()
    const { rerender } = render(<SakuraScene />)
    expect(screen.getByTestId('sakura-scene')).toHaveAttribute('data-celestial', 'moon')
    mode.colorMode = 'light'
    rerender(<SakuraScene />)
    expect(screen.getByTestId('sakura-scene')).toHaveAttribute('data-celestial', 'sun')
  })

  it('stays decorative: aria-hidden, pointer-events-none, behind content', () => {
    mockMedia()
    render(<SakuraScene />)
    const scene = screen.getByTestId('sakura-scene')
    expect(scene).toHaveAttribute('aria-hidden', 'true')
    expect(scene.className).toContain('pointer-events-none')
    expect(scene.className).toContain('fixed')
  })
})

describe('fallback petals', () => {
  it('renders only in the DOM fallback', () => {
    mockMedia({ desktop: false })
    render(<SakuraScene />)
    expect(screen.getAllByTestId('sakura-fallback-petal').length).toBeGreaterThan(3)
  })
})
