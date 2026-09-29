import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScreenTabs } from '../ScreenTabs'
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

function renderTabs(overrides: Partial<Parameters<typeof ScreenTabs>[0]> = {}) {
  const props = {
    sets: [setA, setB],
    active: setA,
    dirty: false,
    onSelect: vi.fn(),
    onCreate: vi.fn(() => Promise.resolve()),
    onRename: vi.fn(() => Promise.resolve()),
    onDelete: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
  render(
    <Provider>
      <ScreenTabs {...props} />
    </Provider>,
  )
  return props
}

beforeEach(() => vi.resetAllMocks())

describe('ScreenTabs', () => {
  it('renders one tab per screen with the active one selected', () => {
    renderTabs()
    expect(screen.getByRole('tablist', { name: /screening screens/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Default' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Quality' })).toHaveAttribute('aria-selected', 'false')
  })

  it('activates a screen when its tab is clicked', async () => {
    const { onSelect } = renderTabs()
    await userEvent.click(screen.getByRole('tab', { name: 'Quality' }))
    expect(onSelect).toHaveBeenCalledWith(setB)
  })

  it('marks the active tab when the draft is dirty', () => {
    renderTabs({ dirty: true })
    expect(screen.getByRole('tab', { name: 'Default' })).toHaveAttribute('data-dirty', 'true')
    expect(screen.getByRole('tab', { name: 'Quality' })).not.toHaveAttribute('data-dirty')
  })

  it('creates a screen from the inline new-tab field', async () => {
    const { onCreate } = renderTabs()
    await userEvent.click(screen.getByRole('button', { name: /new screen/i }))
    await userEvent.type(screen.getByLabelText(/screen name/i), 'Momentum')
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Momentum'))
  })

  it('renames a screen inline', async () => {
    const { onRename } = renderTabs()
    await userEvent.click(screen.getByRole('button', { name: 'Rename Default' }))
    const input = screen.getByRole('textbox', { name: 'Rename Default' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Momentum')
    await userEvent.click(screen.getByRole('button', { name: /save name/i }))
    await waitFor(() => expect(onRename).toHaveBeenCalledWith(setA, 'Momentum'))
  })

  it('deletes with a two-step confirm under the strip', async () => {
    const { onDelete } = renderTabs()
    await userEvent.click(screen.getByRole('button', { name: 'Close Quality' }))
    const confirm = screen.getByText(/delete screen "quality"/i).closest('div')
    expect(confirm).not.toBeNull()
    expect(onDelete).not.toHaveBeenCalled()
    await userEvent.click(within(confirm as HTMLElement).getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(setB))
  })

  it('moves focus between tabs with arrow keys', async () => {
    renderTabs()
    const active = screen.getByRole('tab', { name: 'Default' })
    active.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Quality' })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Default' })).toHaveFocus()
  })

  it('shows an inline error when an action fails', async () => {
    renderTabs({ onCreate: vi.fn(() => Promise.reject(new Error('name taken'))) })
    await userEvent.click(screen.getByRole('button', { name: /new screen/i }))
    await userEvent.type(screen.getByLabelText(/screen name/i), 'Dup')
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('name taken')
  })
})
