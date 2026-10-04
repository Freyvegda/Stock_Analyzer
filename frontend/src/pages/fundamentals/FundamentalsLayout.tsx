/**
 * Fundamentals layout: side rail + content column, and the single owner of
 * saved-screen + screen-run state. Children read it through the outlet context
 * so a run survives side-nav navigation; the rail itself never unmounts.
 *
 * A run now paints the cached shortlist in seconds and then tracks its
 * background job with a 2 s `/screen/jobs/latest` poll, so progress survives
 * page reloads; completion refreshes the rows once, failure keeps them.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, api } from '@/api/client'
import type {
  ExtraRun,
  JobsLatestResponse,
  LatestScreen,
  RatioSpec,
  RunJob,
  RunResponse,
  ScreeningSet,
  ScreeningSetChanges,
  ScreenVerdict,
  ShortlistRow,
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
  sets: ScreeningSet[]
  activeSet: ScreeningSet | null
  setsError: string | null
  ratios: RatioSpec[]
  rows: ShortlistRow[]
  summary: RunSummary | null
  /** Active-screen universe verdict (criteria pass/fail) for the progress matrix. */
  verdict: ScreenVerdict | null
  lastRunDate: string | null
  latestLoaded: boolean
  latestError: string | null
  /** Latest run job, restored on mount and updated by the 2 s poll. */
  job: RunJob | null
  /** Screens with a `queued|running` item while the job runs; empty otherwise. */
  busySetIds: Set<number>
  /** The painted rows came from the stored snapshot of a still-running job. */
  stale: boolean
  /** `POST /screen/run` is in flight (cached rows are not painted yet). */
  starting: boolean
  /** `starting || job?.status === 'running'`. */
  running: boolean
  /** Total seconds of the current job, or the local starting timer. */
  elapsed: number
  runError: string | null
  extraRuns: ExtraRun[] | null
  reloadSets: () => Promise<void>
  activateSet: (id: number) => Promise<void>
  createSet: (name: string) => Promise<ScreeningSet>
  updateSet: (id: number, changes: ScreeningSetChanges) => Promise<ScreeningSet>
  deleteSet: (id: number) => Promise<void>
  runScreen: () => Promise<void>
}

