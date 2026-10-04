import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Provider } from '../ui/provider'
import { chipElapsed, jobElapsed, resolveVerdict, RunProgress } from '../RunProgress'
import { system } from '@/theme/system'
import type { RunJob, RunJobItem, RunJobItemStatus, ScreenVerdict } from '../../api/types'

function item(
  set_id: number,
  name: string,
  status: RunJobItemStatus,
  overrides: Partial<RunJobItem> = {},
): RunJobItem {
  return {
    set_id,
    name,
    status,
    run_id: null,
    error: null,
    started_at: null,
    finished_at: null,
    ...overrides,
  }
}

function job(overrides: Partial<RunJob> = {}): RunJob {
  return {
    id: 42,
    set_id: 1,
    status: 'running',
    started_at: '2026-10-03T10:00:00.000Z',
    finished_at: null,
    error: null,
    universe_total: 10,
    universe_done: 0,
    universe_failed: 0,
    items: [],
    ...overrides,
  }
}

function renderProgress(data: RunJob, verdict: ScreenVerdict | null = null) {
  return render(
    <Provider>
      <RunProgress job={data} verdict={verdict} />
    </Provider>,
  )
}

// Fixed clock: the running chip starts 5 s before "now", so its elapsed text is 00:05.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-03T10:00:05.000Z'))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('RunProgress', () => {
  const runningItem = item(1, 'Alpha', 'running', { started_at: '2026-10-03T10:00:00.000Z' })
  const queuedItem = item(2, 'Beta', 'queued')
  const failedItem = item(3, '', 'failed', { error: 'boom' })

  it('renders chips in item order with status, fallback label and error title', () => {
    renderProgress(
      job({ universe_done: 1, universe_failed: 2, items: [runningItem, queuedItem, failedItem] }),
    )

    const chips = screen.getAllByTestId(/^job-chip-/)
    expect(chips.map((chip) => chip.getAttribute('data-testid'))).toEqual([
      'job-chip-1',
      'job-chip-2',
      'job-chip-3',
    ])
    expect(chips[0]).toHaveTextContent('Alpha')
    expect(chips[0]).toHaveTextContent('running')
    expect(chips[0]).toHaveTextContent('00:05')
    expect(chips[0]?.className).toContain('vault-pulse')
    expect(chips[1]).toHaveTextContent('Beta')
    expect(chips[1]).toHaveTextContent('queued')
    expect(chips[1]?.className).not.toContain('vault-pulse')
    expect(chips[2]).toHaveTextContent('Screen 3')
    expect(chips[2]).toHaveTextContent('failed')
    expect(chips[2]).toHaveAttribute('title', 'boom')
  })

  it('shows the universe counter and progress bar with processed counts', () => {
    renderProgress(
      job({ universe_done: 1, universe_failed: 2, items: [runningItem, queuedItem, failedItem] }),
    )

    const counter = screen.getByTestId('job-universe-counter')
    expect(counter).toHaveTextContent('3 / 10')
    expect(counter).toHaveTextContent('· 2 failed')

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '3')
    expect(bar).toHaveAttribute('aria-valuemax', '10')
    expect(bar).toHaveAccessibleName('Active screen evaluation progress')
  })

  it('resolves done/failed chip tones to gain/loss tokens that exist in the theme', () => {
    renderProgress(
      job({ items: [runningItem, queuedItem, failedItem, item(4, 'Delta', 'done')] }),
    )

    // gain/loss are flat semantic colors; the chips must resolve through them directly.
    expect(system.token('colors.gain')).toBe('var(--chakra-colors-gain)')
    expect(system.token('colors.loss')).toBe('var(--chakra-colors-loss)')
    expect(system.token('colors.gain.subtle')).toBeUndefined()
    expect(system.token('colors.loss.subtle')).toBeUndefined()

    // The exact same resolution path the Badge props take at render time.
    expect(system.css({ color: 'gain', borderColor: 'gain' })).toEqual({
      color: 'var(--chakra-colors-gain)',
      borderColor: 'var(--chakra-colors-gain)',
    })
    expect(system.css({ color: 'loss', borderColor: 'loss' })).toEqual({
      color: 'var(--chakra-colors-loss)',
      borderColor: 'var(--chakra-colors-loss)',
    })
    expect(document.head.textContent).toContain('var(--chakra-colors-gain)')
    expect(document.head.textContent).toContain('var(--chakra-colors-loss)')
  })

  it('resolves the progress-matrix pair to sakura shades in both modes', () => {
    renderProgress(job({ items: [queuedItem] }))

    // Passed = mode-aware solid, failed = 800 light / 700 dark — lighter/darker
    // holds per mode; text uses the fg/solid virtuals. Verified against live
    // pixels (preview-progress mock) in both modes before shipping.
    expect(system.token('colors.sakura.solid')).toBe('var(--chakra-colors-sakura-solid)')
    expect(system.token('colors.sakura.800')).toBe('#8C2753')
    expect(system.token('colors.sakura.700')).toBe('#B0336A')
    expect(system.token('colors.sakura.fg')).toBe('var(--chakra-colors-sakura-fg)')
    expect(system.token('colors.sakura.solid')).toBe('var(--chakra-colors-sakura-solid)')
    expect(system.css({ color: 'sakura.fg', background: 'sakura.solid' })).toMatchObject({
      color: 'var(--chakra-colors-sakura-fg)',
      background: 'var(--chakra-colors-sakura-solid)',
    })
    expect(document.head.textContent).toContain('var(--chakra-colors-sakura-fg)')
    expect(document.head.textContent).toContain('var(--chakra-colors-sakura-solid)')
  })

  it('always shows the failed count in the criteria matrix, even at zero', () => {
    renderProgress(job({ items: [queuedItem] }))
    expect(screen.getByTestId('job-universe-counter')).toHaveTextContent('0 failed')
    expect(screen.getByTestId('job-stat-failed')).toHaveTextContent('0')
  })

  it('shows the criteria matrix from the live job verdict: passed, failed, running, left, total', () => {
    renderProgress(
      job({
        universe_total: 500,
        universe_done: 490,
        universe_failed: 3,
        verdict: { passed: 8, failed: 490, no_data: 2, total: 500 },
        items: [runningItem, queuedItem],
      }),
    )

    expect(screen.getByTestId('job-universe-counter')).toHaveTextContent('8 passed')
    expect(screen.getByTestId('job-universe-counter')).toHaveTextContent('490 failed')
    expect(screen.getByTestId('job-stat-passed')).toHaveTextContent('Passed')
    expect(screen.getByTestId('job-stat-passed')).toHaveTextContent('8')
    expect(screen.getByTestId('job-stat-failed')).toHaveTextContent('490')
    expect(screen.getByTestId('job-stat-left')).toHaveTextContent('2')
    expect(screen.getByTestId('job-stat-total')).toHaveTextContent('500')
    // 2 fetch workers in flight while the job runs and symbols remain.
    expect(screen.getByTestId('job-stat-running')).toHaveTextContent('Running')
    expect(screen.getByTestId('job-stat-running')).toHaveTextContent('2')
    expect(screen.getByTestId('job-running-indicator')).toHaveTextContent('running')
    expect(screen.getByTestId('job-bar-done')).toHaveStyle({ width: '1.6%' })
    expect(screen.getByTestId('job-bar-failed')).toHaveStyle({ width: '98%' })
    expect(screen.getByTestId('job-bar-remaining')).toBeInTheDocument()
  })

  it('falls back to the snapshot verdict prop before the worker sets totals', () => {
    renderProgress(
      job({ universe_total: 0, universe_done: 0, universe_failed: 0, items: [queuedItem] }),
      { passed: 8, failed: 490, no_data: 2, total: 500 },
    )

    expect(screen.getByTestId('job-stat-passed')).toHaveTextContent('8')
    expect(screen.getByTestId('job-stat-total')).toHaveTextContent('500')
  })

  it('prefers the live job verdict over the snapshot prop', () => {
    renderProgress(
      job({
        verdict: { passed: 9, failed: 489, no_data: 2, total: 500 },
        items: [queuedItem],
      }),
      { passed: 8, failed: 490, no_data: 2, total: 500 },
    )

    expect(screen.getByTestId('job-stat-passed')).toHaveTextContent('9')
  })

  it('shows a starting state instead of 0/0 before the worker sets totals', () => {
    renderProgress(job({ universe_total: 0, universe_done: 0, universe_failed: 0, items: [queuedItem] }))

    expect(screen.getByTestId('job-universe-counter')).toHaveTextContent('Starting')
    expect(screen.queryByTestId('job-stat-total')).not.toBeInTheDocument()
  })

  it('advances a running chip once per second', async () => {
    renderProgress(job({ items: [runningItem, queuedItem] }))
    expect(screen.getByTestId('job-chip-1')).toHaveTextContent('00:05')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByTestId('job-chip-1')).toHaveTextContent('00:06')
  })

  it('creates no interval when no item is running', () => {
    const interval = vi.spyOn(window, 'setInterval')
    renderProgress(job({ status: 'done', universe_done: 10, items: [item(1, 'Alpha', 'done')] }))
    expect(interval).not.toHaveBeenCalled()
  })

  it('renders no status banner while the job runs', () => {
    renderProgress(job({ items: [runningItem] }))
    expect(screen.queryByTestId('job-status')).not.toBeInTheDocument()
  })

  it('renders the done banner with evaluated counts', () => {
    renderProgress(
      job({ status: 'done', universe_done: 9, universe_failed: 1, items: [item(1, 'Alpha', 'done')] }),
    )
    expect(screen.getByTestId('job-status')).toHaveTextContent('Evaluated 10/10')
  })

  it('renders the failed banner with the job error', () => {
    renderProgress(job({ status: 'failed', error: 'job exploded' }))
    expect(screen.getByTestId('job-status')).toHaveTextContent('job exploded')
  })

  it('falls back to a generic failed message when the job has no error', () => {
    renderProgress(job({ status: 'failed', error: null }))
    expect(screen.getByTestId('job-status')).toHaveTextContent('Run failed')
  })

  it('renders the interrupted banner with a rerun hint', () => {
    renderProgress(job({ status: 'interrupted', finished_at: '2026-10-03T10:00:04.000Z' }))
    expect(screen.getByTestId('job-status')).toHaveTextContent('Interrupted — run again')
    expect(screen.getByTestId('job-rerun-hint')).toHaveTextContent('Interrupted — run again')
  })
})

