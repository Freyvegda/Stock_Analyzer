import { lazy, Suspense } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { IconButton, Text } from '@chakra-ui/react'
import { LogOut } from 'lucide-react'
import Backtest from './pages/Backtest'
import Documents from './pages/Documents'
import Fundamentals from './pages/Fundamentals'
import Login from './pages/Login'
import { RequireAuth } from './components/RequireAuth'
import { ThemeToggle } from './components/ThemeToggle'
import { useAuth } from './auth/AuthContext'
import { Toaster } from '@/components/ui/toaster'

const AmbientField = lazy(() => import('./components/three/AmbientField'))

const navItems = [
  { to: '/', label: 'Fundamental Analysis' },
  { to: '/documents', label: 'Documents' },
  { to: '/backtest', label: 'Model & Backtest' },
]

function AppShell() {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-screen text-foreground">
      <nav className="border-b border-border px-6 py-3 flex items-center gap-6">
        <span className="font-bold text-lg">Stock Analyzer</span>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`
            }
          >
            {item.label}
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
      <main className="p-6">
        <Routes>
          <Route path="/" element={<Fundamentals />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/backtest" element={<Backtest />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <>
      <Suspense fallback={null}>
        <AmbientField />
      </Suspense>
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
