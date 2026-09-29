import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FundamentalsLayout from '../fundamentals/FundamentalsLayout'
import ScreeningCriteria from '../fundamentals/ScreeningCriteria'
import { api } from '../../api/client'
import { AuthProvider } from '../../auth/AuthContext'
import { RequireAuth } from '../../components/RequireAuth'
import { Provider } from '../../components/ui/provider'
import { StatusProvider, StatusRail } from '../../components/StatusRail'
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

function mockLoads() {
  mockedApi.get.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve({ id: 1, username: 'solo' })
    if (path === '/screen/sets') return Promise.resolve([setA, setB])
    if (path === '/screen/ratios') return Promise.resolve(catalog)
    if (path === '/screen/latest') return Promise.resolve(run)
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
})
