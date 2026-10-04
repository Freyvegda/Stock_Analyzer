/**
 * Stock detail page (`/stock/:symbol`).
 *
 * Shared stock data (stored snapshot, lazy first fetch, manual Refresh) plus a
 * per-user report computed against the caller's saved criteria. Layout: the two
 * halves — company description | verdict — open the page, then the live price
 * chart (memory-cached server-side, 6M/1Y/2Y/5Y × Daily/15D/Monthly), then the
 * ratios and company facts.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Button, CloseButton, Dialog, Flex, Portal, Text } from '@chakra-ui/react'
import { Maximize2 } from 'lucide-react'
import { ApiError, api } from '../api/client'
import type {
  Candle,
  ChartInterval,
  ChartRange,
  CompanyProfile,
  OhlcResponse,
  ScreeningSet,
  StockDetail as StockDetailData,
  StockScreenReport,
} from '../api/types'
import { BlurFade } from '../components/ui/BlurFade'
import { Num } from '../components/ui/Num'
import { Skeleton } from '../components/ui/Skeleton'
import { StockChart } from '../components/StockChart'
import { ScreenPicker } from '../components/ScreenPicker'
import type { ScreenOption } from '../components/ScreenPicker'
import { ScreenReportCard } from '../components/ScreenReportCard'
import { aggregateCandles, mergeCandles, sliceRange } from '../lib/candles'
import { formatPrice, getLatestPrice } from '../lib/price'
import { toaster } from '../components/ui/toaster'
import { PriceAccordion } from '../components/PriceAccordion'
import { FundamentalsPanel } from '../components/FundamentalsPanel'
import { Financials } from '../components/Financials'
import { Delta } from '../components/ui/Delta'

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

function ProfileFacts({ profile }: { profile: CompanyProfile }) {
  return (
    <Flex gap={3} wrap="wrap" align="center">
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
  )
}

/**
 * One half of the detail halves: the business description, clipped to whatever
 * height the verdict half sets (grid stretch). "More" opens the full profile
 * in a dialog — the clipped text is only ever a preview.
 */
