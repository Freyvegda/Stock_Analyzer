import { useEffect, useState } from 'react'
import { animate } from 'motion'
import { cn } from '@/lib/utils'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'

export function NumberTicker({
  value,
  decimals = 0,
  className,
}: {
  value: number
  decimals?: number
  className?: string
}) {
  const reduced = usePrefersReducedMotion()
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (reduced) {
      setDisplay(value)
      return
    }

    const controls = animate(0, value, {
      duration: 0.32,
      onUpdate: (latest) => setDisplay(latest),
    })
    return () => controls.cancel()
  }, [value, reduced])

  return (
    <span data-testid="number-ticker" className={cn('tabular-nums', className)}>
      {(reduced ? value : display).toFixed(decimals)}
    </span>
  )
}
