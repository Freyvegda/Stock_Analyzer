import { render, screen, waitFor } from '@testing-library/react'
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
import type { RatioSpec, UserCriteria } from '../../api/types'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
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

const mockedApi = vi.mocked(api)

const criteria: UserCriteria = {
  criteria: [
    { key: 'pe', enabled: true, value: 25 },
    { key: 'roe', enabled: true, value: 15 },
  ],
  thesis: null,
  shortlist_size: 10,
}

const catalog: RatioSpec[] = [
  { key: 'pe', label: 'PE', unit: '×', category: 'Valuation', direction: 'max' },
  { key: 'roe', label: 'ROE', unit: '%', category: 'Profitability', direction: 'min' },
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

function mockLoads(latest: unknown) {
  mockedApi.get.mockImplementation((path: string) => {
    if (path === '/screen/criteria') return Promise.resolve(criteria)
    if (path === '/screen/ratios') return Promise.resolve(catalog)
    if (path === '/screen/latest') return Promise.resolve(latest)
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

function renderFundamentals(path = '/fundamentals/criteria') {
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

describe('ScreeningCriteria', () => {
  it('renders criteria badges from the per-user criteria endpoint', async () => {
    mockLoads({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
    renderFundamentals()
    expect(await screen.findByText('PE ≤ 25×')).toBeInTheDocument()
    expect(screen.getByText('ROE ≥ 15%')).toBeInTheDocument()
    expect(screen.getByText('Top 10')).toBeInTheDocument()
  })

  it('keeps run feedback inline: disabled button, leaf loader and elapsed timer', async () => {
    mockLoads({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
    mockedApi.post.mockReturnValue(new Promise(() => {}))
    renderFundamentals()
    await userEvent.click(await screen.findByRole('button', { name: /run screen/i }))
    expect(await screen.findByTestId('sakura-leaf-loader')).toBeInTheDocument()
    expect(screen.getByTestId('elapsed')).toHaveTextContent('00:00')
    expect(screen.getByRole('button', { name: /running/i })).toBeDisabled()
  })

  it('jumps to the top 10 page when a run finishes while on the criteria page', async () => {
    let latestCalls = 0
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/criteria') return Promise.resolve(criteria)
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') {
        latestCalls += 1
        return Promise.resolve(
          latestCalls === 1
            ? { run_id: 1, run_date: '2026-09-26', shortlisted: [] }
            : { run_id: 2, run_date: '2026-09-26', shortlisted: [row] },
        )
      }
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    mockedApi.post.mockResolvedValue({
      run_id: 2,
      shortlisted: [row],
      failed_count: 0,
      total: 500,
    })
    renderFundamentals()
    await userEvent.click(await screen.findByRole('button', { name: /run screen/i }))
    expect(await screen.findByRole('heading', { name: 'Top 10 Results' })).toBeInTheDocument()
    expect(await screen.findByText('Tata Consultancy Services')).toBeInTheDocument()
  })

  it('does not jump when the user left the criteria page mid-run, and keeps the run state', async () => {
    mockLoads({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
    let release: (value: unknown) => void = () => {}
    mockedApi.post.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    renderFundamentals()
    await userEvent.click(await screen.findByRole('button', { name: /run screen/i }))
    await userEvent.click(screen.getByRole('link', { name: 'Stocks' }))
    expect(await screen.findByText('stocks stub')).toBeInTheDocument()
    release({ run_id: 2, shortlisted: [row], failed_count: 0, total: 500 })
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(4))
    expect(screen.queryByRole('heading', { name: 'Top 10 Results' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Screen Criteria' }))
    await waitFor(() =>
      expect(screen.getByTestId('summary')).toHaveTextContent(
        '1 shortlisted · 0 failed · 500 total',
      ),
    )
    expect(screen.getByRole('button', { name: /run screen/i })).toBeEnabled()
  })

  it('warns when a run falls back to stored fundamentals', async () => {
    mockLoads({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
    mockedApi.post.mockResolvedValue({
      run_id: 2,
      shortlisted: [],
      failed_count: 3,
      total: 500,
      stale: true,
    })
    renderFundamentals()
    await userEvent.click(await screen.findByRole('button', { name: /run screen/i }))
    await waitFor(() =>
      expect(toaster.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' })),
    )
  })

  it('shows the panel error when criteria loading fails', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/latest') {
        return Promise.resolve({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
      }
      return Promise.reject(new Error('criteria exploded'))
    })
    renderFundamentals()
    expect(await screen.findByRole('alert')).toHaveTextContent(/criteria exploded/)
  })

  it('treats a 401 after a successful run as a session end, not a warning', async () => {
    let latestCalls = 0
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/criteria') return Promise.resolve(criteria)
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') {
        latestCalls += 1
        if (latestCalls === 1) {
          return Promise.resolve({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
        }
        return Promise.reject(new ApiError(401, 'Not authenticated'))
      }
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    mockedApi.post.mockResolvedValue({ run_id: 2, shortlisted: [], failed_count: 0, total: 0 })
    renderFundamentals()
    await userEvent.click(await screen.findByRole('button', { name: /run screen/i }))
    await waitFor(() => expect(latestCalls).toBe(2))
    expect(toaster.create).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a data-as-of badge when the shortlist came from stored fundamentals', async () => {
    mockLoads({
      run_id: 1,
      run_date: '2026-09-26',
      shortlisted: [{ ...row, data_date: '2026-09-26' }],
    })
    renderFundamentals()
    expect(await screen.findByTestId('data-as-of')).toHaveTextContent('Data as of 2026-09-26')
  })

  it('hides the data-as-of badge when rows carry no stored date', async () => {
    mockLoads({ run_id: 1, run_date: '2026-09-26', shortlisted: [row] })
    renderFundamentals()
    expect(await screen.findByText('PE ≤ 25×')).toBeInTheDocument()
    expect(screen.queryByTestId('data-as-of')).not.toBeInTheDocument()
  })

  it('updates the badges when the criteria dialog saves', async () => {
    mockLoads({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
    mockedApi.put.mockResolvedValue({
      criteria: [{ key: 'pe', enabled: true, value: 18 }],
      thesis: null,
      shortlist_size: 10,
    })
    renderFundamentals()
    await screen.findByText('PE ≤ 25×')
    await userEvent.click(screen.getByRole('button', { name: /edit criteria/i }))
    const peInput = await screen.findByLabelText('PE value')
    await userEvent.clear(peInput)
    await userEvent.type(peInput, '18')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText('PE ≤ 18×')).toBeInTheDocument()
    expect(mockedApi.put).toHaveBeenCalledWith('/screen/criteria', expect.anything())
  })
})
