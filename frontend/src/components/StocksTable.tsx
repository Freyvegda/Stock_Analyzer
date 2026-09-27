import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
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
import type { StockListRow } from '../api/types'

type FlatRow = StockListRow & Record<string, unknown>

const COLUMNS: { key: string; label: string; numeric: boolean }[] = [
  { key: 'symbol', label: 'Symbol', numeric: false },
  { key: 'name', label: 'Name', numeric: false },
  { key: 'sector', label: 'Sector', numeric: false },
  { key: 'market_cap', label: 'Mkt Cap (cr)', numeric: true },
  { key: 'pe', label: 'PE', numeric: true },
  { key: 'pb', label: 'PB', numeric: true },
  { key: 'roe', label: 'ROE%', numeric: true },
  { key: 'roce', label: 'ROCE%', numeric: true },
  { key: 'debt_to_equity', label: 'D/E', numeric: true },
  { key: 'verdict', label: 'Screen', numeric: false },
  { key: 'data_date', label: 'Updated', numeric: false },
]

const SKELETON_ROWS = 8

function fmt(value: unknown): string {
  return typeof value === 'number' ? value.toFixed(1) : '—'
}

function Verdict({ row }: { row: StockListRow }) {
  if (row.verdict === 'no_data') {
    return (
      <Badge variant="secondary" data-testid={`verdict-${row.symbol}`}>
        No data
      </Badge>
    )
  }
  if (row.verdict === 'pass') {
    return (
      <Badge data-testid={`verdict-${row.symbol}`}>
        <Num>
          {row.passes}/{row.enabled}
        </Num>{' '}
        pass
      </Badge>
    )
  }
  return (
    <Badge variant="destructive" data-testid={`verdict-${row.symbol}`}>
      Fail
    </Badge>
  )
}

export function StocksTable({
  rows,
  loading = false,
}: {
  rows: StockListRow[]
  loading?: boolean
}) {
  const [sortKey, setSortKey] = useState<string>('symbol')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = loading ? [] : sortRows(rows as FlatRow[], sortKey, sortDir)

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
                className={index < SKELETON_ROWS ? 'vault-row-in' : undefined}
                style={
                  index < SKELETON_ROWS
                    ? ({ '--row-index': index } as CSSProperties)
                    : undefined
                }
              >
                <TableCell>
                  <Link
                    to={`/stock/${r.symbol}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {r.symbol}
                  </Link>
                </TableCell>
                <TableCell>{r.name !== '' ? r.name : '—'}</TableCell>
                <TableCell>{r.sector ?? '—'}</TableCell>
                <TableCell className="text-right">
                  <Num>{fmt(r.market_cap)}</Num>
                </TableCell>
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
                  <Num>{fmt(r.debt_to_equity)}</Num>
                </TableCell>
                <TableCell>
                  <Verdict row={r} />
                </TableCell>
                <TableCell>{r.data_date ?? '—'}</TableCell>
              </TableRow>
            ))}
      </TableBody>
    </Table>
  )
}
