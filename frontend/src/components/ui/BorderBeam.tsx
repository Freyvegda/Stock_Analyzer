import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'

export function BorderBeam({
  active = true,
  className,
}: {
  active?: boolean
  className?: string
}) {
  const reduced = usePrefersReducedMotion()

  if (!active) return null

  if (reduced) {
    return (
      <span
        data-testid="border-beam-static"
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-primary/40',
          className,
        )}
      />
    )
  }

  return (
    <span
      data-testid="border-beam"
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]',
        className,
      )}
    >
      <motion.span
        className="absolute aspect-square w-16 bg-gradient-to-l from-primary via-primary/40 to-transparent"
        style={{ offsetPath: 'rect(0 auto auto 0 round 16px)' }}
        initial={{ offsetDistance: '0%' }}
        animate={{ offsetDistance: '100%' }}
        transition={{ repeat: Infinity, ease: 'linear', duration: 4 }}
      />
    </span>
  )
}
