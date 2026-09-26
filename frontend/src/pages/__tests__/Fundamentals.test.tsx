import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fundamentals from '../Fundamentals'
import { api } from '../../api/client'
import { Provider } from '../../components/ui/provider'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {},
}))

vi.mock('../../components/three/RunVisual', () => ({ default: () => null }))

const mockedApi = vi.mocked(api)

const config = { criteria: { pe_max: 25 }, shortlist_size: 10 }
const row = {
  symbol: 'TCS',
  rank: 1,
  score: 38.2,
  ratios: { pe: 22.1, pb: 4.1, roe: 41, roce: 50.2, debt_to_equity: 0.09 },
  name: 'Tata Consultancy Services',
  sector: 'IT',
  market_cap: 1200000,
}

beforeEach(() => vi.resetAllMocks())

function renderPage() {
  return render(
    <Provider>
      <Fundamentals />
    </Provider>,
  )
}

describe('Fundamentals', () => {
  it('shows an error when initial loads fail', async () => {
    mockedApi.get.mockRejectedValue(new Error('API error 500: boom'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/)
  })

  it('renders the latest run rows with stock metadata', async () => {
    mockedApi.get
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce({ run_id: 1, run_date: '2026-09-26', shortlisted: [row] })
    renderPage()
    expect(await screen.findByText('Tata Consultancy Services')).toBeInTheDocument()
    expect(screen.getByText('IT')).toBeInTheDocument()
    expect(screen.getByText('1200000.0')).toBeInTheDocument()
  })

  it('shows empty state for a zero-row run', async () => {
    mockedApi.get
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
      .mockResolvedValueOnce({ run_id: 2, run_date: '2026-09-26', shortlisted: [] })
    mockedApi.post.mockResolvedValue({ run_id: 2, shortlisted: [], failed_count: 500, total: 500 })
    renderPage()
    await userEvent.setup().click(await screen.findByRole('button', { name: /run screen/i }))
    expect(await screen.findByText(/no stocks passed the screen/i)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('summary')).toHaveTextContent('0 shortlisted · 500 failed · 500 total'),
    )
  })

  it('reloads config through POST /screen/config/reload', async () => {
    mockedApi.get
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
    mockedApi.post.mockResolvedValue({ ...config, criteria: { pe_max: 30 } })
    renderPage()
    await userEvent.setup().click(await screen.findByRole('button', { name: /reload config/i }))
    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/screen/config/reload', {}),
    )
    expect(await screen.findByText('PE ≤ 30')).toBeInTheDocument()
  })
})
