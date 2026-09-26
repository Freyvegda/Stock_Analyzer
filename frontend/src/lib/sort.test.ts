import { describe, expect, it } from 'vitest'
import { sortRows, type SortDir } from './sort'

type Row = { symbol: string; score: number | null }
const rows: Row[] = [
  { symbol: 'C', score: null },
  { symbol: 'A', score: 2 },
  { symbol: 'B', score: 10 },
]

describe('sortRows', () => {
  it('sorts numbers ascending and descending', () => {
    expect(sortRows(rows, 'score', 'asc').map((r) => r.symbol)).toEqual(['A', 'B', 'C'])
    expect(sortRows(rows, 'score', 'desc').map((r) => r.symbol)).toEqual(['B', 'A', 'C'])
  })

  it('keeps nulls last in both directions', () => {
    const asc = sortRows(rows, 'score', 'asc')
    const desc = sortRows(rows, 'score', 'desc')
    expect(asc[asc.length - 1].score).toBeNull()
    expect(desc[desc.length - 1].score).toBeNull()
  })

  it('sorts strings and does not mutate the input', () => {
    const copy = [...rows]
    expect(sortRows(rows, 'symbol', 'asc').map((r) => r.symbol)).toEqual(['A', 'B', 'C'])
    expect(rows).toEqual(copy)
  })

  it('supports toggling the direction value', () => {
    const dirs: SortDir[] = ['asc', 'desc']
    expect(dirs.map((d) => sortRows(rows, 'score', d)[0].symbol)).toEqual(['A', 'B'])
  })
})
