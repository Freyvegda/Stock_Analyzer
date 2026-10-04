import { render } from '@testing-library/react'
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
    LineSeries: { sentinel: 'line' },
  }
})

vi.mock('lightweight-charts', () => ({
  createChart: lw.createChart,
  createSeriesMarkers: lw.createSeriesMarkers,
  CandlestickSeries: lw.CandlestickSeries,
  LineSeries: lw.LineSeries,
}))

import { StockChart } from '../StockChart'

const CLOSE_ONLY: Candle[] = [
  { time: '2026-01-02', open: Number.NaN, high: Number.NaN, low: Number.NaN, close: 1.5, volume: 100 },
  { time: '2026-01-03', open: Number.NaN, high: Number.NaN, low: Number.NaN, close: 2.0, volume: 120 },
]

beforeEach(() => {
  vi.clearAllMocks()
  state.colorMode = 'light'
})

describe('StockChart line fallback', () => {
  it('renders a line series from closes when OHLC is unusable', () => {
    render(<StockChart candles={CLOSE_ONLY} />)

    expect(lw.createChart).toHaveBeenCalledTimes(1)
    expect(lw.chart.addSeries).toHaveBeenCalledWith(lw.LineSeries, expect.anything())
    expect(lw.series.setData).toHaveBeenCalledWith([
      { time: '2026-01-02', value: 1.5 },
      { time: '2026-01-03', value: 2.0 },
    ])
  })
})
