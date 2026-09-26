import { useState, type CSSProperties } from 'react'
import { Badge } from '@/components/ui/badge'
import { Num } from '@/components/ui/Num'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
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

/** Row entrance applies to the first 8 rows only — long cascades exhaust the eye. */
const STAGGER_ROWS = 8
const SKELETON_ROWS = 5

function flatten(rows: ShortlistRow[]): FlatRow[] {
  return rows.map((r) => ({ ...r, ...r.ratios }))
}

function fmt(v: unknown): string {
  return typeof v === 'number' ? v.toFixed(1) : '—'
}

export function ShortlistTable({
  rows,
  loading = false,
}: {
  rows: ShortlistRow[]
  loading?: boolean
}) {
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

  const sorted = loading ? [] : sortRows(flatten(rows), sortKey, sortDir)

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
              className={cn(col.numeric && 'text-right')}
            >
              <button
                type="button"
                onClick={() => toggleSort(col.key)}
                className="inline-flex cursor-pointer select-none items-center font-mono text-[11px] tracking-[0.08em] uppercase hover:text-foreground"
              >
                {col.label}
                {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading
          ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <TableRow key={`skeleton-${index}`}>
                <TableCell colSpan={COLUMNS.length}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            ))
          : sorted.map((r, index) => (
              <TableRow
                key={r.symbol}
                className={index < STAGGER_ROWS ? 'vault-row-in' : undefined}
                style={
                  index < STAGGER_ROWS
                    ? ({ '--row-index': index } as CSSProperties)
                    : undefined
                }
              >
                <TableCell className="text-right">
                  <Num>{r.rank}</Num>
                </TableCell>
                <TableCell className="font-semibold">{r.symbol}</TableCell>
                <TableCell>{r.name ?? '—'}</TableCell>
                <TableCell>{r.sector ?? '—'}</TableCell>
                <TableCell className="text-right">
                  <Num>{fmt(r.pe)}</Num>
                </TableCell>
                <TableCell className="text-right">
                  <Num>{fmt(r.pb)}</Num>
                </TableCell>
                <TableCell className="text-right">
                  <Num>{fmt(r.roe)}</Num>
                </TableCell>
                <TableCell className="text-right">
                  <Num>{fmt(r.roce)}</Num>
                </TableCell>
                <TableCell className="text-right">
                  {typeof r.debt_to_equity === 'number' && r.debt_to_equity > 0.3 ? (
                    <Badge variant="destructive" className="font-mono tabular-nums">
                      {fmt(r.debt_to_equity)}
                    </Badge>
                  ) : (
                    <Num>{fmt(r.debt_to_equity)}</Num>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Num>{fmt(r.market_cap)}</Num>
                </TableCell>
                <TableCell className="text-right font-medium">
                  <Num>{fmt(r.score)}</Num>
                </TableCell>
              </TableRow>
            ))}
      </TableBody>
    </Table>
  )
}
