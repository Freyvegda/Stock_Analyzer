import { useEffect, useState } from 'react'
import { Button, Flex, Text } from '@chakra-ui/react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ApiError, api } from '../api/client'
import type { FinancialPeriod, FinancialsResponse } from '../api/types'
import { BlurFade } from './ui/BlurFade'
import { Num } from './ui/Num'
import { Skeleton } from './ui/Skeleton'
import { cn } from '@/lib/utils'

type Mode = 'quarterly' | 'annual'

const ROWS: { key: keyof Omit<FinancialPeriod, 'period'>; label: string; unit: string; decimals: number }[] = [
  { key: 'sales', label: 'Sales', unit: '₹ cr', decimals: 1 },
  { key: 'expenses', label: 'Expenses', unit: '₹ cr', decimals: 1 },
  { key: 'operating_profit', label: 'Operating Profit', unit: '₹ cr', decimals: 1 },
  { key: 'other_income', label: 'Other Income', unit: '₹ cr', decimals: 1 },
  { key: 'interest', label: 'Interest', unit: '₹ cr', decimals: 1 },
  { key: 'depreciation', label: 'Depreciation', unit: '₹ cr', decimals: 1 },
  { key: 'pbt', label: 'PBT', unit: '₹ cr', decimals: 1 },
  { key: 'tax', label: 'Tax', unit: '₹ cr', decimals: 1 },
  { key: 'pat', label: 'PAT', unit: '₹ cr', decimals: 1 },
  { key: 'eps', label: 'EPS', unit: '₹', decimals: 2 },
]

function cellId(key: string, period: string) {
  return `${key}-${period}`
}

export function Financials({ symbol }: { symbol: string }) {
  const [data, setData] = useState<FinancialsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('quarterly')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<FinancialsResponse>(`/stock/${encodeURIComponent(symbol)}/financials`)
      setData(res)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return // global redirect
      setError(e instanceof Error ? e.message : 'Failed to load financial history')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setData(null)
    setMode('quarterly')
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol])

  if (loading) {
    return <Skeleton className="h-64 w-full" />
  }

  if (error !== null || data === null) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <Text role="alert" fontSize="sm" color="fg.error">
          {error ?? 'Failed to load financial history'}
        </Text>
        <Button mt={3} size="sm" colorPalette="sakura" variant="outline" onClick={load}>
          Retry
        </Button>
      </div>
    )
  }

  const periods = mode === 'quarterly' ? data.quarterly : data.annual
  const empty = data.quarterly.length === 0 && data.annual.length === 0

  return (
    <BlurFade>
      <section data-testid="financials" aria-label="Financial history" className="rounded-lg border border-border bg-card p-4">
        <Flex align="center" justify="space-between" gap={3} wrap="wrap">
          <Text fontSize="sm" fontWeight="medium">
            Financial history
          </Text>
          <Flex gap={1} role="group" aria-label="Period">
            {(['quarterly', 'annual'] as Mode[]).map((option) => (
              <Button
                key={option}
                size="xs"
                variant={mode === option ? 'solid' : 'ghost'}
                colorPalette="sakura"
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
              >
                {option === 'quarterly' ? 'Quarterly' : 'Annual'}
              </Button>
            ))}
          </Flex>
        </Flex>

        {data.stale && data.as_of !== null ? (
          <Text mt={2} fontSize="xs" color="fg.muted">
            Stale — as of <Num>{data.as_of}</Num>
          </Text>
        ) : null}

        {empty ? (
          <Text mt={3} fontSize="sm" color="fg.muted">
            No history yet — hit Refresh to fetch
          </Text>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-left font-medium text-muted-foreground">Metric</th>
                    {periods.map((p) => (
                      <th key={p.period} className="px-2 py-1 text-right font-medium text-muted-foreground">
                        <Num>{p.period}</Num>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={row.key} className="border-t border-border">
                      <td className="px-2 py-1 text-muted-foreground">
                        {row.label} <span className="text-xs">({row.unit})</span>
                      </td>
                      {periods.map((p) => {
                        const value = p[row.key]
                        const negative = row.key === 'pat' && value !== null && value < 0
                        return (
                          <td
                            key={p.period}
                            data-testid={cellId(row.key, p.period)}
                            className={cn('px-2 py-1 text-right tabular-nums', negative && 'text-loss')}
                          >
                            {value === null ? '—' : <Num>{value.toFixed(row.decimals)}</Num>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={periods.map((p) => ({ period: p.period, Sales: p.sales, PAT: p.pat }))}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chakra-colors-border)" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} width={56} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--chakra-colors-bg-panel)',
                      border: '1px solid var(--chakra-colors-border)',
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="Sales" fill="var(--chakra-colors-brand)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="PAT" radius={[3, 3, 0, 0]}>
                    {periods.map((p) => (
                      <Cell
                        key={p.period}
                        fill={
                          p.pat !== null && p.pat < 0
                            ? 'var(--chakra-colors-loss)'
                            : 'var(--chakra-colors-gain)'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </section>
    </BlurFade>
  )
}
