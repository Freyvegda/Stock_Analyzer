import { TOWER_TIERS } from '@/content/tower'
import { tierStage } from '@/components/three/pagodaScene'
import { cn } from '@/lib/utils'

/**
 * The storey rail: four ticks down the side of the landing page.
 *
 * Click to jump to a storey. It goes on the **right**, and that is not a style
 * choice — `towerPose` slides the tower left and the copy column sits right, so
 * the left edge belongs to the building. A rail there would sit on top of it.
 *
 * Hidden below `md` (the overview list already does this job there) and whenever
 * the 3D is absent, since with no tower there is nothing to index.
 */
export function TowerRail({
  openTier,
  onJump,
  visible,
}: {
  /** Storey the tower currently has open, or null. */
  openTier: number | null
  onJump: (stage: number) => void
  /** Only shown alongside the scene. */
  visible: boolean
}) {
  if (!visible) return null

  return (
    <nav
      data-testid="tower-rail"
      aria-label="Storeys"
      // Sits outside the copy column. `pointer-events-none` on the wrapper and
      // `auto` on the buttons, so the empty rail strip never swallows a click
      // meant for the page behind it.
      className="pointer-events-none fixed top-1/2 right-3 z-20 hidden -translate-y-1/2 md:block lg:right-5"
    >
      <ol className="flex flex-col items-end gap-1">
        {TOWER_TIERS.map((tier, i) => {
          const active = openTier === i
          return (
            <li key={tier.id}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => onJump(tierStage(i))}
                className={cn(
                  'glass-panel pointer-events-auto group flex items-center gap-2 rounded-full py-1.5 pr-2 pl-3 transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'text-[11px] tracking-wide whitespace-nowrap',
                    // The name only reads on hover or when it is the current
                    // storey, so the rail stays a quiet edge marker at rest.
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    'transition-opacity duration-150',
                  )}
                >
                  {tier.heading}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-1.5 w-1.5 rounded-full transition-all duration-200',
                    active ? 'bg-primary scale-125' : 'bg-border group-hover:bg-muted-foreground',
                  )}
                />
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default TowerRail
