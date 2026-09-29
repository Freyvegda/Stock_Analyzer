import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TowerAccordion } from '../TowerAccordion'

/**
 * The storey accordion.
 *
 * Hover opens a row on a fine pointer; click always works, so touch and keyboard
 * are never hover-dependent. Exactly one row is open at a time, and the open row
 * is reported upward so the tower can open the same storey.
 */
const CARDS = [
  { title: 'Your criteria, not ours', body: 'Turn ratios on and off.' },
  { title: 'A verifiable verdict', body: 'Every stock shows its ratios.' },
  { title: 'A ranked top ten', body: 'Ordered by how strongly it clears.' },
]

function renderAccordion(props: Partial<Parameters<typeof TowerAccordion>[0]> = {}) {
  const onOpen = vi.fn()
  render(
    <TowerAccordion
      id="fundamentals"
      cards={CARDS}
      finePointer
      reduced={false}
      openRow={0}
      onOpen={onOpen}
      {...props}
    />,
  )
  return { onOpen }
}

describe('TowerAccordion', () => {
  it('renders every card as a row', () => {
    renderAccordion()
    for (const card of CARDS) {
      expect(screen.getByRole('button', { name: new RegExp(card.title, 'i') })).toBeInTheDocument()
    }
  })

  it('keeps the body text of collapsed rows in the DOM', () => {
    // The text is what a screen reader and a search engine read. Collapsing is a
    // visual state, not a reason for the content to stop existing.
    renderAccordion({ openRow: 1 })
    for (const card of CARDS) {
      expect(screen.getByText(card.body)).toBeInTheDocument()
    }
  })

  it('marks exactly one row open', () => {
    renderAccordion({ openRow: 2 })
    const open = screen.getAllByRole('button', { expanded: true })
    expect(open).toHaveLength(1)
    expect(open[0]).toHaveAccessibleName(new RegExp(CARDS[2].title, 'i'))
  })

  it('opens a row on hover with a fine pointer', () => {
    // The open is deferred by a beat, so sweeping the mouse across the panel on
    // the way somewhere else does not thrash the tower through every storey.
    vi.useFakeTimers()
    try {
      const { onOpen } = renderAccordion({ openRow: 0 })
      fireEvent.mouseEnter(screen.getByRole('button', { name: new RegExp(CARDS[1].title, 'i') }))
      expect(onOpen).not.toHaveBeenCalled()
      vi.advanceTimersByTime(200)
      expect(onOpen).toHaveBeenCalledWith(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('abandons a hover that left before it committed', () => {
    // Sweeping across the panel must not open anything: the pointer left before
    // the beat elapsed.
    vi.useFakeTimers()
    try {
      const { onOpen } = renderAccordion({ openRow: 0 })
      const row = screen.getByRole('button', { name: new RegExp(CARDS[1].title, 'i') })
      fireEvent.mouseEnter(row)
      fireEvent.mouseLeave(row.parentElement!.parentElement!)
      vi.advanceTimersByTime(200)
      expect(onOpen).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not open on hover without a fine pointer', () => {
    // A touch device fires mouseEnter on tap; opening on it would fight the tap.
    vi.useFakeTimers()
    try {
      const { onOpen } = renderAccordion({ finePointer: false, openRow: 0 })
      fireEvent.mouseEnter(screen.getByRole('button', { name: new RegExp(CARDS[1].title, 'i') }))
      vi.advanceTimersByTime(200)
      expect(onOpen).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens a row on click regardless of pointer', () => {
    const { onOpen } = renderAccordion({ finePointer: false, openRow: 0 })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CARDS[2].title, 'i') }))
    expect(onOpen).toHaveBeenCalledWith(2)
  })

  it('closes the open row when it is clicked again', () => {
    // Without this the row can never be collapsed except by opening another.
    const { onOpen } = renderAccordion({ openRow: 1 })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CARDS[1].title, 'i') }))
    expect(onOpen).toHaveBeenCalledWith(null)
  })

  it('moves between rows with the arrow keys', () => {
    renderAccordion({ openRow: 0 })
    const rows = screen.getAllByRole('button')
    rows[0].focus()
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' })
    expect(rows[1]).toHaveFocus()
    fireEvent.keyDown(rows[1], { key: 'ArrowUp' })
    expect(rows[0]).toHaveFocus()
  })

  it('does not walk off the end of the list', () => {
    renderAccordion({ openRow: 0 })
    const rows = screen.getAllByRole('button')
    rows[0].focus()
    fireEvent.keyDown(rows[0], { key: 'ArrowUp' })
    expect(rows[0]).toHaveFocus()
  })

  it('closes on Escape, and only then', () => {
    const { onOpen } = renderAccordion({ openRow: 1 })
    const row = screen.getByRole('button', { name: new RegExp(CARDS[1].title, 'i') })
    fireEvent.keyDown(row, { key: 'Escape' })
    expect(onOpen).toHaveBeenCalledWith(null)
  })

  it('gives each row a panel it controls', () => {
    // `aria-controls` and `role="region"` are what make the relationship real to
    // assistive tech rather than implied by visual proximity.
    renderAccordion({ openRow: 1 })
    const row = screen.getByRole('button', { name: new RegExp(CARDS[1].title, 'i') })
    const panelId = row.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    const panel = document.getElementById(panelId!)
    expect(panel).not.toBeNull()
    expect(panel).toHaveTextContent(CARDS[1].body)
  })

  it('does not steal focus when it opens by itself', () => {
    // Scroll drives `openRow` too. If that moved focus, scrolling the page would
    // yank the keyboard user's place away from them.
    const { rerender } = render(
      <TowerAccordion
        id="x"
        cards={CARDS}
        finePointer={false}
        reduced={false}
        openRow={0}
        onOpen={vi.fn()}
      />,
    )
    const body = document.body
    expect(body).toHaveFocus()
    rerender(
      <TowerAccordion
        id="x"
        cards={CARDS}
        finePointer={false}
        reduced={false}
        openRow={2}
        onOpen={vi.fn()}
      />,
    )
    expect(body).toHaveFocus()
  })

  it('renders every row expanded under reduced motion', () => {
    // "Final state instantly": with motion off there is no reason to hide
    // content behind an animation, so every row reads.
    renderAccordion({ reduced: true, openRow: 0 })
    const root = screen.getByTestId('accordion-fundamentals')
    expect(root).toHaveAttribute('data-reduced', 'true')
    for (const card of CARDS) {
      expect(screen.getByText(card.body)).toBeVisible()
    }
  })
})

describe('TowerAccordion accessibility', () => {
  it('reports row count so the header can describe itself', () => {
    renderAccordion()
    const root = screen.getByTestId('accordion-fundamentals')
    expect(within(root).getAllByRole('button')).toHaveLength(CARDS.length)
  })
})
