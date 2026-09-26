import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import './stair-tower.css'

const STEP_COUNT = 8

/**
 * "Never-ending tower" loader: 8 step cells (two columns) fall away while an
 * emerald dot climbs and zig-zags. Pure CSS keyframes; `--tower-size` drives
 * every dimension so the same file renders 16px inside buttons and 140px in
 * the run card. The single sanctioned looping animation in the app
 * (DESIGN.md exception) — never render it inside data areas.
 */
export function StairTowerLoader({
  size = 120,
  label = 'Loading…',
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  const reduced = usePrefersReducedMotion()

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('stair-tower', className)}
      data-reduced={reduced ? 'true' : undefined}
      style={{ '--tower-size': `${size}px` } as CSSProperties}
    >
      <span className="sr-only">{label}</span>
      <div className="stair-tower__stage" aria-hidden="true">
        {Array.from({ length: STEP_COUNT }, (_, i) => (
          <span
            key={i}
            className="stair-tower__step"
            style={{ '--step': i } as CSSProperties}
          />
        ))}
        <span className="stair-tower__dot" />
      </div>
    </div>
  )
}
