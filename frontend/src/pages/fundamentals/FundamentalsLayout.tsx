/**
 * Fundamentals layout: side rail + content column, and the single owner of
 * screen-run state. Children read it through the outlet context so a run
 * survives side-nav navigation; the rail itself never unmounts.
 */

import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, api } from '@/api/client'
import type {
  LatestScreen,
  RatioSpec,
  ScreenRunResult,
  ShortlistRow,
  UserCriteria,
} from '@/api/types'
import { FundamentalNav } from '@/components/FundamentalNav'
import { useStatusFact } from '@/components/StatusRail'
import { toaster } from '@/components/ui/toaster'

export interface RunSummary {
  shortlisted: number
  failed: number
  total: number
}

export interface FundamentalsOutletContext {
  criteria: UserCriteria | null
  ratios: RatioSpec[]
  criteriaError: string | null
  rows: ShortlistRow[]
  summary: RunSummary | null
  lastRunDate: string | null
  latestLoaded: boolean
  latestError: string | null
  running: boolean
  elapsed: number
  runError: string | null
  saveCriteria: (saved: UserCriteria) => void
  runScreen: () => Promise<void>
}

export default function FundamentalsLayout() {
  const [criteria, setCriteria] = useState<UserCriteria | null>(null)
  const [ratios, setRatios] = useState<RatioSpec[]>([])
  const [criteriaError, setCriteriaError] = useState<string | null>(null)
  const [rows, setRows] = useState<ShortlistRow[]>([])
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [lastRunDate, setLastRunDate] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latestLoaded, setLatestLoaded] = useState(false)
  const [latestError, setLatestError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const location = useLocation()
  const navigate = useNavigate()
  const locationRef = useRef(location.pathname)
  useEffect(() => {
    locationRef.current = location.pathname
  }, [location.pathname])

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
      setLatestError(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return // no run yet
      const message = e instanceof Error ? e.message : 'Failed to load the latest run'
      setError(message)
      setLatestError(message)
    } finally {
      setLatestLoaded(true)
    }
  }

  useEffect(() => {
    loadCriteria()
    loadLatest()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (res.stale) {
        toaster.create({
          title: 'Showing stored fundamentals',
          description: 'Live refresh was unavailable — results use the last saved data',
          type: 'warning',
        })
      }
      try {
        const latest = await api.get<LatestScreen>('/screen/latest')
        setRows(latest.shortlisted)
        setLatestError(null)
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
      // Auto-jump only when the user is still watching the criteria page; a
      // deliberate navigation mid-run means they are not waiting on results.
      if (locationRef.current === '/fundamentals/criteria') {
        navigate('/fundamentals/top10')
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

  const context: FundamentalsOutletContext = {
    criteria,
    ratios,
    criteriaError,
    rows,
    summary,
    lastRunDate,
    latestLoaded,
    latestError,
    running,
    elapsed,
    runError: error,
    saveCriteria: setCriteria,
    runScreen,
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      <aside className="md:sticky md:top-24 md:w-56 md:shrink-0 md:pl-1">
        <FundamentalNav />
      </aside>
      <div className="min-w-0 flex-1 space-y-4">
        <Outlet context={context} />
      </div>
    </div>
  )
}
