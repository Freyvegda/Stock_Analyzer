/**
 * Per-user report card: verdict, score, criterion checks and notes.
 *
 * The verdict comes from the API (computed against the caller's saved criteria);
 * stock data itself is shared. Colour is never the only signal — each row pairs
 * the glyph with sr-only pass/fail text.
 */

import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Num } from '@/components/ui/Num'
import type { StockReport } from '../api/types'

function fmt(value: number): string {
  return value.toFixed(1)
}

export function StockReportCard({ report }: { report: StockReport }) {
  const pass = report.verdict === 'pass'

  return (
    <section data-testid="stock-report" className="h-full rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
            pass ? 'border-gain/40 text-gain' : 'border-loss/40 text-loss',
          )}
        >
          {pass ? 'Passes your screen' : 'Below your screen'}
        </span>
        <span className="text-sm text-muted-foreground">
          Score <Num>{fmt(report.score)}</Num> · <Num>{report.passed}</Num>/
          <Num>{report.enabled}</Num> criteria passed
        </span>
      </div>

      {report.enabled === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No criteria enabled</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {report.criteria.map((criterion) => (
            <li
              key={criterion.key}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
            >
              <span className="flex items-center gap-2">
                {criterion.passed ? (
                  <Check aria-hidden="true" size={16} strokeWidth={1.75} className="text-gain" />
                ) : (
                  <X aria-hidden="true" size={16} strokeWidth={1.75} className="text-loss" />
                )}
                <span className="sr-only">{criterion.passed ? 'Passes' : 'Fails'}</span>
                {criterion.label}
              </span>
              <span className="text-xs text-muted-foreground">
                <Num>{criterion.value === null ? '—' : fmt(criterion.value)}</Num>
                {criterion.unit} vs {criterion.direction === 'max' ? '≤' : '≥'}{' '}
                <Num>{fmt(criterion.threshold)}</Num>
                {criterion.unit}
              </span>
            </li>
          ))}
        </ul>
      )}

      {report.notes.length > 0 ? (
        <ul
          data-testid="report-notes"
          className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground"
        >
          {report.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

export default StockReportCard
