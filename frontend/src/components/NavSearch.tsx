/**
 * Nav stock search — glass combobox inside the navbar capsule.
 *
 * Lazy-loads `GET /stocks` on first open (one fetch per mount), filters the
 * caller's own universe client-side and shows each match with the caller's
 * screen verdict. Ctrl/Cmd+K opens, arrows move the active row, Enter or a
 * click opens `/stock/{symbol}`. The panel is the only 3D surface: it enters
 * with a perspective tilt, rows stagger 16 ms and a pointer sheen follows the
 * cursor — all off for coarse pointers and reduced motion (DESIGN.md).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, IconButton, Text } from '@chakra-ui/react'
import { Search } from 'lucide-react'
import { motion } from 'motion/react'
import { api } from '../api/client'
import type { StockListResponse, StockListRow } from '../api/types'
import { cn } from '@/lib/utils'
import { useFinePointer } from '@/lib/useFinePointer'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { Num } from './ui/Num'

const RESULT_LIMIT = 8

const VERDICT_LABEL: Record<StockListRow['verdict'], string> = {
  pass: 'Pass',
  fail: 'Fail',
  no_data: 'No data',
}

const VERDICT_CLASS: Record<StockListRow['verdict'], string> = {
  pass: 'border-gain/40 text-gain',
  fail: 'border-loss/40 text-loss',
  no_data: 'border-border text-muted-foreground',
}

function optionId(symbol: string): string {
  return `nav-search-option-${symbol}`
}

export function NavSearch() {
  const navigate = useNavigate()
  const reduced = usePrefersReducedMotion()
  const finePointer = useFinePointer()
  const sheen = !reduced && finePointer

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<StockListRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [active, setActive] = useState(-1)

  const wrapper = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  async function load() {
    setLoading(true)
    setError(false)
    try {
      const data = await api.get<StockListResponse>('/stocks')
      setRows(data.rows)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  function openSearch() {
    setOpen(true)
  }

  // Load the universe on first open, however the search was opened (button,
  // Ctrl/Cmd+K). A failed load stays failed until Retry is pressed.
  useEffect(() => {
    if (!open || rows !== null || loading || error) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rows, loading, error])

  function closeSearch() {
    setOpen(false)
    setQuery('')
    setActive(-1)
  }

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '' || rows === null) return []
    return rows
      .filter(
        (row) =>
          row.symbol.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle),
      )
      .slice(0, RESULT_LIMIT)
  }, [rows, query])

  // Focus the input when the search opens.
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  // Ctrl/Cmd+K opens from anywhere.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Close when the pointer lands outside the search.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (wrapper.current !== null && !wrapper.current.contains(event.target as Node)) {
        closeSearch()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function goTo(row: StockListRow) {
    closeSearch()
    navigate(`/stock/${row.symbol}`)
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => Math.min(current + 1, matches.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => Math.max(current - 1, -1))
    } else if (event.key === 'Enter') {
      const row = matches[active] ?? matches[0]
      if (row !== undefined) goTo(row)
    } else if (event.key === 'Escape') {
      closeSearch()
    }
  }

  function onPanelMove(event: ReactPointerEvent<HTMLDivElement>) {
    const node = panel.current
    if (node === null || !sheen) return
    const rect = node.getBoundingClientRect()
    node.style.setProperty('--sheen-x', `${event.clientX - rect.left}px`)
    node.style.setProperty('--sheen-y', `${event.clientY - rect.top}px`)
    node.style.setProperty('--sheen-opacity', '1')
  }

  function onPanelLeave() {
    panel.current?.style.setProperty('--sheen-opacity', '0')
  }

  const status =
    error
      ? "Couldn't load the stock list"
      : query.trim() === ''
        ? 'Type a symbol or company name'
        : loading
          ? 'Loading stocks…'
          : 'No stocks match'

  return (
    <div ref={wrapper} data-testid="nav-search" className="relative flex items-center">
      <IconButton
        aria-label="Search stocks"
        aria-keyshortcuts="Control+K"
        title="Search stocks (Ctrl+K)"
        variant="ghost"
        size="sm"
        onClick={() => (open ? closeSearch() : openSearch())}
      >
        <Search size={16} strokeWidth={1.75} aria-hidden="true" />
      </IconButton>

      {open ? (
        <motion.div
          initial={reduced ? false : { opacity: 0, width: 0 }}
          animate={reduced ? undefined : { opacity: 1, width: '12rem' }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-label="Search stocks"
            aria-expanded="true"
            aria-controls="nav-search-listbox"
            aria-activedescendant={
              active >= 0 && matches[active] !== undefined ? optionId(matches[active].symbol) : undefined
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(-1)
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search stocks…"
            autoComplete="off"
            className="h-8 w-full rounded-md border border-border bg-background/40 px-2 text-sm outline-none transition-colors focus-visible:border-ring"
          />
        </motion.div>
      ) : null}

      {open ? (
        <motion.div
          ref={panel}
          data-testid="nav-search-panel"
          data-motion={reduced ? 'static' : 'animated'}
          data-sheen={sheen ? 'on' : 'off'}
          className="glass-panel absolute right-0 top-[calc(100%+0.5rem)] z-40 w-[min(24rem,calc(100vw-2rem))] p-1"
          initial={reduced ? false : { opacity: 0, rotateX: 8, y: -4 }}
          animate={reduced ? undefined : { opacity: 1, rotateX: 0, y: 0 }}
          style={{ transformPerspective: 900 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          onPointerMove={onPanelMove}
          onPointerLeave={onPanelLeave}
        >
          <div className="relative z-10 max-h-80 overflow-y-auto">
            {matches.length > 0 ? (
              <ul id="nav-search-listbox" role="listbox" aria-label="Stocks">
                {matches.map((row, index) => (
                  <motion.li
                    key={row.symbol}
                    id={optionId(row.symbol)}
                    role="option"
                    aria-selected={index === active}
                    initial={reduced ? false : { opacity: 0, y: 4 }}
                    animate={reduced ? undefined : { opacity: 1, y: 0 }}
                    transition={{ duration: 0.12, delay: reduced ? 0 : Math.min(index, 7) * 0.016 }}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => goTo(row)}
                    className={cn(
                      'cursor-pointer rounded-md px-3 py-2 transition-colors',
                      index === active ? 'bg-secondary' : 'hover:bg-secondary/60',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="shrink-0 text-sm font-semibold">{row.symbol}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {row.name}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
                          VERDICT_CLASS[row.verdict],
                        )}
                      >
                        {VERDICT_LABEL[row.verdict]}
                      </span>
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>
                        <Num>{row.passes}</Num>/<Num>{row.enabled}</Num> pass
                      </span>
                      {row.market_cap !== null ? (
                        <span>
                          Mkt cap <Num>{row.market_cap.toFixed(1)}</Num> ₹ cr
                        </span>
                      ) : null}
                    </span>
                  </motion.li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <Text fontSize="xs" color="fg.muted">
                  {status}
                </Text>
                {error && !loading ? (
                  <Button
                    size="xs"
                    variant="outline"
                    colorPalette="sakura"
                    onClick={() => {
                      void load()
                      input.current?.focus()
                    }}
                  >
                    Retry
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </motion.div>
      ) : null}
    </div>
  )
}

export default NavSearch
