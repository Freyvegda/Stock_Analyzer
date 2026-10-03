import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FundamentalsLayout from '../fundamentals/FundamentalsLayout'
import ScreeningCriteria from '../fundamentals/ScreeningCriteria'
import TopTen from '../fundamentals/TopTen'
import { api, ApiError } from '../../api/client'
import { toaster } from '../../components/ui/toaster'
import { Provider } from '../../components/ui/provider'
import { StatusProvider } from '../../components/StatusRail'
import type { RatioSpec, ScreeningSet } from '../../api/types'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number
    detail: string
    constructor(status: number, detail: string) {
      super(`API error ${status}: ${detail}`)
      this.status = status
      this.detail = detail
    }
  },
  AUTH_UNAUTHORIZED_EVENT: 'auth:unauthorized',
}))

vi.mock('../../components/ui/toaster', () => ({ toaster: { create: vi.fn() } }))

// The real loader pulls the three.js chunk; its presence is all these tests assert.
vi.mock('../../components/three/SakuraLeafLoader', () => ({
  default: () => <div data-testid="sakura-leaf-loader" />,
}))

const mockedApi = vi.mocked(api)

const catalog: RatioSpec[] = [
  { key: 'pe', label: 'PE', unit: '×', category: 'Valuation', direction: 'max' },
  { key: 'roe', label: 'ROE', unit: '%', category: 'Profitability', direction: 'min' },
]

const setA: ScreeningSet = {
  id: 1,
  name: 'Default',
  criteria: [
    { key: 'pe', enabled: true, value: 25 },
    { key: 'roe', enabled: true, value: 15 },
  ],
  thesis: null,
  shortlist_size: 10,
  is_active: true,
  updated_at: 'now',
}

const setB: ScreeningSet = {
  id: 2,
  name: 'Quality',
  criteria: [{ key: 'pe', enabled: true, value: 15 }],
  thesis: null,
  shortlist_size: 10,
  is_active: false,
  updated_at: 'now',
}

const row = {
  symbol: 'TCS',
  rank: 1,
  score: 38.2,
  ratios: { pe: 22.1, pb: 4.1, roe: 41, roce: 50.2, debt_to_equity: 0.09 },
  name: 'Tata Consultancy Services',
  sector: 'IT',
  market_cap: 1200000,
}

const emptyRun = { run_id: 1, run_date: '2026-09-26', shortlisted: [] }

const doneJob = {
  id: 9,
  set_id: 1,
  status: 'done',
  started_at: '2026-10-03T10:00:00.000Z',
  finished_at: '2026-10-03T10:00:05.000Z',
  error: null,
  universe_total: 500,
  universe_done: 500,
  universe_failed: 0,
  items: [],
}

const runningJob = {
  id: 10,
  set_id: 1,
  status: 'running',
  started_at: '2026-10-03T10:00:00.000Z',
  finished_at: null,
  error: null,
  universe_total: 500,
  universe_done: 40,
  universe_failed: 0,
  items: [
    {
      set_id: 1,
      name: 'Default',
      status: 'running',
      run_id: null,
      error: null,
      started_at: '2026-10-03T10:00:00.000Z',
      finished_at: null,
    },
    {
      set_id: 2,
      name: 'Quality',
      status: 'done',
      run_id: 2,
      error: null,
      started_at: '2026-10-03T09:59:00.000Z',
      finished_at: '2026-10-03T09:59:30.000Z',
    },
  ],
}

