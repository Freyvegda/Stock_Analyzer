import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CriteriaDialog } from '../CriteriaDialog'
import { Provider } from '../ui/provider'
import { api, ApiError } from '../../api/client'
import type { RatioSpec, UserCriteria } from '../../api/types'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
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

const mockedApi = vi.mocked(api)

const catalog: RatioSpec[] = [
  { key: 'pe', label: 'PE', unit: '×', category: 'Valuation', direction: 'max' },
  { key: 'roe', label: 'ROE', unit: '%', category: 'Profitability', direction: 'min' },
  { key: 'dividendYield', label: 'Dividend Yield', unit: '%', category: 'Dividend', direction: 'min' },
  { key: 'currentRatio', label: 'Current Ratio', unit: '×', category: 'Liquidity', direction: 'min' },
]

const criteria: UserCriteria = {
  criteria: [
    { key: 'pe', enabled: true, value: 25 },
    { key: 'roe', enabled: true, value: 15 },
    { key: 'dividendYield', enabled: false, value: 1 },
  ],
  thesis: 'Quality compounders only.',
  shortlist_size: 10,
}

function mockLoadSuccess() {
  mockedApi.get.mockImplementation((path: string) =>
    Promise.resolve(path === '/screen/ratios' ? catalog : criteria),
  )
}

function renderDialog(overrides?: { onSaved?: (c: UserCriteria) => void; onOpenChange?: (open: boolean) => void }) {
  const onOpenChange = overrides?.onOpenChange ?? vi.fn()
  const onSaved = overrides?.onSaved ?? vi.fn()
  render(
    <Provider>
      <CriteriaDialog open onOpenChange={onOpenChange} onSaved={onSaved} />
    </Provider>,
  )
  return { onOpenChange, onSaved }
}

beforeEach(() => vi.resetAllMocks())

describe('CriteriaDialog', () => {
  it('renders rows from the saved criteria with direction suffixes', async () => {
    mockLoadSuccess()
    renderDialog()
    expect(await screen.findByRole('checkbox', { name: 'PE' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'ROE' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Dividend Yield' })).not.toBeChecked()
    expect(screen.getByLabelText('PE value')).toHaveValue('25')
    expect(screen.getAllByText('≤').length).toBeGreaterThan(0)
    expect(screen.getAllByText('≥').length).toBeGreaterThan(0)
  })

  it('saves the exact PUT payload with toggled rows', async () => {
    mockLoadSuccess()
    mockedApi.put.mockResolvedValue(criteria)
    renderDialog()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'ROE' }))
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith('/screen/criteria', {
        criteria: [
          { key: 'pe', enabled: true, value: 25 },
          { key: 'roe', enabled: false, value: 15 },
          { key: 'dividendYield', enabled: false, value: 1 },
        ],
        thesis: 'Quality compounders only.',
      }),
    )
  })

  it('removes a row from the payload', async () => {
    mockLoadSuccess()
    mockedApi.put.mockResolvedValue(criteria)
    renderDialog()
    await userEvent.click(await screen.findByRole('button', { name: 'Remove ROE' }))
    expect(screen.queryByRole('checkbox', { name: 'ROE' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith(
        '/screen/criteria',
        expect.objectContaining({
          criteria: expect.not.arrayContaining([expect.objectContaining({ key: 'roe' })]),
        }),
      ),
    )
  })

  it('adds a ratio through the combobox, excluding existing keys', async () => {
    mockLoadSuccess()
    mockedApi.put.mockResolvedValue(criteria)
    renderDialog()
    expect(await screen.findByPlaceholderText(/add ratio/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /toggle suggestions/i }))
    const option = await screen.findByRole('option', { name: /current ratio/i })
    expect(screen.queryByRole('option', { name: 'PE' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Dividend Yield' })).not.toBeInTheDocument()
    await userEvent.click(option)
    const valueInput = await screen.findByLabelText('Current Ratio value')
    expect(valueInput).toHaveValue('')
    await userEvent.type(valueInput, '1.2')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith(
        '/screen/criteria',
        expect.objectContaining({
          criteria: expect.arrayContaining([
            { key: 'currentRatio', enabled: true, value: 1.2 },
          ]),
        }),
      ),
    )
  })

  it('rejects a non-numeric row value without firing the PUT', async () => {
    mockLoadSuccess()
    renderDialog()
    const input = await screen.findByLabelText('PE value')
    await userEvent.clear(input)
    await userEvent.type(input, 'abc')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/valid number/i)).toBeInTheDocument()
    expect(mockedApi.put).not.toHaveBeenCalled()
  })

  it('requires at least one enabled criterion', async () => {
    mockLoadSuccess()
    renderDialog()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'PE' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'ROE' }))
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one/i)
    expect(mockedApi.put).not.toHaveBeenCalled()
  })

  it('surfaces a 422 detail and stays open', async () => {
    mockLoadSuccess()
    mockedApi.put.mockRejectedValue(new ApiError(422, 'unknown key: bogus'))
    const { onOpenChange } = renderDialog()
    await userEvent.click(await screen.findByRole('button', { name: /^save$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('unknown key: bogus')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('shows an inline error with Retry when loading fails, then recovers', async () => {
    mockedApi.get
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementation((path: string) =>
        Promise.resolve(path === '/screen/ratios' ? catalog : criteria),
      )
    renderDialog()
    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/)
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('checkbox', { name: 'PE' })).toBeInTheDocument()
  })

  it('disables Save and shows the inline spinner while the PUT is pending', async () => {
    mockLoadSuccess()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockedApi.put.mockReturnValue(gate.then(() => criteria))
    renderDialog()
    await userEvent.click(await screen.findByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled())
    expect(screen.getByTestId('inline-spinner')).toBeInTheDocument()
    release()
  })

  it('calls onSaved with the response and closes on success', async () => {
    mockLoadSuccess()
    mockedApi.put.mockResolvedValue(criteria)
    const { onOpenChange, onSaved } = renderDialog()
    await userEvent.click(await screen.findByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(criteria))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
