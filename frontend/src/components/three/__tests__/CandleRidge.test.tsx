import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const webgl = vi.hoisted(() => ({ hasWebGL: true, calls: 0 }))

vi.mock('@/lib/webgl', () => ({
  hasWebGL: () => {
    webgl.calls += 1
    return webgl.hasWebGL
  },
}))

vi.mock('@react-three/fiber', () => ({
  Canvas: (props: { frameloop?: string; className?: string }) => (
    <div data-testid="candle-ridge-canvas" data-frameloop={props.frameloop} className={props.className} />
  ),
  useFrame: () => {},
}))

import type { Candle } from '../../api/types'
import {
  barLayout,
  barProgress,
  easeOutCubic,
  normalizeRidge,
  ridgeTones,
  ridgeValues,
  RIDGE_BARS,
} from '../ridgeGeometry'
import { CandleRidge } from '../CandleRidge'

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

function closes(...values: number[]): Candle[] {
  return values.map((close, index) => ({
    time: `2026-01-${String(index + 1).padStart(2, '0')}`,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  }))
}

beforeEach(() => {
  webgl.calls = 0
  webgl.hasWebGL = true
})

afterEach(() => vi.restoreAllMocks())

describe('ridgeValues', () => {
  it('takes the last closes up to the bar budget', () => {
    const candles = closes(...Array.from({ length: 200 }, (_, index) => index))
    const values = ridgeValues(candles)

    expect(values).toHaveLength(RIDGE_BARS)
    expect(values[values.length - 1]).toBe(199)
    expect(values[0]).toBe(200 - RIDGE_BARS)
  })

  it('is empty for no candles', () => {
    expect(ridgeValues([])).toEqual([])
  })
})

describe('normalizeRidge', () => {
  it('normalizes to 0..1 and treats a flat series as mid', () => {
    expect(normalizeRidge([10, 20, 30])).toEqual([0, 0.5, 1])
    expect(normalizeRidge([5, 5, 5])).toEqual([0.5, 0.5, 0.5])
    expect(normalizeRidge([])).toEqual([])
  })
})

describe('ridgeTones', () => {
  it('tones rise with the delta and clamp', () => {
    const climbing = ridgeTones([1, 2, 3, 4])
    const falling = ridgeTones([4, 3, 2, 1])
    const flat = ridgeTones([5, 5, 5])

    expect(climbing[0]).toBe(0.5)
    expect(climbing.slice(1).every((tone) => tone > 0.5)).toBe(true)
    expect(falling.slice(1).every((tone) => tone < 0.5)).toBe(true)
    expect(flat).toEqual([0.5, 0.5, 0.5])
    expect([...climbing, ...falling].every((tone) => tone >= 0 && tone <= 1)).toBe(true)
  })
})

describe('barLayout', () => {
  it('lays bars out centered and non-overlapping', () => {
    const layout = barLayout(4, 4)

    expect(layout).toHaveLength(4)
    expect(layout[0].x).toBeLessThan(0)
    expect(layout[layout.length - 1].x).toBeGreaterThan(0)
    expect(layout.every((bar) => bar.width > 0)).toBe(true)
    expect(layout[0].width).toBeCloseTo(0.72, 10)
    expect(layout[0].x).toBeCloseTo(-1.5, 10)
    expect(barLayout(0, 4)).toEqual([])
  })
})

describe('easeOutCubic', () => {
  it('eases out and clamps', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10)
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(2)).toBe(1)
  })
})

describe('barProgress', () => {
  it('eases out and staggers', () => {
    expect(barProgress(0, 10, 0)).toBe(0)
    expect(barProgress(0, 10, 320)).toBe(1)
    expect(barProgress(5, 10, 0)).toBe(0)
    expect(barProgress(0, 10, 100)).toBeGreaterThan(barProgress(5, 10, 100))
    expect(barProgress(99, 10, 1000)).toBe(1)
  })
})

describe('CandleRidge', () => {
  it('renders a continuous 3D ridge by default', () => {
    mockMedia()
    render(<CandleRidge candles={closes(1, 2, 3, 4)} />)
    expect(screen.getByTestId('candle-ridge-canvas')).toHaveAttribute('data-frameloop', 'always')
    expect(screen.getByTestId('candle-ridge')).toHaveAttribute('aria-hidden', 'true')
  })

  it('freezes to a demand-rendered static pose under reduced motion', () => {
    mockMedia({ reduced: true })
    render(<CandleRidge candles={closes(1, 2, 3, 4)} />)
    expect(screen.getByTestId('candle-ridge-canvas')).toHaveAttribute('data-frameloop', 'demand')
    expect(screen.getByTestId('candle-ridge')).toHaveAttribute('data-reduced', 'true')
  })

  it('renders null below md — no canvas mounted', () => {
    mockMedia({ desktop: false })
    render(<CandleRidge candles={closes(1, 2, 3, 4)} />)
    expect(screen.queryByTestId('candle-ridge-canvas')).not.toBeInTheDocument()
  })

  it('renders null without WebGL', () => {
    webgl.hasWebGL = false
    mockMedia()
    render(<CandleRidge candles={closes(1, 2, 3, 4)} />)
    expect(screen.queryByTestId('candle-ridge')).not.toBeInTheDocument()
  })

  it('renders null with fewer than two candles', () => {
    mockMedia()
    render(<CandleRidge candles={closes(5)} />)
    expect(screen.queryByTestId('candle-ridge')).not.toBeInTheDocument()
  })

  it('probes WebGL once, not on every render', () => {
    mockMedia()
    const { rerender } = render(<CandleRidge candles={closes(1, 2, 3)} />)
    rerender(<CandleRidge candles={closes(4, 5, 6)} />)
    rerender(<CandleRidge candles={closes(7, 8, 9)} />)
    expect(webgl.calls).toBe(1)
  })
})
