/**
 * lightweight-charts wrapper (FRONTEND.md contract: {candles, markers?}).
 *
 * Candles first, line fallback: when OHLC legs are unusable but closes
 * exist (partial upstream rows), the same chart renders a LineSeries of
 * closes so the user still sees price instead of an error. Colours come
 * from `chartPalette` — no hex literals here.
 *
 * The chart instance is created once and updated in place: data changes call
 * `series.setData` and theme flips call `applyOptions` — the instance is
 * never destroyed on prop changes, only on unmount. jsdom has no
 * ResizeObserver, so the width sync is guarded.
 */

import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts'
import { useColorMode } from '@/components/ui/color-mode'
import { chartPalette } from '@/theme/tokens'
import type { Candle, ChartMarker } from '../api/types'

const CHART_HEIGHT = 320

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Candles need all four legs; closes-only rows fall back to a line. */
export function canRenderCandles(candles: Candle[]): boolean {
  if (candles.length === 0) return false
  return candles.every(
    (candle) =>
      isFiniteNumber(candle.open) &&
      isFiniteNumber(candle.high) &&
      isFiniteNumber(candle.low) &&
      isFiniteNumber(candle.close),
  )
}

export function StockChart({ candles, markers }: { candles: Candle[]; markers?: ChartMarker[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null)
  const { colorMode } = useColorMode()
  const palette = chartPalette[colorMode === 'dark' ? 'dark' : 'light']

  const hasData = candles.length > 0
  const useLine = hasData && !canRenderCandles(candles)
  useEffect(() => {
    const container = containerRef.current
    if (container === null || !hasData) return
    if (chartRef.current !== null) return

    const chart = createChart(container, {
      height: CHART_HEIGHT,
      layout: {
        background: { color: 'transparent' },
        attributionLogo: false,
        textColor: palette.axisText,
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.axisBorder, textColor: palette.axisText },
      timeScale: { borderColor: palette.axisBorder },
      crosshair: { vertLine: { color: palette.crosshair }, horzLine: { color: palette.crosshair } },
    })
    const series = useLine
      ? chart.addSeries(LineSeries, { color: palette.strategy, lineWidth: 2 })
      : chart.addSeries(CandlestickSeries, {
          upColor: palette.candleUp,
          downColor: palette.candleDown,
          borderVisible: false,
          wickUpColor: palette.candleUp,
          wickDownColor: palette.candleDown,
        })
    chartRef.current = chart
    seriesRef.current = series

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        chart.applyOptions({ width: container.clientWidth })
      })
      observer.observe(container)
    }

    return () => {
      observer?.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, useLine])

  useEffect(() => {
    if (chartRef.current === null || seriesRef.current === null) return
    chartRef.current.applyOptions({
      layout: { textColor: palette.axisText },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.axisBorder, textColor: palette.axisText },
      timeScale: { borderColor: palette.axisBorder },
      crosshair: { vertLine: { color: palette.crosshair }, horzLine: { color: palette.crosshair } },
    })
    if (useLine) {
      seriesRef.current.applyOptions({ color: palette.strategy, lineWidth: 2 })
    } else {
      seriesRef.current.applyOptions({
        upColor: palette.candleUp,
        downColor: palette.candleDown,
        borderVisible: false,
        wickUpColor: palette.candleUp,
        wickDownColor: palette.candleDown,
      })
    }
  }, [palette, useLine])

  useEffect(() => {
    if (chartRef.current === null || seriesRef.current === null || candles.length === 0) return
    if (useLine) {
      seriesRef.current.setData(candles.map(({ time, close }) => ({ time, value: close })))
    } else {
      seriesRef.current.setData(
        candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
      )
    }
    if (!useLine && markers !== undefined && markers.length > 0) {
      createSeriesMarkers(
        seriesRef.current,
        markers.map((marker) =>
          marker.kind === 'buy'
            ? {
                time: marker.time,
                position: 'belowBar',
                shape: 'arrowUp',
                color: palette.candleUp,
              }
            : {
                time: marker.time,
                position: 'aboveBar',
                shape: 'arrowDown',
                color: palette.candleDown,
              },
        ),
      )
    }
    chartRef.current.timeScale().fitContent()
  }, [candles, markers, palette, useLine])

  if (candles.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No price data
      </div>
    )
  }

  return <div ref={containerRef} data-testid="stock-chart" className="h-80 w-full" />
}
