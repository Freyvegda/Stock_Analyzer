/**
 * "Criteria pass" accordion: one live report per screen — the active screen
 * first, then the most-used screens. Reports are computed per request by the
 * API from the shared snapshot; nothing here is persisted.
 *
 * Lazy mode: pass `sets` (every saved screen) plus `onExpand`. Screens
 * without a prefetched report render a "Not checked yet" row; expanding one
 * calls `onExpand(set_id)` once so the parent can fetch
 * `GET /stock/:symbol/report?set_id=…` and cache it. `pendingIds` shows a
 * loading row, `errors` a per-screen retry.
 *
 * Colour is never the only signal — each criterion row pairs the glyph with
 * sr-only pass/fail text.
 */

import { Accordion } from '@chakra-ui/react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Num } from '@/components/ui/Num'
import type { StockReport, StockScreenReport } from '../api/types'

export interface ScreenMeta {
  id: number
  name: string
  is_active: boolean
}

function fmt(value: number): string {
  return value.toFixed(1)
}

function VerdictChip({ pass }: { pass: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        pass ? 'border-gain/40 text-gain' : 'border-loss/40 text-loss',
      )}
    >
      {pass ? 'Passes your screen' : 'Below your screen'}
    </span>
  )
}

function ReportDetails({ report }: { report: StockReport }) {
  return (
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
    </div>
  )
}

export function StockReportsAccordion({
  reports,
  sets,
  pendingIds,
  errors,
  onExpand,
}: {
  reports: StockScreenReport[]
  sets?: ScreenMeta[]
  pendingIds?: number[]
  errors?: Record<number, string>
  onExpand?: (setId: number) => void
}) {
  const items: { set_id: number; name: string; is_active: boolean; report: StockReport | null }[] =
    sets !== undefined
      ? sets.map((set) => {
          const prefetched = reports.find((report) => report.set_id === set.id)
          return {
            set_id: set.id,
            name: set.name,
            is_active: set.is_active,
            report: prefetched?.report ?? null,
          }
        })
      : reports.map(({ set_id, name, is_active, report }) => ({ set_id, name, is_active, report }))
  const defaultOpen =
    reports.length > 0 ? [String(reports[0].set_id)] : items.length > 0 ? [String(items[0].set_id)] : []

  return (
    <section
      data-testid="stock-reports"
      className="h-full rounded-lg border border-border bg-card p-4"
    >
      <Accordion.Root multiple defaultValue={defaultOpen}>
        {items.map(({ set_id, name, is_active, report }) => {
          const pending = pendingIds?.includes(set_id) ?? false
          const error = errors?.[set_id]
          const needsFetch = report === null && !pending && error === undefined
          return (
            <Accordion.Item
              key={set_id}
              value={String(set_id)}
              data-testid="report-item"
              className="border-b border-border last:border-b-0"
            >
              <Accordion.ItemTrigger
                className="flex w-full items-center gap-2 py-3 text-left"
                onClick={() => {
                  if (needsFetch) onExpand?.(set_id)
                }}
              >
                <span className="text-sm font-medium">{name}</span>
                {is_active ? (
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Active
                  </span>
                ) : null}
                {report !== null ? (
                  <VerdictChip pass={report.verdict === 'pass'} />
                ) : (
                  <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Not checked yet
                  </span>
                )}
                <Accordion.ItemIndicator className="ml-auto" />
              </Accordion.ItemTrigger>
              <Accordion.ItemContent>
                <Accordion.ItemBody className="pb-4">
                  {report !== null ? (
                    <ReportDetails report={report} />
                  ) : pending ? (
                    <p className="text-sm text-muted-foreground">Checking this screen…</p>
                  ) : error !== undefined ? (
                    <div className="flex items-center justify-between gap-3">
                      <p role="alert" className="text-sm text-loss">
                        {error}
                      </p>
                      <button
                        type="button"
                        className="text-xs underline-offset-4 hover:underline"
                        onClick={(event) => {
                          event.stopPropagation()
                          onExpand?.(set_id)
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Expand to check this stock against the screen.
                    </p>
                  )}
                </Accordion.ItemBody>
              </Accordion.ItemContent>
            </Accordion.Item>
          )
        })}
      </Accordion.Root>
    </section>
  )
}

export default StockReportsAccordion
