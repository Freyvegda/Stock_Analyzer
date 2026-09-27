import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
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

function renderTable(ui: React.ReactElement) {
  return render(ui, { wrapper: MemoryRouter })
}

describe('ShortlistTable', () => {
  it('renders placeholders for missing values', () => {
    renderTable(<ShortlistTable rows={rows} />)
    const lowRow = screen.getByText('LOW').closest('tr')!
    expect(within(lowRow).getAllByText('—').length).toBeGreaterThanOrEqual(5)
  })

  it('does not badge a null D/E', () => {
    renderTable(<ShortlistTable rows={[rows[0]]} />)
    expect(screen.queryByText('0.1')).not.toBeInTheDocument()
  })

  it('badges D/E above 0.3 and not at 0.3', () => {
    const { unmount } = renderTable(<ShortlistTable rows={[makeRow({ ratios: { pe: 1, pb: 1, roe: 1, roce: 1, debt_to_equity: 0.31 } })]} />)
    expect(screen.getByText('0.3').className).toContain('bg-destructive')
    unmount()
    renderTable(<ShortlistTable rows={[makeRow({ ratios: { pe: 1, pb: 1, roe: 1, roce: 1, debt_to_equity: 0.3 } })]} />)
    expect(screen.getByText('0.3').className).not.toContain('bg-destructive')
  })

  it('sorts by score on header click and exposes aria-sort', async () => {
    const user = userEvent.setup()
    renderTable(<ShortlistTable rows={rows} />)
    expect(screen.getByRole('columnheader', { name: /score/i })).toHaveAttribute('aria-sort', 'none')
    await user.click(screen.getByRole('button', { name: /score/i }))
    const bodyRows = screen.getAllByRole('row').slice(1)
    expect(within(bodyRows[0]).getByText('LOW')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /score/i })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('renders numeric cells in mono tabular numerals', () => {
    renderTable(<ShortlistTable rows={[makeRow({ symbol: 'MONO', ratios: { pe: 21.4, pb: 2, roe: 9, roce: 9, debt_to_equity: 0.1 } })]} />)
    const cell = screen.getByText('21.4')
    expect(cell.className).toContain('font-mono')
    expect(cell.className).toContain('tabular-nums')
  })

  it('renders skeleton rows while loading', () => {
    renderTable(<ShortlistTable rows={[]} loading />)
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThanOrEqual(5)
    expect(screen.queryByRole('row', { name: /LOW/ })).not.toBeInTheDocument()
  })

  it('staggers the first rows on first paint only', () => {
    renderTable(<ShortlistTable rows={rows} />)
    const bodyRows = screen.getAllByRole('row').slice(1)
    expect(bodyRows[0].className).toContain('vault-row-in')
    expect(bodyRows[0].style.getPropertyValue('--row-index')).toBe('0')
  })

  it('links each symbol to its stock detail page', () => {
    renderTable(<ShortlistTable rows={[makeRow({ symbol: 'AAA' })]} />)
    expect(screen.getByRole('link', { name: 'AAA' })).toHaveAttribute('href', '/stock/AAA')
  })
})
