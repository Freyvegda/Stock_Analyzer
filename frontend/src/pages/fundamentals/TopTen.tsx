/**
 * Top 10 Results — one saved screen at a time.
 *
 * The active screen paints from the layout's shared run state (live: it
 * follows runs to completion). Any other saved screen is read on demand
 * from its own latest stored run (`GET /screen/latest?set_id=`) — a pure
 * read that never writes. The glass `ScreenPicker` is shared with the stock
 * detail page; the table swap animates through `BlurFade` keyed by screen.
 */

import { useEffect, useState } from 'react'
import { Badge, Flex, Text } from '@chakra-ui/react'
import { Link, useOutletContext } from 'react-router-dom'
import { api, ApiError } from '@/api/client'
import type { LatestScreen } from '@/api/types'
import { RunProgress } from '@/components/RunProgress'
import { ScreenPicker } from '@/components/ScreenPicker'
import { ShortlistTable } from '@/components/ShortlistTable'
import { BlurFade } from '@/components/ui/BlurFade'
import { DotPattern } from '@/components/ui/DotPattern'
import { NumberTicker } from '@/components/ui/NumberTicker'
import { Num } from '@/components/ui/Num'
import type { FundamentalsOutletContext } from './FundamentalsLayout'

export default function TopTen() {
  const {
    sets,
    activeSet,
    rows,
    summary,
    verdict,
    lastRunDate,
    latestLoaded,
    latestError,
    running,
    job,
    stale,
  } = useOutletContext<FundamentalsOutletContext>()

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [picked, setPicked] = useState<LatestScreen | null>(null)
  const [pickedLoading, setPickedLoading] = useState(false)
  const [pickedMissing, setPickedMissing] = useState(false)
  const [pickedError, setPickedError] = useState<string | null>(null)

  const effectiveId = selectedId ?? activeSet?.id ?? null
  const showingActive = activeSet !== null && effectiveId === activeSet.id

  useEffect(() => {
    if (selectedId === null && activeSet !== null) setSelectedId(activeSet.id)
  }, [selectedId, activeSet])

  useEffect(() => {
    if (showingActive || effectiveId === null) {
      setPicked(null)
      setPickedMissing(false)
      setPickedError(null)
      setPickedLoading(false)
      return
    }
    let cancelled = false
    setPickedLoading(true)
    setPickedMissing(false)
    setPickedError(null)
    api
      .get<LatestScreen>(`/screen/latest?set_id=${effectiveId}`)
      .then((latest) => {
        if (cancelled) return
        setPicked(latest)
        setPickedLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setPickedLoading(false)
        if (e instanceof ApiError && e.status === 404) {
          setPicked(null)
          setPickedMissing(true)
          return
        }
        setPicked(null)
        setPickedError(e instanceof Error ? e.message : 'Failed to load that screen')
      })
    return () => {
      cancelled = true
    }
  }, [showingActive, effectiveId])

  const displayRows = showingActive ? rows : (picked?.shortlisted ?? [])
  const displayVerdict = showingActive ? verdict : (picked?.verdict ?? null)
  const displayRunDate = showingActive ? lastRunDate : (picked?.run_date ?? null)
  const displaySummary =
    summary !== null && showingActive
      ? summary
      : displayVerdict !== null
        ? {
            shortlisted: displayRows.length,
            failed: displayVerdict.failed,
            total: displayVerdict.total,
          }
        : null
  const displayLoaded = showingActive ? latestLoaded : !pickedLoading
  const displayError = showingActive ? latestError : pickedError

  const todayIso = (() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })()
  const storedDataDate =
    displayRows
      .map((r) => r.data_date)
      .filter((d): d is string => Boolean(d))
      .sort()[0] ?? null

  const emptyRun =
    displayError === null &&
    !running &&
    displayRows.length === 0 &&
    (displaySummary !== null || displayRunDate !== null) &&
    !pickedMissing
  const noRunYet =
    (displayError === null &&
      !running &&
      displayLoaded &&
      displayRows.length === 0 &&
      displaySummary === null &&
      displayRunDate === null) ||
    pickedMissing

  return (
    <div className="space-y-4">
      <Flex align="baseline" justify="space-between" gap={3} wrap="wrap">
        <Text as="h1" fontSize="xl" fontWeight="semibold">
          Top 10 Results
        </Text>
        {displaySummary !== null ? (
          <Text data-testid="summary" fontSize="sm" color="fg.muted">
            <Num>
              <NumberTicker value={displaySummary.shortlisted} />
            </Num>{' '}
            shortlisted ·{' '}
            <Num>
              <NumberTicker value={displaySummary.failed} />
            </Num>{' '}
            failed ·{' '}
            <Num>
              <NumberTicker value={displaySummary.total} />
            </Num>{' '}
            total
          </Text>
        ) : displayRunDate !== null ? (
          <Text data-testid="summary" fontSize="sm" color="fg.muted">
            Last run: {displayRunDate}
          </Text>
        ) : null}
        {storedDataDate !== null && storedDataDate !== todayIso ? (
          <Text data-testid="data-as-of" fontSize="sm" color="fg.muted">
            Data as of {storedDataDate}
          </Text>
        ) : null}
      </Flex>

      {sets.length > 0 ? (
        <ScreenPicker
          options={sets.map((set) => ({
            id: set.id,
            name: set.name,
            isActive: set.is_active,
            verdict: null,
          }))}
          selectedId={effectiveId}
          onSelect={setSelectedId}
          hideVerdict
        />
      ) : null}

      {showingActive && stale ? (
        <Badge data-testid="stale-badge" variant="outline" color="fg.muted">
          cached — refreshing in background
        </Badge>
      ) : null}

      {showingActive && job !== null ? <RunProgress job={job} verdict={verdict} /> : null}

      {displayError !== null ? (
        <Text role="alert" color="fg.error" fontSize="sm">
          {displayError}
        </Text>
      ) : null}

      {displayRows.length > 0 || !displayLoaded || (running && showingActive) ? (
        <BlurFade key={effectiveId ?? 'none'}>
          {/* Same card surface as the stocks table (see Stocks.tsx). */}
          <div className="rounded-lg border border-border bg-card p-4">
            <ShortlistTable rows={displayRows} loading={!displayLoaded} />
          </div>
        </BlurFade>
      ) : null}

      {emptyRun ? (
        <div className="relative overflow-hidden rounded-lg border border-border bg-card p-10 text-center">
          <DotPattern className="opacity-40" />
          <Text position="relative" color="fg.muted">
            No stocks passed the screen.
          </Text>
        </div>
      ) : null}

      {noRunYet ? (
        <div className="relative overflow-hidden rounded-lg border border-border bg-card p-10 text-center">
          <DotPattern className="opacity-40" />
          <Text position="relative" color="fg.muted">
            No screen run yet for this screen.{' '}
            <Link to="/fundamentals/criteria" className="underline underline-offset-4">
              Set criteria and run the screen
            </Link>
            .
          </Text>
        </div>
      ) : null}
    </div>
  )
}
