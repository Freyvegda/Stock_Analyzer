import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StockDetail from '../StockDetail'
import { api, ApiError } from '../../api/client'
import { Provider } from '../../components/ui/provider'
import { toaster } from '../../components/ui/toaster'
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

// lightweight-charts needs a real canvas; StockChart has its own mocked suite.
vi.mock('../../components/StockChart', () => ({
  StockChart: ({ candles }: { candles: unknown[] }) => (
    <div data-testid="stock-chart-stub">{candles.length} candles</div>
  ),
}))

const mockedApi = vi.mocked(api)

const detail: StockDetailData = {
  symbol: 'TCS',
  name: 'Tata Consultancy Services',
  sector: 'IT',
  market_cap: 1200000,
  snapshot: {
    date: '2026-09-26',
    pe: 22.1,
    pb: 4.1,
    roe: 41,
    roce: 50.2,
    debt_to_equity: 0.09,
    data_status: 'ok',
  },
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
    groups: [
      { category: 'Valuation', metrics: [{ key: 'pe', label: 'P/E', unit: '×', value: 22.1 }] },
      { category: 'Profitability', metrics: [{ key: 'roe', label: 'ROE', unit: '%', value: 41 }] },
    ],
  },
  data_date: '2026-09-26',
  stale: true,
  run: { run_id: 4, run_date: '2026-09-26', rank: 2, score: 12.3 },
  refreshed: null,
  warning: null,
}

const ohlc: OhlcResponse = {
  symbol: 'TCS',
  range: '1y',
  interval: '1d',
  as_of: '2026-09-26',
  candles: [{ time: '2026-09-25', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }],
}

function mockLoads() {
  mockedApi.get.mockImplementation((path: string) => {
    if (path.startsWith('/stock/TCS/ohlc')) return Promise.resolve(ohlc)
    if (path === '/stock/TCS') return Promise.resolve(detail)
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

function renderPage(symbol = 'TCS') {
  return render(
    <Provider>
      <MemoryRouter initialEntries={[`/stock/${symbol}`]}>
        <Routes>
          <Route path="/stock/:symbol" element={<StockDetail />} />
          <Route path="/" element={<div>Fundamentals home</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('StockDetail', () => {
  it('renders the identity header, report verdict and metric groups', async () => {
    mockLoads()
    renderPage()

    expect(await screen.findByText('TCS')).toBeInTheDocument()
    expect(screen.getByText('Tata Consultancy Services')).toBeInTheDocument()
    expect(screen.getByText('IT')).toBeInTheDocument()
    expect(screen.getByText('Passes your screen')).toBeInTheDocument()
    expect(screen.getByText('Valuation')).toBeInTheDocument()
    expect(screen.getAllByText('22.1').length).toBeGreaterThanOrEqual(2) // report row + metric tile
    expect(screen.getAllByText('41.0').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Data as of 2026-09-26')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(await screen.findByTestId('stock-chart-stub')).toHaveTextContent('1 candles')
  })

  it('shows the unknown-symbol state on 404', async () => {
    mockedApi.get.mockRejectedValue(new ApiError(404, 'Unknown symbol NOPE'))
    renderPage('NOPE')

    expect(await screen.findByText('Unknown symbol NOPE')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to fundamental analysis/i })).toHaveAttribute('href', '/')
  })

  it('shows an error with Retry when the snapshot fails', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockImplementation((path: string) =>
      path.startsWith('/stock/TCS/ohlc')
        ? Promise.resolve(ohlc)
        : Promise.reject(new ApiError(500, 'snapshot exploded')),
    )
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('snapshot exploded')

    mockLoads()
    await user.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByText('Passes your screen')).toBeInTheDocument()
  })

  it('switching range refetches only the ohlc endpoint', async () => {
    const user = userEvent.setup()
    mockLoads()
    renderPage()
    await screen.findByText('Passes your screen')
    mockedApi.get.mockClear()

    await user.click(screen.getByRole('button', { name: '6M' }))

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith('/stock/TCS/ohlc?range=6m&interval=1d'),
    )
    expect(mockedApi.get.mock.calls.every(([path]) => String(path).startsWith('/stock/TCS/ohlc'))).toBe(true)
  })

  it('switching interval refetches with the monthly aggregation', async () => {
    const user = userEvent.setup()
    mockLoads()
    renderPage()
    await screen.findByText('Passes your screen')
    mockedApi.get.mockClear()

    await user.click(screen.getByRole('button', { name: 'Monthly' }))

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith('/stock/TCS/ohlc?range=1y&interval=1mo'),
    )
  })

  it('refreshes the snapshot via POST and merges the response', async () => {
    const user = userEvent.setup()
    mockLoads()
    mockedApi.post.mockResolvedValue({
      ...detail,
      refreshed: true,
      snapshot: { ...detail.snapshot, pe: 20.1 },
      report: {
        ...detail.report,
        groups: [{ category: 'Valuation', metrics: [{ key: 'pe', label: 'P/E', unit: '×', value: 20.1 }] }],
      },
    })
    renderPage()
    await screen.findByText('Passes your screen')

    await user.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/stock/TCS/refresh', {}))
    expect(await screen.findByText('20.1')).toBeInTheDocument()
  })

  it('keeps the stored snapshot when refresh reports a warning', async () => {
    const user = userEvent.setup()
    mockLoads()
    mockedApi.post.mockResolvedValue({
      ...detail,
      refreshed: false,
      warning: 'Live refresh failed: fetch failed for TCS',
    })
    renderPage()
    await screen.findByText('Passes your screen')

    await user.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() =>
      expect(toaster.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Live refresh failed: fetch failed for TCS' }),
      ),
    )
    expect(screen.getByText('Passes your screen')).toBeInTheDocument()
  })
})
