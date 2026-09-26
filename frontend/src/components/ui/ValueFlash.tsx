import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'

export type FlashTone = 'neutral' | 'gain' | 'loss'

const FLASH_MS = 300

/**
 * Colour-only tint (80ms hold, 220ms fade) when `value` changes — never movement.
 * Skips the first render and never flashes under reduced motion.
 */
export function ValueFlash({
  value,
  tone = 'neutral',
  children,
  className,
}: {
  value: unknown
  tone?: FlashTone
  children: ReactNode
  className?: string
}) {
  const reduced = usePrefersReducedMotion()
  const previous = useRef(value)
  const [flashing, setFlashing] = useState(false)

  useEffect(() => {
    if (previous.current === value) return
    previous.current = value
    if (reduced) return
    setFlashing(true)
    const timeout = window.setTimeout(() => setFlashing(false), FLASH_MS)
    return () => window.clearTimeout(timeout)
  }, [value, reduced])

  return (
    <span
      data-testid="value-flash"
      data-flash={flashing ? tone : undefined}
      className={cn('inline-block', className)}
    >
      {children}
    </span>
  )
}
