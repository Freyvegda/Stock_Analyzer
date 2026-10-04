/**
 * Client-side candle helpers: range slicing + interval aggregation.
 *
 * Mirrors `backend/app/stock/candles.py` so the detail page can fetch the
 * 5y daily series once and derive every range/interval view locally with
 * zero extra network. Pure functions, no network, no storage.
 */

import type { Candle, ChartInterval, ChartRange } from '../api/types'

const RANGES: Record<ChartRange, number> = { '6m': 182, '1y': 365, '2y': 730, '5y': 1825 }

const BUCKET_DAYS = 15

function toOrdinal(iso: string): number {
  const ms = Date.parse(`${iso}T00:00:00Z`)
  return Math.floor(ms / 86400000)
}

/** Union 1y + 5y daily series by `time` (incoming wins), sorted ascending. */
export function mergeCandles(current: Candle[], incoming: Candle[]): Candle[] {
  if (incoming.length === 0) return current.map((row) => ({ ...row }))
  const byTime = new Map<string, Candle>()
  for (const row of current) byTime.set(row.time, { ...row })
  for (const row of incoming) byTime.set(row.time, { ...row })
  return [...byTime.values()].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
}

/** Keep bars with `time >= last_bar_time - RANGES[range]` (inclusive). */
export function sliceRange(rows: Candle[], range: ChartRange): Candle[] {
  if (rows.length === 0) return []
  const last = Date.parse(`${rows[rows.length - 1].time}T00:00:00Z`)
  const cutoff = new Date(last - RANGES[range] * 86400000).toISOString().slice(0, 10)
  return rows.filter((row) => row.time >= cutoff)
}

/**
 * Fold ascending daily bars into `1d` / `15d` / `1mo` candles.
 * Per bucket: `time` = first bar's date, `open` = first open,
 * `close` = last close, `high`/`low` = max/min, `volume` = sum.
 */
export function aggregateCandles(rows: Candle[], interval: ChartInterval): Candle[] {
  if (interval === '1d') return rows.map((row) => ({ ...row }))
  const keyOf =
    interval === '15d'
      ? (row: Candle) => String(Math.floor(toOrdinal(row.time) / BUCKET_DAYS))
      : (row: Candle) => row.time.slice(0, 7)
  const buckets: Candle[] = []
  let currentKey: string | null = null
  for (const row of rows) {
    const key = keyOf(row)
    const last = buckets[buckets.length - 1]
    if (last !== undefined && currentKey === key) {
      last.close = row.close
      last.high = Math.max(last.high, row.high)
      last.low = Math.min(last.low, row.low)
      last.volume += row.volume
      continue
    }
    currentKey = key
    buckets.push({ ...row })
  }
  return buckets
}
