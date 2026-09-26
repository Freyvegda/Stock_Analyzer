import { NavLink, Route, Routes } from 'react-router-dom'
import Backtest from './pages/Backtest'
import Documents from './pages/Documents'
import Fundamentals from './pages/Fundamentals'

const navItems = [
  { to: '/', label: 'Fundamental Analysis' },
  { to: '/documents', label: 'Documents' },
  { to: '/backtest', label: 'Model & Backtest' },
]

export default function App() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <nav className="border-b border-zinc-800 px-6 py-3 flex items-center gap-6">
        <span className="font-bold text-lg">Stock Analyzer</span>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'}`
            }
          >
            {item.label}
          </NavLink>
        ))}
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
