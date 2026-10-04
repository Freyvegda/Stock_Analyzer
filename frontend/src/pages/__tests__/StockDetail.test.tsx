import { render, screen, waitFor, within } from '@testing-library/react'
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
  price: 3100.5,
  price_as_of: '2026-09-26',
  snapshot: {
    date: '2026-09-26',
    pe: 22.1,
    pb: 4.1,
    roe: 41,
    roce: 50.2,
    debt_to_equity: 0.09,
    data_status: 'ok',
  },
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
        groups: [
          { category: 'Valuation', metrics: [{ key: 'pe', label: 'P/E', unit: '×', value: 22.1 }] },
          { category: 'Profitability', metrics: [{ key: 'roe', label: 'ROE', unit: '%', value: 41 }] },
        ],
      },
    },
    {
      set_id: 2,
      name: 'Quality',
      is_active: false,
      report: {
        verdict: 'fail',
        score: 8.1,
        passed: 1,
        enabled: 2,
        criteria: [
          { key: 'pe', label: 'P/E', unit: '×', direction: 'max', threshold: 15, value: 22.1, passed: false, delta: 7.1 },
          { key: 'roe', label: 'ROE', unit: '%', direction: 'min', threshold: 15, value: 41, passed: true, delta: 26 },
        ],
        notes: ['P/E 22.1× is above your limit of 15×'],
        groups: [],
      },
    },
  ],
  data_date: '2026-09-26',
  stale: true,
  run: { run_id: 4, run_date: '2026-09-26', rank: 2, score: 12.3 },
  refreshed: null,
  warning: null,
  profile: {
    description: 'IT services giant',
    industry: 'Information Technology Services',
    sector: 'Technology',
    website: 'https://tcs.test',
    employees: 600000,
    hq: 'Mumbai, Maharashtra, India',
  },
  main_ratios: [
    { key: 'pe', label: 'P/E', unit: '×', value: 22.1 },
    { key: 'roe', label: 'ROE', unit: '%', value: 41 },
  ],
  has: [
    { key: 'totalRevenue', label: 'Revenue', unit: '₹ cr', value: 250000 },
    { key: 'totalCash', label: 'Total Cash', unit: '₹ cr', value: 10000 },
  ],
  done: [{ key: 'revenueGrowth', label: 'Revenue Growth', unit: '%', value: 8.5 }],
  other_groups: [
    { category: 'Risk', metrics: [{ key: 'beta', label: 'Beta', unit: '×', value: 0.8 }] },
  ],
}

const ohlc: OhlcResponse = {
  symbol: 'TCS',
  range: '5y',
  interval: '1d',
  as_of: '2026-09-26',
  candles: Array.from({ length: 400 }, (_, i) => {
    const time = new Date(Date.UTC(2025, 7, 1) + i * 86400000).toISOString().slice(0, 10)
    return { time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }
  }),
}

const screeningSets = [
  {
    id: 1,
    name: 'Default',
    criteria: [],
    thesis: null,
    shortlist_size: 10,
    is_active: true,
    updated_at: 'now',
  },
  {
    id: 2,
    name: 'Quality',
    criteria: [],
    thesis: null,
    shortlist_size: 10,
    is_active: false,
    updated_at: 'now',
  },
]

