import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

export interface StatusFact {
  area: string
  text: string
}

interface StatusContextValue {
  facts: StatusFact[]
  publish: (area: string, text: string | null) => void
}

const StatusContext = createContext<StatusContextValue | null>(null)

/** Holds pipeline facts published by pages; the rail renders them. */
export function StatusProvider({ children }: { children: ReactNode }) {
  const [facts, setFacts] = useState<StatusFact[]>([])

  const publish = useCallback((area: string, text: string | null) => {
    setFacts((prev) => {
      const rest = prev.filter((fact) => fact.area !== area)
      return text === null || text === '' ? rest : [...rest, { area, text }]
    })
  }, [])

  const value = useMemo(() => ({ facts, publish }), [facts, publish])
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>
}

/**
 * Publishes one fact for `area` while mounted (null clears it). Publishing is
 * optional infrastructure: without a provider this is a no-op so page tests and
 * standalone usage stay simple.
 */
export function useStatusFact(area: string, text: string | null): void {
  const context = useContext(StatusContext)
  const publish = context?.publish

  useEffect(() => {
    if (publish === undefined) return
    publish(area, text)
    return () => publish(area, null)
  }, [publish, area, text])
}

/** Mono status strip under the nav. Renders nothing when no facts are published. */
export function StatusRail({ className }: { className?: string }) {
  const context = useContext(StatusContext)
  const line = context?.facts.map((fact) => `${fact.area} ${fact.text}`).join(' · ') ?? ''
  const containerRef = useRef<HTMLDivElement>(null)
  const [marquee, setMarquee] = useState(false)

  useEffect(() => {
    const element = containerRef.current
    if (element === null) return
    const measure = () => setMarquee(element.scrollWidth > element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [line])

  if (context === null || context.facts.length === 0) return null

  return (
    <section
      aria-label="Pipeline status"
      data-testid="status-rail"
      className={cn('border-b border-border bg-background/70 px-6 py-1', className)}
    >
      <div
        ref={containerRef}
        className="overflow-hidden font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase"
      >
        {marquee ? (
          <div className="vault-rail-track flex w-max" data-marquee="true">
            <span className="pr-8">{line}</span>
            <span className="pr-8" aria-hidden="true">
              {line}
            </span>
          </div>
        ) : (
          <div className="truncate">{line}</div>
        )}
      </div>
    </section>
  )
}
