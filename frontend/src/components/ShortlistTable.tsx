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

const COLUMNS: { key: string; label: string }[] = [
  { key: 'rank', label: '#' },
  { key: 'symbol', label: 'Symbol' },
  { key: 'name', label: 'Name' },
  { key: 'sector', label: 'Sector' },
  { key: 'pe', label: 'PE' },
  { key: 'pb', label: 'PB' },
  { key: 'roe', label: 'ROE%' },
  { key: 'roce', label: 'ROCE%' },
  { key: 'debt_to_equity', label: 'D/E' },
  { key: 'market_cap', label: 'Mkt Cap (cr)' },
  { key: 'score', label: 'Score' },
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
              onClick={() => toggleSort(col.key)}
              className="cursor-pointer select-none hover:text-zinc-100"
            >
              {col.label}
              {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => (
          <TableRow key={r.symbol}>
            <TableCell>{r.rank}</TableCell>
            <TableCell className="font-semibold">{r.symbol}</TableCell>
            <TableCell>{r.name ?? '—'}</TableCell>
            <TableCell>{r.sector ?? '—'}</TableCell>
            <TableCell className="text-right">{fmt(r.pe)}</TableCell>
            <TableCell className="text-right">{fmt(r.pb)}</TableCell>
            <TableCell className="text-right">{fmt(r.roe)}</TableCell>
            <TableCell className="text-right">{fmt(r.roce)}</TableCell>
            <TableCell className="text-right">
              {typeof r.debt_to_equity === 'number' && r.debt_to_equity > 0.3 ? (
                <Badge variant="destructive">{fmt(r.debt_to_equity)}</Badge>
              ) : (
                fmt(r.debt_to_equity)
              )}
            </TableCell>
            <TableCell className="text-right">{fmt(r.market_cap)}</TableCell>
            <TableCell className="text-right font-medium">{fmt(r.score)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
