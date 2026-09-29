import { act, render, screen } from '@testing-library/react'
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

  it('links the three top-level sections and drops the old Stocks item', () => {
    renderNav()
    expect(screen.getByRole('link', { name: 'Fundamental Analysis' })).toHaveAttribute(
      'href',
      '/fundamentals',
    )
    expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute('href', '/documents')
    expect(screen.getByRole('link', { name: 'Model & Backtest' })).toHaveAttribute(
      'href',
      '/backtest',
    )
    expect(screen.queryByRole('link', { name: 'Stocks' })).not.toBeInTheDocument()
  })

  it('renders the stock search in the nav capsule', () => {
    renderNav()
    expect(screen.getByRole('combobox', { name: 'Search stocks' })).toBeInTheDocument()
  })

  it('keeps the links, the search and the account cluster on one row', () => {
    renderNav()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(nav).toHaveClass('lg:flex-nowrap')
    expect(nav).not.toHaveClass('md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]')

    const [links, account] = Array.from(nav.children)
    expect(links).toContainElement(screen.getByRole('link', { name: 'Documents' }))
    expect(links).toContainElement(screen.getByText('STOCK ANALYZER'))
    expect(account).toContainElement(screen.getByTestId('nav-search'))
    expect(account).toContainElement(screen.getByText('solo'))
    expect(account).toContainElement(screen.getByRole('button', { name: 'Log out' }))

    // The search takes the row's spare width (capped) and keeps breathing room
    // from the username; it stops being the widest thing before the row wraps.
    const search = screen.getByTestId('nav-search').parentElement
    expect(search).toHaveClass('flex-1', 'min-w-[12rem]', 'lg:max-w-[24rem]')
  })

  it('keeps sheen off without a fine pointer (jsdom default)', () => {
    renderNav()
    expect(screen.getByTestId('glass-nav')).toHaveAttribute('data-sheen', 'off')
  })

  it('keeps sheen off under reduced motion even on a fine pointer and pins the pill static', () => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': true, '(pointer: fine)': true })
    renderNav('/documents')
    expect(screen.getByTestId('glass-nav')).toHaveAttribute('data-sheen', 'off')
    expect(screen.getByTestId('glass-nav-pill')).toHaveAttribute('data-motion', 'static')
  })

  it('enables sheen on a fine pointer without reduced motion and animates the pill', () => {
    mockMatchMedia({ '(pointer: fine)': true })
    renderNav('/documents')
    expect(screen.getByTestId('glass-nav')).toHaveAttribute('data-sheen', 'on')
    expect(screen.getByTestId('glass-nav-pill')).toHaveAttribute('data-motion', 'animated')
  })

  it('tracks pointer capability changes after mount', () => {
    const listeners: Array<() => void> = []
    let fine = false
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          get matches() {
            return query === '(pointer: fine)' ? fine : false
          },
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: (_type: string, callback: () => void) => {
            if (query === '(pointer: fine)') listeners.push(callback)
          },
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    )
    renderNav()
    expect(screen.getByTestId('glass-nav')).toHaveAttribute('data-sheen', 'off')
    fine = true
    act(() => {
      for (const listener of listeners) listener()
    })
    expect(screen.getByTestId('glass-nav')).toHaveAttribute('data-sheen', 'on')
  })
})
