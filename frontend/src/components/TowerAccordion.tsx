import { motion } from 'motion/react'
import { useCallback, useEffect, useId, useRef } from 'react'

import type { Card } from '@/content/tower'
import { cn } from '@/lib/utils'

/**
 * The storey accordion: one row per card, one row open at a time.
 *
 * Hover opens a row on a fine pointer; click and keyboard always work, so touch
 * and a keyboard are never hover-dependent. The open row is owned by the caller
 * — the same value the tower reads — so the DOM and the 3D cannot disagree about
 * which row, and so which storey, is open.
 *
 * Under reduced motion every row renders open: "final state instantly" means
 * there is no reason to hide content behind an animation.
 */
export function TowerAccordion({
  id,
  cards,
  finePointer,
  reduced,
  openRow,
  onOpen,
}: {
  id: string
  cards: Card[]
  /** `(pointer: fine)`. Hover-open is only offered when the pointer justifies it. */
  finePointer: boolean
  reduced: boolean
  /** Index of the open row, or null for all collapsed. */
  openRow: number | null
  onOpen: (row: number | null) => void
}) {
  const baseId = useId()
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Hover-open is deferred by a short beat so that sweeping the mouse across the
  // panel on the way somewhere else does not thrash the tower through four
  // storeys. It is cancelled by leaving, so a pass-through never commits.
  const hoverTimer = useRef<number | null>(null)
  const cancelHover = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }, [])
  useEffect(() => cancelHover, [cancelHover])

  const enter = useCallback(
    (row: number) => {
      if (!finePointer || reduced) return
      cancelHover()
      hoverTimer.current = window.setTimeout(() => onOpen(row), 90)
    },
    [finePointer, reduced, onOpen, cancelHover],
  )

  const move = useCallback((from: number, delta: number) => {
    const next = from + delta
    if (next < 0 || next >= rowRefs.current.length) return
    rowRefs.current[next]?.focus()
  }, [])

  return (
    <div
      data-testid={`accordion-${id}`}
      data-reduced={reduced ? 'true' : undefined}
      className="mt-6 divide-y divide-border/60 border-t border-border/60"
      onMouseLeave={cancelHover}
    >
      {cards.map((card, row) => {
        const open = reduced || openRow === row
        const panelId = `${baseId}-panel-${row}`
        const buttonId = `${baseId}-row-${row}`
        return (
          <div key={card.title}>
            <h3 className="m-0">
              <button
                id={buttonId}
                ref={(node) => {
                  rowRefs.current[row] = node
                }}
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onMouseEnter={() => enter(row)}
                onFocus={() => enter(row)}
                onClick={() => onOpen(openRow === row && !reduced ? null : row)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    move(row, 1)
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    move(row, -1)
                  } else if (event.key === 'Escape') {
                    onOpen(null)
                  }
                }}
                className={cn(
                  'group flex w-full items-center gap-3 py-3 text-left transition-colors',
                  open ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {/* A caret that turns, rather than a chevron that swaps. One
                    element, so there is nothing to flash on toggle. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-block text-xs transition-transform duration-200',
                    open ? 'rotate-90 text-primary' : 'rotate-0',
                  )}
                >
                  ▸
                </span>
                <span className="text-sm font-medium">{card.title}</span>
              </button>
            </h3>

            {/* The panel is always in the DOM and always in the accessibility
                tree; only its height changes. Unmounting it would take the text
                out of the document, and the text is the content — the animation
                is not a reason for it to stop existing. */}
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              className="text-sm text-muted-foreground"
            >
              <motion.div
                initial={false}
                animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
                transition={{ duration: reduced ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
                // A collapsed panel is out of the tab order, so a keyboard user
                // is not sent into content they cannot see.
                inert={!open}
              >
                <div className="pb-3 pl-6 pr-2">{card.body}</div>
              </motion.div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default TowerAccordion
