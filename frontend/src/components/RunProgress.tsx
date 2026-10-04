/**
 * Progress matrix for a background run job — presentation only. The
 * fundamentals layout owns the job state and polls `/screen/jobs/latest`;
 * this panel renders the latest projection.
 *
 * Chips follow `job.items` order (the backend sends the active screen first).
 * A running chip pulses with the existing `vault-pulse` class and its elapsed
 * time ticks locally once per second, keeping the panel live between polls.
 *
 * The matrix covers the FULL universe (~500) for the ACTIVE screen:
 * Passed/Failed come from the live criteria verdict the worker refreshes per
 * fetch flush (`job.verdict`, snapshot at POST, final at completion); Running
 * is the live refresh state and Left is `total - passed - failed` (pending +
 * no-data). Without any verdict (pre-migration payloads) the panel falls back
 * to fetch counters so progress never goes blank.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Badge, Box, Flex, Text } from '@chakra-ui/react'
import { Num } from '@/components/ui/Num'
import { formatElapsed } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { RunJob, RunJobItem, RunJobItemStatus, ScreenVerdict } from '@/api/types'

/** Whole seconds since `item.started_at` while the item is `running`; null otherwise. */
export function chipElapsed(item: RunJobItem, now: number): number | null {
  if (item.status !== 'running' || item.started_at === null) return null
  const started = Date.parse(item.started_at)
  if (Number.isNaN(started)) return null
  return Math.max(0, Math.floor((now - started) / 1000))
}

/** Whole seconds since the job started while it runs; total duration once finished. */
export function jobElapsed(job: RunJob, now: number): number {
  const started = Date.parse(job.started_at)
  if (Number.isNaN(started)) return 0
  const end = job.finished_at !== null ? Date.parse(job.finished_at) : now
  if (Number.isNaN(end)) return 0
  return Math.max(0, Math.floor((end - started) / 1000))
}

/** Active-screen verdict: live `job.verdict` first, snapshot prop fallback. */
export function resolveVerdict(job: RunJob, fallback: ScreenVerdict | null | undefined): ScreenVerdict | null {
  if (job.verdict !== undefined && job.verdict.total > 0) return job.verdict
  return fallback ?? null
}

type ChipTone = {
  variant: 'outline' | 'subtle'
  color?: 'fg.muted' | 'gain' | 'loss'
  borderColor?: 'gain' | 'loss'
  colorPalette?: 'sakura'
}

// `gain`/`loss` are flat semantic colors, not palettes with virtual steps, so the
// chips use direct `color`/`borderColor` props (colorPalette="gain" would only set
// --chakra-colors-color-palette and leave Badge subtle's fg/subtle steps unresolved).
const CHIP_TONES: Record<RunJobItemStatus, ChipTone> = {
  queued: { variant: 'outline', color: 'fg.muted' },
  running: { variant: 'subtle', colorPalette: 'sakura' },
  done: { variant: 'outline', color: 'gain', borderColor: 'gain' },
  failed: { variant: 'outline', color: 'loss', borderColor: 'loss' },
}

function chipLabel(item: RunJobItem): ReactNode {
  if (item.name !== '') return item.name
  return (
    <>
      Screen <Num>{item.set_id}</Num>
    </>
  )
}

function chipStatus(item: RunJobItem, now: number): ReactNode {
  if (item.status !== 'running') return item.status
  const elapsed = chipElapsed(item, now)
  if (elapsed === null) return 'running'
  return (
    <>
      running <Num>{formatElapsed(elapsed)}</Num>
    </>
  )
}

function statusBanner(job: RunJob, evaluated: number, total: number): ReactNode {
  if (job.status === 'running') return null
  if (job.status === 'done') {
    return (
      <Text data-testid="job-status" fontSize="sm" color="brand">
        Evaluated{' '}
        <Num>
          {evaluated}/{total}
        </Num>
      </Text>
    )
  }
  if (job.status === 'failed') {
    return (
      <Text data-testid="job-status" fontSize="sm" color="fg.error" role="alert">
        {job.error ?? 'Run failed'}
      </Text>
    )
  }
  return (
    <Text data-testid="job-status" fontSize="sm" color="fg.muted">
      <span data-testid="job-rerun-hint">Interrupted — run again</span>
    </Text>
  )
}

function Stat({
  testId,
  label,
  value,
  tone,
}: {
  testId: string
  label: string
  value: number
  tone: 'pass' | 'fail' | 'muted' | 'sakura'
}) {
  // Dots + bar carry sakura pinks (lighter = passed, darker = failed) with a
  // per-mode step for the failed tone so the boundary reads on both tracks;
  // text uses the mode-aware virtuals (fg/solid) to stay AA-safe on either card.
  const color =
    tone === 'pass'
      ? 'sakura.fg'
      : tone === 'fail'
        ? 'sakura.solid'
        : tone === 'sakura'
          ? 'brand'
          : 'fg.muted'
  const dotBg = tone === 'pass' ? 'sakura.solid' : tone === 'sakura' ? 'brand' : 'bg.muted'
  return (
    <Flex data-testid={testId} align="baseline" gap={1.5}>
      <Box
        aria-hidden
        w="1.5"
        h="1.5"
        borderRadius="full"
        bg={tone === 'fail' ? 'sakura.800' : dotBg}
        _dark={tone === 'fail' ? { bg: 'sakura.700' } : undefined}
        flexShrink={0}
      />
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="sm" fontWeight="semibold" color={color}>
        <Num>{value}</Num>
      </Text>
    </Flex>
  )
}

