import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScreenPicker } from '../ScreenPicker'
import { Provider } from '../ui/provider'
import type { ScreenOption } from '../ScreenPicker'

vi.mock('../three/RibbonRail', () => ({ default: () => null }))

const OPTIONS: ScreenOption[] = [
  { id: 1, name: 'Default', isActive: true, verdict: 'pass', score: 12.3, passed: 2, enabled: 2 },
  { id: 2, name: 'Quality', isActive: false, verdict: 'fail', score: 8.1, passed: 1, enabled: 2 },
  { id: 3, name: 'Value', isActive: false, verdict: null },
]

function renderPicker(props: Partial<Parameters<typeof ScreenPicker>[0]> = {}) {
  return render(
    <Provider>
      <ScreenPicker options={OPTIONS} selectedId={1} onSelect={() => {}} {...props} />
    </Provider>,
  )
}

function mockMatchMedia(map: Record<string, boolean>) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: map[query] ?? false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('ScreenPicker', () => {
  it('shows the selected screen on the button', () => {
    renderPicker()

    expect(screen.getByRole('combobox')).toHaveTextContent('Default')
    expect(screen.getByRole('combobox')).toHaveTextContent('Passes your screen')
  })

  it('lists every screen with verdict chips when opened', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole('combobox'))

    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /quality/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /value/i })).toBeInTheDocument()
    expect(screen.getByText('Not checked yet')).toBeInTheDocument()
  })

  it('selects a screen and closes the panel', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderPicker({ onSelect })

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /quality/i }))

    expect(onSelect).toHaveBeenCalledWith(2)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('supports arrow keys, Enter and Escape', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderPicker({ onSelect })
    const box = screen.getByRole('combobox')

    await user.click(box)
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onSelect).toHaveBeenCalledWith(1)

    await user.click(box)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('renders a static panel under reduced motion', async () => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': true })
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole('combobox'))

    expect(screen.getByTestId('screen-picker-panel')).toHaveAttribute('data-motion', 'static')
    vi.restoreAllMocks()
  })

  it('shows a checking chip for pending screens', async () => {
    const user = userEvent.setup()
    renderPicker({
      options: OPTIONS.map((option) => (option.id === 3 ? { ...option, pending: true } : option)),
    })

    await user.click(screen.getByRole('combobox'))

    expect(screen.getByRole('option', { name: /value/i })).toHaveTextContent('Checking…')
  })
})
