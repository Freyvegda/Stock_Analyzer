import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScreenSetPicker } from '../ScreenSetPicker'
import { Provider } from '../ui/provider'
import type { ScreeningSet } from '../../api/types'

const setA: ScreeningSet = {
  id: 1,
  name: 'Default',
  criteria: [{ key: 'pe', enabled: true, value: 25 }],
  thesis: null,
  shortlist_size: 10,
  is_active: true,
  updated_at: 'now',
}

const setB: ScreeningSet = { ...setA, id: 2, name: 'Quality', is_active: false }

function renderPicker(overrides: Partial<Parameters<typeof ScreenSetPicker>[0]> = {}) {
  const props = {
    sets: [setA, setB],
    active: setA,
    onSelect: vi.fn(),
    onCreate: vi.fn(() => Promise.resolve()),
    onRename: vi.fn(() => Promise.resolve()),
    onDelete: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
  render(
    <Provider>
      <ScreenSetPicker {...props} />
    </Provider>,
  )
  return props
}

beforeEach(() => vi.resetAllMocks())

describe('ScreenSetPicker', () => {
  it('lists screens and marks the active one', () => {
    renderPicker()
    expect(screen.getByRole('button', { name: 'Default' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quality' })).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('selects a screen when clicked', async () => {
    const { onSelect } = renderPicker()
    await userEvent.click(screen.getByRole('button', { name: 'Quality' }))
    expect(onSelect).toHaveBeenCalledWith(setB)
  })

  it('creates a screen from the inline input', async () => {
    const { onCreate } = renderPicker()
    await userEvent.click(screen.getByRole('button', { name: /new screen/i }))
    await userEvent.type(screen.getByLabelText(/screen name/i), 'Momentum')
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Momentum'))
  })

  it('renames a screen inline', async () => {
    const { onRename } = renderPicker()
    await userEvent.click(screen.getByRole('button', { name: 'Rename Quality' }))
    const input = screen.getByLabelText('Rename Quality')
    await userEvent.clear(input)
    await userEvent.type(input, 'Momentum')
    await userEvent.click(screen.getByRole('button', { name: /^save name$/i }))
    await waitFor(() => expect(onRename).toHaveBeenCalledWith(setB, 'Momentum'))
  })

  it('deletes with a two-step confirm', async () => {
    const { onDelete } = renderPicker()
    await userEvent.click(screen.getByRole('button', { name: 'Delete Quality' }))
    expect(onDelete).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /^confirm$/i }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(setB))
  })

  it('shows an inline error when an action fails', async () => {
    renderPicker({ onCreate: vi.fn(() => Promise.reject(new Error('name taken'))) })
    await userEvent.click(screen.getByRole('button', { name: /new screen/i }))
    await userEvent.type(screen.getByLabelText(/screen name/i), 'Dup')
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('name taken')
  })
})
