import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '../api/client'
import type { LatestScreen, ScreenConfig, ScreenRunResult, ShortlistRow } from '../api/types'
import { CriteriaPanel } from '../components/CriteriaPanel'
import { ShortlistTable } from '../components/ShortlistTable'

export default function Fundamentals() {
  const [config, setConfig] = useState<ScreenConfig | null>(null)
  const [rows, setRows] = useState<ShortlistRow[]>([])
  const [summary, setSummary] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string>('')

  async function loadConfig() {
    setConfig(await api.get<ScreenConfig>('/screen/config'))
  }

  async function loadLatest() {
    try {
      const latest = await api.get<LatestScreen>('/screen/latest')
      setRows(latest.shortlisted)
      setSummary(`Last run: ${latest.run_date}`)
    } catch {
      // 404 = no run yet, fine
    }
  }

  useEffect(() => {
    loadConfig()
    loadLatest()
  }, [])

  async function runScreen() {
    setRunning(true)
    setError('')
    try {
      const res = await api.post<ScreenRunResult>('/screen/run', {})
      setRows(res.shortlisted)
      setSummary(`${res.shortlisted.length} shortlisted · ${res.failed_count} failed · ${res.total} total`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Screen run failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Fundamental Analysis</h1>
      {config && <CriteriaPanel config={config} onReload={loadConfig} />}
      <div className="flex items-center gap-4">
        <Button onClick={runScreen} disabled={running}>
          {running ? 'Running…' : 'Run Screen'}
        </Button>
        {running && (
          <span className="text-sm text-zinc-400">
            Fetching fundamentals for ~500 stocks — takes a few minutes.
          </span>
        )}
        {summary && !running && <span className="text-sm text-zinc-400">{summary}</span>}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {rows.length > 0 && <ShortlistTable rows={rows} />}
    </div>
  )
}
