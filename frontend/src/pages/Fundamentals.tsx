import { useEffect, useState } from 'react'
import { Button, Flex, Text } from '@chakra-ui/react'
import { ApiError, api } from '../api/client'
import type { LatestScreen, RatioSpec, ScreenRunResult, ShortlistRow, UserCriteria } from '../api/types'
import { CriteriaDialog } from '../components/CriteriaDialog'
import { CriteriaPanel } from '../components/CriteriaPanel'
import { ShortlistTable } from '../components/ShortlistTable'
import { Num } from '../components/ui/Num'
import { useStatusFact } from '../components/StatusRail'
import { formatElapsed } from '../lib/format'
import { BlurFade } from '../components/ui/BlurFade'
import { BorderBeam } from '../components/ui/BorderBeam'
import { DotPattern } from '../components/ui/DotPattern'
import { NumberTicker } from '../components/ui/NumberTicker'
import { StairTowerLoader } from '../components/ui/StairTowerLoader'
import { toaster } from '../components/ui/toaster'

interface RunSummary {
  shortlisted: number
  failed: number
  total: number
}

export default function Fundamentals() {
  const [criteria, setCriteria] = useState<UserCriteria | null>(null)
  const [ratios, setRatios] = useState<RatioSpec[]>([])
  const [criteriaError, setCriteriaError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [rows, setRows] = useState<ShortlistRow[]>([])
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [lastRunDate, setLastRunDate] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latestLoaded, setLatestLoaded] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const statusFact =
    summary !== null
      ? `${summary.shortlisted} shortlisted`
      : rows.length > 0
        ? `${rows.length} shortlisted`
        : lastRunDate !== null
          ? `last run ${lastRunDate}`
          : null
  useStatusFact('screen', statusFact)

  useEffect(() => {
    if (!running) {
      setElapsed(0)
      return
    }
    const id = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000)
    return () => window.clearInterval(id)
  }, [running])

  async function loadCriteria() {
    try {
      const [saved, ratioList] = await Promise.all([
        api.get<UserCriteria>('/screen/criteria'),
        api.get<RatioSpec[]>('/screen/ratios'),
      ])
      setCriteria(saved)
      setRatios(ratioList)
      setCriteriaError(null)
    } catch (e) {
      setCriteriaError(e instanceof Error ? e.message : 'Failed to load screening criteria')
    }
  }

  async function loadLatest() {
    try {
      const latest = await api.get<LatestScreen>('/screen/latest')
      setRows(latest.shortlisted)
      setLastRunDate(latest.run_date)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return // no run yet
      setError(e instanceof Error ? e.message : 'Failed to load the latest run')
    } finally {
      setLatestLoaded(true)
    }
  }

  useEffect(() => {
    loadCriteria()
    loadLatest()
  }, [])

  async function runScreen() {
    setRunning(true)
    setError(null)
    try {
      const res = await api.post<ScreenRunResult>('/screen/run', {})
      setSummary({
        shortlisted: res.shortlisted.length,
        failed: res.failed_count,
        total: res.total,
      })
      try {
        const latest = await api.get<LatestScreen>('/screen/latest')
        setRows(latest.shortlisted)
      } catch (e) {
        // Session died mid-run: rethrow so the outer handler stays quiet; the
        // client's auth:unauthorized event redirects to /login.
        if (e instanceof ApiError && e.status === 401) throw e
        setRows(res.shortlisted)
        toaster.create({
          title: 'Showing screen result',
          description: 'Could not load enriched rows from the latest run',
          type: 'warning',
        })
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return // global event handles the redirect
      const message = e instanceof Error ? e.message : 'Screen run failed'
      setError(message)
      toaster.create({ title: 'Screen run failed', description: message, type: 'error' })
    } finally {
      setRunning(false)
    }
  }

  const emptyState = !running && rows.length === 0 && (summary !== null || lastRunDate !== null)

  return (
    <div className="space-y-4">
      <Text fontSize="xl" fontWeight="semibold">
        Fundamental Analysis
      </Text>

      <CriteriaPanel
        criteria={criteria}
        ratios={ratios}
        onEdit={() => setDialogOpen(true)}
        error={criteriaError}
      />

      <CriteriaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={(saved) => setCriteria(saved)}
      />

      <BlurFade>
        <div className="relative overflow-hidden rounded-lg border border-border bg-card p-4">
          <BorderBeam active={running} />
          <Flex align="center" gap={4} wrap="wrap">
            <Button
              colorPalette="amber"
              loading={running}
              loadingText="Running…"
              onClick={runScreen}
            >
              Run Screen
            </Button>
            {running ? (
              <>
                <Text fontSize="sm" color="fg.muted">
                  Fetching fundamentals for ~500 stocks — takes a few minutes
                </Text>
                <Text data-testid="elapsed" fontSize="sm" color="fg.muted">
                  <Num>{formatElapsed(elapsed)}</Num>
                </Text>
                <StairTowerLoader size={120} label="Running screen…" />
              </>
            ) : null}
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
          </Flex>
        </div>
      </BlurFade>

      {/* CriteriaPanel already renders this failure with role="alert"; avoid a duplicate alert. */}
      {error !== null && criteriaError === null ? (
        <Text role="alert" color="fg.error" fontSize="sm">
          {error}
        </Text>
      ) : null}

      {rows.length > 0 || !latestLoaded ? (
        <BlurFade>
          <ShortlistTable rows={rows} loading={!latestLoaded} />
        </BlurFade>
      ) : null}

      {emptyState ? (
        <div className="relative overflow-hidden rounded-lg border border-border bg-card p-10 text-center">
          <DotPattern className="opacity-40" />
          <Text position="relative" color="fg.muted">
            No stocks passed the screen.
          </Text>
        </div>
      ) : null}
    </div>
  )
}
