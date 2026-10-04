/**
 * Latest traded price from daily candles (no new endpoint).
 *
 * The detail page fetches 5y/1d once; the last candle close is the latest
 * traded price, the previous close gives day change. Pure, no network.
 */

import type { Candle } from '../api/types'

export interface LatestPrice {
  price: number
  prevClose: number | null
  change: number | null
  pct: number | null
  asOf: string
  prevDate: string | null
  open: number
  high: number
  low: number
  volume: number
}

/** Last candle wins; change needs two bars, OHLCV comes from the last bar. */
export function getLatestPrice(candles: Candle[]): LatestPrice | null {
  if (candles.length === 0) return null
  const last = candles[candles.length - 1]
  const prev = candles.length > 1 ? candles[candles.length - 2] : null
  const change = prev !== null ? last.close - prev.close : null
  const pct = change !== null && prev !== null && prev.close !== 0 ? (change / prev.close) * 100 : null
  return {
    price: last.close,
    prevClose: prev?.close ?? null,
    change,
    pct,
    asOf: last.time,
    prevDate: prev?.time ?? null,
    open: last.open,
    high: last.high,
    low: last.low,
    volume: last.volume,
  }
}