function mockLoads() {
  mockedApi.get.mockImplementation((path: string) => {
    if (path.startsWith('/stock/TCS/ohlc')) return Promise.resolve(ohlc)
    if (path === '/stock/TCS') return Promise.resolve(detail)
    if (path === '/screen/sets') return Promise.resolve(screeningSets)
    if (path === '/stock/TCS/financials') return Promise.resolve({ symbol: 'TCS', quarterly: [], annual: [], as_of: null, stale: false })
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
    const user = userEvent.setup()
    mockLoads()
    renderPage()

    expect(await screen.findByText('TCS')).toBeInTheDocument()
    expect(screen.getByText('Tata Consultancy Services')).toBeInTheDocument()
    expect(screen.getByText('IT')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveTextContent('Default')
    expect(screen.getAllByText('Passes your screen').length).toBeGreaterThanOrEqual(2) // picker button + card

    await user.click(screen.getByRole('combobox'))
    expect(screen.getByRole('option', { name: /quality/i })).toBeInTheDocument()
    expect(screen.getByText('Below your screen')).toBeInTheDocument()
    expect(screen.getByTestId('fundamentals-panel')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /valuation/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /profitability/i })).toBeInTheDocument()
    expect(screen.getAllByText('22.1').length).toBeGreaterThanOrEqual(2) // report row + metric tile
    await user.click(screen.getByRole('tab', { name: /profitability/i }))
    expect(screen.getAllByText('41.0').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: /about roe/i })).toBeInTheDocument()
    expect(screen.getByText('Data as of 2026-09-26')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(await screen.findByTestId('stock-chart-stub')).toHaveTextContent('366 candles')
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

    expect((await screen.findAllByText('Passes your screen')).length).toBeGreaterThanOrEqual(1)
  })

  it('switching range derives locally without refetching ohlc', async () => {
    const user = userEvent.setup()
    mockLoads()
    renderPage()
    await screen.findAllByText('Passes your screen')
    const ohlcCalls = () =>
      mockedApi.get.mock.calls.filter(([path]) => String(path).includes('/ohlc')).length
    const callsBefore = ohlcCalls()

    await user.click(screen.getByRole('button', { name: '6M' }))

    await waitFor(() =>
      expect(screen.getByTestId('stock-chart-stub')).toHaveTextContent('183 candles'),
    )
    expect(ohlcCalls()).toBe(callsBefore)
  })

  it('switching interval aggregates locally without refetching ohlc', async () => {
    const user = userEvent.setup()
    mockLoads()
    renderPage()
    await screen.findAllByText('Passes your screen')
    const ohlcCalls = () =>
      mockedApi.get.mock.calls.filter(([path]) => String(path).includes('/ohlc')).length
    const callsBefore = ohlcCalls()

    await user.click(screen.getByRole('button', { name: 'Monthly' }))

    await waitFor(() =>
      expect(screen.getByTestId('stock-chart-stub')).toHaveTextContent('13 candles'),
    )
    expect(ohlcCalls()).toBe(callsBefore)
  })

  it('lazy-loads another screen report on expand without refetching detail', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockImplementation((path: string) => {
      if (path.startsWith('/stock/TCS/ohlc')) return Promise.resolve(ohlc)
      if (path === '/stock/TCS')
        return Promise.resolve({ ...detail, reports: [detail.reports[0]] })
      if (path === '/screen/sets') return Promise.resolve(screeningSets)
      if (path === '/stock/TCS/report?set_id=2') return Promise.resolve(detail.reports[1])
      if (path === '/stock/TCS/financials') return Promise.resolve({ symbol: 'TCS', quarterly: [], annual: [], as_of: null, stale: false })
    return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    renderPage()
    await screen.findAllByText('Passes your screen')
    expect(screen.getByText('Not checked yet')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /quality/i }))

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith('/stock/TCS/report?set_id=2'),
    )
    expect(await screen.findByText('P/E 22.1× is above your limit of 15×')).toBeInTheDocument()
  })

  it('refreshes the snapshot via POST and merges the response', async () => {
    const user = userEvent.setup()
    mockLoads()
    mockedApi.post.mockResolvedValue({
      ...detail,
      refreshed: true,
      snapshot: { ...detail.snapshot, pe: 20.1 },
      main_ratios: [
        { key: 'pe', label: 'P/E', unit: '×', value: 20.1 },
        { key: 'roe', label: 'ROE', unit: '%', value: 41 },
      ],
    })
    renderPage()
    await screen.findAllByText('Passes your screen')

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
    await screen.findAllByText('Passes your screen')

    await user.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() =>
      expect(toaster.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Live refresh failed: fetch failed for TCS' }),
      ),
    )
    expect(screen.getAllByText('Passes your screen').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('refresh-warning')).toHaveTextContent(
      'Live refresh failed: fetch failed for TCS',
    )
  })

  it('renders the description and the verdict side by side above the chart', async () => {
    mockLoads()
    renderPage()
    await screen.findAllByText('Passes your screen')

    const halves = screen.getByTestId('detail-halves')
    expect(halves).toContainElement(screen.getByTestId('company-description'))
    expect(halves).toContainElement(screen.getByTestId('screen-picker'))
    expect(halves).toContainElement(screen.getByTestId('screen-report-card'))
    expect(halves.className).toContain('lg:grid-cols-2')

    const chart = screen.getByTestId('price-chart')
    expect(halves.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('orders the fundamentals explorer below the chart with technical nav', async () => {
    mockLoads()
    renderPage()
    await screen.findAllByText('Passes your screen')

    const chart = screen.getByTestId('price-chart')
    const panel = screen.getByTestId('fundamentals-panel')

    expect(chart.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('tab', { name: /valuation/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /profitability/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /financial scale/i })).toBeInTheDocument()
    expect(screen.queryByText('Main fundamental ratios')).not.toBeInTheDocument()
    expect(screen.queryByText('What it has')).not.toBeInTheDocument()
    expect(screen.queryByText("What it's done")).not.toBeInTheDocument()
    expect(screen.queryByText('All other ratios')).not.toBeInTheDocument()
  })

  it('renders the company description and industry', async () => {
    mockLoads()
    renderPage()

    const description = await screen.findByTestId('company-description')
    expect(description).toHaveTextContent('What the company does')
    expect(description).toHaveTextContent('IT services giant')
    expect(description).toHaveTextContent('Information Technology Services')
    expect(screen.getByRole('link', { name: 'Website' })).toHaveAttribute('href', 'https://tcs.test')
    expect(description).toHaveTextContent('600000')
    expect(description).toHaveTextContent('Mumbai, Maharashtra, India')
  })

  it('opens the full company profile dialog from the description More control', async () => {
    const user = userEvent.setup()
    mockLoads()
    renderPage()
    await screen.findAllByText('Passes your screen')

    expect(screen.getByTestId('company-description-body')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'More' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Tata Consultancy Services')
    expect(dialog).toHaveTextContent('IT services giant')
    expect(dialog).toHaveTextContent('Information Technology Services')
    expect(dialog).toHaveTextContent('600000')
    expect(within(dialog).getByRole('link', { name: 'Website' })).toHaveAttribute(
      'href',
      'https://tcs.test',
    )

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows a description fallback when the profile and metrics are missing', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path.startsWith('/stock/TCS/ohlc')) return Promise.resolve(ohlc)
      if (path === '/screen/sets') return Promise.resolve([])
      return Promise.resolve({
        ...detail,
        profile: {
          description: null,
          industry: null,
          sector: null,
          website: null,
          employees: null,
          hq: null,
        },
        main_ratios: [],
        has: [],
        done: [],
        other_groups: [],
      })
    })
    renderPage()

    expect((await screen.findAllByText('Passes your screen')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('company-description')).toHaveTextContent('No description stored yet')
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.queryByText('What it has')).not.toBeInTheDocument()
    expect(screen.queryByText('Main fundamental ratios')).not.toBeInTheDocument()
    expect(screen.queryByText("What it's done")).not.toBeInTheDocument()
    expect(screen.queryByText('All other ratios')).not.toBeInTheDocument()
  })

  it('renders scale, growth and other tiles behind technical nav', async () => {
    const user = userEvent.setup()
    mockLoads()
    renderPage()
    await screen.findAllByText('Passes your screen')

    expect(screen.getByTestId('fundamentals-panel')).toBeInTheDocument()
    expect(screen.getAllByText('P/E').length).toBeGreaterThanOrEqual(1)

    await user.click(screen.getByRole('tab', { name: /financial scale/i }))
    expect(screen.getByText('Revenue')).toBeInTheDocument()
    expect(screen.getByText('250000.0')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /growth/i }))
    expect(screen.getByText('Revenue Growth')).toBeInTheDocument()
  })

  it('renders unmapped metrics under Other with help controls', async () => {
    const user = userEvent.setup()
    mockLoads()
    renderPage()
    await screen.findAllByText('Passes your screen')

    await user.click(screen.getByRole('tab', { name: /other/i }))
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /about beta/i })).toBeInTheDocument()
  })
})
