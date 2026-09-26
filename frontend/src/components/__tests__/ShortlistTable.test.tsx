import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ShortlistTable } from '../ShortlistTable'
import type { ShortlistRow } from '../../api/types'

function makeRow(overrides: Partial<ShortlistRow>): ShortlistRow {
  return {
    symbol: 'AAA',
    rank: 1,
    score: 10,
    ratios: { pe: 20, pb: 3, roe: 15, roce: 20, debt_to_equity: 0.1 },
    ...overrides,
  }
}

const rows: ShortlistRow[] = [
  makeRow({ symbol: 'LOW', rank: 2, score: 5, ratios: { pe: null, pb: null, roe: null, roce: null, debt_to_equity: null } }),
  makeRow({ symbol: 'HIGH', rank: 1, score: 50 }),
]

describe('ShortlistTable', () => {
  it('renders placeholders for missing values', () => {
    render(<ShortlistTable rows={rows} />)
    const lowRow = screen.getByText('LOW').closest('tr')!
    expect(within(lowRow).getAllByText('—').length).toBeGreaterThanOrEqual(5)
  })

  it('does not badge a null D/E', () => {
    render(<ShortlistTable rows={[rows[0]]} />)
    expect(screen.queryByText('0.1')).not.toBeInTheDocument()
  })

  it('badges D/E above 0.3 and not at 0.3', () => {
    const { unmount } = render(<ShortlistTable rows={[makeRow({ ratios: { pe: 1, pb: 1, roe: 1, roce: 1, debt_to_equity: 0.31 } })]} />)
    expect(screen.getByText('0.3').className).toContain('bg-destructive')
    unmount()
    render(<ShortlistTable rows={[makeRow({ ratios: { pe: 1, pb: 1, roe: 1, roce: 1, debt_to_equity: 0.3 } })]} />)
    expect(screen.getByText('0.3').className).not.toContain('bg-destructive')
  })

  it('sorts by score on header click and exposes aria-sort', async () => {
    const user = userEvent.setup()
    render(<ShortlistTable rows={rows} />)
    expect(screen.getByRole('columnheader', { name: /score/i })).toHaveAttribute('aria-sort', 'none')
    await user.click(screen.getByRole('button', { name: /score/i }))
    const bodyRows = screen.getAllByRole('row').slice(1)
    expect(within(bodyRows[0]).getByText('LOW')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /score/i })).toHaveAttribute('aria-sort', 'ascending')
  })
})
