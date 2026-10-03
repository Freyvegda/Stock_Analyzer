import { motion, useScroll, useTransform } from 'motion/react'
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { TOWER_TIERS } from '@/content/tower'
import { tierStage } from '@/components/three/pagodaScene'
import { TowerAccordion } from '@/components/TowerAccordion'
import { TowerRail } from '@/components/TowerRail'
import { ColorModeButton } from '@/components/ui/color-mode'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { useFinePointer } from '@/lib/useFinePointer'
import { useLandingStage } from '@/lib/useLandingStage'
import { hasWebGL } from '@/lib/webgl'
import { cn } from '@/lib/utils'

/**
 * The landing page: a pagoda whose storeys open one at a time as you scroll.
 *
 * One scroll `MotionValue` drives two consumers that never talk to each other:
 * the 3D scene samples it inside its frame loop, and the DOM subscribes to it
 * for the active stage index. Because neither owns the state, the tower and the
 * cards cannot disagree about which storey is open.
 *
 * Every stage is exactly one viewport tall, and each tier section is wrapped in
 * a same-height `<div>`. That wrapper matters: a `sticky` element is bounded by
 * its *parent*, and the parent here is `<main>` — the whole page. Without the
 * wrapper the first tier pins at the top and never releases, so every later
 * section stacks on top of it.
 */
const Pagoda = lazy(() => import('@/components/three/Pagoda'))

/** Every stage is exactly this tall, so the scroll maths holds. See pagodaScene. */
const STAGE_H = 'h-svh'

