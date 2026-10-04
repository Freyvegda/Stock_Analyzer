import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Financials } from '../Financials'
import { Provider } from '../ui/provider'
import { api } from '../../api/client'
import type { FinancialsResponse } from '../../api/types'

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

const mockedApi = vi.mocked(api)

function period(overrides: Record<string, number | string | null>) {
  return {
    period: 'Q?',
    sales: null,
    expenses: null,
    operating_profit: null,
    other_income: null,
    interest: null,
    depreciation: null,
    pbt: null,
    tax: null,
    pat: null,
    eps: null,
    ...overrides,
  }
}

function response(overrides: Partial<FinancialsResponse> = {}): FinancialsResponse {
  return {
    symbol: 'AAA',
    quarterly: [
      period({ period: 'Q1FY26', sales: 100.0, expenses: 80.0, operating_profit: 20.0, pat: -5.0, eps: null }),
      period({ period: 'Q2FY26', sales: 110.0, expenses: 85.0, operating_profit: 25.0, pat: 12.0, eps: 2.5 }),
    ],
    annual: [period({ period: 'FY25', sales: 1000.0, pat: 150.0, eps: 12.5 })],
    as_of: '2026-10-04',
    stale: false,
    ...overrides,
  }
}

describe('Financials', () => {
  it('renders quarterly table and toggles to annual columns', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockResolvedValue(response())
    render(<Provider><Financials symbol="AAA" /></Provider>)

    expect(await screen.findByTestId('financials')).toBeInTheDocument()
    expect(screen.getByText('Q1FY26')).toBeInTheDocument()
    expect(screen.queryByText('FY25')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /annual/i }))
    expect(await screen.findByText('FY25')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Q1FY26')).not.toBeInTheDocument())
    expect(mockedApi.get).toHaveBeenCalledWith('/stock/AAA/financials')
  })

  it('renders — for nulls and loss styling for negative PAT', async () => {
    mockedApi.get.mockResolvedValue(response())
    render(<Provider><Financials symbol="AAA" /></Provider>)

    await screen.findByTestId('financials')
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('pat-Q1FY26')).toHaveClass('text-loss')
    expect(screen.getByTestId('pat-Q2FY26')).not.toHaveClass('text-loss')
  })

  it('shows stale badge when history is stale', async () => {
    mockedApi.get.mockResolvedValue(response({ stale: true }))
    render(<Provider><Financials symbol="AAA" /></Provider>)

    await screen.findByTestId('financials')
    expect(screen.getByText(/stale/i)).toBeInTheDocument()
    expect(screen.getByText('2026-10-04')).toBeInTheDocument()
  })

  it('shows error with retry that recovers', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockRejectedValueOnce(new Error('screener down'))
    mockedApi.get.mockResolvedValueOnce(response())
    render(<Provider><Financials symbol="AAA" /></Provider>)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(screen.getByTestId('financials')).toBeInTheDocument())
  })

  it('shows empty state when both series are empty', async () => {
    mockedApi.get.mockResolvedValue(response({ quarterly: [], annual: [] }))
    render(<Provider><Financials symbol="AAA" /></Provider>)

    expect(await screen.findByText(/no history yet/i)).toBeInTheDocument()
  })

  it('renders sales/PAT chart with legend', async () => {
    mockedApi.get.mockResolvedValue(response())
    render(<Provider><Financials symbol="AAA" /></Provider>)

    await screen.findByTestId('financials')
    expect(screen.getByTestId('financials-chart')).toBeInTheDocument()
    const legend = screen.getByTestId('financials-legend')
    expect(legend).toHaveTextContent('Sales')
    expect(legend).toHaveTextContent('PAT')
  })

  it('marks motion animated by default and static under reduced motion', async () => {
    mockedApi.get.mockResolvedValue(response())
    const { unmount } = render(<Provider><Financials symbol="AAA" /></Provider>)
    expect(await screen.findByTestId('financials')).toHaveAttribute('data-motion', 'animated')
    unmount()

    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true, media: '', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })
    mockedApi.get.mockResolvedValue(response())
    render(<Provider><Financials symbol="AAA" /></Provider>)
    expect(await screen.findByTestId('financials')).toHaveAttribute('data-motion', 'static')
  })
})

afterEach(() => vi.restoreAllMocks())
