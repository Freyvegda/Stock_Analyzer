/**
 * Top 10 Results — the shortlist the last screen run produced, read from the
 * layout's shared run state (no fetch of its own).
 */

import { Badge, Flex, Text } from '@chakra-ui/react'
import { Link, useOutletContext } from 'react-router-dom'
import { RunProgress } from '@/components/RunProgress'
import { ShortlistTable } from '@/components/ShortlistTable'
import { BlurFade } from '@/components/ui/BlurFade'
import { DotPattern } from '@/components/ui/DotPattern'
import { NumberTicker } from '@/components/ui/NumberTicker'
import { Num } from '@/components/ui/Num'
import type { FundamentalsOutletContext } from './FundamentalsLayout'

export default function TopTen() {
  const { rows, summary, lastRunDate, latestLoaded, latestError, running, job, stale, extraRuns } =
    useOutletContext<FundamentalsOutletContext>()

  const todayIso = (() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })()
  const storedDataDate =
    rows
      .map((r) => r.data_date)
      .filter((d): d is string => Boolean(d))
      .sort()[0] ?? null

  const emptyRun =
    latestError === null && !running && rows.length === 0 && (summary !== null || lastRunDate !== null)
  const noRunYet =
    latestError === null &&
    !running &&
    latestLoaded &&
    rows.length === 0 &&
    summary === null &&
    lastRunDate === null

  return (
    <div className="space-y-4">
      <Flex align="baseline" justify="space-between" gap={3} wrap="wrap">
        <Text as="h1" fontSize="xl" fontWeight="semibold">
          Top 10 Results
        </Text>
        {summary !== null ? (
          <Text data-testid="summary" fontSize="sm" color="fg.muted">
            <Num>
              <NumberTicker value={summary.shortlisted} />
            </Num>{' '}
            shortlisted ·{' '}
            <Num>
              <NumberTicker value={summary.failed} />
            </Num>{' '}
            failed ·{' '}
            <Num>
              <NumberTicker value={summary.total} />
            </Num>{' '}
            total
          </Text>
        ) : lastRunDate !== null ? (
          <Text data-testid="summary" fontSize="sm" color="fg.muted">
            Last run: {lastRunDate}
          </Text>
        ) : null}
        {storedDataDate !== null && storedDataDate !== todayIso ? (
          <Text data-testid="data-as-of" fontSize="sm" color="fg.muted">
            Data as of {storedDataDate}
          </Text>
        ) : null}
      </Flex>

      {stale ? (
        <Badge data-testid="stale-badge" variant="outline" color="fg.muted">
          cached — refreshing in background
        </Badge>
      ) : null}

      {job !== null ? <RunProgress job={job} /> : null}

      {extraRuns !== null && extraRuns.length > 0 ? (
        <Text data-testid="extra-runs" fontSize="xs" color="fg.muted">
          Also ran:{' '}
          {extraRuns.map((extra, index) => (
            <span key={extra.set_id}>
              {index > 0 ? ' · ' : ''}
              {extra.name}
              {extra.error !== null ? ' (failed)' : ` (${extra.shortlisted ?? 0})`}
            </span>
          ))}
        </Text>
      ) : null}

      {latestError !== null ? (
        <Text role="alert" color="fg.error" fontSize="sm">
          {latestError}
        </Text>
      ) : null}

      {rows.length > 0 || !latestLoaded || running ? (
        <BlurFade>
          {/* Same card surface as the stocks table (see Stocks.tsx). */}
          <div className="rounded-lg border border-border bg-card p-4">
            <ShortlistTable rows={rows} loading={!latestLoaded} />
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
