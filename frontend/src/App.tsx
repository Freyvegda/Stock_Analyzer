import { NavLink, Route, Routes } from 'react-router-dom'
import Backtest from './pages/Backtest'
import Documents from './pages/Documents'
import Fundamentals from './pages/Fundamentals'
import { ThemeToggle } from './components/ThemeToggle'
import { Toaster } from '@/components/ui/toaster'

const navItems = [
  { to: '/', label: 'Fundamental Analysis' },
  { to: '/documents', label: 'Documents' },
  { to: '/backtest', label: 'Model & Backtest' },
]

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
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
        <div className="ml-auto">
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
      <Toaster />
    </div>
  )
}
