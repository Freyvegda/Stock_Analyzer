import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NumberTicker } from '../ui/NumberTicker'

function mockReducedMotion(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}

afterEach(() => vi.restoreAllMocks())

describe('NumberTicker', () => {
  it('renders the final value', async () => {
    render(<NumberTicker value={42} />)
    await waitFor(() => expect(screen.getByTestId('number-ticker')).toHaveTextContent('42'))
  })

  it('renders the exact value instantly under reduced motion', () => {
    mockReducedMotion(true)
    render(<NumberTicker value={123} decimals={1} />)
    expect(screen.getByTestId('number-ticker')).toHaveTextContent('123.0')
  })
})
