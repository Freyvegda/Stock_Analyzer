/**
 * Stock detail page (`/stock/:symbol`).
 *
 * Shared stock data (stored snapshot, lazy first fetch, manual Refresh) plus a
 * per-user report computed against the caller's saved criteria. The chart is
 * served live (memory-cached server-side) with 6M/1Y/2Y/5Y ranges and
 * Daily/15D/Monthly intervals. The Candle Ridge hero is a lazy 3D chunk fed by
 * the loaded closes.
 */

import { Suspense, lazy, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Button, Flex, Text } from '@chakra-ui/react'
import { ApiError, api } from '../api/client'
import type {
  Candle,
  ChartInterval,
  ChartRange,
  CompanyProfile,
  MetricGroup,
  OhlcResponse,
  StockDetail as StockDetailData,
  StockFact,
} from '../api/types'
import { BlurFade } from '../components/ui/BlurFade'
import { Num } from '../components/ui/Num'
import { Skeleton } from '../components/ui/Skeleton'
import { StockChart } from '../components/StockChart'
import { StockReportCard } from '../components/StockReportCard'
import { toaster } from '../components/ui/toaster'

const CandleRidge = lazy(() => import('../components/three/CandleRidge'))

const RANGES: { key: ChartRange; label: string }[] = [
  { key: '6m', label: '6M' },
  { key: '1y', label: '1Y' },
  { key: '2y', label: '2Y' },
  { key: '5y', label: '5Y' },
]

const INTERVALS: { key: ChartInterval; label: string }[] = [
  { key: '1d', label: 'Daily' },
  { key: '15d', label: '15D' },
  { key: '1mo', label: 'Monthly' },
]

function fmt(value: number): string {
  return value.toFixed(1)
}

function hasProfile(profile: CompanyProfile): boolean {
  return Object.values(profile).some((value) => value !== null)
}

function DescriptionCard({ profile }: { profile: CompanyProfile }) {
  if (!hasProfile(profile)) return null
  return (
    <BlurFade>
      <section
        data-testid="company-description"
        className="rounded-lg border border-border bg-card p-4"
      >
        <Text fontSize="sm" fontWeight="medium">
          What the company does
        </Text>
        {profile.description !== null ? (
          <Text mt={2} fontSize="sm" color="fg.muted" className="whitespace-pre-line">
            {profile.description}
          </Text>
        ) : null}
        <Flex mt={3} gap={3} wrap="wrap" align="center">
          {profile.industry !== null ? <Badge variant="subtle">{profile.industry}</Badge> : null}
          {profile.sector !== null ? <Badge variant="outline">{profile.sector}</Badge> : null}
          {profile.website !== null ? (
            <a
              href={profile.website}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline-offset-4 hover:underline"
            >
              Website
            </a>
          ) : null}
          {profile.employees !== null ? (
            <Text fontSize="xs" color="fg.muted">
              Employees <Num>{profile.employees}</Num>
            </Text>
          ) : null}
          {profile.hq !== null ? (
            <Text fontSize="xs" color="fg.muted">
              {profile.hq}
            </Text>
          ) : null}
        </Flex>
      </section>
    </BlurFade>
  )
}

function FactTiles({ title, facts }: { title: string; facts: StockFact[] }) {
  if (facts.length === 0) return null
  return (
    <BlurFade>
      <section className="rounded-lg border border-border bg-card p-4">
        <Text fontSize="sm" fontWeight="medium">
          {title}
        </Text>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.key} className="rounded-md border border-border bg-background/40 p-3">
              <Text fontSize="xs" color="fg.muted">
                {fact.label}
              </Text>
              <Text fontSize="sm" mt={1}>
                <Num>{fmt(fact.value)}</Num>{' '}
                <span className="text-xs text-muted-foreground">{fact.unit}</span>
              </Text>
            </div>
          ))}
        </div>
      </section>
    </BlurFade>
  )
}

