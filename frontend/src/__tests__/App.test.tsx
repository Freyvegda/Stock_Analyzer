/**
 * App-level routing shell: redirects (`/` → `/fundamentals/criteria`,
 * `/stocks` → `/fundamentals/stocks`) and the fact that the fundamentals rail
 * only exists inside the fundamentals tree.
 */

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { api } from '../api/client'
import { AuthProvider } from '../auth/AuthContext'
import { Provider } from '../components/ui/provider'
import type { RatioSpec, ScreeningSet, StockListResponse } from '../api/types'

vi.mock('../api/client', () => ({
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

vi.mock('../components/three/Bonfire', () => ({ default: () => null }))

const mockedApi = vi.mocked(api)

const screeningSet: ScreeningSet = {
  id: 1,
  name: 'Default',
  criteria: [
    { key: 'pe', enabled: true, value: 25 },
    { key: 'roe', enabled: true, value: 15 },
  ],
  thesis: null,
  shortlist_size: 10,
  is_active: true,
  updated_at: 'now',
}

const catalog: RatioSpec[] = [
  { key: 'pe', label: 'PE', unit: '×', category: 'Valuation', direction: 'max' },
  { key: 'roe', label: 'ROE', unit: '%', category: 'Profitability', direction: 'min' },
]

const stockList: StockListResponse = {
  as_of: '2026-09-26',
  total: 1,
  rows: [
    {
      symbol: 'TCS',
      name: 'Tata Consultancy Services',
      sector: 'IT',
      market_cap: 1200000,
      pe: 22.1,
      pb: 4.1,
      roe: 41,
      roce: 50.2,
      debt_to_equity: 0.09,
      data_date: '2026-09-26',
      passes: 2,
      enabled: 2,
      verdict: 'pass',
    },
  ],
}

function mockApi() {
  mockedApi.get.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve({ id: 1, username: 'solo' })
    if (path === '/screen/sets') return Promise.resolve([screeningSet])
    if (path === '/screen/ratios') return Promise.resolve(catalog)
    if (path === '/screen/latest') {
      return Promise.resolve({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
    }
    if (path === '/stocks') return Promise.resolve(stockList)
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

function renderApp(path: string) {
  return render(
    <Provider>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </Provider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('App routing shell', () => {
  it('sends / to the criteria page inside the fundamentals shell', async () => {
    mockApi()
    renderApp('/')
    expect(await screen.findByText('PE ≤ 25×', undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Fundamental analysis' })).toBeInTheDocument()
  })

  it('sends /stocks to the stocks page inside the fundamentals shell', async () => {
    mockApi()
    renderApp('/stocks')
    expect(await screen.findByText('Nifty 500')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Fundamental analysis' })).toBeInTheDocument()
  })

  it('renders no fundamentals rail outside the fundamentals tree', async () => {
    mockApi()
    renderApp('/backtest')
    expect(await screen.findByText('Price Model & Backtest')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Fundamental analysis' })).not.toBeInTheDocument()
  })
})
