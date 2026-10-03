import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FundamentalsLayout from '../fundamentals/FundamentalsLayout'
import ScreeningCriteria from '../fundamentals/ScreeningCriteria'
import TopTen from '../fundamentals/TopTen'
import { api, ApiError } from '../../api/client'
import { toaster } from '../../components/ui/toaster'
import { Provider } from '../../components/ui/provider'
import { StatusProvider } from '../../components/StatusRail'
import type { RatioSpec, ScreeningSet } from '../../api/types'

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

// The real loader pulls the three.js chunk; these tests only need the run state.
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

const runningJob = {
  id: 10,
  set_id: 1,
  status: 'running',
  started_at: '2026-10-03T10:00:00.000Z',
  finished_at: null,
  error: null,
  universe_total: 500,
  universe_done: 40,
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
  ],
}

function renderTopTen(latest: unknown, path = '/fundamentals/top10') {
  mockedApi.get.mockImplementation((path: string) => {
    if (path === '/screen/sets') return Promise.resolve([setA])
    if (path === '/screen/ratios') return Promise.resolve(catalog)
    if (path === '/screen/latest') return Promise.resolve(latest)
    if (path === '/screen/jobs/latest') return Promise.resolve({ job: null })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
  return render(
    <Provider>
      <StatusProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/fundamentals" element={<FundamentalsLayout />}>
              <Route path="criteria" element={<ScreeningCriteria />} />
              <Route path="top10" element={<TopTen />} />
              <Route path="stocks" element={<div>stocks stub</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </StatusProvider>
    </Provider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('TopTen', () => {
  it('renders the latest run rows with stock metadata', async () => {
    renderTopTen({ run_id: 1, run_date: '2026-09-26', shortlisted: [row] })
    expect(await screen.findByText('Tata Consultancy Services')).toBeInTheDocument()
    expect(screen.getByText('IT')).toBeInTheDocument()
    expect(screen.getByText('1200000.0')).toBeInTheDocument()
  })

  it('names the extra screens a run evaluated, failures included', async () => {
    renderTopTen({ run_id: 1, run_date: '2026-09-26', shortlisted: [row] }, '/fundamentals/criteria')
    mockedApi.post.mockResolvedValue({
      run: {
        run_id: 5,
        shortlisted: [],
        failed_count: 0,
        total: 3,
        extra_runs: [
          { set_id: 2, name: 'Quality', run_id: 6, shortlisted: 7, error: null },
          { set_id: 3, name: 'Value', run_id: null, shortlisted: null, error: 'boom' },
        ],
      },
      extra_runs: [
        { set_id: 2, name: 'Quality', run_id: 6, shortlisted: 7, error: null },
        { set_id: 3, name: 'Value', run_id: null, shortlisted: null, error: 'boom' },
      ],
      job: null,
    })
    await screen.findByText('PE ≤ 25×')

    await userEvent.click(screen.getByRole('button', { name: /run screen/i }))

    const line = await screen.findByTestId('extra-runs')
    expect(line).toHaveTextContent('Quality (7)')
    expect(line).toHaveTextContent('Value (failed)')
  })

  it('shows skeleton rows while the latest run loads', async () => {
    let release: (value: unknown) => void = () => {}
    const gate = new Promise((resolve) => {
      release = resolve
    })
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/sets') return Promise.resolve([setA])
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') return gate
      if (path === '/screen/jobs/latest') return Promise.resolve({ job: null })
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    render(
      <Provider>
        <StatusProvider>
          <MemoryRouter initialEntries={['/fundamentals/top10']}>
            <Routes>
              <Route path="/fundamentals" element={<FundamentalsLayout />}>
                <Route path="top10" element={<TopTen />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </StatusProvider>
      </Provider>,
    )
    expect((await screen.findAllByTestId('skeleton')).length).toBeGreaterThan(0)
    release({ run_id: 1, run_date: '2026-09-26', shortlisted: [row] })
    expect(await screen.findByText('Tata Consultancy Services')).toBeInTheDocument()
  })

  it('shows empty state for a zero-row run', async () => {
    renderTopTen({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
    expect(await screen.findByText(/no stocks passed the screen/i)).toBeInTheDocument()
  })

  it('shows a data-as-of badge when the rows came from stored fundamentals', async () => {
    renderTopTen({ run_id: 1, run_date: '2026-09-26', shortlisted: [{ ...row, data_date: '2026-09-26' }] })
    expect(await screen.findByTestId('data-as-of')).toHaveTextContent('Data as of 2026-09-26')
  })

  it('renders the shortlist on the same card surface as the stocks table', async () => {
    renderTopTen({ run_id: 1, run_date: '2026-09-26', shortlisted: [row] })
    const table = await screen.findByRole('table')
    expect(table.closest('.bg-card')).not.toBeNull()
  })

  it('treats a 404 (no run yet) as an empty page without errors', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/sets') return Promise.resolve([setA])
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') return Promise.reject(new ApiError(404, 'No screen run yet'))
      if (path === '/screen/jobs/latest') return Promise.resolve({ job: null })
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    render(
      <Provider>
        <StatusProvider>
          <MemoryRouter initialEntries={['/fundamentals/top10']}>
            <Routes>
              <Route path="/fundamentals" element={<FundamentalsLayout />}>
                <Route path="top10" element={<TopTen />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </StatusProvider>
      </Provider>,
    )
    expect(await screen.findByText(/no screen run yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(toaster.create).not.toHaveBeenCalled()
  })

  it('shows a load error instead of the no-run state when /screen/latest fails', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/sets') return Promise.resolve([setA])
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') return Promise.reject(new ApiError(500, 'latest exploded'))
      if (path === '/screen/jobs/latest') return Promise.resolve({ job: null })
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    render(
      <Provider>
        <StatusProvider>
          <MemoryRouter initialEntries={['/fundamentals/top10']}>
            <Routes>
              <Route path="/fundamentals" element={<FundamentalsLayout />}>
                <Route path="top10" element={<TopTen />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </StatusProvider>
      </Provider>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/latest exploded/)
    expect(screen.queryByText(/no screen run yet/i)).not.toBeInTheDocument()
  })

  it('shows the progress panel while the run job is in flight', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/sets') return Promise.resolve([setA])
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') {
        return Promise.resolve({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
      }
      if (path === '/screen/jobs/latest') return Promise.resolve({ job: null })
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    mockedApi.post.mockResolvedValue({
      run: { run_id: 2, shortlisted: [], failed_count: 0, total: 500 },
      job: runningJob,
    })
    render(
      <Provider>
        <StatusProvider>
          <MemoryRouter initialEntries={['/fundamentals/criteria']}>
            <Routes>
              <Route path="/fundamentals" element={<FundamentalsLayout />}>
                <Route path="criteria" element={<ScreeningCriteria />} />
                <Route path="top10" element={<TopTen />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </StatusProvider>
      </Provider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: /run screen/i }))
    expect(await screen.findByTestId('run-progress')).toBeInTheDocument()
    expect(screen.getByTestId('job-chip-1')).toBeInTheDocument()
    expect(screen.queryByText(/run in progress/i)).not.toBeInTheDocument()
  })

  it('shows the stale badge alongside the progress panel when the run used stored fundamentals', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/sets') return Promise.resolve([setA])
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') {
        return Promise.resolve({ run_id: 2, run_date: '2026-09-26', shortlisted: [row] })
      }
      if (path === '/screen/jobs/latest') return Promise.resolve({ job: null })
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    mockedApi.post.mockResolvedValue({
      run: { run_id: 2, shortlisted: [row], failed_count: 0, total: 500, stale: true },
      job: runningJob,
    })
    render(
      <Provider>
        <StatusProvider>
          <MemoryRouter initialEntries={['/fundamentals/criteria']}>
            <Routes>
              <Route path="/fundamentals" element={<FundamentalsLayout />}>
                <Route path="criteria" element={<ScreeningCriteria />} />
                <Route path="top10" element={<TopTen />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </StatusProvider>
      </Provider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: /run screen/i }))
    expect(await screen.findByTestId('stale-badge')).toHaveTextContent(
      'cached — refreshing in background',
    )
    expect(screen.getByTestId('run-progress')).toBeInTheDocument()
    expect(screen.getByTestId('job-chip-1')).toBeInTheDocument()
  })
})
