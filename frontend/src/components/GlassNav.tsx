import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { NavLink } from 'react-router-dom'
import { IconButton, Text } from '@chakra-ui/react'
import { LogOut, TrendingUp } from 'lucide-react'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { ThemeToggle } from './ThemeToggle'
import { useAuth } from '@/auth/AuthContext'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'

const navItems = [
  { to: '/', label: 'Fundamental Analysis' },
  { to: '/documents', label: 'Documents' },
  { to: '/backtest', label: 'Model & Backtest' },
]

/** Maximum capsule tilt in degrees, either axis. */
const MAX_TILT = 3

/**
 * Liquid-glass navbar (DESIGN.md → Liquid-glass 3D navbar): sticky capsule with a
 * token-derived translucent surface, pointer-tracked specular sheen and a spring
 * 3D tilt on fine pointers. Tilt and sheen are off for coarse pointers and under
 * reduced motion; the active pill is a static highlight in that case.
 */
export function GlassNav() {
  const { user, logout } = useAuth()
  const reduced = usePrefersReducedMotion()
  const [tilt, setTilt] = useState(false)
  const capsule = useRef<HTMLDivElement>(null)

  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const rotateY = useSpring(useTransform(pointerX, [-0.5, 0.5], [-MAX_TILT, MAX_TILT]), {
    stiffness: 260,
    damping: 30,
  })
  const rotateX = useSpring(useTransform(pointerY, [-0.5, 0.5], [MAX_TILT, -MAX_TILT]), {
    stiffness: 260,
    damping: 30,
  })

  useEffect(() => {
    if (reduced || typeof window.matchMedia !== 'function') {
      setTilt(false)
      return
    }
    setTilt(window.matchMedia('(pointer: fine)').matches)
  }, [reduced])

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const node = capsule.current
    if (node === null) return
    const rect = node.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    if (!tilt) return
    node.style.setProperty('--sheen-x', `${x}px`)
    node.style.setProperty('--sheen-y', `${y}px`)
    node.style.setProperty('--sheen-opacity', '1')
    pointerX.set(x / rect.width - 0.5)
    pointerY.set(y / rect.height - 0.5)
  }

  function onPointerLeave() {
    capsule.current?.style.setProperty('--sheen-opacity', '0')
    pointerX.set(0)
    pointerY.set(0)
  }

  return (
    <header className="sticky top-0 z-30 px-4 pt-4 pb-1">
      <div className="glass-nav-tilt">
        <motion.div
          ref={capsule}
          data-testid="glass-nav"
          data-tilt={tilt ? 'on' : 'off'}
          className="glass-nav px-4 py-2"
          style={tilt ? { rotateX, rotateY, transformStyle: 'preserve-3d' } : undefined}
          initial={reduced ? false : { opacity: 0, y: -10, filter: 'blur(6px)' }}
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
                className="relative rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                {({ isActive }) => (
                  <>
                    {isActive ? (
                      reduced ? (
                        <span
                          aria-hidden="true"
                          data-testid="glass-nav-pill"
                          className="glass-nav-pill"
                        />
                      ) : (
                        <motion.span
                          aria-hidden="true"
                          data-testid="glass-nav-pill"
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
              <IconButton
                aria-label="Log out"
                variant="ghost"
                size="sm"
                onClick={() => void logout()}
              >
                <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
              </IconButton>
              <ThemeToggle />
            </div>
          </nav>
        </motion.div>
      </div>
    </header>
  )
}

export default GlassNav
