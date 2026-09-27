/**
 * Fundamentals section rail: the three screens of the fundamental pipeline.
 * Structural companion to `GlassNav` — the glass/floating treatment lands in
 * the rail's own styling (Task 2 of the restructure plan).
 */

import { Fragment } from 'react'
import { NavLink } from 'react-router-dom'
import { ListChecks, Table2, Trophy } from 'lucide-react'
import { motion } from 'motion/react'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'

const items = [
  { to: '/fundamentals/criteria', label: 'Screen Criteria', icon: ListChecks },
  { to: '/fundamentals/top10', label: 'Top 10 Results', icon: Trophy },
  { to: '/fundamentals/stocks', label: 'Stocks', icon: Table2 },
]

export function FundamentalNav() {
  const reduced = usePrefersReducedMotion()

  return (
    <nav aria-label="Fundamental analysis" className="flex flex-col gap-1">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className="relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          {({ isActive }) => (
            <Fragment>
              {isActive ? (
                reduced ? (
                  <span
                    aria-hidden="true"
                    data-testid="fundamental-nav-pill"
                    data-motion="static"
                    className="glass-nav-pill"
                  />
                ) : (
                  <motion.span
                    aria-hidden="true"
                    data-testid="fundamental-nav-pill"
                    data-motion="animated"
                    layoutId="fundamental-nav-pill"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    className="glass-nav-pill"
                  />
                )
              ) : null}
              <span
                className={
                  isActive
                    ? 'relative flex items-center gap-2 font-semibold text-foreground'
                    : 'relative flex items-center gap-2'
                }
              >
                <item.icon size={16} strokeWidth={1.75} aria-hidden="true" />
                {item.label}
              </span>
            </Fragment>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

export default FundamentalNav
