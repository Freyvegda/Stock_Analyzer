import { render, screen } from '@testing-library/react'
import type { CSSProperties } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const webgl = vi.hoisted(() => ({ hasWebGL: true, calls: 0 }))

vi.mock('@/lib/webgl', () => ({
  hasWebGL: () => {
    webgl.calls += 1
    return webgl.hasWebGL
  },
}))

vi.mock('@react-three/fiber', () => ({
  Canvas: (props: { frameloop?: string; className?: string; style?: CSSProperties }) => (
    <div
      data-testid="sakura-leaf-canvas"
      data-frameloop={props.frameloop}
      className={props.className}
      style={props.style}
    />
  ),
  useFrame: () => {},
}))

import {
  candleOffset,
  candleSlots,
  CANDLE_SPACING,
  GUST_AMPLITUDE,
  LEAF_ANCHOR_X,
  LEAF_HALF_WIDTH,
  leafHalfWidth,
  leafOutline,
  leafPose,
  leafSurfaceZ,
  lighterTone,
  OUTLINE_SEGMENTS,
  PRICE_RANGE,
  PRICE_TO_WORLD,
  priceCurve,
  SURGE_AMPLITUDE,
  SWAY_AMPLITUDE,
  TAPE_SPAN,
  tapeFade,
  WIND_SPEED,
  windDistance,
} from '../leafTrace'
import { SakuraLeafLoader } from '../SakuraLeafLoader'

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
})

afterEach(() => vi.restoreAllMocks())

describe('leafHalfWidth', () => {
  it('is a point at the base and the tip', () => {
    expect(leafHalfWidth(0)).toBeCloseTo(0, 10)
    expect(leafHalfWidth(1)).toBeCloseTo(0, 10)
  })

  it('is widest through the middle of the blade', () => {
    expect(leafHalfWidth(0.5)).toBeGreaterThan(leafHalfWidth(0.1))
    expect(leafHalfWidth(0.5)).toBeGreaterThan(leafHalfWidth(0.9))
  })

  it('never exceeds the half-width budget', () => {
    for (let step = 0; step <= 100; step += 1) {
      const width = leafHalfWidth(step / 100)
      expect(width).toBeGreaterThanOrEqual(0)
      expect(width).toBeLessThanOrEqual(LEAF_HALF_WIDTH + 1e-9)
    }
  })
})

describe('leafOutline', () => {
  it('loops both sides of the blade and stays inside the profile', () => {
    const outline = leafOutline()
    expect(outline).toHaveLength(OUTLINE_SEGMENTS * 2)
    const upper = outline.slice(0, OUTLINE_SEGMENTS + 1)
    const lower = outline.slice(OUTLINE_SEGMENTS + 1)
    expect(upper.every((point) => point.y >= -1e-9)).toBe(true)
    expect(lower.every((point) => point.y < 0)).toBe(true)
    expect(upper[0].x).toBeCloseTo(-1, 10)
    expect(upper[upper.length - 1].x).toBeCloseTo(1, 10)
    for (const point of outline) {
      const u = (point.x + 1) / 2
      expect(Math.abs(point.y)).toBeLessThanOrEqual(leafHalfWidth(u) + 1e-9)
    }
  })
})

describe('leafSurfaceZ', () => {
  it('is a ridge along the midrib', () => {
    expect(leafSurfaceZ(0, 0.05)).toBeLessThan(leafSurfaceZ(0, 0))
    expect(leafSurfaceZ(-0.2, 0.1)).toBeCloseTo(leafSurfaceZ(-0.2, -0.1), 10)
  })

  it('stays shallow enough to read as a low-poly curl', () => {
    for (let step = -5; step <= 5; step += 1) {
      expect(Math.abs(leafSurfaceZ(step / 10, step / 20))).toBeLessThan(0.1)
    }
  })
})

