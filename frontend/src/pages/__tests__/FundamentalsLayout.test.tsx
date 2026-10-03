import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useOutletContext } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FundamentalsLayout, {
  type FundamentalsOutletContext,
} from '../fundamentals/FundamentalsLayout'
import ScreeningCriteria from '../fundamentals/ScreeningCriteria'
import TopTen from '../fundamentals/TopTen'
import { api } from '../../api/client'
import { AuthProvider } from '../../auth/AuthContext'
import { RequireAuth } from '../../components/RequireAuth'
import { toaster } from '../../components/ui/toaster'
import { Provider } from '../../components/ui/provider'
import { StatusProvider, StatusRail } from '../../components/StatusRail'
import type { RatioSpec, RunJob, ScreeningSet } from '../../api/types'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number
    detail: string
    constructor(status: number, detail: string) {
      super(`API error ${status}: ${detail}`)
      this.status = status
      this.detail = detail
    }
  },
  AUTH_UNAUTHORIZED_EVENT: 'auth:unauthorized',
}))

vi.mock('../../components/ui/toaster', () => ({ toaster: { create: vi.fn() } }))

vi.mock('../../components/three/SakuraLeafLoader', () => ({
  default: () => <div data-testid="sakura-leaf-loader" />,
}))

const mockedApi = vi.mocked(api)

const setA: ScreeningSet = {
  id: 1,
  name: 'Default',
  criteria: [{ key: 'pe', enabled: true, value: 25 }],
  thesis: null,
  shortlist_size: 10,
  is_active: true,
  updated_at: 'now',
}

const setB: ScreeningSet = {
  id: 2,
  name: 'Quality',
  criteria: [{ key: 'pe', enabled: true, value: 15 }],
  thesis: null,
  shortlist_size: 10,
  is_active: false,
  updated_at: 'now',
}

const catalog: RatioSpec[] = [
  { key: 'pe', label: 'PE', unit: '×', category: 'Valuation', direction: 'max' },
]

const row = {
  symbol: 'TCS',
  rank: 1,
  score: 38.2,
  ratios: { pe: 22.1, pb: 4.1, roe: 41, roce: 50.2, debt_to_equity: 0.09 },
  name: 'Tata Consultancy Services',
  sector: 'IT',
  market_cap: 1200000,
}

const run = { run_id: 1, run_date: '2026-09-26', shortlisted: [row] }

function job(overrides: Partial<RunJob> = {}): RunJob {
  return {
    id: 7,
    set_id: 1,
    status: 'running',
    started_at: '2026-10-03T10:00:00.000Z',
    finished_at: null,
    error: null,
    universe_total: 500,
    universe_done: 10,
    universe_failed: 0,
    items: [
      {
        set_id: 1,
        name: 'Default',
        status: 'running',
        run_id: null,
        error: null,
        started_at: '2026-10-03T10:00:00.000Z',
        finished_at: null,
      },
      {
        set_id: 2,
        name: 'Quality',
        status: 'queued',
        run_id: null,
        error: null,
        started_at: null,
        finished_at: null,
      },
    ],
    ...overrides,
  }
}

const doneJob = job({
  status: 'done',
  finished_at: '2026-10-03T10:05:00.000Z',
  universe_done: 500,
  items: [
    {
      set_id: 1,
      name: 'Default',
      status: 'done',
      run_id: 2,
      error: null,
      started_at: '2026-10-03T10:00:00.000Z',
      finished_at: '2026-10-03T10:02:00.000Z',
    },
    {
      set_id: 2,
      name: 'Quality',
      status: 'done',
      run_id: 3,
      error: null,
      started_at: '2026-10-03T10:02:00.000Z',
      finished_at: '2026-10-03T10:05:00.000Z',
    },
  ],
})

/** Reads the outlet context into stable probes. F3 moved the real RunProgress
 * panel into TopTen, so the top10 route renders it next to these probes. */
function RunProbe() {
  const { busySetIds, stale, starting, runScreen } =
    useOutletContext<FundamentalsOutletContext>()
  return (
    <div>
      <span data-testid="probe-starting">{String(starting)}</span>
      <span data-testid="probe-stale">{String(stale)}</span>
      <span data-testid="probe-busy">
        {[...busySetIds].sort((a, b) => a - b).join(',')}
      </span>
      <button type="button" onClick={() => void runScreen()}>
        probe-run
      </button>
    </div>
  )
}

