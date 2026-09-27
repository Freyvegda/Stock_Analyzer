import { useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { NavLink } from 'react-router-dom'
import { IconButton, Text } from '@chakra-ui/react'
import { LogOut, TrendingUp } from 'lucide-react'
import { motion } from 'motion/react'
import { ThemeToggle } from './ThemeToggle'
import { useAuth } from '@/auth/AuthContext'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'

const navItems = [
  { to: '/', label: 'Fundamental Analysis' },
  { to: '/stocks', label: 'Stocks' },
  { to: '/documents', label: 'Documents' },
  { to: '/backtest', label: 'Model & Backtest' },
]

const POINTER_QUERY = '(pointer: fine)'

/** Subscribes to fine-pointer capability changes (2-in-1 detach/attach, tablet + mouse). */
function subscribePointerFine(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(POINTER_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function readPointerFine() {
  return typeof window.matchMedia === 'function' && window.matchMedia(POINTER_QUERY).matches
}

/**
 * Liquid-glass navbar (DESIGN.md → Liquid-glass 3D navbar): sticky capsule with a
 * token-derived translucent surface and a pointer-tracked specular sheen. The
 * capsule never tilts, rotates, scales or translates on pointer move (owner
 * feedback); hover brightens the border and inner highlight in colour only.
 * Sheen is off for coarse pointers and under reduced motion, where the active
 * pill is a static highlight.
 */
export function GlassNav() {
  const { user, logout } = useAuth()
  const reduced = usePrefersReducedMotion()
  const finePointer = useSyncExternalStore(subscribePointerFine, readPointerFine, () => false)
  const sheen = !reduced && finePointer
  const capsule = useRef<HTMLDivElement>(null)

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const node = capsule.current
    if (node === null || !sheen) return
    const rect = node.getBoundingClientRect()
    node.style.setProperty('--sheen-x', `${event.clientX - rect.left}px`)
    node.style.setProperty('--sheen-y', `${event.clientY - rect.top}px`)
    node.style.setProperty('--sheen-opacity', '1')
  }

  function onPointerLeave() {
    capsule.current?.style.setProperty('--sheen-opacity', '0')
  }

  return (
    <header className="sticky top-0 z-30 px-4 pt-4 pb-1">
      <motion.div
        ref={capsule}
        data-testid="glass-nav"
        data-sheen={sheen ? 'on' : 'off'}
        className="glass-nav px-4 py-2"
        initial={reduced ? false : { opacity: 0, y: -8, filter: 'blur(6px)' }}
        animate={reduced ? undefined : { opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <nav aria-label="Primary" className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="flex items-center gap-2 pl-1 pr-2 text-sm font-semibold tracking-[0.08em]">
            <TrendingUp size={18} strokeWidth={1.75} className="text-primary" aria-hidden="true" />
            STOCK ANALYZER
          </span>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className="glass-nav-link relative rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    reduced ? (
                      <span
                        aria-hidden="true"
                        data-testid="glass-nav-pill"
                        data-motion="static"
                        className="glass-nav-pill"
                      />
                    ) : (
                      <motion.span
                        aria-hidden="true"
                        data-testid="glass-nav-pill"
                        data-motion="animated"
                        layoutId="nav-active-pill"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                        className="glass-nav-pill"
                      />
                    )
                  ) : null}
                  <span className={isActive ? 'relative font-semibold text-foreground' : 'relative'}>
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Text fontSize="sm" color="fg.muted" className="hidden sm:block">
              {user?.username}
            </Text>
            <IconButton aria-label="Log out" variant="ghost" size="sm" onClick={() => void logout()}>
              <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
            <ThemeToggle />
          </div>
        </nav>
      </motion.div>
    </header>
  )
}

export default GlassNav
