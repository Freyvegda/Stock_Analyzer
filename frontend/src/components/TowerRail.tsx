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
      <ol className="flex flex-col items-end gap-2">
        {TOWER_TIERS.map((tier, i) => {
          const active = openTier === i
          return (
            <li key={tier.id}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => onJump(tierStage(i))}
                // One size for all four ticks. The label used to be in this
                // button's layout, so a longer heading made a wider "bookmark"
                // and the hidden ones read as four different empty pills.
                className={cn(
                  'glass-panel pointer-events-auto group relative flex h-6 w-6 items-center justify-center rounded-full transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  aria-hidden="true"
                  data-testid="rail-dot"
                  className={cn(
                    'h-1.5 w-1.5 rounded-full transition-transform duration-200',
                    // Never `bg-border`: in dark mode that is the same near-black
                    // as the panel behind it, and the rail disappears.
                    active
                      ? 'bg-primary scale-125'
                      : 'bg-muted-foreground/70 group-hover:bg-muted-foreground',
                  )}
                />
                {/* Absolutely positioned, so the label never takes part in the
                    button's layout however long it is. */}
                <span
                  data-testid="rail-label"
                  className={cn(
                    'absolute right-full mr-2 rounded-full border border-border/70 bg-popover/95 px-2 py-0.5 text-[11px] tracking-wide whitespace-nowrap text-popover-foreground transition-opacity duration-150',
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  )}
                >
                  {tier.heading}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default TowerRail