export function RunProgress({ job, verdict }: { job: RunJob; verdict?: ScreenVerdict | null }) {
  const hasRunningItem = job.items.some((item) => item.status === 'running')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!hasRunningItem && job.status !== 'running') return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [hasRunningItem, job.status])

  const resolved = resolveVerdict(job, verdict)
  const total = Math.max(0, resolved?.total ?? job.universe_total)
  // Criteria outcome when known; otherwise the fetch counters keep the panel live.
  const passed = Math.max(0, resolved?.passed ?? job.universe_done)
  const failed = Math.max(0, resolved?.failed ?? job.universe_failed)
  const evaluated = passed + failed
  const left = Math.max(0, total - evaluated)
  const percent = total > 0 ? Math.min(100, (evaluated / total) * 100) : 0
  const passedPct = total > 0 ? Math.min(100, (passed / total) * 100) : 0
  const failedPct = total > 0 ? Math.min(100, (failed / total) * 100) : 0
  const isRunning = job.status === 'running'
  const isStarting = total <= 0
  const elapsed = jobElapsed(job, now)
  // Fetch state stays the live signal for the running estimate: 2 workers in
  // flight while symbols remain, 1 during the screen stage, 0 at rest.
  const fetchLeft = Math.max(0, job.universe_total - job.universe_done - job.universe_failed)
  const runningCount = !isRunning ? 0 : fetchLeft > 0 ? Math.min(fetchLeft, 2) : 1

  return (
    <Box data-testid="run-progress">
      <Flex wrap="wrap" gap={2} align="center">
        {job.items.map((item) => (
          <Badge
            key={item.set_id}
            data-testid={`job-chip-${item.set_id}`}
            title={item.status === 'failed' ? (item.error ?? undefined) : undefined}
            display="inline-flex"
            alignItems="center"
            gap="1.5"
            className={cn('font-mono tabular-nums', item.status === 'running' && 'vault-pulse')}
            {...CHIP_TONES[item.status]}
          >
            {chipLabel(item)}
            <Text as="span" opacity={0.8}>
              {chipStatus(item, now)}
            </Text>
          </Badge>
        ))}
        {isRunning ? (
          <Badge
            data-testid="job-running-indicator"
            variant="subtle"
            colorPalette="sakura"
            display="inline-flex"
            alignItems="center"
            gap="1.5"
            className="font-mono tabular-nums vault-pulse"
          >
            <span aria-hidden>●</span>
            <Text as="span" opacity={0.9}>
              running <Num>{formatElapsed(elapsed)}</Num>
            </Text>
          </Badge>
        ) : null}
      </Flex>

      <Box mt={3}>
        <Flex align="baseline" justify="space-between" gap={3} wrap="wrap" mb={1}>
          <Text data-testid="job-universe-counter" fontSize="sm" color="fg.muted">
            {isStarting ? (
              <>Starting…</>
            ) : (
              <>
                <Num>
                  {passed} passed
                </Num>
                {' · '}
                <Num>{failed}</Num> failed
                {' · '}
                <Num>
                  {evaluated} / {total}
                </Num>
                {' · '}
                <Num>{Math.round(percent)}%</Num>
              </>
            )}
          </Text>
          {statusBanner(job, evaluated, total)}
        </Flex>
        <Box
          role="progressbar"
          aria-label="Active screen evaluation progress"
          aria-valuenow={evaluated}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuetext={
            isStarting ? 'Starting screen evaluation' : `${passed} passed, ${failed} failed of ${total} stocks (${Math.round(percent)}%)`
          }
          h="2"
          w="full"
          overflow="hidden"
          borderRadius="full"
          bg="bg.muted"
          display="flex"
        >
          {isStarting ? (
            <Box
              h="full"
              w="full"
              borderRadius="full"
              bg="brand"
              className="vault-pulse"
              opacity={0.7}
            />
          ) : (
            <>
              <Box
                data-testid="job-bar-done"
                h="full"
                bg="sakura.solid"
                style={{ width: `${passedPct}%`, transition: 'width 300ms var(--ease-vault)' }}
              />
              <Box
                data-testid="job-bar-failed"
                h="full"
                bg="sakura.800"
                _dark={{ bg: 'sakura.700' }}
                style={{ width: `${failedPct}%`, transition: 'width 300ms var(--ease-vault)' }}
              />
              {isRunning && left > 0 ? (
                <Box
                  data-testid="job-bar-remaining"
                  h="full"
                  flex="1"
                  borderRadius="full"
                  bg="brand"
                  opacity={0.45}
                  className="vault-pulse"
                  style={{ transition: 'width 300ms var(--ease-vault)' }}
                />
              ) : null}
            </>
          )}
        </Box>
        {!isStarting ? (
          <Flex
            mt={2}
            wrap="wrap"
            gapX={4}
            gapY={1}
            align="center"
            aria-label="Per-stock progress breakdown"
          >
            <Stat testId="job-stat-passed" label="Passed" value={passed} tone="pass" />
            <Stat testId="job-stat-failed" label="Failed" value={failed} tone="fail" />
            <Stat
              testId="job-stat-running"
              label="Running"
              value={runningCount}
              tone={isRunning ? 'sakura' : 'muted'}
            />
            <Stat testId="job-stat-left" label="Left" value={left} tone="muted" />
            <Stat testId="job-stat-total" label="Total" value={total} tone="muted" />
          </Flex>
        ) : null}
      </Box>
    </Box>
  )
}
