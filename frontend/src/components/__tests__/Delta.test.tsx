import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Delta } from '../ui/Delta'

describe('Delta', () => {
  it('renders gains with an up arrow and explicit plus sign', () => {
    const { container } = render(<Delta value={2.5} />)
    const element = screen.getByTestId('delta')
    expect(element).toHaveAttribute('data-tone', 'gain')
    expect(element).toHaveTextContent('+2.5')
    expect(container.querySelector('.lucide-arrow-up')).not.toBeNull()
  })

  it('renders losses with a down arrow and explicit minus sign', () => {
    const { container } = render(<Delta value={-3.25} />)
    const element = screen.getByTestId('delta')
    expect(element).toHaveAttribute('data-tone', 'loss')
    expect(element).toHaveTextContent('-3.3')
    expect(container.querySelector('.lucide-arrow-down')).not.toBeNull()
  })

  it('renders zero as neutral with no sign', () => {
    const { container } = render(<Delta value={0} />)
    const element = screen.getByTestId('delta')
    expect(element).toHaveAttribute('data-tone', 'neutral')
    expect(element).toHaveTextContent('0.0')
    expect(element.textContent).not.toMatch(/[+-]/)
    expect(container.querySelector('.lucide-minus')).not.toBeNull()
  })

  it('appends a suffix after the number', () => {
    render(<Delta value={1.2} suffix="%" />)
    expect(screen.getByTestId('delta')).toHaveTextContent('+1.2%')
  })
})