function DescriptionCard({
  profile,
  symbol,
  name,
}: {
  profile: CompanyProfile
  symbol: string
  name: string
}) {
  const [open, setOpen] = useState(false)
  const hasText = profile.description !== null

  return (
    <>
      <BlurFade className="h-full">
        <section
          data-testid="company-description"
          className="flex h-full flex-col rounded-lg border border-border bg-card p-4"
        >
          <Text fontSize="sm" fontWeight="medium">
            What the company does
          </Text>
          {hasText ? (
            <div className="relative mt-2 min-h-0 flex-1">
              <div
                data-testid="company-description-body"
                className="clip-fade-bottom max-h-72 overflow-hidden lg:absolute lg:inset-0 lg:max-h-none"
              >
                <Text fontSize="sm" color="fg.muted" className="whitespace-pre-line">
                  {profile.description}
                </Text>
              </div>
            </div>
          ) : (
            <Text mt={2} fontSize="sm" color="fg.muted">
              No description stored yet — hit Refresh to fetch
            </Text>
          )}
          <Flex mt={3} gap={3} wrap="wrap" align="center">
            <ProfileFacts profile={profile} />
            {hasText ? (
              <Button
                ml="auto"
                size="xs"
                variant="ghost"
                colorPalette="sakura"
                onClick={() => setOpen(true)}
              >
                <Maximize2 size={14} strokeWidth={1.75} aria-hidden="true" />
                More
              </Button>
            ) : null}
          </Flex>
        </section>
      </BlurFade>

      <Dialog.Root
        open={open}
        onOpenChange={(details) => setOpen(details.open)}
        motionPreset="scale"
        size="lg"
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>
                  {symbol} — {name}
                </Dialog.Title>
                <Dialog.CloseTrigger asChild>
                  <CloseButton size="sm" />
                </Dialog.CloseTrigger>
              </Dialog.Header>
              <Dialog.Body maxH="70vh" overflowY="auto">
                <Text fontSize="sm" color="fg.muted" className="whitespace-pre-line">
                  {profile.description}
                </Text>
                <Flex mt={4}>
                  <ProfileFacts profile={profile} />
                </Flex>
              </Dialog.Body>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
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
  const [sets, setSets] = useState<ScreeningSet[] | null>(null)
  const [extraReports, setExtraReports] = useState<Record<number, StockScreenReport>>({})
  const [pendingReports, setPendingReports] = useState<number[]>([])
  const [reportErrors, setReportErrors] = useState<Record<number, string>>({})
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const displayedCandles = useMemo(
    () => aggregateCandles(sliceRange(candles, range), interval),
    [candles, range, interval],
  )

  const latestPrice = useMemo(() => getLatestPrice(candles), [candles])

  const knownReports = useMemo(
    () =>
      detail === null
        ? []
        : [...detail.reports, ...Object.values(extraReports)].filter(
            (report, index, all) => all.findIndex((other) => other.set_id === report.set_id) === index,
          ),
    [detail, extraReports],
  )

  const screenOptions = useMemo<ScreenOption[]>(() => {
    if (detail === null) return []
    const meta =
      sets !== null && sets.length > 0
        ? sets.map((set) => ({ id: set.id, name: set.name, isActive: set.is_active }))
        : detail.reports.map((report) => ({
            id: report.set_id,
            name: report.name,
            isActive: report.is_active,
          }))
    const seen = new Set<number>()
    return meta
      .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
      .map((item) => {
        const known = knownReports.find((report) => report.set_id === item.id)
        return {
          id: item.id,
          name: item.name,
          isActive: item.isActive,
          verdict: known !== undefined ? known.report.verdict : null,
          pending: pendingReports.includes(item.id),
          score: known?.report.score ?? null,
          passed: known?.report.passed,
          enabled: known?.report.enabled,
        }
      })
  }, [detail, sets, knownReports, pendingReports])

  const activeId =
    sets?.find((set) => set.is_active)?.id ??
    detail?.reports.find((report) => report.is_active)?.set_id ??
    null

  useEffect(() => {
    if (selectedId === null && activeId !== null) setSelectedId(activeId)
  }, [selectedId, activeId])

  const selectedReport = knownReports.find((report) => report.set_id === selectedId) ?? null
  const selectedMeta = screenOptions.find((option) => option.id === selectedId)

  function selectScreen(setId: number) {
    setSelectedId(setId)
    void requestReport(setId)
  }

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
    // 1y-first: ~250 daily bars paint fast (rate-limit safe), then a silent
    // 5y expand merges in the background. Range/interval toggles derive
    // locally (see displayedCandles) — no refetch.
    setCandlesLoading(true)
    setCandlesError(null)
    try {
      const first = await api.get<OhlcResponse>(
        `/stock/${encodeURIComponent(symbol)}/ohlc?range=1y&interval=1d`,
      )
      setCandles(first.candles)
      setCandlesLoading(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return // global redirect
      setCandles([])
      setCandlesError(e instanceof Error ? e.message : 'Failed to load the chart')
      setCandlesLoading(false)
      return
    }
    try {
      const full = await api.get<OhlcResponse>(
        `/stock/${encodeURIComponent(symbol)}/ohlc?range=5y&interval=1d`,
      )
      setCandles((prev) => mergeCandles(prev, full.candles))
    } catch {
      // 1y already paints; the 5y expand is best-effort and silent.
    }
  }

  async function loadSets() {
    try {
      const data = await api.get<ScreeningSet[]>('/screen/sets')
      setSets(data)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return // global redirect
      setSets(null) // fall back to the embedded reports
    }
  }

  async function requestReport(setId: number) {
    if (detail?.reports.some((report) => report.set_id === setId) === true) return
    if (extraReports[setId] !== undefined || pendingReports.includes(setId)) return
    setPendingReports((ids) => [...ids, setId])
    setReportErrors((errors) => {
      const next = { ...errors }
      delete next[setId]
      return next
    })
    try {
      const data = await api.get<StockScreenReport>(
        `/stock/${encodeURIComponent(symbol)}/report?set_id=${setId}`,
      )
      setExtraReports((reports) => ({ ...reports, [setId]: data }))
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return // global redirect
      setReportErrors((errors) => ({
        ...errors,
        [setId]: e instanceof Error ? e.message : 'Failed to check this screen',
      }))
    } finally {
      setPendingReports((ids) => ids.filter((id) => id !== setId))
    }
  }

  useEffect(() => {
    if (symbol !== '') {
      setExtraReports({})
      setPendingReports([])
      setReportErrors({})
      setSets(null)
      setSelectedId(null)
      loadDetail()
      loadCandles()
      loadSets()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol])

  useEffect(() => {
    // 15-minute price poll: lightweight 1y refetch merged in place, so the
    // latest close lands without hammering upstream. Silent — never flashes
    // the skeleton.
    if (symbol === '') return
    const FIFTEEN_MINUTES = 15 * 60 * 1000
    const id = window.setInterval(() => {
      if (document.hidden) return
      void api
        .get<OhlcResponse>(`/stock/${encodeURIComponent(symbol)}/ohlc?range=1y&interval=1d`)
        .then((data) => {
          setCandles((prev) => mergeCandles(prev, data.candles))
          setCandlesError(null)
        })
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 401) return // global redirect
          setCandlesError(e instanceof Error ? e.message : 'Failed to load the chart')
        })
    }, FIFTEEN_MINUTES)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol])

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
              {latestPrice !== null ? (
                <Flex data-testid="header-price" align="center" gap={2} wrap="wrap">
                  <Text fontSize="sm" fontWeight="semibold">
                    ₹ <Num>{formatPrice(latestPrice.price)}</Num>
                  </Text>
                  {latestPrice.change !== null ? (
                    <Delta value={latestPrice.change} decimals={2} />
                  ) : null}
                  <Text fontSize="xs" color="fg.muted">
                    as of <Num>{latestPrice.asOf}</Num>
                  </Text>
                </Flex>
              ) : detail.price !== null ? (
                <Flex data-testid="header-price" align="center" gap={2} wrap="wrap">
                  <Text fontSize="sm" fontWeight="semibold">
                    ₹ <Num>{formatPrice(detail.price)}</Num>
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    as of <Num>{detail.price_as_of ?? detail.data_date}</Num>
                  </Text>
                </Flex>
              ) : null}
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

      <div data-testid="detail-halves" className="grid items-stretch gap-4 lg:grid-cols-2">
        <DescriptionCard profile={detail.profile} symbol={detail.symbol} name={detail.name} />
        <BlurFade className="h-full">
          <div className="flex h-full flex-col gap-3">
            <ScreenPicker
              options={screenOptions}
              selectedId={selectedId}
              onSelect={selectScreen}
            />
            <div className="min-h-0 flex-1">
              <ScreenReportCard
                name={selectedMeta?.name ?? detail.symbol}
                isActive={selectedMeta?.isActive ?? false}
                report={selectedReport?.report ?? null}
                pending={selectedId !== null && pendingReports.includes(selectedId)}
                error={selectedId !== null ? reportErrors[selectedId] : undefined}
                onRetry={() => {
                  if (selectedId !== null) void requestReport(selectedId)
                }}
              />
            </div>
          </div>
        </BlurFade>
      </div>

      <BlurFade>
        <section data-testid="price-chart" className="rounded-lg border border-border bg-card p-4">
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
              <StockChart candles={displayedCandles} />
            )}
          </div>
        </section>
      </BlurFade>

      <BlurFade>
        <PriceAccordion
          candles={candles}
          loading={candlesLoading}
          error={candlesError}
          onRetry={loadCandles}
          fallbackPrice={detail.price}
          fallbackAsOf={detail.price_as_of ?? detail.data_date}
        />
      </BlurFade>

      <FundamentalsPanel
        mainRatios={detail.main_ratios}
        has={detail.has}
        done={detail.done}
        otherGroups={detail.other_groups}
        criteria={selectedReport?.report.criteria ?? null}
      />

      <Financials symbol={detail.symbol} />
    </div>
  )
}
