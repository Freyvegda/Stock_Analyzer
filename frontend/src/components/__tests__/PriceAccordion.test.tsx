import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PriceAccordion } from '../PriceAccordion'
import { Provider } from '../ui/provider'

function candles() {
  return [
    { time: '2026-09-25', open: 99, high: 101, low: 98, close: 100, volume: 1000 },
    { time: '2026-09-26', open: 100, high: 112, low: 99, close: 110, volume: 1200 },
  ]
}

describe('PriceAccordion', () => {
  it('shows latest price, change and OHLCV, collapses on toggle', async () => {
    const user = userEvent.setup()
    render(<Provider><PriceAccordion candles={candles()} /></Provider>)

    expect(screen.getByTestId('price-accordion')).toBeInTheDocument()
    expect(screen.getAllByText('110.00').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByTestId('delta')).toBeInTheDocument()
    expect(screen.getByText('2026-09-26')).toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: /latest price/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})
