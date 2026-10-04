/**
 * lightweight-charts candlestick wrapper (FRONTEND.md contract: {candles, markers?}).
 *
 * The chart instance is created once and updated in place: data changes call
 * `series.setData` and theme flips call `applyOptions` — the instance is
 * never destroyed on prop changes, only on unmount. Colours come from
 * `chartPalette` — no hex literals here. jsdom has no ResizeObserver, so the
 * width sync is guarded.
 */

import { useEffect, useRef } from 'react'
import { CandlestickSeries, createChart, createSeriesMarkers } from 'lightweight-charts'
import { useColorMode } from '@/components/ui/color-mode'
import { chartPalette } from '@/theme/tokens'
import type { Candle, ChartMarker } from '../api/types'

const CHART_HEIGHT = 320

export function StockChart({ candles, markers }: { candles: Candle[]; markers?: ChartMarker[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null)
  const { colorMode } = useColorMode()
  const palette = chartPalette[colorMode === 'dark' ? 'dark' : 'light']

  const hasData = candles.length > 0
  useEffect(() => {
    const container = containerRef.current
    if (container === null || !hasData) return
    if (chartRef.current !== null) return

    const chart = createChart(container, {
      height: CHART_HEIGHT,
      layout: { background: { color: 'transparent' }, attributionLogo: false },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.grid },
      timeScale: { borderColor: palette.grid },
      crosshair: { vertLine: { color: palette.crosshair }, horzLine: { color: palette.crosshair } },
    })
    const series = chart.addSeries(CandlestickSeries, {
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
  }, [hasData])

  useEffect(() => {
    if (chartRef.current === null || seriesRef.current === null) return
    chartRef.current.applyOptions({
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.grid },
      timeScale: { borderColor: palette.grid },
      crosshair: { vertLine: { color: palette.crosshair }, horzLine: { color: palette.crosshair } },
    })
    seriesRef.current.applyOptions({
      upColor: palette.candleUp,
      downColor: palette.candleDown,
      borderVisible: false,
      wickUpColor: palette.candleUp,
      wickDownColor: palette.candleDown,
    })
  }, [palette])

  useEffect(() => {
    if (chartRef.current === null || seriesRef.current === null || candles.length === 0) return
    seriesRef.current.setData(
      candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
    )
    if (markers !== undefined && markers.length > 0) {
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
  }, [candles, markers, palette])

  if (candles.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No price data
      </div>
    )
  }

  return <div ref={containerRef} data-testid="stock-chart" className="h-80 w-full" />
}
