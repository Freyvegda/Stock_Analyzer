import { useEffect, useState } from 'react'
import { Button, Flex, Text } from '@chakra-ui/react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ApiError, api } from '../api/client'
import type { FinancialPeriod, FinancialsResponse } from '../api/types'
import { useColorMode } from './ui/color-mode'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { chartPalette } from '@/theme/tokens'
import { BlurFade } from './ui/BlurFade'
import { Num } from './ui/Num'
import { Skeleton } from './ui/Skeleton'
import { cn } from '@/lib/utils'

type Mode = 'quarterly' | 'annual'

type RowKey = keyof Omit<FinancialPeriod, 'period'>

const GROUPS: { title: string; rows: { key: RowKey; label: string; unit: string; decimals: number }[] }[] = [
  {
    title: 'Revenue & operations',
    rows: [
      { key: 'sales', label: 'Sales', unit: '₹ cr', decimals: 1 },
      { key: 'expenses', label: 'Expenses', unit: '₹ cr', decimals: 1 },
      { key: 'operating_profit', label: 'Operating Profit', unit: '₹ cr', decimals: 1 },
    ],
  },
  {
    title: 'Other items',
    rows: [
      { key: 'other_income', label: 'Other Income', unit: '₹ cr', decimals: 1 },
      { key: 'interest', label: 'Interest', unit: '₹ cr', decimals: 1 },
      { key: 'depreciation', label: 'Depreciation', unit: '₹ cr', decimals: 1 },
    ],
  },
  {
    title: 'Bottom line',
    rows: [
      { key: 'pbt', label: 'PBT', unit: '₹ cr', decimals: 1 },
      { key: 'tax', label: 'Tax', unit: '₹ cr', decimals: 1 },
      { key: 'pat', label: 'PAT', unit: '₹ cr', decimals: 1 },
    ],
  },
  {
    title: 'Per share',
    rows: [{ key: 'eps', label: 'EPS', unit: '₹', decimals: 2 }],
  },
]

function cellId(key: string, period: string) {
  return `${key}-${period}`
}

function compactTick(value: number): string {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`
  return `${value}`
}

function fmt(value: number | null, decimals: number) {
  return value === null ? '—' : value.toFixed(decimals)
}

export function Financials({ symbol }: { symbol: string }) {
  const reduced = usePrefersReducedMotion()
  const { colorMode } = useColorMode()
  const palette = chartPalette[colorMode === 'dark' ? 'dark' : 'light']
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
  const latest = periods.length > 0 ? periods[periods.length - 1] : null
  const chartData = periods.map((p) => ({
    period: p.period,
    Revenue: p.sales,
    OperatingProfit: p.operating_profit,
    PAT: p.pat,
  }))

  const body = (
    <div className="mt-4 space-y-6">
      {GROUPS.map((group) => (
        <div key={group.title}>
          <Text fontSize="xs" color="fg.muted" className="uppercase tracking-[0.08em]">
            {group.title}
          </Text>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Metric</th>
                  {periods.map((p) => (
                    <th key={p.period} className="px-3 py-2 text-right font-medium text-muted-foreground">
                      <Num>{p.period}</Num>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.key} className="border-t border-border transition-colors hover:bg-muted/50">
                    <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                      {row.label} <span className="text-xs">({row.unit})</span>
                    </td>
                    {periods.map((p) => {
                      const value = p[row.key]
                      const negative = row.key === 'pat' && value !== null && value < 0
                      return (
                        <td
                          key={p.period}
                          data-testid={cellId(row.key, p.period)}
                          className={cn('px-3 py-1.5 text-right tabular-nums', negative && 'text-loss')}
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
        </div>
      ))}

      <div>
        <Text fontSize="xs" color="fg.muted" className="uppercase tracking-[0.08em]">
          Trend
        </Text>
        <div data-testid="financials-chart" className="mt-2 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={palette.grid} />
              <XAxis
                dataKey="period"
                tick={{ fontSize: 11, fill: palette.axisText }}
                tickLine={false}
                axisLine={{ stroke: palette.axisBorder }}
                interval={0}
              />
              <YAxis
                tick={{ fontSize: 11, fill: palette.axisText }}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={compactTick}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--chakra-colors-bg-panel)',
                  border: `1px solid ${palette.axisBorder}`,
                  borderRadius: '8px',
                  fontSize: 12,
                  color: palette.axisText,
                }}
                cursor={{ stroke: palette.axisBorder, strokeDasharray: '3 3' }}
              />
              <ReferenceLine y={0} stroke={palette.axisBorder} />
              <Bar
                dataKey="OperatingProfit"
                name="Operating Profit"
                fill={palette.benchmark}
                fillOpacity={0.75}
                radius={[4, 4, 0, 0]}
                maxBarSize={26}
                isAnimationActive={!reduced}
                animationDuration={700}
                animationEasing="ease-out"
              />
              <Bar
                dataKey="PAT"
                name="PAT"
                fill={palette.strategy}
                fillOpacity={0.55}
                radius={[4, 4, 0, 0]}
                maxBarSize={26}
                isAnimationActive={!reduced}
                animationDuration={700}
                animationEasing="ease-out"
              />
              <Line
                type="monotone"
                dataKey="Revenue"
                stroke={palette.strategy}
                strokeWidth={2.5}
                dot={{ r: 3, fill: palette.strategy, strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                isAnimationActive={!reduced}
                animationDuration={700}
                animationEasing="ease-out"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <Flex data-testid="financials-legend" mt={3} gap={4} wrap="wrap" align="center">
          <Flex gap={1.5} align="center">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-5 rounded-full"
              style={{ background: palette.strategy }}
            />
            <Text fontSize="xs" color="fg.muted">Revenue</Text>
          </Flex>
          <Flex gap={1.5} align="center">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-[3px]"
              style={{ background: palette.benchmark }}
            />
            <Text fontSize="xs" color="fg.muted">Operating Profit</Text>
          </Flex>
          <Flex gap={1.5} align="center">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-[3px]"
              style={{ background: palette.strategy, opacity: 0.55 }}
            />
            <Text fontSize="xs" color="fg.muted">PAT</Text>
          </Flex>
        </Flex>
      </div>
    </div>
  )

  return (
    <BlurFade>
      <section
        data-testid="financials"
        data-motion={reduced ? 'static' : 'animated'}
        aria-label="Financial history"
        className="rounded-lg border border-border bg-card p-5"
      >
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

        {latest !== null ? (
          <Text data-testid="financials-summary" mt={2} fontSize="xs" color="fg.muted">
            <Num>{latest.period}</Num>
            {latest.sales !== null ? (
              <> · Revenue <Num>{fmt(latest.sales, 1)}</Num> ₹ cr</>
            ) : null}
            {latest.operating_profit !== null ? (
              <> · OP <Num>{fmt(latest.operating_profit, 1)}</Num> ₹ cr</>
            ) : null}
            {latest.pat !== null ? (
              <> · PAT <Num>{fmt(latest.pat, 1)}</Num> ₹ cr</>
            ) : null}
          </Text>
        ) : null}

        {data.stale && data.as_of !== null ? (
          <Text mt={1} fontSize="xs" color="fg.muted">
            Stale — as of <Num>{data.as_of}</Num>
          </Text>
        ) : null}

        {empty ? (
          <Text mt={3} fontSize="sm" color="fg.muted">
            No history yet — hit Refresh to fetch
          </Text>
        ) : reduced ? (
          <div key={mode}>{body}</div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              {body}
            </motion.div>
          </AnimatePresence>
        )}
      </section>
    </BlurFade>
  )
}
