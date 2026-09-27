import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StockReportCard } from '../StockReportCard'
import type { StockReport } from '../../api/types'

const failingReport: StockReport = {
  verdict: 'fail',
  score: 12.3,
  passed: 1,
  enabled: 2,
  criteria: [
    { key: 'pe', label: 'P/E', unit: '×', direction: 'max', threshold: 25, value: 30, passed: false, delta: 5 },
    { key: 'roe', label: 'ROE', unit: '%', direction: 'min', threshold: 15, value: 18, passed: true, delta: 3 },
  ],
  notes: ['P/E 30× is above your limit of 25×'],
  groups: [],
}

describe('StockReportCard', () => {
  it('renders the verdict, score and per-criterion checks', () => {
    render(<StockReportCard report={failingReport} />)

    expect(screen.getByText('Below your screen')).toBeInTheDocument()
    expect(screen.getByText('12.3')).toBeInTheDocument()
    expect(screen.getByText('P/E')).toBeInTheDocument()
    expect(screen.getByText('30.0')).toBeInTheDocument()
    expect(screen.getByText('25.0')).toBeInTheDocument()
    expect(screen.getByText('Fails')).toBeInTheDocument()
    expect(screen.getByText('Passes')).toBeInTheDocument()
    expect(screen.getByText('P/E 30× is above your limit of 25×')).toBeInTheDocument()
  })

  it('renders the pass verdict', () => {
    render(<StockReportCard report={{ ...failingReport, verdict: 'pass', notes: [] }} />)

    expect(screen.getByText('Passes your screen')).toBeInTheDocument()
    expect(screen.queryByTestId('report-notes')).not.toBeInTheDocument()
  })

  it('shows a placeholder for a missing value', () => {
    render(
      <StockReportCard
        report={{
          ...failingReport,
          criteria: [
            { key: 'pe', label: 'P/E', unit: '×', direction: 'max', threshold: 25, value: null, passed: false, delta: null },
          ],
        }}
      />,
    )

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows the empty copy when no criteria are enabled', () => {
    render(<StockReportCard report={{ ...failingReport, criteria: [], enabled: 0, passed: 0, notes: [] }} />)

    expect(screen.getByText('No criteria enabled')).toBeInTheDocument()
  })
})