describe('priceCurve', () => {
  it('stays within the quoted range', () => {
    for (let step = 0; step <= 200; step += 1) {
      expect(Math.abs(priceCurve(step / 20))).toBeLessThanOrEqual(PRICE_RANGE + 1e-9)
    }
  })

  it('is deterministic and both rises and falls', () => {
    expect(priceCurve(1.234)).toBe(priceCurve(1.234))
    let rises = 0
    let falls = 0
    for (let step = 1; step <= 200; step += 1) {
      const delta = priceCurve(step / 20) - priceCurve((step - 1) / 20)
      if (delta > 1e-6) rises += 1
      if (delta < -1e-6) falls += 1
    }
    expect(rises).toBeGreaterThan(10)
    expect(falls).toBeGreaterThan(10)
  })
})

describe('windDistance', () => {
  it('starts at zero and is carried by the wind without ever reversing', () => {
    expect(windDistance(0)).toBeCloseTo(0, 10)
    for (let step = 1; step <= 160; step += 1) {
      expect(windDistance(step / 8)).toBeGreaterThan(windDistance((step - 1) / 8))
    }
  })

  it('never drifts further than the gust amplitude from the steady wind', () => {
    for (let step = 0; step <= 100; step += 1) {
      const t = step / 10
      expect(Math.abs(windDistance(t) - WIND_SPEED * t)).toBeLessThanOrEqual(GUST_AMPLITUDE + 1e-9)
    }
  })
})

describe('leafPose', () => {
  it('sways around its anchor and rides the price curve it draws', () => {
    for (let step = 0; step <= 120; step += 1) {
      const pose = leafPose(step / 10)
      expect(Math.abs(pose.x - LEAF_ANCHOR_X)).toBeLessThanOrEqual(
        SWAY_AMPLITUDE + SURGE_AMPLITUDE + 1e-9,
      )
      expect(Math.abs(pose.y)).toBeLessThanOrEqual(PRICE_RANGE * PRICE_TO_WORLD + 1e-9)
    }
  })

  it('tilts its nose into the climb: bank follows the slope sign', () => {
    let climbing = 0
    let diving = 0
    for (let step = 0; step <= 400; step += 1) {
      const pose = leafPose(step / 20)
      if (Math.abs(pose.slope) < 1e-6) continue
      expect(Math.sign(pose.bank)).toBe(Math.sign(pose.slope))
      if (pose.slope > 0) climbing += 1
      if (pose.slope < 0) diving += 1
    }
    expect(climbing).toBeGreaterThan(10)
    expect(diving).toBeGreaterThan(10)
  })
})

describe('candleSlots', () => {
  it('returns a full tape of contiguous candles', () => {
    const slots = candleSlots(4)
    expect(slots).toHaveLength(slots.length)
    expect(slots.length).toBeGreaterThan(10)
    for (let index = 0; index < slots.length - 1; index += 1) {
      expect(slots[index].open).toBeCloseTo(slots[index + 1].close, 10)
      expect(slots[index + 1].index).toBe(slots[index].index - 1)
    }
  })

  it('wraps every candle around its own body', () => {
    for (const slot of candleSlots(4)) {
      expect(slot.high).toBeGreaterThanOrEqual(Math.max(slot.open, slot.close) - 1e-9)
      expect(slot.low).toBeLessThanOrEqual(Math.min(slot.open, slot.close) + 1e-9)
    }
  })

  it('brightens climbing candles and dims falling ones on the brand ladder', () => {
    let rising = 0
    let falling = 0
    for (const slot of candleSlots(6)) {
      expect(slot.tone).toBeGreaterThanOrEqual(0)
      expect(slot.tone).toBeLessThanOrEqual(1)
      if (slot.close > slot.open) {
        rising += 1
        expect(slot.tone).toBeGreaterThan(0.5)
      }
      if (slot.close < slot.open) {
        falling += 1
        expect(slot.tone).toBeLessThan(0.5)
      }
    }
    expect(rising + falling).toBeGreaterThan(10)
  })

  it('is deterministic for a frontier', () => {
    expect(candleSlots(4)).toEqual(candleSlots(4))
  })
})

