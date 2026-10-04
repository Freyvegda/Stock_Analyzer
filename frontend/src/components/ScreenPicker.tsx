/**
 * Screen picker — glass dropdown for choosing which saved screen grades the
 * stock on the detail page. Mirrors the `NavSearch` combobox recipe
 * (`.glass-field` button, `.glass-panel` listbox, rotateX entrance, 16 ms
 * option stagger, full keyboard support) so it reads as family.
 *
 * Sakura marks selection only; verdicts stay gain/loss plus text. Static
 * under reduced motion (DESIGN.md).
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { Num } from '@/components/ui/Num'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'

export type ScreenVerdict = 'pass' | 'fail' | null

export interface ScreenOption {
  id: number
  name: string
  isActive: boolean
  verdict: ScreenVerdict
  pending?: boolean
  score?: number | null
  passed?: number
  enabled?: number
}

function optionId(id: number): string {
  return `screen-picker-option-${id}`
}

function VerdictChip({ verdict, pending }: { verdict: ScreenVerdict; pending?: boolean }) {
  if (pending === true) {
    return (
      <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
        Checking…
      </span>
    )
  }
  if (verdict === null) {
    return (
      <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
        Not checked yet
      </span>
    )
  }
  const pass = verdict === 'pass'
  return (
    <span
      className={cn(
        'shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
        pass ? 'border-gain/40 text-gain' : 'border-loss/40 text-loss',
      )}
    >
      {pass ? 'Passes your screen' : 'Below your screen'}
    </span>
  )
}

export function ScreenPicker({
  options,
  selectedId,
  onSelect,
  hideVerdict = false,
}: {
  options: ScreenOption[]
  selectedId: number | null
  onSelect: (id: number) => void
  /** Hide the verdict chips (Top 10 / universe pickers grade on demand). */
  hideVerdict?: boolean
}) {
  const reduced = usePrefersReducedMotion()
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const wrapper = useRef<HTMLDivElement>(null)

  const selected = options.find((option) => option.id === selectedId) ?? options[0]

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (wrapper.current !== null && !wrapper.current.contains(event.target as Node)) {
        setOpen(false)
        setHighlight(-1)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open ])

  function choose(id: number) {
    setOpen(false)
    setHighlight(-1)
    onSelect(id)
  }

  function onButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (open) {
        setHighlight((current) => Math.min(current + 1, options.length - 1))
      } else {
        setOpen(true)
        setHighlight(0)
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (open) {
        setHighlight((current) => Math.max(current - 1, 0))
      } else {
        setOpen(true)
        setHighlight(0)
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) {
        const option = options[highlight] ?? selected ?? options[0]
        if (option !== undefined) choose(option.id)
      } else {
        setOpen(true)
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
      setHighlight(-1)
    }
  }

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((current) => Math.min(current + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = options[highlight] ?? options[0]
      if (option !== undefined) choose(option.id)
    } else if (event.key === 'Escape') {
      setOpen(false)
      setHighlight(-1)
    }
  }

  return (
    <div ref={wrapper} data-testid="screen-picker" className="relative">
      <button
        type="button"
        role="combobox"
        aria-label="Choose a screen"
        aria-expanded={open}
        aria-controls="screen-picker-listbox"
        aria-activedescendant={
          highlight >= 0 && options[highlight] !== undefined
            ? optionId(options[highlight].id)
            : undefined
        }
        onClick={() => {
          setOpen((value) => !value)
          setHighlight(-1)
        }}
        onKeyDown={onButtonKeyDown}
        className="glass-field flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {selected?.name ?? 'Choose a screen'}
        </span>
        {selected?.isActive === true ? (
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Active
          </span>
        ) : null}
        {selected !== undefined && !hideVerdict ? (
          <VerdictChip verdict={selected.verdict} pending={selected.pending} />
        ) : null}
        <ChevronDown
          aria-hidden="true"
          size={16}
          strokeWidth={1.75}
          className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <motion.div
          data-testid="screen-picker-panel"
          data-motion={reduced ? 'static' : 'animated'}
          className="glass-panel absolute top-[calc(100%+0.5rem)] right-0 left-0 z-40 p-1"
          initial={reduced ? false : { opacity: 0, rotateX: 8, y: -4 }}
          animate={reduced ? undefined : { opacity: 1, rotateX: 0, y: 0 }}
          style={{ transformPerspective: 900 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          onKeyDown={onListKeyDown}
        >
          <ul id="screen-picker-listbox" role="listbox" aria-label="Screens">
            {options.map((option, index) => (
              <motion.li
                key={option.id}
                id={optionId(option.id)}
                role="option"
                aria-selected={option.id === selectedId}
                initial={reduced ? false : { opacity: 0, y: 4 }}
                animate={reduced ? undefined : { opacity: 1, y: 0 }}
                transition={{ duration: 0.12, delay: reduced ? 0 : Math.min(index, 7) * 0.016 }}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option.id)}
                className={cn(
                  'cursor-pointer rounded-md px-3 py-2 transition-colors',
                  index === highlight || option.id === selectedId
                    ? 'bg-primary/12'
                    : 'hover:bg-secondary/60',
                )}
              >
                <span className="flex items-center gap-2">
                  {option.id === selectedId ? (
                    <Check aria-hidden="true" size={14} strokeWidth={1.75} className="shrink-0 text-primary" />
                  ) : (
                    <span className="w-[14px] shrink-0" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{option.name}</span>
                  {option.isActive ? (
                    <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Active
                    </span>
                  ) : null}
                  {!hideVerdict ? (
                    <VerdictChip verdict={option.verdict} pending={option.pending} />
                  ) : null}
                </span>
                {option.verdict !== null &&
                option.score !== undefined &&
                option.score !== null &&
                option.passed !== undefined &&
                option.enabled !== undefined ? (
                  <span className="mt-1 flex items-center gap-2 pl-6 text-[11px] text-muted-foreground">
                    <span>
                      Score <Num>{option.score.toFixed(1)}</Num>
                    </span>
                    <span>
                      <Num>{option.passed}</Num>/<Num>{option.enabled}</Num> pass
                    </span>
                  </span>
                ) : null}
              </motion.li>
            ))}
          </ul>
        </motion.div>
      ) : null}
    </div>
  )
}

export default ScreenPicker
