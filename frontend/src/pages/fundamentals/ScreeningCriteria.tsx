/**
 * Screening Criteria — the per-user criteria panel, its editor dialog and the
 * Run Screen card. Owns no run state: everything comes from the layout outlet
 * context so a run keeps going while the user browses the other rail pages.
 */

import { Suspense, lazy, useState } from 'react'
import { Button, Flex, Text } from '@chakra-ui/react'
import { useOutletContext } from 'react-router-dom'
import { CriteriaDialog } from '@/components/CriteriaDialog'
import { CriteriaPanel } from '@/components/CriteriaPanel'
import { BlurFade } from '@/components/ui/BlurFade'
import { NumberTicker } from '@/components/ui/NumberTicker'
import { Num } from '@/components/ui/Num'
import { formatElapsed } from '@/lib/format'
import type { FundamentalsOutletContext } from './FundamentalsLayout'

const SakuraLeafLoader = lazy(() => import('@/components/three/SakuraLeafLoader'))

export default function ScreeningCriteria() {
  const {
    criteria,
    ratios,
    criteriaError,
    rows,
    summary,
    lastRunDate,
    running,
    elapsed,
    runError,
    saveCriteria,
    runScreen,
  } = useOutletContext<FundamentalsOutletContext>()
  const [dialogOpen, setDialogOpen] = useState(false)

  const todayIso = (() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })()
  const storedDataDate =
    rows
      .map((r) => r.data_date)
      .filter((d): d is string => Boolean(d))
      .sort()[0] ?? null

  return (
    <div className="space-y-4">
      <Text as="h1" fontSize="xl" fontWeight="semibold">
        Screening Criteria
      </Text>

      <CriteriaPanel
        criteria={criteria}
        ratios={ratios}
        onEdit={() => setDialogOpen(true)}
        error={criteriaError}
      />

      <CriteriaDialog open={dialogOpen} onOpenChange={setDialogOpen} onSaved={saveCriteria} />

      <BlurFade>
        <div className="relative overflow-hidden rounded-lg border border-border bg-card p-4">
          <Flex align="center" gap={4} wrap="wrap">
            <Button colorPalette="sakura" disabled={running} onClick={runScreen}>
              {running ? 'Running…' : 'Run Screen'}
            </Button>
            {summary !== null ? (
              <Text data-testid="summary" fontSize="sm" color="fg.muted">
                <Num>
                  <NumberTicker value={summary.shortlisted} />
                </Num>{' '}
                shortlisted ·{' '}
                <Num>
                  <NumberTicker value={summary.failed} />
                </Num>{' '}
                failed ·{' '}
                <Num>
                  <NumberTicker value={summary.total} />
                </Num>{' '}
                total
              </Text>
            ) : lastRunDate !== null ? (
              <Text data-testid="summary" fontSize="sm" color="fg.muted">
                Last run: {lastRunDate}
              </Text>
            ) : null}
            {storedDataDate !== null && storedDataDate !== todayIso ? (
              <Text data-testid="data-as-of" fontSize="sm" color="fg.muted">
                Data as of {storedDataDate}
              </Text>
            ) : null}
          </Flex>

          {running ? (
            <div className="mt-4 flex flex-col items-center gap-2">
              <Suspense fallback={null}>
                <SakuraLeafLoader size={120} label="Running screen…" />
              </Suspense>
              <Text fontSize="sm" color="fg.muted">
                Fetching fundamentals for ~500 stocks — takes a few minutes
              </Text>
              <Text fontSize="sm" color="fg.muted">
                <span data-testid="elapsed">
                  <Num>{formatElapsed(elapsed)}</Num>
                </span>
              </Text>
            </div>
          ) : null}
        </div>
      </BlurFade>

      {/* CriteriaPanel already renders load failures with role="alert"; avoid a duplicate alert. */}
      {runError !== null && criteriaError === null ? (
        <Text role="alert" color="fg.error" fontSize="sm">
          {runError}
        </Text>
      ) : null}
    </div>
  )
}
