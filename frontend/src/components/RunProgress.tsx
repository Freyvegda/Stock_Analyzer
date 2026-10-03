/**
 * Per-screen progress for a background run job — presentation only. The
 * fundamentals layout owns the job state and polls `/screen/jobs/latest`;
 * this panel renders the latest projection.
 *
 * Chips follow `job.items` order (the backend sends the active screen first).
 * A running chip pulses with the existing `vault-pulse` class and its elapsed
 * time ticks locally once per second, keeping the panel live between polls.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Badge, Box, Flex, Text } from '@chakra-ui/react'
import { Num } from '@/components/ui/Num'
import { formatElapsed } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { RunJob, RunJobItem, RunJobItemStatus } from '@/api/types'

/** Whole seconds since `item.started_at` while the item is `running`; null otherwise. */
export function chipElapsed(item: RunJobItem, now: number): number | null {
  if (item.status !== 'running' || item.started_at === null) return null
  const started = Date.parse(item.started_at)
  if (Number.isNaN(started)) return null
  return Math.max(0, Math.floor((now - started) / 1000))
}

type ChipTone = {
  variant: 'outline' | 'subtle'
  color?: 'fg.muted'
  colorPalette?: 'sakura' | 'gain' | 'loss'
}

const CHIP_TONES: Record<RunJobItemStatus, ChipTone> = {
  queued: { variant: 'outline', color: 'fg.muted' },
  running: { variant: 'subtle', colorPalette: 'sakura' },
  done: { variant: 'subtle', colorPalette: 'gain' },
  failed: { variant: 'subtle', colorPalette: 'loss' },
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

function statusBanner(job: RunJob): ReactNode {
  if (job.status === 'running') return null
  if (job.status === 'done') {
    return (
      <Text data-testid="job-status" fontSize="sm" color="gain">
        Refreshed{' '}
        <Num>
          {job.universe_done}/{job.universe_total}
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

export function RunProgress({ job }: { job: RunJob }) {
  const hasRunningItem = job.items.some((item) => item.status === 'running')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!hasRunningItem) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [hasRunningItem])

  const processed = job.universe_done + job.universe_failed
  const percent =
    job.universe_total > 0 ? Math.min(100, (processed / job.universe_total) * 100) : 0

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
      </Flex>

      <Box mt={3}>
        <Flex align="baseline" justify="space-between" gap={3} wrap="wrap" mb={1}>
          <Text data-testid="job-universe-counter" fontSize="sm" color="fg.muted">
            <Num>
              {processed} / {job.universe_total}
            </Num>
            {job.universe_failed > 0 ? (
              <>
                {' · '}
                <Num>{job.universe_failed}</Num> failed
              </>
            ) : null}
          </Text>
          {statusBanner(job)}
        </Flex>
        <Box
          role="progressbar"
          aria-valuenow={processed}
          aria-valuemin={0}
          aria-valuemax={job.universe_total}
          h="1"
          w="full"
          overflow="hidden"
          borderRadius="full"
          bg="bg.muted"
        >
          <Box h="full" borderRadius="full" bg="brand" width={`${percent}%`} />
        </Box>
      </Box>
    </Box>
  )
}
