import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Financials } from '../Financials'
import { Provider } from '../ui/provider'
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

// Sized container so recharts renders real svg instead of the 0-size stub.
window.ResizeObserver = class {
  cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe(target: Element) {
    this.cb(
      [{ contentRect: { width: 600, height: 320 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}

describe('Financials sized chart', () => {
  it('renders both axis titles inside the svg', async () => {
    vi.mocked(api).get.mockResolvedValue({
      symbol: 'AAA',
      quarterly: [
        { period: 'Q1FY26', sales: 100, expenses: 80, operating_profit: 20, other_income: null, interest: null, depreciation: null, pbt: null, tax: null, pat: -5, eps: null },
        { period: 'Q2FY26', sales: 110, expenses: 85, operating_profit: 25, other_income: null, interest: null, depreciation: null, pbt: null, tax: null, pat: 12, eps: 2.5 },
      ],
      annual: [],
      as_of: null,
      stale: false,
    })
    render(<Provider><Financials symbol="AAA" /></Provider>)
    await screen.findByTestId('financials-chart')
    let svg: Element | null = null
    await waitFor(() => {
      svg = document.querySelector('[data-testid="financials-chart"] svg')
      expect(svg).not.toBeNull()
    })
    expect(svg!.textContent).toMatch(/Profits \(₹ cr\)/)
    expect(svg!.textContent).toMatch(/Revenue \(₹ cr\)/)
  })
})