describe('chipElapsed', () => {
  const now = Date.parse('2026-10-03T10:00:07.000Z')

  it('returns whole seconds since the start for a running item', () => {
    const running = item(1, 'Alpha', 'running', { started_at: '2026-10-03T10:00:00.000Z' })
    expect(chipElapsed(running, now)).toBe(7)
  })

  it('returns null for queued, done and failed items', () => {
    expect(chipElapsed(item(1, 'Alpha', 'queued'), now)).toBeNull()
    expect(
      chipElapsed(item(1, 'Alpha', 'done', { started_at: '2026-10-03T10:00:00.000Z' }), now),
    ).toBeNull()
    expect(
      chipElapsed(item(1, 'Alpha', 'failed', { started_at: '2026-10-03T10:00:00.000Z' }), now),
    ).toBeNull()
  })

  it('returns null for a running item without a start time', () => {
    expect(chipElapsed(item(1, 'Alpha', 'running'), now)).toBeNull()
  })
})

describe('resolveVerdict', () => {
  const live = { passed: 9, failed: 489, no_data: 2, total: 500 }
  const snapshot = { passed: 8, failed: 490, no_data: 2, total: 500 }
  const base = job({})

  it('prefers the live job verdict when it carries totals', () => {
    expect(resolveVerdict(job({ verdict: live }), snapshot)).toEqual(live)
  })

  it('falls back to the snapshot prop when the job has no verdict yet', () => {
    expect(resolveVerdict(base, snapshot)).toEqual(snapshot)
    expect(resolveVerdict(job({ verdict: { passed: 0, failed: 0, no_data: 0, total: 0 } }), snapshot)).toEqual(
      snapshot,
    )
  })

  it('returns null when neither source has a verdict', () => {
    expect(resolveVerdict(base, null)).toBeNull()
    expect(resolveVerdict(base, undefined)).toBeNull()
  })
})

describe('jobElapsed', () => {
  it('measures live seconds while running and total duration once finished', () => {
    const running = job({ started_at: '2026-10-03T10:00:00.000Z' })
    expect(jobElapsed(running, Date.parse('2026-10-03T10:00:07.000Z'))).toBe(7)
    const done = job({
      status: 'done',
      started_at: '2026-10-03T10:00:00.000Z',
      finished_at: '2026-10-03T10:01:00.000Z',
    })
    expect(jobElapsed(done, Date.parse('2026-10-03T10:05:00.000Z'))).toBe(60)
  })
})
