import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Numeric value renderer: Geist Mono + tabular numerals. Every number in the UI. */
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono tabular-nums', className)}>{children}</span>
}
