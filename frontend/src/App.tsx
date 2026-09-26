import { lazy, Suspense } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { IconButton, Text } from '@chakra-ui/react'
import { LogOut, TrendingUp } from 'lucide-react'
import { motion } from 'motion/react'
import Backtest from './pages/Backtest'
import Documents from './pages/Documents'
import Fundamentals from './pages/Fundamentals'
import Login from './pages/Login'
import { Backdrop } from './components/Backdrop'
import { RequireAuth } from './components/RequireAuth'
import { StatusProvider, StatusRail } from './components/StatusRail'
import { ThemeToggle } from './components/ThemeToggle'
import { useAuth } from './auth/AuthContext'
import { usePrefersReducedMotion } from './lib/usePrefersReducedMotion'
import { Toaster } from '@/components/ui/toaster'

const AmbientField = lazy(() => import('./components/three/AmbientField'))

const navItems = [
  { to: '/', label: 'Fundamental Analysis' },
  { to: '/documents', label: 'Documents' },
  { to: '/backtest', label: 'Model & Backtest' },
]

function AppShell() {
  const { user, logout } = useAuth()
  const reduced = usePrefersReducedMotion()

  return (
    <StatusProvider>
      <div className="min-h-screen text-foreground">
        <nav className="border-b border-border px-6 py-3 flex items-center gap-6">
          <span className="flex items-center gap-2 text-sm font-semibold tracking-[0.08em]">
            <TrendingUp size={18} strokeWidth={1.75} className="text-primary" aria-hidden="true" />
            STOCK ANALYZER
          </span>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {({ isActive }) => (
                <span
                  className={
                    isActive
                      ? 'relative inline-block py-0.5 font-semibold text-foreground'
                      : 'relative inline-block py-0.5'
                  }
                >
                  {item.label}
                  {isActive ? (
                    reduced ? (
                      <span className="absolute -bottom-0.5 left-0 right-0 h-0.5 rounded-full bg-primary" />
                    ) : (
                      <motion.span
                        layoutId="nav-underline"
                        className="absolute -bottom-0.5 left-0 right-0 h-0.5 rounded-full bg-primary"
                      />
                    )
                  ) : null}
                </span>
              )}
            </NavLink>
          ))}
          <div className="ml-auto flex items-center gap-3">
            <Text fontSize="sm" color="fg.muted">
              {user?.username}
            </Text>
            <IconButton
              aria-label="Log out"
              variant="ghost"
              size="sm"
              onClick={() => void logout()}
            >
              <LogOut size={16} strokeWidth={1.75} />
            </IconButton>
            <ThemeToggle />
          </div>
        </nav>
        <StatusRail />
        <main className="p-6">
          <Routes>
            <Route path="/" element={<Fundamentals />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/backtest" element={<Backtest />} />
          </Routes>
        </main>
      </div>
    </StatusProvider>
  )
}

export default function App() {
  const onLogin = useLocation().pathname === '/login'

  return (
    <>
      <Backdrop />
      {/* Login draws its own Sakura Garden scene; one decorative loop per viewport zone. */}
      {onLogin ? null : (
        <Suspense fallback={null}>
          <AmbientField />
        </Suspense>
      )}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        />
      </Routes>
      <Toaster />
    </>
  )
}
