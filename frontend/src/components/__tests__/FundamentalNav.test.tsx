import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FundamentalNav } from '../FundamentalNav'
import { Provider } from '../ui/provider'

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

afterEach(() => vi.restoreAllMocks())

function renderNav(path = '/fundamentals/top10') {
  return render(
    <Provider>
      <MemoryRouter initialEntries={[path]}>
        <FundamentalNav />
      </MemoryRouter>
    </Provider>,
  )
}

describe('FundamentalNav', () => {
  it('renders the three fundamentals routes', () => {
    renderNav()
    expect(screen.getByRole('navigation', { name: 'Fundamental analysis' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Screen Criteria' })).toHaveAttribute(
      'href',
      '/fundamentals/criteria',
    )
    expect(screen.getByRole('link', { name: 'Top 10 Results' })).toHaveAttribute(
      'href',
      '/fundamentals/top10',
    )
    expect(screen.getByRole('link', { name: 'Stocks' })).toHaveAttribute(
      'href',
      '/fundamentals/stocks',
    )
  })

  it('marks the active route with exactly one pill', () => {
    renderNav('/fundamentals/top10')
    const active = screen.getByRole('link', { name: 'Top 10 Results' })
    expect(active).toHaveAttribute('aria-current', 'page')
    const pills = screen.getAllByTestId('fundamental-nav-pill')
    expect(pills).toHaveLength(1)
    expect(active).toContainElement(pills[0])
  })

  it('animates the glass rail entrance by default', () => {
    renderNav()
    expect(screen.getByTestId('fundamental-nav-rail')).toHaveAttribute('data-motion', 'animated')
  })

  it('renders the rail static under reduced motion', () => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': true })
    renderNav()
    expect(screen.getByTestId('fundamental-nav-rail')).toHaveAttribute('data-motion', 'static')
  })
})
