import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CriteriaPanel } from '../CriteriaPanel'
import { Provider } from '../ui/provider'
import type { RatioSpec, UserCriteria } from '../../api/types'

const catalog: RatioSpec[] = [
  { key: 'pe', label: 'PE', unit: '×', category: 'Valuation', direction: 'max' },
  { key: 'roe', label: 'ROE', unit: '%', category: 'Profitability', direction: 'min' },
  { key: 'market_cap', label: 'Market Cap', unit: '₹ cr', category: 'Size', direction: 'min' },
  { key: 'currentRatio', label: 'Current Ratio', unit: '×', category: 'Liquidity', direction: 'min' },
]

const criteria: UserCriteria = {
  criteria: [
    { key: 'pe', enabled: true, value: 25 },
    { key: 'roe', enabled: true, value: 15 },
    { key: 'market_cap', enabled: true, value: 1000 },
    { key: 'currentRatio', enabled: false, value: 1.5 },
    { key: 'mystery', enabled: true, value: 3 },
  ],
  thesis: null,
  shortlist_size: 10,
}

const renderPanel = (ui: React.ReactElement) => render(<Provider>{ui}</Provider>)

describe('CriteriaPanel', () => {
  it('renders enabled criteria with catalog labels, directions and units', () => {
    renderPanel(<CriteriaPanel criteria={criteria} ratios={catalog} onEdit={() => {}} />)
    expect(screen.getByText('PE ≤ 25×')).toBeInTheDocument()
    expect(screen.getByText('ROE ≥ 15%')).toBeInTheDocument()
    expect(screen.getByText('Market Cap ≥ 1000 ₹ cr')).toBeInTheDocument()
    expect(screen.getByText('Top 10')).toBeInTheDocument()
  })

  it('never renders disabled criteria and falls back for unknown keys', () => {
    renderPanel(<CriteriaPanel criteria={criteria} ratios={catalog} onEdit={() => {}} />)
    expect(screen.queryByText(/Current Ratio/)).not.toBeInTheDocument()
    expect(screen.getByText('mystery: 3')).toBeInTheDocument()
  })

  it('opens the editor from the Edit Criteria button', async () => {
    const onEdit = vi.fn()
    renderPanel(<CriteriaPanel criteria={criteria} ratios={catalog} onEdit={onEdit} />)
    await userEvent.setup().click(screen.getByRole('button', { name: /edit criteria/i }))
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it('renders chips in mono numerals', () => {
    renderPanel(<CriteriaPanel criteria={criteria} ratios={catalog} onEdit={() => {}} />)
    expect(screen.getByText('PE ≤ 25×').className).toContain('font-mono')
  })

  it('shows loading and error states instead of stale badges', () => {
    renderPanel(
      <CriteriaPanel criteria={null} ratios={catalog} onEdit={() => {}} error="Could not load criteria" />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load criteria')
    expect(screen.getByText(/loading criteria/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reload config/i })).not.toBeInTheDocument()
  })
})
