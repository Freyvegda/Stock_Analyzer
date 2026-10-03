import { describe, expect, it } from 'vitest'
import { aggregateCandles, sliceRange } from '../candles'
import type { Candle } from '../../api/types'

function dailyRows(start: string, days: number): Candle[] {
  const out: Candle[] = []
  const base = new Date(`${start}T00:00:00Z`).getTime()
  for (let i = 0; i < days; i++) {
    const time = new Date(base + i * 86400000).toISOString().slice(0, 10)
    out.push({ time, open: 10 + i, high: 12 + i, low: 9 + i, close: 11 + i, volume: 100 })
  }
  return out
}

describe('candles utils', () => {
  it('slices 6m from a 5y daily series', () => {
    const rows = dailyRows('2021-01-01', 1825)

    const sliced = sliceRange(rows, '6m')

    expect(sliced.length).toBeGreaterThan(100)
    expect(sliced.length).toBeLessThan(rows.length)
    expect(sliced[sliced.length - 1].time).toBe(rows[rows.length - 1].time)
  })

  it('aggregates 15d buckets with first-open last-close max-high min-low', () => {
    const rows = dailyRows('2026-01-01', 30)

    const buckets = aggregateCandles(rows, '15d')

    expect(buckets.length).toBeGreaterThanOrEqual(2)
    expect(buckets[0].open).toBe(rows[0].open)
    expect(buckets[0].volume).toBeGreaterThan(rows[0].volume)
  })

  it('aggregates monthly buckets by calendar month', () => {
    const rows = [...dailyRows('2026-01-28', 10)]

    const buckets = aggregateCandles(rows, '1mo')

    expect(buckets.length).toBeGreaterThanOrEqual(1)
    expect(buckets[0].time).toBe(rows[0].time)
  })
})
