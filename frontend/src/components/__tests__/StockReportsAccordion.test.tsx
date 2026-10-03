import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StockReportsAccordion } from '../StockReportsAccordion'
import { Provider } from '../ui/provider'
import type { StockReport, StockScreenReport } from '../../api/types'

vi.mock('../three/RibbonRail', () => ({ default: () => null }))

function makeReport(verdict: 'pass' | 'fail', overrides: Partial<StockReport> = {}): StockReport {
  return {
    verdict,
    score: 41,
    passed: verdict === 'pass' ? 1 : 0,
    enabled: 1,
    criteria: [
      {
        key: 'pe',
        label: 'PE',
        unit: '×',
        direction: 'max',
        threshold: 25,
        value: 20,
        passed: verdict === 'pass',
        delta: -5,
      },
    ],
    notes: verdict === 'fail' ? ['P/E 20× is above your limit of 5×'] : [],
    groups: [],
    ...overrides,
  }
}

function makeReports(): StockScreenReport[] {
  return [
    { set_id: 1, name: 'Default', is_active: true, report: makeReport('pass') },
    { set_id: 2, name: 'Quality', is_active: false, report: makeReport('fail') },
  ]
}

function renderAccordion(reports: StockScreenReport[]) {
  return render(
    <Provider>
      <StockReportsAccordion reports={reports} />
    </Provider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('StockReportsAccordion', () => {
  it('renders one item per screen, active first', () => {
    renderAccordion(makeReports())

    const items = screen.getAllByTestId('report-item')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Default')).toBeInTheDocument()
    expect(within(items[0]).getByText('Active')).toBeInTheDocument()
    expect(within(items[1]).getByText('Quality')).toBeInTheDocument()
    expect(within(items[1]).queryByText('Active')).not.toBeInTheDocument()
  })

  it('shows the verdict and criteria rows for each screen', () => {
    renderAccordion(makeReports())

    expect(screen.getByText('Passes your screen')).toBeInTheDocument()
    expect(screen.getByText('Below your screen')).toBeInTheDocument()
    expect(screen.getAllByText('PE')).toHaveLength(2)
    expect(screen.getByText('P/E 20× is above your limit of 5×')).toBeInTheDocument()
  })

  it('keeps the No criteria enabled copy', () => {
    renderAccordion([
      {
        set_id: 1,
        name: 'Default',
        is_active: true,
        report: makeReport('pass', { enabled: 0, passed: 0, criteria: [], notes: [] }),
      },
    ])

    expect(screen.getByText('No criteria enabled')).toBeInTheDocument()
  })

  it('renders a single active report without history', () => {
    renderAccordion([{ set_id: 1, name: 'Default', is_active: true, report: makeReport('pass') }])

    expect(screen.getAllByTestId('report-item')).toHaveLength(1)
    expect(screen.getByText('Passes your screen')).toBeInTheDocument()
  })
})
