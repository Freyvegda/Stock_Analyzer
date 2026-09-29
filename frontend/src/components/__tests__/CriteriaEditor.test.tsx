import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CriteriaEditor } from '../CriteriaEditor'
import { Provider } from '../ui/provider'
import type { RatioSpec, ScreeningSet } from '../../api/types'

const catalog: RatioSpec[] = [
  { key: 'pe', label: 'PE', unit: '×', category: 'Valuation', direction: 'max' },
  { key: 'pb', label: 'PB', unit: '×', category: 'Valuation', direction: 'max' },
  { key: 'roe', label: 'ROE', unit: '%', category: 'Profitability', direction: 'min' },
  { key: 'currentRatio', label: 'Current Ratio', unit: '×', category: 'Liquidity', direction: 'min' },
]

const savedSet: ScreeningSet = {
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

function renderEditor(overrides: {
  set?: ScreeningSet
  onSave?: (criteria: unknown, thesis: string | null) => Promise<void>
  onDirtyChange?: (dirty: boolean) => void
} = {}) {
  const onSave = overrides.onSave ?? vi.fn(() => Promise.resolve())
  const onDirtyChange = overrides.onDirtyChange ?? vi.fn()
  render(
    <Provider>
      <CriteriaEditor
        open
        onOpenChange={() => {}}
        set={overrides.set ?? savedSet}
        ratios={catalog}
        onSave={onSave}
        onDirtyChange={onDirtyChange}
      />
    </Provider>,
  )
  return { onSave, onDirtyChange }
}

beforeEach(() => vi.resetAllMocks())

describe('CriteriaEditor', () => {
  it('shows every category and the saved rows', async () => {
    renderEditor()
    expect(await screen.findByRole('button', { name: /valuation/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /profitability/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /liquidity/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'PE' })).toBeChecked()
    expect(screen.getByLabelText('PE value')).toHaveValue('25')
  })

  it('saves toggled and edited rows through onSave', async () => {
    const { onSave } = renderEditor()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'ROE' }))
    const peInput = screen.getByLabelText('PE value')
    await userEvent.clear(peInput)
    await userEvent.type(peInput, '18')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        [
          { key: 'pe', enabled: true, value: 18, bookmarked: false },
          { key: 'roe', enabled: false, value: 15, bookmarked: false },
        ],
        null,
      ),
    )
  })

  it('adds a criterion from its category and removes another', async () => {
    const { onSave } = renderEditor()
    await userEvent.click(await screen.findByRole('button', { name: 'Remove ROE' }))
    expect(screen.queryByRole('checkbox', { name: 'ROE' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Add Liquidity criterion'))
    await userEvent.type(screen.getByLabelText('Add Liquidity criterion'), 'Curr')
    const option = await screen.findByRole('option', { name: /current ratio/i })
    await userEvent.click(option)
    const valueInput = await screen.findByLabelText('Current Ratio value')
    await userEvent.type(valueInput, '1.2')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.arrayContaining([
          { key: 'pe', enabled: true, value: 25, bookmarked: false },
          { key: 'currentRatio', enabled: true, value: 1.2, bookmarked: false },
        ]),
        null,
      ),
    )
  })

  it('blocks save with an invalid threshold', async () => {
    const { onSave } = renderEditor()
    const input = await screen.findByLabelText('PE value')
    await userEvent.clear(input)
    await userEvent.type(input, 'abc')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/valid number/i)).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('requires at least one enabled criterion', async () => {
    const { onSave } = renderEditor()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'PE' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'ROE' }))
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one/i)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps unknown keys instead of crashing', async () => {
    const { onSave } = renderEditor({
      set: {
        ...savedSet,
        criteria: [{ key: 'mystery', enabled: true, value: 3 }],
      },
    })
    expect(await screen.findByRole('checkbox', { name: 'mystery' })).toBeChecked()
    const input = screen.getByLabelText('mystery value')
    await userEvent.clear(input)
    await userEvent.type(input, '4')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        [{ key: 'mystery', enabled: true, value: 4, bookmarked: false }],
        null,
      ),
    )
  })

  it('pins a bookmarked criterion to the top of its category', async () => {
    renderEditor({
      set: {
        ...savedSet,
        criteria: [
          { key: 'pe', enabled: true, value: 25 },
          { key: 'pb', enabled: true, value: 3 },
          { key: 'roe', enabled: true, value: 15 },
        ],
      },
    })
    await screen.findByRole('checkbox', { name: 'PB' })
    await userEvent.click(screen.getByRole('button', { name: 'Bookmark PB' }))
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes[0]).toHaveAccessibleName('PB')
  })

  it('saves the bookmarked flag in the payload', async () => {
    const { onSave } = renderEditor()
    await screen.findByRole('checkbox', { name: 'PE' })
    await userEvent.click(screen.getByRole('button', { name: 'Bookmark PE' }))
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        [
          { key: 'pe', enabled: true, value: 25, bookmarked: true },
          { key: 'roe', enabled: true, value: 15, bookmarked: false },
        ],
        null,
      ),
    )
  })

  it('filters to bookmarked criteria only', async () => {
    renderEditor({
      set: {
        ...savedSet,
        criteria: [
          { key: 'pe', enabled: true, value: 25 },
          { key: 'pb', enabled: true, value: 3 },
          { key: 'roe', enabled: true, value: 15 },
        ],
      },
    })
    await screen.findByRole('checkbox', { name: 'PB' })
    await userEvent.click(screen.getByRole('button', { name: 'Bookmark PB' }))
    await userEvent.click(screen.getByRole('button', { name: /bookmarked only/i }))
    expect(screen.getByRole('checkbox', { name: 'PB' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'PE' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /profitability/i })).not.toBeInTheDocument()
  })

  it('reports dirty state changes', async () => {
    const onDirtyChange = vi.fn()
    renderEditor({ onDirtyChange })
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    const input = await screen.findByLabelText('PE value')
    await userEvent.clear(input)
    await userEvent.type(input, '18')
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true))
  })
})