function OtherGroups({ groups }: { groups: MetricGroup[] }) {
  if (groups.length === 0) return null
  return (
    <BlurFade>
      <section className="rounded-lg border border-border bg-card p-4">
        <Text fontSize="sm" fontWeight="medium">
          All other ratios
        </Text>
        <div className="mt-3 space-y-4">
          {groups.map((group) => (
            <div key={group.category}>
              <Text fontSize="xs" color="fg.muted" className="uppercase tracking-[0.08em]">
                {group.category}
              </Text>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {group.metrics.map((metric) => (
                  <div
                    key={metric.key}
                    className="rounded-md border border-border bg-background/40 p-3"
                  >
                    <Text fontSize="xs" color="fg.muted">
                      {metric.label}
                    </Text>
                    <Text fontSize="sm" mt={1}>
                      <Num>{fmt(metric.value)}</Num>{' '}
                      <span className="text-xs text-muted-foreground">{metric.unit}</span>
                    </Text>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </BlurFade>
  )
}

export default function StockDetail() {
  const params = useParams()
  const symbol = (params.symbol ?? '').toUpperCase()
  const [detail, setDetail] = useState<StockDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [candles, setCandles] = useState<Candle[]>([])
  const [candlesLoading, setCandlesLoading] = useState(true)
  const [candlesError, setCandlesError] = useState<string | null>(null)
  const [range, setRange] = useState<ChartRange>('1y')
  const [interval, setInterval] = useState<ChartInterval>('1d')
  const [refreshing, setRefreshing] = useState(false)

  async function loadDetail() {
    setLoading(true)
    setNotFound(false)
    setError(null)
    try {
      const data = await api.get<StockDetailData>(`/stock/${encodeURIComponent(symbol)}`)
      setDetail(data)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return // global redirect
      if (e instanceof ApiError && e.status === 404) {
        setNotFound(true)
        return
      }
      setError(e instanceof Error ? e.message : 'Failed to load the stock')
    } finally {
      setLoading(false)
    }
  }

  async function loadCandles() {
    setCandlesLoading(true)
    setCandlesError(null)
    try {
      const data = await api.get<OhlcResponse>(
        `/stock/${encodeURIComponent(symbol)}/ohlc?range=${range}&interval=${interval}`,
      )
      setCandles(data.candles)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return // global redirect
      setCandles([])
      setCandlesError(e instanceof Error ? e.message : 'Failed to load the chart')
    } finally {
      setCandlesLoading(false)
    }
  }

  useEffect(() => {
    if (symbol !== '') loadDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol])

  useEffect(() => {
    if (symbol !== '') loadCandles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, range, interval])

  async function refresh() {
    setRefreshing(true)
    try {
      const next = await api.post<StockDetailData>(
        `/stock/${encodeURIComponent(symbol)}/refresh`,
        {},
      )
      setDetail(next)
      if (next.warning !== null) {
        toaster.create({
          title: 'Showing stored data',
          description: next.warning,
          type: 'warning',
        })
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return // global redirect
      const message = e instanceof Error ? e.message : 'Refresh failed'
      toaster.create({ title: 'Refresh failed', description: message, type: 'error' })
    } finally {
      setRefreshing(false)
    }
  }

  if (notFound) {
    return (
      <div className="rounded-lg border border-border bg-card p-10 text-center">
        <Text fontSize="lg" fontWeight="semibold">
          Unknown symbol {symbol}
        </Text>
        <Text mt={2} fontSize="sm" color="fg.muted">
          It is not part of the stored Nifty 500 universe.
        </Text>
        <Link
          to="/"
          className="mt-4 inline-block text-sm underline-offset-4 hover:underline"
        >
          ← Back to Fundamental Analysis
        </Link>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (detail === null) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <Text role="alert" fontSize="sm" color="fg.error">
          {error ?? 'Failed to load the stock'}
        </Text>
        <Button mt={3} size="sm" colorPalette="sakura" variant="outline" onClick={loadDetail}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <BlurFade>
        <Flex align="flex-start" justify="space-between" gap={4} wrap="wrap">
          <div>
            <Link
              to="/"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              ← Fundamental Analysis
            </Link>
            <Text as="h1" fontSize="2xl" fontWeight="semibold" mt={1}>
              {detail.symbol}{' '}
              <Text as="span" fontSize="md" color="fg.muted">
                {detail.name}
              </Text>
            </Text>
            <Flex align="center" gap={3} mt={1} wrap="wrap">
              {detail.sector !== null ? <Badge variant="subtle">{detail.sector}</Badge> : null}
              {detail.market_cap !== null ? (
                <Text fontSize="xs" color="fg.muted">
                  Mkt cap <Num>{fmt(detail.market_cap)}</Num> ₹ cr
                </Text>
              ) : null}
              {detail.stale ? (
                <Text fontSize="xs" color="fg.muted">
                  Data as of {detail.data_date}
                </Text>
              ) : null}
              {detail.run !== null ? (
                <Text fontSize="xs" color="fg.muted">
                  Run <Num>#{detail.run.rank}</Num>
                </Text>
              ) : null}
            </Flex>
          </div>
          <Button
            size="sm"
            colorPalette="sakura"
            variant="outline"
            disabled={refreshing}
            onClick={refresh}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </Flex>
        {detail.warning !== null ? (
          <Text
            data-testid="refresh-warning"
            role="status"
            fontSize="xs"
            color="fg.muted"
            mt={2}
          >
            {detail.warning}
          </Text>
        ) : null}
      </BlurFade>

      {candles.length > 1 ? (
        <div className="relative hidden h-[140px] overflow-hidden rounded-lg border border-border bg-card md:block">
          <Suspense fallback={null}>
            <CandleRidge candles={candles} className="absolute inset-0" />
          </Suspense>
        </div>
      ) : null}

      <BlurFade>
        <StockReportCard report={detail.report} />
      </BlurFade>

      <DescriptionCard profile={detail.profile} />
      <FactTiles title="What it has" facts={detail.has} />
      <FactTiles title="Main fundamental ratios" facts={detail.main_ratios} />
      <FactTiles title="What it's done" facts={detail.done} />
      <OtherGroups groups={detail.other_groups} />

      <BlurFade>
        <section className="rounded-lg border border-border bg-card p-4">
          <Flex align="center" justify="space-between" gap={3} wrap="wrap">
            <Text fontSize="sm" fontWeight="medium">
              Price chart
            </Text>
            <Flex gap={2} wrap="wrap">
              <Flex gap={1} role="group" aria-label="Range">
                {RANGES.map((option) => (
                  <Button
                    key={option.key}
                    size="xs"
                    variant={range === option.key ? 'solid' : 'ghost'}
                    colorPalette="sakura"
                    aria-pressed={range === option.key}
                    onClick={() => setRange(option.key)}
                  >
                    {option.label}
                  </Button>
                ))}
              </Flex>
              <Flex gap={1} role="group" aria-label="Interval">
                {INTERVALS.map((option) => (
                  <Button
                    key={option.key}
                    size="xs"
                    variant={interval === option.key ? 'solid' : 'ghost'}
                    colorPalette="sakura"
                    aria-pressed={interval === option.key}
                    onClick={() => setInterval(option.key)}
                  >
                    {option.label}
                  </Button>
                ))}
              </Flex>
            </Flex>
          </Flex>

          <div className="mt-3">
            {candlesError !== null ? (
              <div className="py-10 text-center">
                <Text role="alert" fontSize="sm" color="fg.error">
                  {candlesError}
                </Text>
                <Button
                  mt={3}
                  size="sm"
                  colorPalette="sakura"
                  variant="outline"
                  onClick={loadCandles}
                >
                  Retry chart
                </Button>
              </div>
            ) : candlesLoading ? (
              <Skeleton className="h-80 w-full" />
            ) : (
              <StockChart candles={candles} />
            )}
          </div>
        </section>
      </BlurFade>
    </div>
  )
}
