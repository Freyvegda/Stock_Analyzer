import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Backtest from './pages/Backtest'
import Documents from './pages/Documents'
import Landing from './pages/Landing'
import Login from './pages/Login'
import StockDetail from './pages/StockDetail'
import Stocks from './pages/Stocks'
import FundamentalsLayout from './pages/fundamentals/FundamentalsLayout'
import ScreeningCriteria from './pages/fundamentals/ScreeningCriteria'
import TopTen from './pages/fundamentals/TopTen'
import { Backdrop } from './components/Backdrop'
import { GlassNav } from './components/GlassNav'
import { RequireAuth } from './components/RequireAuth'
import { StatusProvider, StatusRail } from './components/StatusRail'
import { Toaster } from '@/components/ui/toaster'

const Bonfire = lazy(() => import('./components/three/Bonfire'))

function AppShell() {
  return (
    <StatusProvider>
      <div className="min-h-screen text-foreground">
        <GlassNav />
        <StatusRail />
        <main className="p-6">
          <Routes>
            {/* `/` is the public landing page (a top-level route below), so the
                app's own entry is /fundamentals/criteria. */}
            <Route path="/fundamentals" element={<FundamentalsLayout />}>
              <Route index element={<Navigate to="criteria" replace />} />
              <Route path="criteria" element={<ScreeningCriteria />} />
              <Route path="top10" element={<TopTen />} />
              <Route path="stocks" element={<Stocks />} />
            </Route>
            <Route path="/stocks" element={<Navigate to="/fundamentals/stocks" replace />} />
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
  const pathname = useLocation().pathname
  // One decorative loop per viewport zone. The landing page draws the pagoda
  // instead, and login draws the Sakura Garden.
  const onLanding = pathname === '/'
  const onLogin = pathname === '/login'

  return (
    <>
      <Backdrop />
      {onLanding || onLogin ? null : (
        <Suspense fallback={null}>
          <Bonfire />
        </Suspense>
      )}
      <Routes>
        <Route path="/" element={<Landing />} />
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
