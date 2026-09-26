import { useState } from 'react'
import { api } from '../api/client'

export default function Fundamentals() {
  const [status, setStatus] = useState<string>('')

  async function runScreen() {
    setStatus('Running...')
    const res = await api.post<{ status: string }>('/screen/run', {})
    setStatus(JSON.stringify(res))
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Fundamental Analysis</h1>
      <button
        onClick={runScreen}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"
      >
        Run Screen
      </button>
      <p className="mt-4 text-sm text-zinc-400">
        Screens Nifty 500 against ratios in backend/config/screening.yaml, returns shortlist.
        (Phase 1 — endpoint is a placeholder.)
      </p>
      {status && <pre className="mt-4 rounded bg-zinc-900 p-3 text-xs">{status}</pre>}
    </div>
  )
}
