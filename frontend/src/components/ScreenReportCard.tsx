/**
 * Single-screen verdict card for the stock detail page. Shows the picked
 * screen's name, verdict and per-criterion checks; loading and error states
 * cover the lazy fetch. Colour is never the only signal — each criterion
 * row pairs the glyph with sr-only pass/fail text.
 */

import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Num } from '@/components/ui/Num'
import { Skeleton } from '@/components/ui/Skeleton'
import type { StockReport } from '../api/types'

function fmt(value: number): string {
  return value.toFixed(1)
}

export function ScreenReportCard({
  name,
  isActive,
  report,
  pending,
  error,
  onRetry,
}: {
  name: string
  isActive: boolean
  report: StockReport | null
  pending: boolean
  error?: string
  onRetry: () => void
}) {
  const pass = report?.verdict === 'pass'
  return (
    <section
      data-testid="screen-report-card"
      className="flex h-full flex-col rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{name}</span>
        {isActive ? (
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Active
          </span>
        ) : null}
        {report !== null ? (
          <span
            className={cn(
              'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
              pass ? 'border-gain/40 text-gain' : 'border-loss/40 text-loss',
            )}
          >
            {pass ? 'Passes your screen' : 'Below your screen'}
          </span>
        ) : pending ? (
          <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
            Checking…
          </span>
        ) : (
          <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
            Not checked yet
          </span>
        )}
      </div>

      <div className="mt-3">
        {report !== null ? (
          <div>
            <span className="text-sm text-muted-foreground">
              Score <Num>{fmt(report.score)}</Num> · <Num>{report.passed}</Num>/
              <Num>{report.enabled}</Num> criteria passed
            </span>

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
                        <Check
                          aria-hidden="true"
                          size={16}
                          strokeWidth={1.75}
                          className="text-gain"
                        />
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
          </div>
        ) : pending ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : error !== undefined ? (
          <div className="flex items-center justify-between gap-3">
            <p role="alert" className="text-sm text-loss">
              {error}
            </p>
            <button
              type="button"
              className="text-xs underline-offset-4 hover:underline"
              onClick={onRetry}
            >
              Retry
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Pick a screen above to check this stock against it.
          </p>
        )}
      </div>
    </section>
  )
}

export default ScreenReportCard
