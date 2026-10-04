import { describe, expect, it } from 'vitest'
import { mergeCandles } from '../candles'
import type { Candle } from '../../api/types'

function row(time: string, close: number): Candle {
  return { time, open: close - 1, high: close + 1, low: close - 2, close, volume: 10 }
}

describe('mergeCandles', () => {
  it('unions 1y + 5y by time with fresh winning and sorts', () => {
    const oneYear = [row('2025-01-02', 10), row('2025-01-03', 11)]
    const fiveYear = [row('2024-01-05', 9), row('2025-01-03', 12)]

    const merged = mergeCandles(oneYear, fiveYear)

    expect(merged.map((r) => r.time)).toEqual(['2024-01-05', '2025-01-02', '2025-01-03'])
    expect(merged[2].close).toBe(12)
  })

  it('empty incoming keeps current', () => {
    const current = [row('2025-01-02', 10)]
    expect(mergeCandles(current, [])).toEqual(current)
  })
})
