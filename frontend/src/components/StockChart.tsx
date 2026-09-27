/**
 * lightweight-charts candlestick wrapper (FRONTEND.md contract: {candles, markers?}).
 *
 * Phase 3 only passes markers; Phase 1.6 renders candles alone. Colours come from
 * `chartPalette` — no hex literals here. jsdom has no ResizeObserver, so the width
 * sync is guarded.
 */

import { useEffect, useRef } from 'react'
import { CandlestickSeries, createChart, createSeriesMarkers } from 'lightweight-charts'
import { useColorMode } from '@/components/ui/color-mode'
import { chartPalette } from '@/theme/tokens'
import type { Candle, ChartMarker } from '../api/types'

const CHART_HEIGHT = 320

export function StockChart({ candles, markers }: { candles: Candle[]; markers?: ChartMarker[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { colorMode } = useColorMode()
  const palette = chartPalette[colorMode === 'dark' ? 'dark' : 'light']

  useEffect(() => {
    const container = containerRef.current
    if (container === null || candles.length === 0) return

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
    series.setData(
      candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
    )
    if (markers !== undefined && markers.length > 0) {
      createSeriesMarkers(
        series,
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
    chart.timeScale().fitContent()

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
    }
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
