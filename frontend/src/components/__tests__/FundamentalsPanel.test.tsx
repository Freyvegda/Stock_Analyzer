import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FundamentalsPanel } from '../FundamentalsPanel'
import { Provider } from '../ui/provider'
import type { MetricGroup, StockFact } from '../../api/types'

const mainRatios: StockFact[] = [
  { key: 'pe', label: 'P/E', unit: '×', value: 22.1 },
  { key: 'roe', label: 'ROE', unit: '%', value: 41 },
]

const has: StockFact[] = [{ key: 'totalRevenue', label: 'Revenue', unit: '₹ cr', value: 250000 }]

const done: StockFact[] = [{ key: 'revenueGrowth', label: 'Revenue Growth', unit: '%', value: 8.5 }]

const otherGroups: MetricGroup[] = [
  { category: 'Risk', metrics: [{ key: 'beta', label: 'Beta', unit: '×', value: 0.8 }] },
]

function renderPanel() {
  return render(
    <Provider>
      <FundamentalsPanel mainRatios={mainRatios} has={has} done={done} otherGroups={otherGroups} />
    </Provider>,
  )
}

describe('FundamentalsPanel', () => {
  it('renders professional side nav sections, not colloquial labels', async () => {
    renderPanel()
    const nav = screen.getByRole('tablist', { name: /fundamentals/i })
    expect(nav).toBeInTheDocument()
    expect(within(nav).getByRole('tab', { name: /valuation/i })).toBeInTheDocument()
    expect(within(nav).getByRole('tab', { name: /profitability/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /what it has/i })).not.toBeInTheDocument()
    expect(screen.queryByText("What it's done")).not.toBeInTheDocument()
  })

  it('shows one section at a time and switches on nav select', async () => {
    const user = userEvent.setup()
    renderPanel()

    expect(screen.getByText('P/E')).toBeInTheDocument()
    expect(screen.queryByText('ROE')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /profitability/i }))
    expect(screen.getByText('ROE')).toBeInTheDocument()
    expect(screen.queryByText('P/E')).not.toBeInTheDocument()
  })

  it('gives every ratio an info control explaining it', async () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /about p\/e/i })).toBeInTheDocument()
  })

  it('uses a flat rail surface, not the floating glass rail', () => {
    renderPanel()
    const nav = screen.getByRole('tablist', { name: /fundamentals/i })
    expect(nav.className).toContain('fundamentals-rail')
    expect(nav.className).not.toContain('glass-rail')
  })
})
