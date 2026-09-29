import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NavSearch } from '../NavSearch'
import { api } from '../../api/client'
import { Provider } from '../ui/provider'
import type { StockListResponse, StockListRow } from '../../api/types'

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

const mockedApi = vi.mocked(api)

function row(overrides: Partial<StockListRow> & { symbol: string; name: string }): StockListRow {
  return {
    sector: null,
    market_cap: null,
    pe: null,
    pb: null,
    roe: null,
    roce: null,
    debt_to_equity: null,
    data_date: null,
    passes: 0,
    enabled: 0,
    verdict: 'no_data',
    ...overrides,
  }
}

const universe: StockListResponse = {
  as_of: '2026-09-26',
  total: 3,
  rows: [
    row({
      symbol: 'AAA',
      name: 'Alpha Ltd',
      sector: 'IT',
      market_cap: 1200,
      passes: 2,
      enabled: 2,
      verdict: 'pass',
    }),
    row({
      symbol: 'BBB',
      name: 'Beta Industries',
      sector: 'Energy',
      market_cap: 800,
      passes: 1,
      enabled: 3,
      verdict: 'fail',
    }),
    row({ symbol: 'CCC', name: 'Gamma Corp', passes: 0, enabled: 3, verdict: 'no_data' }),
  ],
}

function tenRows(): StockListResponse {
  return {
    as_of: '2026-09-26',
    total: 10,
    rows: Array.from({ length: 10 }, (_, index) =>
      row({ symbol: `R${index + 1}`, name: `Row ${index + 1}`, verdict: 'pass', passes: 1, enabled: 1 }),
    ),
  }
}

function StockPage() {
  const { symbol } = useParams()
  return <div>Stock page {symbol}</div>
}

function renderSearch() {
  return render(
    <Provider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<NavSearch />} />
          <Route path="/stock/:symbol" element={<StockPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
}

function mockMatchMedia(map: Record<string, boolean>) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: map[query] ?? false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  )
}

async function openSearch() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox'))
  return user
}

beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('NavSearch', () => {
  it('renders the glass input permanently without fetching', () => {
    mockedApi.get.mockResolvedValue(universe)
    renderSearch()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByTestId('nav-search-field')).toHaveClass('glass-field')
    expect(screen.queryByTestId('nav-search-panel')).not.toBeInTheDocument()
    expect(mockedApi.get).not.toHaveBeenCalled()
  })

  it('opens the panel and fetches the universe once on first focus', async () => {
    mockedApi.get.mockResolvedValue(universe)
    renderSearch()

    await openSearch()

    expect(screen.getByText('Type a symbol or company name')).toBeInTheDocument()
    expect(screen.getByTestId('nav-search-panel')).toHaveAttribute('data-motion', 'animated')
    expect(mockedApi.get).toHaveBeenCalledTimes(1)
    expect(mockedApi.get).toHaveBeenCalledWith('/stocks')
  })

  it('filters rows by symbol and by company name', async () => {
    mockedApi.get.mockResolvedValue(universe)
    renderSearch()
    const user = await openSearch()
    await screen.findByText('Type a symbol or company name')

    await user.keyboard('beta')

    expect(await screen.findByRole('option', { name: /BBB/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /AAA/ })).not.toBeInTheDocument()

    await user.clear(screen.getByRole('combobox'))
    await user.keyboard('ccc')

    expect(await screen.findByRole('option', { name: /CCC/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /BBB/ })).not.toBeInTheDocument()
    expect(mockedApi.get).toHaveBeenCalledTimes(1)
  })

  it('shows the caller verdict and pass count on every result', async () => {
    mockedApi.get.mockResolvedValue(universe)
    renderSearch()
    const user = await openSearch()
    await screen.findByText('Type a symbol or company name')

    await user.keyboard('a')

    expect(await screen.findByRole('option', { name: /Alpha Ltd/ })).toHaveTextContent('Pass')
    expect(screen.getByRole('option', { name: /Beta Industries/ })).toHaveTextContent('Fail')
    expect(screen.getByRole('option', { name: /Gamma Corp/ })).toHaveTextContent('No data')
    expect(screen.getByRole('option', { name: /Alpha Ltd/ })).toHaveTextContent('2/2 pass')
    expect(screen.getByRole('option', { name: /Beta Industries/ })).toHaveTextContent('1/3 pass')
  })

  it('caps the list at eight results', async () => {
    mockedApi.get.mockResolvedValue(tenRows())
    renderSearch()
    const user = await openSearch()
    await screen.findByText('Type a symbol or company name')

    await user.keyboard('row')

    expect(await screen.findAllByRole('option')).toHaveLength(8)
    expect(screen.queryByRole('option', { name: /Row 9/ })).not.toBeInTheDocument()
  })

  it('opens the stock page when a result is clicked', async () => {
    mockedApi.get.mockResolvedValue(universe)
    renderSearch()
    const user = await openSearch()
    await screen.findByText('Type a symbol or company name')

    await user.keyboard('alpha')
    await user.click(await screen.findByRole('option', { name: /Alpha Ltd/ }))

    expect(await screen.findByText('Stock page AAA')).toBeInTheDocument()
    expect(screen.queryByTestId('nav-search-panel')).not.toBeInTheDocument()
  })

  it('moves the active option with arrow keys and opens it with enter', async () => {
    mockedApi.get.mockResolvedValue(universe)
    renderSearch()
    const user = await openSearch()
    await screen.findByText('Type a symbol or company name')

    await user.keyboard('a')
    await screen.findAllByRole('option')

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-activedescendant', 'nav-search-option-AAA')
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-activedescendant', 'nav-search-option-BBB')
    await user.keyboard('{Enter}')

    expect(await screen.findByText('Stock page BBB')).toBeInTheDocument()
  })

  it('closes on escape and reopens without refetching', async () => {
    mockedApi.get.mockResolvedValue(universe)
    renderSearch()
    const user = await openSearch()
    await screen.findByText('Type a symbol or company name')
    await user.keyboard('alpha')
    await screen.findByRole('option', { name: /AAA/ })

    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('nav-search-panel')).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox'))
    expect(screen.getByTestId('nav-search-panel')).toBeInTheDocument()
    expect(mockedApi.get).toHaveBeenCalledTimes(1)
  })

  it('shows the no-match state', async () => {
    mockedApi.get.mockResolvedValue(universe)
    renderSearch()
    const user = await openSearch()
    await screen.findByText('Type a symbol or company name')

    await user.keyboard('zzz')

    expect(await screen.findByText('No stocks match')).toBeInTheDocument()
  })

  it('shows an error with retry when the universe fails to load', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('boom'))
    renderSearch()
    const user = await openSearch()

    expect(await screen.findByText("Couldn't load the stock list")).toBeInTheDocument()

    mockedApi.get.mockResolvedValue(universe)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await user.keyboard('alpha')

    expect(await screen.findByRole('option', { name: /Alpha Ltd/ })).toBeInTheDocument()
  })

  it('focuses the input from ctrl+k anywhere', async () => {
    mockedApi.get.mockResolvedValue(universe)
    renderSearch()

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

    expect(await screen.findByTestId('nav-search-panel')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveFocus()
    expect(mockedApi.get).toHaveBeenCalledWith('/stocks')
  })

  it('renders the panel static and sheen-free under reduced motion', async () => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': true, '(pointer: fine)': true })
    mockedApi.get.mockResolvedValue(universe)
    renderSearch()
    await openSearch()
    await waitFor(() => expect(screen.getByTestId('nav-search-panel')).toBeInTheDocument())

    expect(screen.getByTestId('nav-search-panel')).toHaveAttribute('data-motion', 'static')
    expect(screen.getByTestId('nav-search-panel')).toHaveAttribute('data-sheen', 'off')
  })
})
