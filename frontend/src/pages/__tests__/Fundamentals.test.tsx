import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fundamentals from '../Fundamentals'
import { api } from '../../api/client'
import { Provider } from '../../components/ui/provider'
import { AuthProvider } from '../../auth/AuthContext'
import { RequireAuth } from '../../components/RequireAuth'
import type { RatioSpec, UserCriteria } from '../../api/types'

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

const mockedApi = vi.mocked(api)

const criteria: UserCriteria = {
  criteria: [
    { key: 'pe', enabled: true, value: 25 },
    { key: 'roe', enabled: true, value: 15 },
  ],
  thesis: null,
  shortlist_size: 10,
}

const catalog: RatioSpec[] = [
  { key: 'pe', label: 'PE', unit: '×', category: 'Valuation', direction: 'max' },
  { key: 'roe', label: 'ROE', unit: '%', category: 'Profitability', direction: 'min' },
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

function mockLoads(latest: unknown) {
  mockedApi.get.mockImplementation((path: string) => {
    if (path === '/screen/criteria') return Promise.resolve(criteria)
    if (path === '/screen/ratios') return Promise.resolve(catalog)
    if (path === '/screen/latest') return Promise.resolve(latest)
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

function renderPage() {
  return render(
    <Provider>
      <Fundamentals />
    </Provider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('Fundamentals', () => {
  it('renders criteria badges from the per-user criteria endpoint', async () => {
    mockLoads({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
    renderPage()
    expect(await screen.findByText('PE ≤ 25×')).toBeInTheDocument()
    expect(screen.getByText('ROE ≥ 15%')).toBeInTheDocument()
    expect(screen.getByText('Top 10')).toBeInTheDocument()
  })

  it('renders the latest run rows with stock metadata', async () => {
    mockLoads({ run_id: 1, run_date: '2026-09-26', shortlisted: [row] })
    renderPage()
    expect(await screen.findByText('Tata Consultancy Services')).toBeInTheDocument()
    expect(screen.getByText('IT')).toBeInTheDocument()
    expect(screen.getByText('1200000.0')).toBeInTheDocument()
  })

  it('shows empty state for a zero-row run', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/criteria') return Promise.resolve(criteria)
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      return Promise.resolve({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
    })
    mockedApi.post.mockResolvedValue({ run_id: 2, shortlisted: [], failed_count: 500, total: 500 })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /run screen/i }))
    expect(await screen.findByText(/no stocks passed the screen/i)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('summary')).toHaveTextContent('0 shortlisted · 500 failed · 500 total'),
    )
  })

  it('shows the stair-tower loader while the screen runs', async () => {
    mockLoads({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockedApi.post.mockReturnValue(gate.then(() => ({ run_id: 2, shortlisted: [], failed_count: 0, total: 0 })))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /run screen/i }))
    expect(await screen.findByRole('status')).toBeInTheDocument()
    release()
  })

  it('shows the panel error when criteria loading fails', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/latest') return Promise.resolve({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
      return Promise.reject(new Error('criteria exploded'))
    })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(/criteria exploded/)
  })

  it('redirects to /login when a 401 event fires mid-session', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/auth/me') return Promise.resolve({ id: 1, username: 'solo' })
      if (path === '/screen/criteria') return Promise.resolve(criteria)
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') return Promise.resolve({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    render(
      <Provider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route
                path="/"
                element={
                  <RequireAuth>
                    <Fundamentals />
                  </RequireAuth>
                }
              />
              <Route path="/login" element={<div>login page</div>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </Provider>,
    )
    expect(await screen.findByText('PE ≤ 25×')).toBeInTheDocument()
    act(() => window.dispatchEvent(new Event('auth:unauthorized')))
    expect(await screen.findByText('login page')).toBeInTheDocument()
  })
})
