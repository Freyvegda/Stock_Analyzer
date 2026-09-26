import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '../ThemeToggle'
import { Provider } from '../ui/provider'

function renderToggle() {
  return render(
    <Provider>
      <ThemeToggle />
    </Provider>,
  )
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
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
})
