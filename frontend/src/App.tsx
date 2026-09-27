import { lazy, Suspense } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Backtest from './pages/Backtest'
import Documents from './pages/Documents'
import Fundamentals from './pages/Fundamentals'
import Login from './pages/Login'
import StockDetail from './pages/StockDetail'
import { Backdrop } from './components/Backdrop'
import { GlassNav } from './components/GlassNav'
import { RequireAuth } from './components/RequireAuth'
import { StatusProvider, StatusRail } from './components/StatusRail'
import { Toaster } from '@/components/ui/toaster'

const AmbientField = lazy(() => import('./components/three/AmbientField'))

function AppShell() {
  return (
    <StatusProvider>
      <div className="min-h-screen text-foreground">
        <GlassNav />
        <StatusRail />
        <main className="p-6">
          <Routes>
            <Route path="/" element={<Fundamentals />} />
            <Route path="/stock/:symbol" element={<StockDetail />} />
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
