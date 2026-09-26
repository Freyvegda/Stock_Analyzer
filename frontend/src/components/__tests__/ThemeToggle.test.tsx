import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeToggle } from '../ThemeToggle'
import { Provider } from '../ui/provider'

function renderToggle() {
  return render(
    <Provider>
      <ThemeToggle />
    </Provider>,
  )
}

function mockReducedMotion(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches,
    media: '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList)
}

function mockViewTransition() {
  const start = vi.fn((callback: () => void) => {
    callback()
    return { finished: Promise.resolve() }
  })
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start })
  return start
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(document, 'startViewTransition')
  })

  it('renders an accessible trigger', () => {
    renderToggle()
    expect(screen.getByRole('button', { name: /color mode/i })).toBeInTheDocument()
  })

  it('switches to dark mode via the menu', async () => {
    const user = userEvent.setup()
    renderToggle()
    await user.click(screen.getByRole('button', { name: /color mode/i }))
    await user.click(await screen.findByText('Dark'))
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
  })

  it('persists the choice under the stock-analyzer-theme key', async () => {
    const user = userEvent.setup()
    renderToggle()
    await user.click(screen.getByRole('button', { name: /color mode/i }))
    await user.click(await screen.findByText('Light'))
    await waitFor(() => expect(localStorage.getItem('stock-analyzer-theme')).toBe('light'))
  })

  it('renders with corrupt persisted theme', () => {
    localStorage.setItem('stock-analyzer-theme', '{not json')
    renderToggle()
    expect(screen.getByRole('button', { name: /color mode/i })).toBeInTheDocument()
  })

  it('uses a view transition when the browser supports one', async () => {
    const startViewTransition = mockViewTransition()
    const user = userEvent.setup()
    renderToggle()
    await user.click(screen.getByRole('button', { name: /color mode/i }))
    await user.click(await screen.findByText('Dark'))
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
    expect(startViewTransition).toHaveBeenCalledTimes(1)
  })

  it('skips the view transition under reduced motion', async () => {
    const startViewTransition = mockViewTransition()
    mockReducedMotion(true)
    const user = userEvent.setup()
    renderToggle()
    await user.click(screen.getByRole('button', { name: /color mode/i }))
    await user.click(await screen.findByText('Dark'))
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
    expect(startViewTransition).not.toHaveBeenCalled()
  })
})
