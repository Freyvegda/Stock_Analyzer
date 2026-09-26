import { cn } from '@/lib/utils'

/** Tone-matched loading block (surface ladder base + shimmer); static under reduced motion. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-testid="skeleton" className={cn('vault-skeleton rounded-md', className)} />
  )
}
