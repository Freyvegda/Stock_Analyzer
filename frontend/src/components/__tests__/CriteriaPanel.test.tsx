import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CriteriaPanel } from '../CriteriaPanel'
import { Provider } from '../ui/provider'

const renderPanel = (ui: React.ReactElement) => render(<Provider>{ui}</Provider>)

const config = {
  criteria: { pe_max: 25, roe_min: 15, custom_ratio: 3 },
  shortlist_size: 10,
}

describe('CriteriaPanel', () => {
  it('renders config entries with human labels and the top-N badge', () => {
    renderPanel(<CriteriaPanel config={config} onReload={() => {}} />)
    expect(screen.getByText('PE ≤ 25')).toBeInTheDocument()
    expect(screen.getByText('ROE ≥ 15%')).toBeInTheDocument()
    expect(screen.getByText('Top 10')).toBeInTheDocument()
  })

  it('renders unknown keys with a fallback label', () => {
    renderPanel(<CriteriaPanel config={config} onReload={() => {}} />)
    expect(screen.getByText('custom_ratio: 3')).toBeInTheDocument()
  })

  it('calls onReload when the reload button is clicked', async () => {
    const onReload = vi.fn()
    renderPanel(<CriteriaPanel config={config} onReload={onReload} />)
    await userEvent.setup().click(screen.getByRole('button', { name: /reload config/i }))
    expect(onReload).toHaveBeenCalledOnce()
  })

  it('shows the reload hint and surfaces errors', () => {
    renderPanel(
      <CriteriaPanel config={null} onReload={() => {}} error="Invalid screening.yaml" />,
    )
    expect(screen.getByText(/backend\/config\/screening\.yaml/)).toBeInTheDocument()
    expect(screen.getByText('Invalid screening.yaml')).toBeInTheDocument()
  })
})
