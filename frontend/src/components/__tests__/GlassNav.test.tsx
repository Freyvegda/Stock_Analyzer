import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GlassNav } from '../GlassNav'
import { Provider } from '../ui/provider'

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, username: 'solo' }, logout: vi.fn() }),
}))

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

function renderNav(path = '/') {
  return render(
    <Provider>
      <MemoryRouter initialEntries={[path]}>
        <GlassNav />
      </MemoryRouter>
    </Provider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('GlassNav', () => {
  it('marks the active route and renders exactly one pill inside it', () => {
    renderNav('/documents')
    const active = screen.getByRole('link', { name: 'Documents' })
    expect(active).toHaveAttribute('aria-current', 'page')
    const pills = screen.getAllByTestId('glass-nav-pill')
    expect(pills).toHaveLength(1)
    expect(active).toContainElement(pills[0])
  })

  it('renders the nav landmark, logout and theme toggle', () => {
    renderNav()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /color mode/i })).toBeInTheDocument()
  })

  it('keeps sheen off without a fine pointer (jsdom default)', () => {
    renderNav()
    expect(screen.getByTestId('glass-nav')).toHaveAttribute('data-sheen', 'off')
  })

  it('keeps sheen off under reduced motion even on a fine pointer', () => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': true, '(pointer: fine)': true })
    renderNav()
    expect(screen.getByTestId('glass-nav')).toHaveAttribute('data-sheen', 'off')
  })

  it('enables sheen on a fine pointer without reduced motion', () => {
    mockMatchMedia({ '(pointer: fine)': true })
    renderNav()
    expect(screen.getByTestId('glass-nav')).toHaveAttribute('data-sheen', 'on')
  })
})
