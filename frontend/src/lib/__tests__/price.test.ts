import { describe, expect, it } from 'vitest'
import { getLatestPrice } from '../price'
import type { Candle } from '../../api/types'

function candle(time: string, close: number, extra: Partial<Candle> = {}): Candle {
  return { time, open: close - 0.5, high: close + 0.5, low: close - 1, close, volume: 100, ...extra }
}

describe('getLatestPrice', () => {
  it('returns null for empty series', () => {
    expect(getLatestPrice([])).toBeNull()
  })

  it('derives price, change and pct from the last two closes', () => {
    const out = getLatestPrice([candle('2026-09-25', 100), candle('2026-09-26', 110)])
    expect(out?.price).toBe(110)
    expect(out?.prevClose).toBe(100)
    expect(out?.change).toBe(10)
    expect(out?.pct).toBeCloseTo(10, 5)
    expect(out?.asOf).toBe('2026-09-26')
  })
})