function renderLayout(path = '/fundamentals/criteria') {
  return render(
    <Provider>
      <StatusProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/fundamentals" element={<FundamentalsLayout />}>
              <Route path="criteria" element={<ScreeningCriteria />} />
              <Route path="top10" element={<><TopTen /><RunProbe /></>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </StatusProvider>
    </Provider>,
  )
}

function mockLoads() {
  mockedApi.get.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve({ id: 1, username: 'solo' })
    if (path === '/screen/sets') return Promise.resolve([setA, setB])
    if (path === '/screen/ratios') return Promise.resolve(catalog)
    if (path === '/screen/latest') return Promise.resolve(run)
    if (path === '/screen/jobs/latest') return Promise.resolve({ job: null })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

beforeEach(() => vi.resetAllMocks())

describe('FundamentalsLayout', () => {
  it('keeps the shortlist status fact while a sibling page is shown', async () => {
    mockLoads()
    render(
      <Provider>
        <StatusProvider>
          <MemoryRouter initialEntries={['/fundamentals/stocks']}>
            <Routes>
              <Route path="/fundamentals" element={<FundamentalsLayout />}>
                <Route path="criteria" element={<ScreeningCriteria />} />
                <Route path="stocks" element={<div>stocks stub</div>} />
              </Route>
            </Routes>
            <StatusRail />
          </MemoryRouter>
        </StatusProvider>
      </Provider>,
    )
    expect(await screen.findByText('stocks stub')).toBeInTheDocument()
    expect(await screen.findByTestId('status-rail')).toHaveTextContent('screen 1 shortlisted')
  })

  it('redirects to /login when a 401 event fires mid-session', async () => {
    mockLoads()
    render(
      <Provider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route
                path="/"
                element={
                  <RequireAuth>
                    <FundamentalsLayout />
                  </RequireAuth>
                }
              >
                <Route index element={<ScreeningCriteria />} />
              </Route>
              <Route path="/login" element={<div>login page</div>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </Provider>,
    )
    expect(await screen.findByRole('heading', { name: 'Screening Criteria' })).toBeInTheDocument()
    act(() => window.dispatchEvent(new Event('auth:unauthorized')))
    expect(await screen.findByText('login page')).toBeInTheDocument()
  })

  it('activates a screen and refetches the latest run', async () => {
    mockLoads()
    mockedApi.post.mockResolvedValue({ ...setB, is_active: true })
    render(
      <Provider>
        <StatusProvider>
          <MemoryRouter initialEntries={['/fundamentals/criteria']}>
            <Routes>
              <Route path="/fundamentals" element={<FundamentalsLayout />}>
                <Route path="criteria" element={<ScreeningCriteria />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </StatusProvider>
      </Provider>,
    )
    await screen.findByText('PE ≤ 25×')
    await userEvent.click(screen.getByRole('tab', { name: 'Quality' }))
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/screen/sets/2/activate', {}))
    await waitFor(() =>
      expect(mockedApi.get.mock.calls.filter(([path]) => path === '/screen/latest').length).toBe(2),
    )
    expect(await screen.findByText('PE ≤ 15×')).toBeInTheDocument()
  })

  it('posts /screen/run once and shows cached results while the job runs', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/sets') return Promise.resolve([setA, setB])
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') {
        return Promise.resolve({ run_id: 2, run_date: '2026-09-26', shortlisted: [row] })
      }
      if (path === '/screen/jobs/latest') return Promise.resolve({ job: null })
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    mockedApi.post.mockResolvedValue({
      run: { run_id: 2, shortlisted: [row], failed_count: 0, total: 500 },
      job: job(),
    })
    renderLayout()
    await userEvent.click(await screen.findByRole('button', { name: /run screen/i }))

    expect(await screen.findByTestId('probe-busy')).toHaveTextContent('1,2')
    expect(screen.getByTestId('job-chip-1')).toBeInTheDocument()
    expect(screen.getByTestId('probe-starting')).toHaveTextContent('false')
    expect(screen.getByTestId('probe-stale')).toHaveTextContent('false')
    expect(await screen.findByText('Tata Consultancy Services')).toBeInTheDocument()
    expect(
      mockedApi.post.mock.calls.filter(([path]) => path === '/screen/run').length,
    ).toBe(1)
  })

  it('restores a running job from the mount fetch and marks its screens busy', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/sets') return Promise.resolve([setA, setB])
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') return Promise.resolve(run)
      if (path === '/screen/jobs/latest') return Promise.resolve({ job: job() })
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    renderLayout('/fundamentals/top10')

    expect(await screen.findByTestId('job-chip-1')).toBeInTheDocument()
    expect(screen.getByTestId('probe-busy')).toHaveTextContent('1,2')
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('refreshes /screen/latest once when the poll reports done and stops polling', async () => {
    vi.useFakeTimers()
    try {
      let jobsCalls = 0
      let latestCalls = 0
      mockedApi.get.mockImplementation((path: string) => {
        if (path === '/screen/sets') return Promise.resolve([setA, setB])
        if (path === '/screen/ratios') return Promise.resolve(catalog)
        if (path === '/screen/latest') {
          latestCalls += 1
          return Promise.resolve({
            run_id: latestCalls,
            run_date: '2026-09-26',
            shortlisted: [row],
          })
        }
        if (path === '/screen/jobs/latest') {
          jobsCalls += 1
          return Promise.resolve({ job: jobsCalls === 1 ? job() : doneJob })
        }
        return Promise.reject(new Error(`unexpected GET ${path}`))
      })
      renderLayout('/fundamentals/top10')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByTestId('job-chip-1')).toBeInTheDocument()
      expect(latestCalls).toBe(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(jobsCalls).toBe(2)
      expect(latestCalls).toBe(2)
      expect(screen.getByTestId('job-status')).toHaveTextContent('Refreshed')
      expect(screen.getByTestId('probe-busy').textContent).toBe('')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000)
      })
      expect(jobsCalls).toBe(2)
      expect(latestCalls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps cached rows and warns when the poll reports failure', async () => {
    vi.useFakeTimers()
    try {
      let jobsCalls = 0
      let latestCalls = 0
      mockedApi.get.mockImplementation((path: string) => {
        if (path === '/screen/sets') return Promise.resolve([setA, setB])
        if (path === '/screen/ratios') return Promise.resolve(catalog)
        if (path === '/screen/latest') {
          latestCalls += 1
          return Promise.resolve({ run_id: 1, run_date: '2026-09-26', shortlisted: [row] })
        }
        if (path === '/screen/jobs/latest') {
          jobsCalls += 1
          return Promise.resolve({
            job:
              jobsCalls === 1
                ? job()
                : job({
                    status: 'failed',
                    error: 'job exploded',
                    finished_at: '2026-10-03T10:05:00.000Z',
                  }),
          })
        }
        return Promise.reject(new Error(`unexpected GET ${path}`))
      })
      renderLayout('/fundamentals/top10')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByText('Tata Consultancy Services')).toBeInTheDocument()
      expect(latestCalls).toBe(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(jobsCalls).toBe(2)
      expect(screen.getByText('Tata Consultancy Services')).toBeInTheDocument()
      expect(latestCalls).toBe(1)
      expect(toaster.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Screen run failed', type: 'warning' }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the stale badge when the poll reports terminal failure', async () => {
    vi.useFakeTimers()
    try {
      let jobsCalls = 0
      mockedApi.get.mockImplementation((path: string) => {
        if (path === '/screen/sets') return Promise.resolve([setA, setB])
        if (path === '/screen/ratios') return Promise.resolve(catalog)
        if (path === '/screen/latest') return Promise.resolve(run)
        if (path === '/screen/jobs/latest') {
          jobsCalls += 1
          return Promise.resolve({
            job:
              jobsCalls === 1
                ? null
                : job({
                    status: 'failed',
                    error: 'job exploded',
                    finished_at: '2026-10-03T10:05:00.000Z',
                  }),
          })
        }
        return Promise.reject(new Error(`unexpected GET ${path}`))
      })
      mockedApi.post.mockResolvedValue({
        run: { run_id: 1, shortlisted: [row], failed_count: 0, total: 500, stale: true },
        job: job(),
      })
      renderLayout('/fundamentals/top10')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      fireEvent.click(screen.getByText('probe-run'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByTestId('probe-stale')).toHaveTextContent('true')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(screen.getByTestId('probe-stale')).toHaveTextContent('false')
      expect(screen.getByText('Tata Consultancy Services')).toBeInTheDocument()
      expect(toaster.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Screen run failed', type: 'warning' }),
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
