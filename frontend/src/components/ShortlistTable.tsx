import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { sortRows, type SortDir } from '../lib/sort'
import type { ShortlistRow } from '../api/types'

type FlatRow = ShortlistRow & Record<string, unknown>

const COLUMNS: { key: string; label: string; numeric: boolean }[] = [
  { key: 'rank', label: '#', numeric: true },
  { key: 'symbol', label: 'Symbol', numeric: false },
  { key: 'name', label: 'Name', numeric: false },
  { key: 'sector', label: 'Sector', numeric: false },
  { key: 'pe', label: 'PE', numeric: true },
  { key: 'pb', label: 'PB', numeric: true },
  { key: 'roe', label: 'ROE%', numeric: true },
  { key: 'roce', label: 'ROCE%', numeric: true },
  { key: 'debt_to_equity', label: 'D/E', numeric: true },
  { key: 'market_cap', label: 'Mkt Cap (cr)', numeric: true },
  { key: 'score', label: 'Score', numeric: true },
]

function flatten(rows: ShortlistRow[]): FlatRow[] {
  return rows.map((r) => ({ ...r, ...r.ratios }))
}

function fmt(v: unknown): string {
  return typeof v === 'number' ? v.toFixed(1) : '—'
}

export function ShortlistTable({ rows }: { rows: ShortlistRow[] }) {
  const [sortKey, setSortKey] = useState<string>('rank')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = sortRows(flatten(rows), sortKey, sortDir)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {COLUMNS.map((col) => (
            <TableHead
              key={col.key}
              aria-sort={
                sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
              }
              className={col.numeric ? 'text-right' : undefined}
            >
              <button
                type="button"
                onClick={() => toggleSort(col.key)}
                className="inline-flex cursor-pointer select-none items-center hover:text-foreground"
              >
                {col.label}
                {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => (
          <TableRow key={r.symbol}>
            <TableCell className="text-right tabular-nums">{r.rank}</TableCell>
            <TableCell className="font-semibold">{r.symbol}</TableCell>
            <TableCell>{r.name ?? '—'}</TableCell>
            <TableCell>{r.sector ?? '—'}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(r.pe)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(r.pb)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(r.roe)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(r.roce)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {typeof r.debt_to_equity === 'number' && r.debt_to_equity > 0.3 ? (
                <Badge variant="destructive">{fmt(r.debt_to_equity)}</Badge>
              ) : (
                fmt(r.debt_to_equity)
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{fmt(r.market_cap)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{fmt(r.score)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
