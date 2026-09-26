import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Backdrop } from '../Backdrop'

describe('Backdrop', () => {
  it('renders a fixed, click-through, hidden texture layer', () => {
    render(<Backdrop />)
    const layer = screen.getByTestId('vault-backdrop')
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(layer.className).toContain('fixed')
    expect(layer.className).toContain('inset-0')
    expect(layer.className).toContain('pointer-events-none')
    expect(layer.className).toContain('-z-10')
    expect(layer.className).toContain('vault-backdrop')
  })
})
