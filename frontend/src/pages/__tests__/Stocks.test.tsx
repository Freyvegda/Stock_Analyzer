import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Stocks from '../Stocks'
import { api, ApiError } from '../../api/client'
import { Provider } from '../../components/ui/provider'
import type { StockListResponse } from '../../api/types'

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
}))

const mockedApi = vi.mocked(api)

const response: StockListResponse = {
  as_of: '2026-09-26',
  total: 3,
  rows: [
    {
      symbol: 'AAA',
      name: 'Alpha Ltd',
      sector: 'IT',
      market_cap: 5000,
      pe: 20,
      pb: 3,
      roe: 25,
      roce: 22,
      debt_to_equity: 0.2,
      data_date: '2026-09-26',
      passes: 2,
      enabled: 2,
      verdict: 'pass',
    },
    {
      symbol: 'BBB',
      name: 'Beta Bank',
      sector: 'Bank',
      market_cap: 100,
      pe: 80,
      pb: 12,
      roe: 5,
      roce: 5,
      debt_to_equity: 2,
      data_date: '2026-09-24',
      passes: 0,
      enabled: 2,
      verdict: 'fail',
    },
    {
      symbol: 'CCC',
      name: 'Gamma Foods',
      sector: 'FMCG',
      market_cap: null,
      pe: null,
      pb: null,
      roe: null,
      roce: null,
      debt_to_equity: null,
      data_date: null,
      passes: 0,
      enabled: 2,
      verdict: 'no_data',
    },
  ],
}

function renderPage() {
  return render(
    <Provider>
      <MemoryRouter initialEntries={['/stocks']}>
        <Routes>
          <Route path="/stocks" element={<Stocks />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('Stocks', () => {
  it('renders rows with ratios and verdict chips', async () => {
    mockedApi.get.mockResolvedValue(response)
    renderPage()

    expect(await screen.findByText('Alpha Ltd')).toBeInTheDocument()
    expect(screen.getByText('Beta Bank')).toBeInTheDocument()
    expect(screen.getByTestId('as-of')).toHaveTextContent('Data as of 2026-09-26')
    expect(screen.getByTestId('verdict-AAA')).toHaveTextContent('2/2 pass')
    expect(screen.getByTestId('verdict-BBB')).toHaveTextContent('Fail')
    expect(screen.getByTestId('verdict-CCC')).toHaveTextContent('No data')
    expect(screen.getByText('20.0')).toBeInTheDocument()
  })

  it('filters rows on each keystroke without refetching', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockResolvedValue(response)
    renderPage()
    await screen.findByText('Alpha Ltd')

    await user.type(screen.getByPlaceholderText('Search symbol or company'), 'beta')

    expect(screen.getByText('Beta Bank')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Ltd')).not.toBeInTheDocument()
    // One universe fetch + one screen-list fetch; typing filters locally.
    expect(mockedApi.get).toHaveBeenCalledTimes(2)
    expect(mockedApi.get).toHaveBeenCalledWith('/stocks')
  })

  it('filters by sector and verdict', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockResolvedValue(response)
    renderPage()
    await screen.findByText('Alpha Ltd')

    await user.selectOptions(screen.getByLabelText('Sector'), 'Bank')
    expect(screen.getByText('Beta Bank')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Ltd')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Sector'), 'All sectors')
    await user.click(screen.getByRole('button', { name: 'No data' }))
    expect(screen.getByText('Gamma Foods')).toBeInTheDocument()
    expect(screen.queryByText('Beta Bank')).not.toBeInTheDocument()
  })

  it('shows empty state when nothing matches', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockResolvedValue(response)
    renderPage()
    await screen.findByText('Alpha Ltd')

    await user.type(screen.getByPlaceholderText('Search symbol or company'), 'zzz')

    expect(screen.getByText('No stocks match')).toBeInTheDocument()
  })

  it('shows an error with Retry when the fetch fails', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockRejectedValue(new ApiError(500, 'universe exploded'))
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('universe exploded')

    mockedApi.get.mockResolvedValue(response)
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Alpha Ltd')).toBeInTheDocument()
  })

  it('links each symbol to its stock detail page', async () => {
    mockedApi.get.mockResolvedValue(response)
    renderPage()

    await waitFor(() => expect(screen.getByRole('link', { name: 'AAA' })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'AAA' })).toHaveAttribute('href', '/stock/AAA')
  })

  it('re-renders pass/fail verdicts for the picked screen', async () => {
    const user = userEvent.setup()
    const wide = response
    const narrow: StockListResponse = {
      as_of: '2026-09-26',
      total: 3,
      rows: response.rows.map((row) =>
        row.symbol === 'AAA' ? { ...row, passes: 0, verdict: 'fail' as const } : row,
      ),
    }
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/sets') {
        return Promise.resolve([
          { id: 1, name: 'Default', is_active: true },
          { id: 2, name: 'Quality', is_active: false },
        ])
      }
      if (path === '/stocks?set_id=2') return Promise.resolve(narrow)
      if (path === '/stocks') return Promise.resolve(wide)
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    renderPage()

    expect(await screen.findByTestId('verdict-AAA')).toHaveTextContent('2/2 pass')
    expect(screen.getByRole('combobox', { name: 'Choose a screen' })).toHaveTextContent('Default')

    await user.click(screen.getByRole('combobox', { name: 'Choose a screen' }))
    await user.click(screen.getByRole('option', { name: /quality/i }))

    expect(mockedApi.get).toHaveBeenCalledWith('/stocks?set_id=2')
    expect(await screen.findByText('Showing verdicts for Quality')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-AAA')).toHaveTextContent('Fail')
  })
})
