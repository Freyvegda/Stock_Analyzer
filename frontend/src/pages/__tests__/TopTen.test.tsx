import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FundamentalsLayout from '../fundamentals/FundamentalsLayout'
import ScreeningCriteria from '../fundamentals/ScreeningCriteria'
import TopTen from '../fundamentals/TopTen'
import { api, ApiError } from '../../api/client'
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
  criteria: [{ key: 'pe', enabled: true, value: 25 }],
  thesis: null,
  shortlist_size: 10,
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

function renderTopTen(latest: unknown) {
  mockedApi.get.mockImplementation((path: string) => {
    if (path === '/screen/criteria') return Promise.resolve(criteria)
    if (path === '/screen/ratios') return Promise.resolve(catalog)
    if (path === '/screen/latest') return Promise.resolve(latest)
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
  return render(
    <Provider>
      <StatusProvider>
        <MemoryRouter initialEntries={['/fundamentals/top10']}>
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

  it('shows skeleton rows while the latest run loads', async () => {
    let release: (value: unknown) => void = () => {}
    const gate = new Promise((resolve) => {
      release = resolve
    })
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/criteria') return Promise.resolve(criteria)
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') return gate
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

  it('treats a 404 (no run yet) as an empty page without errors', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/criteria') return Promise.resolve(criteria)
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') return Promise.reject(new ApiError(404, 'No screen run yet'))
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
  })
})
