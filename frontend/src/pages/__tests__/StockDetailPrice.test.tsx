import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StockDetail from '../StockDetail'
import { api } from '../../api/client'
import { Provider } from '../../components/ui/provider'
import type { OhlcResponse, StockDetail as StockDetailData } from '../../api/types'

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
vi.mock('../../components/StockChart', () => ({
  StockChart: ({ candles }: { candles: unknown[] }) => (
    <div data-testid="stock-chart-stub">{candles.length} candles</div>
  ),
}))

const mockedApi = vi.mocked(api)

function detailFixture(): StockDetailData {
  return {
    symbol: 'TCS',
    name: 'Tata Consultancy Services',
    sector: 'IT',
    market_cap: 1200000,
    price: 3100.5,
    price_as_of: '2026-09-26',
    snapshot: { date: '2026-09-26', pe: 22.1, pb: 4.1, roe: 41, roce: 50.2, debt_to_equity: 0.09, data_status: 'ok' },
    reports: [
      {
        set_id: 1, name: 'Default', is_active: true,
        report: { verdict: 'pass', score: 12.3, passed: 2, enabled: 2, criteria: [], notes: [], groups: [] },
      },
    ],
    data_date: '2026-09-26',
    stale: true,
    run: null,
    refreshed: null,
    warning: null,
    profile: { description: 'IT services', industry: 'IT', sector: 'Tech', website: null, employees: null, hq: null },
    main_ratios: [],
    has: [],
    done: [],
    other_groups: [],
  }
}

function ohlcFixture(closes: number[]): OhlcResponse {
  return {
    symbol: 'TCS', range: '5y', interval: '1d', as_of: '2026-09-26',
    candles: closes.map((close, i) => ({
      time: `2026-09-${String(25 + i).padStart(2, '0')}`,
      open: close - 1, high: close + 1, low: close - 2, close, volume: 1000,
    })),
  }
}

function renderPage() {
  return render(
    <Provider>
      <MemoryRouter initialEntries={['/stock/TCS']}>
        <Routes>
          <Route path="/stock/:symbol" element={<StockDetail />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('StockDetail price', () => {
  it('shows header price beside stock and accordion with OHLCV', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path.startsWith('/stock/TCS/ohlc')) return Promise.resolve(ohlcFixture([100, 110]))
      if (path === '/stock/TCS') return Promise.resolve(detailFixture())
      if (path === '/screen/sets') return Promise.resolve([])
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    renderPage()

    expect(await screen.findByTestId('header-price')).toHaveTextContent('110')
    expect(await screen.findByTestId('price-accordion')).toBeInTheDocument()
    expect(screen.getAllByText('2026-09-26').length).toBeGreaterThanOrEqual(2)
  })

  it('polls ohlc every 15 minutes silently', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')
    mockedApi.get.mockImplementation((path: string) => {
      if (path.startsWith('/stock/TCS/ohlc')) return Promise.resolve(ohlcFixture([100, 110]))
      if (path === '/stock/TCS') return Promise.resolve(detailFixture())
      if (path === '/screen/sets') return Promise.resolve([])
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    const { unmount } = renderPage()
    await screen.findByTestId('header-price')

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15 * 60 * 1000)

    const pollFn = setIntervalSpy.mock.calls[0][0] as () => void
    mockedApi.get.mockImplementation((path: string) => {
      if (path.startsWith('/stock/TCS/ohlc')) return Promise.resolve(ohlcFixture([100, 120]))
      if (path === '/stock/TCS') return Promise.resolve(detailFixture())
      if (path === '/screen/sets') return Promise.resolve([])
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    pollFn()
    const matches = await screen.findAllByText('120.00')
    expect(matches.length).toBeGreaterThanOrEqual(2)
    const ohlcCalls = mockedApi.get.mock.calls.filter((c) => String(c[0]).includes('/ohlc')).length
    expect(ohlcCalls).toBeGreaterThanOrEqual(2)

    unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it('shows fallback fast then live price, never stored tag', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path.startsWith('/stock/TCS/ohlc')) return Promise.reject(new Error('chart down'))
      if (path === '/stock/TCS') return Promise.resolve(detailFixture())
      if (path === '/screen/sets') return Promise.resolve([])
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    renderPage()

    const header = await screen.findByTestId('header-price')
    expect(header).toHaveTextContent('3100.5')
    expect(header.textContent ?? '').not.toMatch(/stored/i)
    expect(await screen.findByTestId('price-accordion')).toHaveTextContent('3100.5')
  })
})
