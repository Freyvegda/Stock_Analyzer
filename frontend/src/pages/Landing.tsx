import { motion, useMotionValueEvent, useScroll, useSpring, useTransform } from 'motion/react'
import { Suspense, lazy, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Backdrop } from '@/components/Backdrop'
import { useAuth } from '@/auth/AuthContext'
import { TOWER_TIERS } from '@/content/tower'
import { SCROLL_SPAN, stageProgress } from '@/components/three/pagodaScene'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { hasWebGL } from '@/lib/webgl'
import { cn } from '@/lib/utils'

/**
 * The landing page: a pagoda whose storeys open one at a time as you scroll.
 *
 * One scroll `MotionValue` drives two consumers that never talk to each other:
 * the 3D scene samples it inside its frame loop, and the DOM subscribes to it
 * for the active stage index. Because neither owns the state, the tower and the
 * cards cannot disagree about which storey is open.
 */
const Pagoda = lazy(() => import('@/components/three/Pagoda'))

/** Every stage is exactly this tall, so the scroll maths holds. See pagodaScene. */
const STAGE_H = 'h-svh'

export function Landing() {
  const { user } = useAuth()
  const reduced = usePrefersReducedMotion()
  const isDesktop = useIsDesktop()
  const scrollRef = useRef<HTMLDivElement>(null)

  const { scrollYProgress } = useScroll({ target: scrollRef, offset: ['start start', 'end end'] })
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 })

  // The 3D needs a real number every frame; this is that number.
  const raw = useTransform(scrollYProgress, (v) => v)

  // The DOM only cares which stage is on screen, and that changes 7 times, not
  // once per frame. Deriving the index from the same value is what keeps the
  // two consumers honest.
  const [activeStage, setActiveStage] = useState(0)
  useMotionValueEvent(progress, 'change', (v) => {
    const s = Math.min(SCROLL_SPAN, Math.floor(stageProgress(v)))
    setActiveStage((prev) => (prev === s ? prev : s))
  })

  const openTier = activeStage - 2
  const heroOpacity = useTransform(raw, [0, 0.12, 0.22], [1, 1, 0])
  const ctaOpacity = useTransform(raw, [0.86, 0.96], [0, 1])
  const ctaY = useTransform(raw, [0.86, 1], [24, 0])

  // Below `md` (and without WebGL, and under reduced motion) the story is told
  // by the DOM alone. Same content, no 3D chunk requested.
  const showTower = isDesktop && !reduced && hasWebGL()

  return (
    <div ref={scrollRef} data-testid="landing" className="relative">
      <Backdrop />
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
          <Link
            to={user ? '/fundamentals/criteria' : '/login'}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {user ? 'Open the analyzer' : 'Sign in'}
          </Link>
        </div>
      </header>

      <main>
        {/* Hero — a small tower at the foot of the screen. */}
        <section className={cn(STAGE_H, 'relative flex flex-col items-center justify-end pb-16')}>
          <motion.div
            style={reduced ? undefined : { opacity: heroOpacity }}
            className="mx-auto max-w-2xl px-6 text-center"
          >
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
              Read a company the way you would read its filings.
            </h1>
            <p className="mt-4 text-muted-foreground">
              A screen, a search and a set of models over the Nifty 500 — on your own machine, on
              your own criteria.
            </p>
          </motion.div>
          <div className="mt-auto h-24 w-full" aria-hidden="true" />
        </section>

        {/* Overview — the whole tower, all four storeys named. */}
        <section className={cn(STAGE_H, 'flex items-center justify-center px-6')}>
          <ol className="w-full max-w-2xl space-y-3">
            {TOWER_TIERS.map((tier, i) => (
              <li
                key={tier.id}
                className={cn(
                  'flex items-baseline justify-between gap-4 border-l pl-4 transition-colors',
                  activeStage >= 2 + i ? 'border-primary text-foreground' : 'border-border text-muted-foreground',
                )}
              >
                <span className="font-medium">{tier.heading}</span>
                <span className="text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* One section per storey. Pinned by CSS; the 3D reads the same value. */}
        {TOWER_TIERS.map((tier, i) => {
          const open = openTier === i
          return (
            <section
              key={tier.id}
              data-testid={`tier-${tier.id}`}
              data-open={open ? 'true' : 'false'}
              className={cn(STAGE_H, 'sticky top-0 flex items-center px-6')}
            >
              <div
                className={cn(
                  'ml-auto w-full max-w-xl transition-all duration-200',
                  showTower ? 'md:max-w-[46%]' : 'max-w-2xl mx-auto',
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
                <div className="mt-6 grid gap-3 sm:grid-cols-3 md:grid-cols-1">
                  {tier.cards.map((card) => (
                    <article key={card.title} className="glass-panel rounded-[--radius-lg] p-4">
                      <h3 className="text-sm font-medium">{card.title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{card.body}</p>
                    </article>
                  ))}
                </div>
                <Link
                  to={user ? tier.route : '/login'}
                  className="mt-6 inline-block text-sm text-primary underline underline-offset-4"
                >
                  {user ? `Open ${tier.heading.toLowerCase()}` : 'Sign in to use it'}
                </Link>
              </div>
            </section>
          )
        })}

        {/* Call to action — the tower re-centres and closes. */}
        <section className={cn(STAGE_H, 'flex items-center justify-center px-6')}>
          <motion.div
            style={reduced ? undefined : { opacity: ctaOpacity, y: ctaY }}
            className="text-center"
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