describe('candleOffset', () => {
  it('measures how far behind the leaf a candle trails', () => {
    expect(candleOffset(47, 4, CANDLE_SPACING)).toBeCloseTo(0.005, 10)
    expect(candleOffset(46, 4, CANDLE_SPACING)).toBeCloseTo(0.09, 10)
    expect(candleOffset(30, 4, CANDLE_SPACING)).toBeGreaterThan(candleOffset(40, 4, CANDLE_SPACING))
  })
})

describe('tapeFade', () => {
  it('is full at the leaf and gone past the tail', () => {
    expect(tapeFade(0, TAPE_SPAN)).toBeCloseTo(1, 10)
    expect(tapeFade(TAPE_SPAN, TAPE_SPAN)).toBeCloseTo(0, 10)
    expect(tapeFade(TAPE_SPAN * 2, TAPE_SPAN)).toBeCloseTo(0, 10)
  })

  it('fades monotonically down the tape', () => {
    let previous = 1
    for (let step = 0; step <= 40; step += 1) {
      const value = tapeFade((step / 40) * TAPE_SPAN, TAPE_SPAN)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
      expect(value).toBeLessThanOrEqual(previous + 1e-9)
      previous = value
    }
  })
})

describe('lighterTone', () => {
  it('returns the lighter of the two tones', () => {
    expect(lighterTone('#F2EAF0', '#0C080B')).toBe('#F2EAF0')
    expect(lighterTone('#0C080B', '#F2EAF0')).toBe('#F2EAF0')
  })

  it('picks the near-black pole out of the light-mode pair', () => {
    expect(lighterTone('#1A1116', '#FBF6F8')).toBe('#FBF6F8')
    expect(lighterTone('#FBF6F8', '#1A1116')).toBe('#FBF6F8')
  })

  it('treats equal tones as the first argument', () => {
    expect(lighterTone('#FFA9C6', '#FFA9C6')).toBe('#FFA9C6')
  })
})

describe('SakuraLeafLoader', () => {
  it('announces loading with an sr-only label', () => {
    mockMedia()
    render(<SakuraLeafLoader label="Running screen…" />)
    expect(screen.getByRole('status')).toHaveTextContent('Running screen…')
  })

  it('renders a continuous 3D loop by default', () => {
    mockMedia()
    render(<SakuraLeafLoader />)
    expect(screen.getByTestId('sakura-leaf-canvas')).toHaveAttribute('data-frameloop', 'always')
  })

  it('freezes to a demand-rendered static frame under reduced motion', () => {
    mockMedia({ reduced: true })
    render(<SakuraLeafLoader />)
    expect(screen.getByTestId('sakura-leaf-canvas')).toHaveAttribute('data-frameloop', 'demand')
    expect(screen.getByTestId('sakura-leaf-loader')).toHaveAttribute('data-reduced', 'true')
  })

  it('renders only the vault pulse below md — no canvas mounted', () => {
    mockMedia({ desktop: false })
    render(<SakuraLeafLoader />)
    expect(screen.getByTestId('vault-pulse')).toBeInTheDocument()
    expect(screen.queryByTestId('sakura-leaf-canvas')).not.toBeInTheDocument()
  })

  it('falls back to the vault pulse ring without WebGL', () => {
    webgl.hasWebGL = false
    mockMedia()
    render(<SakuraLeafLoader />)
    expect(screen.getByTestId('vault-pulse')).toBeInTheDocument()
    expect(screen.queryByTestId('sakura-leaf-canvas')).not.toBeInTheDocument()
  })

  it('probes WebGL once, not on every render', () => {
    mockMedia()
    const { rerender } = render(<SakuraLeafLoader label="first" />)
    rerender(<SakuraLeafLoader label="second" />)
    rerender(<SakuraLeafLoader label="third" />)
    expect(webgl.calls).toBe(1)
  })
})
