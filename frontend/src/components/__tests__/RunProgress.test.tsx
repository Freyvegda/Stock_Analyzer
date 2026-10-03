import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Provider } from '../ui/provider'
import { chipElapsed, RunProgress } from '../RunProgress'
import type { RunJob, RunJobItem, RunJobItemStatus } from '../../api/types'

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

function renderProgress(data: RunJob) {
  return render(
    <Provider>
      <RunProgress job={data} />
    </Provider>,
  )
}

// Fixed clock: the running chip starts 5 s before "now", so its elapsed text is 00:05.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-03T10:00:05.000Z'))
})

afterEach(() => vi.useRealTimers())

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
  })

  it('hides the failed suffix when nothing failed', () => {
    renderProgress(job({ items: [queuedItem] }))
    expect(screen.getByTestId('job-universe-counter')).not.toHaveTextContent('failed')
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

  it('renders the done banner with refreshed counts', () => {
    renderProgress(
      job({ status: 'done', universe_done: 9, universe_failed: 1, items: [item(1, 'Alpha', 'done')] }),
    )
    expect(screen.getByTestId('job-status')).toHaveTextContent('Refreshed 9/10')
  })

  it('renders the failed banner with the job error', () => {
    renderProgress(job({ status: 'failed', error: 'job exploded' }))
    expect(screen.getByTestId('job-status')).toHaveTextContent('job exploded')
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
