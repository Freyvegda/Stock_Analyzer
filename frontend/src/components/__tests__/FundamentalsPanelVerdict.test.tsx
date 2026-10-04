import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FundamentalsPanel } from '../FundamentalsPanel'
import { Provider } from '../ui/provider'

describe('FundamentalsPanel verdict + help', () => {
  it('shows pass/fail vs the picked screen threshold on matching tiles', () => {
    render(
      <Provider>
        <FundamentalsPanel
          mainRatios={[{ key: 'pe', label: 'P/E', unit: '×', value: 22.1 }]}
          has={[]}
          done={[]}
          otherGroups={[]}
          criteria={[{ key: 'pe', passed: false, threshold: 15, direction: 'max', unit: '×' }]}
        />
      </Provider>,
    )
    expect(screen.getByText(/vs ≤/)).toBeInTheDocument()
    expect(screen.getByText('Fails', { selector: '.sr-only' })).toBeInTheDocument()
  })

  it('reveals the ratio explanation on hovering the info control', async () => {
    const user = userEvent.setup()
    render(
      <Provider>
        <FundamentalsPanel
          mainRatios={[{ key: 'pe', label: 'P/E', unit: '×', value: 22.1 }]}
          has={[]}
          done={[]}
          otherGroups={[]}
        />
      </Provider>,
    )
    await user.hover(screen.getByRole('button', { name: /about p\/e/i }))
    expect(await screen.findByText(/what you pay for each rupee of profit/i)).toBeInTheDocument()
  })

  it('moves between sections with arrow keys', async () => {
    const user = userEvent.setup()
    render(
      <Provider>
        <FundamentalsPanel
          mainRatios={[
            { key: 'pe', label: 'P/E', unit: '×', value: 22.1 },
            { key: 'roe', label: 'ROE', unit: '%', value: 41 },
          ]}
          has={[]}
          done={[]}
          otherGroups={[]}
        />
      </Provider>,
    )
    const valuation = screen.getByRole('tab', { name: /valuation/i })
    valuation.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: /profitability/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('ROE')).toBeInTheDocument()
  })
})
