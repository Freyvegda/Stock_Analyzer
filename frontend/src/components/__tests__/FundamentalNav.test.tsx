import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { FundamentalNav } from '../FundamentalNav'
import { Provider } from '../ui/provider'

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
})
