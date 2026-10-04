import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import StockDetail from '../StockDetail'
import { Provider } from '../../components/ui/provider'
import type { OhlcResponse, StockDetail as StockDetailData } from '../../api/types'
import { api } from '../../api/client'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {
    status = 500
    constructor(status: number, detail: string) {
      super(`API error ${status}: ${detail}`)
      this.status = status
    }
  },
  AUTH_UNAUTHORIZED_EVENT: 'auth:unauthorized',
}))

vi.mock('../../components/ui/toaster', () => ({ toaster: { create: vi.fn() } }))
vi.mock('../../components/StockChart', () => ({
  StockChart: () => <div data-testid="stock-chart-stub" />,
}))

const mockedApi = vi.mocked(api)

const detail: StockDetailData = {
  symbol: 'TCS',
  name: 'Tata Consultancy Services',
  sector: 'IT',
  market_cap: 1200000,
  price: 3100.5,
  price_as_of: '2026-09-26',
  snapshot: { date: '2026-09-26', pe: 22.1, pb: 4.1, roe: 41, roce: 50.2, debt_to_equity: 0.09, data_status: 'ok' },
  reports: [
    {
      set_id: 1,
      name: 'Default',
      is_active: true,
      report: {
        verdict: 'pass',
        score: 12.3,
        passed: 2,
        enabled: 2,
        criteria: [
          { key: 'pe', label: 'P/E', unit: '×', direction: 'max', threshold: 25, value: 22.1, passed: true, delta: -2.9 },
          { key: 'roe', label: 'ROE', unit: '%', direction: 'min', threshold: 15, value: 41, passed: true, delta: 26 },
        ],
        notes: [],
        groups: [],
      },
    },
  ],
  data_date: '2026-09-26',
  stale: false,
  run: null,
  refreshed: null,
  warning: null,
  profile: { description: 'IT services', industry: 'IT', sector: 'Tech', website: null, employees: null, hq: null },
  main_ratios: [
    { key: 'pe', label: 'P/E', unit: '×', value: 22.1 },
    { key: 'roe', label: 'ROE', unit: '%', value: 41 },
  ],
  has: [{ key: 'totalRevenue', label: 'Revenue', unit: '₹ cr', value: 250000 }],
  done: [{ key: 'revenueGrowth', label: 'Revenue Growth', unit: '%', value: 8.5 }],
  other_groups: [{ category: 'Risk', metrics: [{ key: 'beta', label: 'Beta', unit: '×', value: 0.8 }] }],
}

const ohlc: OhlcResponse = {
  symbol: 'TCS',
  range: '1y',
  interval: '1d',
  as_of: '2026-09-26',
  candles: [{ time: '2026-09-26', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }],
}

describe('StockDetail fundamentals explorer', () => {
  it('renders one fundamentals panel with technical nav below the price accordion', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path.startsWith('/stock/TCS/ohlc')) return Promise.resolve(ohlc)
      if (path === '/stock/TCS') return Promise.resolve(detail)
      if (path === '/screen/sets') return Promise.resolve([])
      if (path === '/stock/TCS/financials') return Promise.resolve({ symbol: 'TCS', quarterly: [], annual: [], as_of: null, stale: false })
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    render(
      <Provider>
        <MemoryRouter initialEntries={['/stock/TCS']}>
          <Routes>
            <Route path="/stock/:symbol" element={<StockDetail />} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    )
    expect(await screen.findByTestId('fundamentals-panel')).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: /fundamentals sections/i })).toBeInTheDocument()
    expect(screen.queryByText('Main fundamental ratios')).not.toBeInTheDocument()
    expect(screen.queryByText('What it has')).not.toBeInTheDocument()
  })
})