export default function FundamentalsLayout() {
  const [sets, setSets] = useState<ScreeningSet[]>([])
  const [setsError, setSetsError] = useState<string | null>(null)
  const [ratios, setRatios] = useState<RatioSpec[]>([])
  const [rows, setRows] = useState<ShortlistRow[]>([])
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [verdict, setVerdict] = useState<ScreenVerdict | null>(null)
  const [lastRunDate, setLastRunDate] = useState<string | null>(null)
  const [job, setJob] = useState<RunJob | null>(null)
  const [starting, setStarting] = useState(false)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latestLoaded, setLatestLoaded] = useState(false)
  const [latestError, setLatestError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const completedJobRef = useRef<number | null>(null)
  const [extraRuns, setExtraRuns] = useState<ExtraRun[] | null>(null)

  const location = useLocation()
  const navigate = useNavigate()
  const locationRef = useRef(location.pathname)
  useEffect(() => {
    locationRef.current = location.pathname
  }, [location.pathname])

  const running = starting || job?.status === 'running'

  const busySetIds = useMemo(() => {
    if (job === null || job.status !== 'running') return new Set<number>()
    return new Set(
      job.items
        .filter((item) => item.status === 'queued' || item.status === 'running')
        .map((item) => item.set_id),
    )
  }, [job])

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
    setNow(Date.now())
    const id = window.setInterval(() => {
      setElapsed((seconds) => seconds + 1)
      setNow(Date.now())
    }, 1000)
    return () => window.clearInterval(id)
  }, [running])

  /** Whole seconds of a job: live from `started_at` while it runs, total
   * duration once it finished. */
  function jobElapsedSeconds(current: RunJob): number {
    const started = Date.parse(current.started_at)
    if (Number.isNaN(started)) return 0
    const end = current.finished_at !== null ? Date.parse(current.finished_at) : now
    if (Number.isNaN(end)) return 0
    return Math.max(0, Math.floor((end - started) / 1000))
  }

  const totalElapsed = job !== null ? jobElapsedSeconds(job) : elapsed

  async function loadSets() {
    try {
      setSets(await api.get<ScreeningSet[]>('/screen/sets'))
      setSetsError(null)
    } catch (e) {
      setSetsError(e instanceof Error ? e.message : 'Failed to load screening screens')
    }
  }

  async function loadRatios() {
    try {
      setRatios(await api.get<RatioSpec[]>('/screen/ratios'))
    } catch (e) {
      setSetsError(e instanceof Error ? e.message : 'Failed to load screening criteria')
    }
  }

  async function loadLatest() {
    try {
      const latest = await api.get<LatestScreen>('/screen/latest')
      setRows(latest.shortlisted)
      setLastRunDate(latest.run_date)
      setVerdict(latest.verdict ?? null)
      setLatestError(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // This screen has no run yet — clear the previous screen's results.
        setRows([])
        setLastRunDate(null)
        setLatestError(null)
        setSummary(null)
        setVerdict(null)
        return
      }
      const message = e instanceof Error ? e.message : 'Failed to load the latest run'
      setError(message)
      setLatestError(message)
    } finally {
      setLatestLoaded(true)
    }
  }

  /** Best-effort: a page reload mid-job restores the progress panel; a failure
   * just leaves the panel hidden. Never clobbers a job set by a just-started run
   * (the mount fetch can resolve after `runScreen`). */
  async function loadJob() {
    try {
      const res = await api.get<JobsLatestResponse>('/screen/jobs/latest')
      setJob((prev) => prev ?? res.job)
    } catch {
      // Progress is not worth an error banner.
    }
  }

  /** One terminal transition per job id: `done` refreshes once, `failed` and
   * `interrupted` warn and keep whatever rows are painted. */
  function applyJobUpdate(next: RunJob) {
    setJob(next)
    if (next.status === 'running') return
    if (completedJobRef.current === next.id) return
    completedJobRef.current = next.id
    if (next.status === 'done') {
      setStale(false)
      void loadLatest()
      return
    }
    // Terminal failure: the rows stay, but they are no longer "refreshing".
    setStale(false)
    toaster.create({
      title: next.status === 'failed' ? 'Screen run failed' : 'Screen run interrupted',
      description:
        next.error ??
        (next.status === 'failed'
          ? 'The background run failed — showing cached results'
          : 'The background run stopped before finishing — showing cached results'),
      type: 'warning',
    })
  }

  useEffect(() => {
    void loadSets()
    void loadRatios()
    void loadLatest()
    void loadJob()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (job === null || job.status !== 'running') return
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const res = await api.get<JobsLatestResponse>('/screen/jobs/latest')
          if (res.job !== null) applyJobUpdate(res.job)
        } catch {
          // Polling is best-effort; the cached run is already on screen.
        }
      })()
    }, 2000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, job?.id])

  async function reloadSets() {
    await loadSets()
  }

  async function activateSet(id: number) {
    const activated = await api.post<ScreeningSet>(`/screen/sets/${id}/activate`, {})
    setSets((prev) =>
      prev.map((set) =>
        set.id === activated.id ? activated : { ...set, is_active: false },
      ),
    )
    setSummary(null)
    setVerdict(null)
    setExtraRuns(null)
    await loadLatest()
  }

  async function createSet(name: string) {
    const created = await api.post<ScreeningSet>('/screen/sets', { name })
    setSummary(null)
    setVerdict(null)
    setExtraRuns(null)
    await loadSets()
    await loadLatest()
    return created
  }

  async function updateSet(id: number, changes: ScreeningSetChanges) {
    const saved = await api.put<ScreeningSet>(`/screen/sets/${id}`, changes)
    setSets((prev) => prev.map((set) => (set.id === saved.id ? saved : set)))
    return saved
  }

  async function deleteSet(id: number) {
    await api.delete<void>(`/screen/sets/${id}`)
    setSummary(null)
    setVerdict(null)
    setExtraRuns(null)
    await loadSets()
    await loadLatest()
  }

  async function runScreen() {
    setStarting(true)
    setError(null)
    try {
      const res = await api.post<RunResponse>('/screen/run', {})
      setSummary({
        shortlisted: res.run.shortlisted.length,
        failed: res.run.failed_count,
        total: res.run.total,
      })
      setExtraRuns(res.extra_runs ?? res.run.extra_runs ?? [])
      setVerdict(res.run.verdict ?? null)
      setStale(res.run.stale ?? false)
      setJob(res.job)
      if (res.run.stale) {
        toaster.create({
          title: 'Showing stored fundamentals',
          description: 'Live refresh was unavailable — results use the last saved data',
          type: 'warning',
        })
      }
      try {
        const latest = await api.get<LatestScreen>('/screen/latest')
        setRows(latest.shortlisted)
        setVerdict(latest.verdict ?? res.run.verdict ?? null)
        setLatestError(null)
      } catch (e) {
        // Session died mid-run: rethrow so the outer handler stays quiet; the
        // client's auth:unauthorized event redirects to /login.
        if (e instanceof ApiError && e.status === 401) throw e
        setRows(res.run.shortlisted)
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
      setStarting(false)
    }
  }

  const context: FundamentalsOutletContext = {
    sets,
    activeSet: sets.find((set) => set.is_active) ?? null,
    setsError,
    ratios,
    rows,
    summary,
    verdict,
    lastRunDate,
    latestLoaded,
    latestError,
    job,
    busySetIds,
    stale,
    starting,
    running,
    elapsed: totalElapsed,
    runError: error,
    extraRuns,
    reloadSets,
    activateSet,
    createSet,
    updateSet,
    deleteSet,
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