export function Landing() {
  const { user } = useAuth()
  const reduced = usePrefersReducedMotion()
  const isDesktop = useIsDesktop()
  const finePointer = useFinePointer()
  const [webgl, setWebgl] = useState<boolean | null>(null)

  // `hasWebGL` creates a canvas and gets a context. In the render body that is
  // one leaked context per re-render — and this page re-renders on every stage
  // change — until the browser drops the oldest and the canvas goes black.
  useEffect(() => setWebgl(hasWebGL()), [])

  // Below `md` (and without WebGL, and under reduced motion) the story is told
  // by the DOM alone. Same content, no 3D chunk requested.
  const showTower = isDesktop && !reduced && webgl === true

  const scrollRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: scrollRef, offset: ['start start', 'end end'] })
  // The 3D needs a real number every frame; this is that number.
  const raw = useTransform(scrollYProgress, (v) => v)

  const { activeStage, openTier, openRow, onOpen, goToStage } = useLandingStage(raw)

  const heroOpacity = useTransform(raw, [0, 0.08, 0.16], [1, 1, 0])
  const ctaOpacity = useTransform(raw, [0.9, 0.98], [0, 1])
  const ctaY = useTransform(raw, [0.9, 1], [24, 0])

  return (
    <div ref={scrollRef} data-testid="landing" className="relative">
      {showTower ? (
        <Suspense fallback={null}>
          <Pagoda progress={raw} />
        </Suspense>
      ) : null}

      <header className="sticky top-0 z-30 px-4 pt-4 pb-1">
        <div className="glass-nav mx-auto flex max-w-5xl items-center justify-between px-4 py-2">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-[0.08em]"
            aria-label="Stock Analyzer home"
          >
            <PagodaMark />
            STOCK ANALYZER
          </Link>
          <div className="flex items-center gap-1">
            {/* The theme selector: sun or moon, and the whole scene follows it.
                The landscape switches its sky and its celestial body with it. */}
            <ColorModeButton />
            <Link
              to={user ? '/fundamentals/criteria' : '/login'}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {user ? 'Open the analyzer' : 'Sign in'}
            </Link>
          </div>
        </div>
      </header>

      <TowerRail openTier={showTower ? openTier : null} onJump={goToStage} visible={showTower} />

      <main>
        {/* Hero — copy on top, the small tower at the foot of the screen. */}
        <section className={cn(STAGE_H, 'relative flex flex-col justify-between px-6 pt-24 pb-8')}>
          <motion.div
            style={reduced ? undefined : { opacity: heroOpacity }}
            className="mx-auto max-w-2xl text-center"
          >
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
              Read a company the way you would read its filings.
            </h1>
            <p className="mt-4 text-muted-foreground">
              A screen, a search and a set of models over the Nifty 500 — on your own machine, on
              your own criteria.
            </p>
          </motion.div>
          <div className="h-40" aria-hidden="true" />
        </section>

        {/* Overview — the whole tower, all four storeys named. This doubles as a
            table of contents: every row jumps to its storey. */}
        <section className={cn(STAGE_H, 'flex items-center px-6')}>
          <div className="mx-auto w-full max-w-2xl rounded-[--radius-lg] border border-border/60 bg-background/70 p-6 backdrop-blur-md">
            <ol className="space-y-3">
            {TOWER_TIERS.map((t, i) => {
              const current = activeStage >= tierStage(i)
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => goToStage(tierStage(i))}
                    className={cn(
                      'group flex w-full items-baseline justify-between gap-4 border-l pl-4 text-left transition-colors',
                      current
                        ? 'border-primary text-foreground'
                        : 'border-border text-muted-foreground hover:border-muted-foreground',
                    )}
                  >
                    <span className="font-medium">{t.heading}</span>
                    <span className="flex items-center gap-3">
                      <span className="hidden text-sm text-muted-foreground group-hover:block">
                        {t.tagline}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
            </ol>
          </div>
        </section>

        {/* One stage per storey. The wrapper is the containing block for the
            sticky section inside it. */}
        {TOWER_TIERS.map((tier, i) => {
          const open = openTier === i
          const built = tier.status === 'built'
          return (
            <div key={tier.id} className={STAGE_H}>
              <section
                data-testid={'tier-' + tier.id}
                data-open={open ? 'true' : 'false'}
                className={cn(STAGE_H, 'sticky top-0 flex items-center px-6')}
              >
                <div
                  data-testid={'tier-copy-' + tier.id}
                  className={cn(
                    // Narrower than before so the rail, which sits outside it,
                    // can never overlap the copy at any width. The translucent
                    // panel keeps the copy legible over the day scene, where a
                    // pale sky sits directly behind every line.
                    'ml-auto w-full rounded-[--radius-lg] border border-border/60 bg-background/70 p-6 backdrop-blur-md transition-opacity duration-200',
                    showTower ? 'md:max-w-[42%] lg:max-w-[40%]' : 'mx-auto max-w-2xl',
                    open ? 'opacity-100' : 'opacity-70',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
                      {tier.heading}
                    </h2>
                    {tier.badge ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                        {tier.badge}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-muted-foreground">{tier.tagline}</p>

                  <TowerAccordion
                    id={tier.id}
                    cards={tier.cards}
                    finePointer={finePointer}
                    reduced={reduced}
                    openRow={open ? openRow : null}
                    onOpen={onOpen}
                  />

                  {/* The CTA is computed from the storey's status. A built storey
                      links to its route; an unbuilt one does not pretend, and
                      offers a working screen instead of a dead end. */}
                  {built ? (
                    <Link
                      to={user ? tier.route : '/login'}
                      className="mt-6 inline-block text-sm text-primary underline underline-offset-4"
                    >
                      {user ? 'Open it' : 'Sign in to use it'}
                    </Link>
                  ) : (
                    <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-2">
                      <span className="text-sm text-muted-foreground">Not built yet</span>
                      <Link
                        to={user ? tier.fallbackRoute! : '/login'}
                        className="text-sm text-primary underline underline-offset-4"
                      >
                        {user ? 'See the screen that works' : 'Sign in to see what works'}
                      </Link>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )
        })}

        {/* Call to action — the tower re-centres and closes. */}
        <section className={cn(STAGE_H, 'flex items-center justify-center px-6')}>
          <motion.div
            style={reduced ? undefined : { opacity: ctaOpacity, y: ctaY }}
            className="rounded-[--radius-lg] border border-border/60 bg-background/70 px-8 py-6 text-center backdrop-blur-md"
          >
            <h2 className="text-3xl font-semibold tracking-tight">Start with your own criteria.</h2>
            <p className="mx-auto mt-3 max-w-md text-muted-foreground">
              One account, one screen, and every number behind it.
            </p>
            <Link
              to={user ? '/fundamentals/criteria' : '/login'}
              className="mt-6 inline-block rounded-[--radius-md] border border-border bg-card px-5 py-2 text-sm font-medium"
            >
              {user ? 'Open the analyzer' : 'Sign in'}
            </Link>
          </motion.div>
        </section>
      </main>
    </div>
  )
}

/** A code-drawn pagoda mark — the nav logo and the mobile stand-in for the scene. */
function PagodaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      className={cn('text-primary', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2.5v2" />
      <path d="M7 6.5h10l-2-2H9l-2 2Z" />
      <path d="M8.5 6.5v3M15.5 6.5v3M12 6.5v3" />
      <path d="M5 12h14l-2-2.5H7L5 12Z" />
      <path d="M6 12v3M12 12v3M18 12v3" />
      <path d="M3.5 18.5h17l-2-3.5h-13l-2 3.5Z" />
      <path d="M12 15v3.5" />
    </svg>
  )
}

export default Landing
