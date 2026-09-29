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
    expect(screen.getByRole('tab', { name: 'Default' })).toHaveAttribute(
      'aria-controls',
      'screen-tabpanel',
    )
  })

  it('activates a screen when its tab is clicked', async () => {
    const { onSelect } = renderTabs()
    await userEvent.click(screen.getByRole('tab', { name: 'Quality' }))
    expect(onSelect).toHaveBeenCalledWith(setB)
  })

  it('activates a screen from the keyboard with enter and space', async () => {
    const { onSelect } = renderTabs()
    const quality = screen.getByRole('tab', { name: 'Quality' })
    quality.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(setB)
    onSelect.mockClear()
    await userEvent.keyboard(' ')
    expect(onSelect).toHaveBeenCalledWith(setB)
  })

  it('marks the active tab when the draft is dirty, described for screen readers', () => {
    renderTabs({ dirty: true })
    const active = screen.getByRole('tab', { name: 'Default' })
    expect(active).toHaveAttribute('data-dirty', 'true')
    expect(active).toHaveAttribute('aria-describedby', 'screen-dirty-1')
    expect(screen.getByText('unsaved changes')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Quality' })).not.toHaveAttribute('data-dirty')
  })

  it('creates a screen by typing in a new draft tab', async () => {
    const { onCreate } = renderTabs()
    await userEvent.click(screen.getByRole('button', { name: /new screen/i }))
    const strip = screen.getByRole('tablist', { name: /screening screens/i })
    const input = within(strip).getByRole('textbox', { name: 'New screen name' })
    await userEvent.type(input, 'Momentum{Enter}')
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Momentum'))
  })

  it('cancels the draft tab with escape and refocuses the plus button', async () => {
    const { onCreate } = renderTabs()
    await userEvent.click(screen.getByRole('button', { name: /new screen/i }))
    await userEvent.type(screen.getByRole('textbox', { name: 'New screen name' }), 'Momentum')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'New screen name' })).not.toBeInTheDocument()
    expect(onCreate).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: /new screen/i })).toHaveFocus())
  })

  it('renames the active screen in place', async () => {
    const { onRename } = renderTabs()
    await userEvent.click(screen.getByRole('button', { name: 'Rename Default' }))
    const strip = screen.getByRole('tablist', { name: /screening screens/i })
    const input = within(strip).getByRole('textbox', { name: 'Rename Default' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Momentum{Enter}')
    await waitFor(() => expect(onRename).toHaveBeenCalledWith(setA, 'Momentum'))
  })

  it('reverts an in-place rename with escape', async () => {
    const { onRename } = renderTabs()
    await userEvent.click(screen.getByRole('button', { name: 'Rename Default' }))
    const input = screen.getByRole('textbox', { name: 'Rename Default' })
    await userEvent.type(input, 'X')
    await userEvent.keyboard('{Escape}')
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'Default' })).toBeInTheDocument()
  })

  it('deletes with a two-step confirm and does not activate on close', async () => {
    const { onDelete, onSelect } = renderTabs()
    await userEvent.click(screen.getByRole('button', { name: 'Close Quality' }))
    expect(onSelect).not.toHaveBeenCalled()
    const group = screen.getByRole('group', { name: 'Confirm delete Quality' })
    expect(onDelete).not.toHaveBeenCalled()
    await userEvent.click(within(group).getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(setB))
  })

  it('returns focus to the active tab after a delete', async () => {
    renderTabs()
    await userEvent.click(screen.getByRole('button', { name: 'Close Quality' }))
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Default' })).toHaveFocus())
  })

  it('moves focus between tabs with arrow, home and end keys', async () => {
    renderTabs()
    screen.getByRole('tab', { name: 'Default' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Quality' })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Default' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Quality' })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Default' })).toHaveFocus()
  })

  it('makes the first tab reachable when no screen is active', async () => {
    renderTabs({ active: null })
    const first = screen.getByRole('tab', { name: 'Default' })
    expect(first).toHaveAttribute('tabindex', '0')
    first.focus()
    await userEvent.keyboard('{Enter}')
  })

  it('shows an inline error when creating fails and keeps the draft tab', async () => {
    renderTabs({ onCreate: vi.fn(() => Promise.reject(new Error('name taken'))) })
    await userEvent.click(screen.getByRole('button', { name: /new screen/i }))
    await userEvent.type(screen.getByRole('textbox', { name: 'New screen name' }), 'Dup{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('name taken')
    expect(screen.getByRole('textbox', { name: 'New screen name' })).toBeInTheDocument()
  })
})
