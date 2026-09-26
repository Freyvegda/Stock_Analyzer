import { useId } from 'react'
import { cn } from '@/lib/utils'

export function DotPattern({
  className,
  width = 20,
  height = 20,
  radius = 1,
}: {
  className?: string
  width?: number
  height?: number
  radius?: number
}) {
  const patternId = `dot-pattern-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  return (
    <svg
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 h-full w-full text-border', className)}
    >
      <defs>
        <pattern id={patternId} width={width} height={height} patternUnits="userSpaceOnUse">
          <circle cx={radius} cy={radius} r={radius} fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  )
}
