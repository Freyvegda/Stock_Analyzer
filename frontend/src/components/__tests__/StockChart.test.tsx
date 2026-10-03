import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Candle } from '../../api/types'

const state = vi.hoisted(() => ({ colorMode: 'light' as string }))

vi.mock('@/components/ui/color-mode', () => ({
  useColorMode: () => ({ colorMode: state.colorMode }),
}))

const lw = vi.hoisted(() => {
  const series = { setData: vi.fn(), applyOptions: vi.fn() }
  const chart = {
    addSeries: vi.fn((..._args: unknown[]) => series),
    applyOptions: vi.fn(),
    remove: vi.fn(),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
  }
  return {
    series,
    chart,
    createChart: vi.fn((..._args: unknown[]) => chart),
    createSeriesMarkers: vi.fn((..._args: unknown[]) => undefined),
    CandlestickSeries: { sentinel: 'candlestick' },
  }
})

vi.mock('lightweight-charts', () => ({
  createChart: lw.createChart,
  createSeriesMarkers: lw.createSeriesMarkers,
  CandlestickSeries: lw.CandlestickSeries,
}))

import { chartPalette } from '@/theme/tokens'
import { StockChart } from '../StockChart'

const CANDLES: Candle[] = [
  { time: '2026-01-02', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
  { time: '2026-01-03', open: 1.5, high: 2.5, low: 1.4, close: 2.0, volume: 120 },
]

beforeEach(() => {
  vi.clearAllMocks()
  state.colorMode = 'light'
})

describe('StockChart', () => {
  it('creates a chart and sets candle data in order', () => {
    render(<StockChart candles={CANDLES} />)

    expect(lw.createChart).toHaveBeenCalledTimes(1)
    expect(lw.chart.addSeries).toHaveBeenCalledTimes(1)
    expect(lw.series.setData).toHaveBeenCalledWith([
      { time: '2026-01-02', open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: '2026-01-03', open: 1.5, high: 2.5, low: 1.4, close: 2.0 },
    ])
  })

  it('applies buy/sell markers only when provided', () => {
    const { rerender } = render(<StockChart candles={CANDLES} />)
    expect(lw.createSeriesMarkers).not.toHaveBeenCalled()

    rerender(<StockChart candles={CANDLES} markers={[{ time: '2026-01-03', kind: 'sell' }]} />)

    expect(lw.createSeriesMarkers).toHaveBeenCalledTimes(1)
    const [series, markers] = lw.createSeriesMarkers.mock.calls[0] as unknown as [
      unknown,
      { time: string; position: string; shape: string; color: string }[],
    ]
    expect(series).toBe(lw.series)
    expect(markers[0]).toMatchObject({
      time: '2026-01-03',
      position: 'aboveBar',
      shape: 'arrowDown',
      color: chartPalette.light.candleDown,
    })
  })

  it('removes the chart on unmount', () => {
    const { unmount } = render(<StockChart candles={CANDLES} />)
    unmount()
    expect(lw.chart.remove).toHaveBeenCalledTimes(1)
  })

  it('renders an empty state without creating a chart', () => {
    render(<StockChart candles={[]} />)
    expect(screen.getByText('No price data')).toBeInTheDocument()
    expect(lw.createChart).not.toHaveBeenCalled()
  })

  it('re-applies the palette when the color mode flips', () => {
    const { rerender } = render(<StockChart candles={CANDLES} />)
    state.colorMode = 'dark'
    rerender(<StockChart candles={CANDLES} />)

    expect(lw.createChart).toHaveBeenCalledTimes(1)
    expect(lw.chart.applyOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        grid: {
          vertLines: { color: chartPalette.dark.grid },
          horzLines: { color: chartPalette.dark.grid },
        },
      }),
    )
    expect(lw.series.applyOptions).toHaveBeenCalledWith(
      expect.objectContaining({ upColor: chartPalette.dark.candleUp }),
    )
  })

  it('updates data without recreating the chart', () => {
    const more = [...CANDLES, { ...CANDLES[1], time: '2026-01-04' }]
    const { rerender } = render(<StockChart candles={CANDLES} />)
    rerender(<StockChart candles={more} />)

    expect(lw.createChart).toHaveBeenCalledTimes(1)
    expect(lw.series.setData).toHaveBeenCalledTimes(2)
  })
})