function mockLoads(
  latest: unknown = emptyRun,
  sets: ScreeningSet[] = [setA, setB],
  job: unknown = null,
) {
  mockedApi.get.mockImplementation((path: string) => {
    if (path === '/screen/sets') return Promise.resolve(sets)
    if (path === '/screen/ratios') return Promise.resolve(catalog)
    if (path === '/screen/latest') return Promise.resolve(latest)
    if (path === '/screen/jobs/latest') return Promise.resolve({ job })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

function renderFundamentals(path = '/fundamentals/criteria') {
  return render(
    <Provider>
      <StatusProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/fundamentals" element={<FundamentalsLayout />}>
              <Route path="criteria" element={<ScreeningCriteria />} />
              <Route path="top10" element={<TopTen />} />
              <Route path="stocks" element={<div>stocks stub</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </StatusProvider>
    </Provider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('ScreeningCriteria', () => {
  it('renders the picker and the active screen badges', async () => {
    mockLoads()
    renderFundamentals()
    expect(await screen.findByRole('tab', { name: 'Default' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Quality' })).toBeInTheDocument()
    expect(screen.getByText('PE ≤ 25×')).toBeInTheDocument()
    expect(screen.getByText('ROE ≥ 15%')).toBeInTheDocument()
    expect(screen.getByText('Top 10')).toBeInTheDocument()
    expect(screen.getByTestId('panel-summary')).toHaveTextContent('2 enabled · 0 bookmarked')
  })

  it('keeps run feedback inline: disabled button, leaf loader and elapsed timer', async () => {
    mockLoads()
    mockedApi.post.mockReturnValue(new Promise(() => {}))
    renderFundamentals()
    await userEvent.click(await screen.findByRole('button', { name: /run screen/i }))
    expect(await screen.findByTestId('sakura-leaf-loader')).toBeInTheDocument()
    expect(screen.getByTestId('elapsed')).toHaveTextContent('00:00')
    expect(screen.getByRole('button', { name: /running/i })).toBeDisabled()
  })

  it('locks the active screen while its job runs: editor, rename and delete controls disabled', async () => {
    mockLoads(emptyRun, [setA, setB], runningJob)
    renderFundamentals()
    expect(await screen.findByTestId('panel-locked')).toHaveTextContent(
      'Screen is running — editing unlocks when the job finishes.',
    )
    expect(screen.getByRole('button', { name: /edit criteria/i })).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Default' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Rename Default' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close Default' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Quality' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Close Quality' })).toBeEnabled()
    expect(screen.getByTestId('tab-running-1')).toBeInTheDocument()
    expect(screen.queryByTestId('tab-running-2')).not.toBeInTheDocument()
  })

  it('disables Run Screen and paints the progress panel on the run card while the job runs', async () => {
    mockLoads(emptyRun, [setA, setB], runningJob)
    renderFundamentals()
    expect(await screen.findByTestId('run-progress')).toBeInTheDocument()
    expect(screen.getByTestId('job-chip-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /running/i })).toBeDisabled()
    expect(screen.queryByTestId('sakura-leaf-loader')).not.toBeInTheDocument()
    expect(screen.queryByTestId('elapsed')).not.toBeInTheDocument()
  })

  it('jumps to the top 10 page when a run finishes while on the criteria page', async () => {
    let latestCalls = 0
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/sets') return Promise.resolve([setA, setB])
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') {
        latestCalls += 1
        return Promise.resolve(
          latestCalls === 1 ? emptyRun : { run_id: 2, run_date: '2026-09-26', shortlisted: [row] },
        )
      }
      if (path === '/screen/jobs/latest') return Promise.resolve({ job: null })
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    mockedApi.post.mockResolvedValue({
      run: { run_id: 2, shortlisted: [row], failed_count: 0, total: 500 },
      job: doneJob,
    })
    renderFundamentals()
    await userEvent.click(await screen.findByRole('button', { name: /run screen/i }))
    expect(await screen.findByRole('heading', { name: 'Top 10 Results' })).toBeInTheDocument()
    expect(await screen.findByText('Tata Consultancy Services')).toBeInTheDocument()
  })

  it('does not jump when the user left the criteria page mid-run, and keeps the run state', async () => {
    mockLoads()
    let release: (value: unknown) => void = () => {}
    mockedApi.post.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    renderFundamentals()
    await userEvent.click(await screen.findByRole('button', { name: /run screen/i }))
    await userEvent.click(screen.getByRole('link', { name: 'Stocks' }))
    expect(await screen.findByText('stocks stub')).toBeInTheDocument()
    release({
      run: { run_id: 2, shortlisted: [row], failed_count: 0, total: 500 },
      job: doneJob,
    })
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(5))
    expect(screen.queryByRole('heading', { name: 'Top 10 Results' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Screen Criteria' }))
    await waitFor(() =>
      expect(screen.getByTestId('summary')).toHaveTextContent(
        '1 shortlisted · 0 failed · 500 total',
      ),
    )
    expect(screen.getByRole('button', { name: /run screen/i })).toBeEnabled()
  })

  it('warns when a run falls back to stored fundamentals', async () => {
    mockLoads()
    mockedApi.post.mockResolvedValue({
      run: {
        run_id: 2,
        shortlisted: [],
        failed_count: 3,
        total: 500,
        stale: true,
      },
      job: doneJob,
    })
    renderFundamentals()
    await userEvent.click(await screen.findByRole('button', { name: /run screen/i }))
    await waitFor(() =>
      expect(toaster.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' })),
    )
  })

  it('shows the panel error when screens loading fails', async () => {
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/latest') return Promise.resolve(emptyRun)
      if (path === '/screen/jobs/latest') return Promise.resolve({ job: null })
      return Promise.reject(new Error('sets exploded'))
    })
    renderFundamentals()
    expect(await screen.findByRole('alert')).toHaveTextContent(/sets exploded/)
  })

  it('treats a 401 after a successful run as a session end, not a warning', async () => {
    let latestCalls = 0
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/sets') return Promise.resolve([setA, setB])
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') {
        latestCalls += 1
        if (latestCalls === 1) return Promise.resolve(emptyRun)
        return Promise.reject(new ApiError(401, 'Not authenticated'))
      }
      if (path === '/screen/jobs/latest') return Promise.resolve({ job: null })
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    mockedApi.post.mockResolvedValue({
      run: { run_id: 2, shortlisted: [], failed_count: 0, total: 0 },
      job: doneJob,
    })
    renderFundamentals()
    await userEvent.click(await screen.findByRole('button', { name: /run screen/i }))
    await waitFor(() => expect(latestCalls).toBe(2))
    expect(toaster.create).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a data-as-of badge when the shortlist came from stored fundamentals', async () => {
    mockLoads({ run_id: 1, run_date: '2026-09-26', shortlisted: [{ ...row, data_date: '2026-09-26' }] })
    renderFundamentals()
    expect(await screen.findByTestId('data-as-of')).toHaveTextContent('Data as of 2026-09-26')
  })

  it('hides the data-as-of badge when rows carry no stored date', async () => {
    mockLoads({ run_id: 1, run_date: '2026-09-26', shortlisted: [row] })
    renderFundamentals()
    expect(await screen.findByText('PE ≤ 25×')).toBeInTheDocument()
    expect(screen.queryByTestId('data-as-of')).not.toBeInTheDocument()
  })

  it('expands the inline editor from Edit Criteria without any dialog', async () => {
    mockLoads()
    renderFundamentals()
    await screen.findByText('PE ≤ 25×')
    await userEvent.click(screen.getByRole('button', { name: /edit criteria/i }))
    expect(await screen.findByLabelText('PE value')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Valuation' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps breathing room between the title, the tabs, the summary and the editor', async () => {
    mockLoads()
    renderFundamentals()
    const shell = await screen.findByTestId('criteria-shell')
    const page = shell.closest('div.space-y-6')
    const tabRow = screen.getByRole('tablist', { name: 'Screening screens' }).closest('.pt-4')
    const editorTitle = screen.getByText('Criteria · Default').closest('button')

    expect(page).not.toBeNull()
    expect(tabRow).not.toBeNull()
    expect(shell.querySelector('[role="tabpanel"]')).toHaveClass('px-4', 'pt-5', 'pb-5')
    expect(editorTitle).toHaveClass('py-4')
  })

  it('joins the screen tabs and the criteria panel into one shell with a small gap', async () => {
    mockLoads()
    renderFundamentals()
    const shell = await screen.findByTestId('criteria-shell')
    expect(shell).toContainElement(screen.getByRole('tablist', { name: 'Screening screens' }))
    expect(shell).toContainElement(screen.getByTestId('panel-summary'))
    expect(shell).toContainElement(screen.getByRole('button', { name: /edit criteria/i }))
    expect(shell.querySelector('[role="tabpanel"]')).toHaveClass('pt-5')
  })

  it('sits flush against the editor so tabs, summary and editor are one stack', async () => {
    mockLoads()
    renderFundamentals()
    const shell = await screen.findByTestId('criteria-shell')
    const editor = await screen.findByText('Criteria · Default')
    const item = editor.closest('[data-part="item"]')
    const stack = shell.parentElement

    expect(item).not.toBeNull()
    expect(item).toHaveClass('border-t-0')
    expect(stack?.contains(item)).toBe(true)
    expect(stack?.className ?? '').not.toContain('space-y')
  })

  it('shows the unsaved-changes bar and saves before switching screens', async () => {
    mockLoads()
    const savedSetA = {
      ...setA,
      criteria: [
        { key: 'pe', enabled: true, value: 18 },
        { key: 'roe', enabled: true, value: 15 },
      ],
    }
    mockedApi.put.mockResolvedValue(savedSetA)
    mockedApi.post.mockResolvedValue({ ...setB, is_active: true })
    renderFundamentals()
    await screen.findByText('PE ≤ 25×')
    await userEvent.click(screen.getByRole('button', { name: /edit criteria/i }))
    const peInput = await screen.findByLabelText('PE value')
    await userEvent.clear(peInput)
    await userEvent.type(peInput, '18')
    expect(screen.getByRole('tab', { name: 'Default' })).toHaveAttribute('data-dirty', 'true')

    await userEvent.click(screen.getByRole('tab', { name: 'Quality' }))
    const bar = await screen.findByRole('alert')
    expect(bar).toHaveTextContent(/unsaved changes/i)

    await userEvent.click(screen.getByRole('button', { name: /save & switch/i }))
    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith('/screen/sets/1', {
        criteria: [
          { key: 'pe', enabled: true, value: 18, bookmarked: false },
          { key: 'roe', enabled: true, value: 15, bookmarked: false },
        ],
        thesis: null,
      }),
    )
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/screen/sets/2/activate', {}))
    expect(await screen.findByText('PE ≤ 15×')).toBeInTheDocument()
  })

  it('discards the draft when choosing Discard & switch', async () => {
    mockLoads()
    mockedApi.post.mockResolvedValue({ ...setB, is_active: true })
    renderFundamentals()
    await screen.findByText('PE ≤ 25×')
    await userEvent.click(screen.getByRole('button', { name: /edit criteria/i }))
    const peInput = await screen.findByLabelText('PE value')
    await userEvent.clear(peInput)
    await userEvent.type(peInput, '18')

    await userEvent.click(screen.getByRole('tab', { name: 'Quality' }))
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: /discard & switch/i }))
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/screen/sets/2/activate', {}))
    expect(mockedApi.put).not.toHaveBeenCalled()
    expect(await screen.findByText('PE ≤ 15×')).toBeInTheDocument()
  })

  it('saves the draft before running', async () => {
    mockLoads()
    mockedApi.put.mockResolvedValue({
      ...setA,
      criteria: [
        { key: 'pe', enabled: true, value: 18 },
        { key: 'roe', enabled: true, value: 15 },
      ],
    })
    mockedApi.post.mockResolvedValue({
      run: { run_id: 2, shortlisted: [], failed_count: 0, total: 500 },
      job: doneJob,
    })
    renderFundamentals()
    await screen.findByText('PE ≤ 25×')
    await userEvent.click(screen.getByRole('button', { name: /edit criteria/i }))
    const peInput = await screen.findByLabelText('PE value')
    await userEvent.clear(peInput)
    await userEvent.type(peInput, '18')

    await userEvent.click(screen.getByRole('button', { name: /run screen/i }))

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalled())
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/screen/run', {}))
    expect(mockedApi.put.mock.invocationCallOrder[0]).toBeLessThan(
      mockedApi.post.mock.invocationCallOrder[0],
    )
  })

  it('creates a new screen from the inline draft tab', async () => {
    const setC: ScreeningSet = { ...setB, id: 3, name: 'Momentum', is_active: true }
    let setsRequests = 0
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/sets') {
        setsRequests += 1
        return Promise.resolve(setsRequests === 1 ? [setA, setB] : [setA, setB, setC])
      }
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') return Promise.resolve(emptyRun)
      if (path === '/screen/jobs/latest') return Promise.resolve({ job: null })
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    mockedApi.post.mockImplementation((path: string) =>
      path === '/screen/sets'
        ? Promise.resolve(setC)
        : Promise.reject(new Error(`unexpected POST ${path}`)),
    )
    renderFundamentals()
    await screen.findByRole('tab', { name: 'Quality' })
    await userEvent.click(screen.getByRole('button', { name: /new screen/i }))
    await userEvent.type(screen.getByRole('textbox', { name: 'New screen name' }), 'Momentum{Enter}')
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/screen/sets', { name: 'Momentum' }))
    expect(await screen.findByRole('tab', { name: 'Momentum' })).toBeInTheDocument()
  })

  it('retries loading screens from the panel error', async () => {
    let setsCalls = 0
    mockedApi.get.mockImplementation((path: string) => {
      if (path === '/screen/sets') {
        setsCalls += 1
        return setsCalls === 1
          ? Promise.reject(new Error('sets exploded'))
          : Promise.resolve([setA, setB])
      }
      if (path === '/screen/ratios') return Promise.resolve(catalog)
      if (path === '/screen/latest') return Promise.resolve(emptyRun)
      if (path === '/screen/jobs/latest') return Promise.resolve({ job: null })
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    renderFundamentals()
    expect(await screen.findByRole('alert')).toHaveTextContent(/sets exploded/)
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('tab', { name: 'Default' })).toBeInTheDocument()
  })

  it('saves the draft before renaming a dirty screen', async () => {
    mockLoads()
    mockedApi.put.mockResolvedValue({
      ...setA,
      criteria: [
        { key: 'pe', enabled: true, value: 18, bookmarked: false },
        { key: 'roe', enabled: true, value: 15, bookmarked: false },
      ],
    })
    renderFundamentals()
    await screen.findByText('PE ≤ 25×')
    await userEvent.click(screen.getByRole('button', { name: /edit criteria/i }))
    const peInput = await screen.findByLabelText('PE value')
    await userEvent.clear(peInput)
    await userEvent.type(peInput, '18')

    await userEvent.click(screen.getByRole('button', { name: 'Rename Default' }))
    const input = screen.getByRole('textbox', { name: 'Rename Default' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Core{Enter}')

    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith(
        '/screen/sets/1',
        expect.objectContaining({ criteria: expect.any(Array) }),
      ),
    )
    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith('/screen/sets/1', { name: 'Core' }))
  })
})
