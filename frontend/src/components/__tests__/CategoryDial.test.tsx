import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CategoryDial } from '../CategoryDial'
import { Provider } from '../ui/provider'
import { rotationFor } from '@/lib/dial'

const segments = [
  { category: 'Valuation', enabled: 1, total: 2 },
  { category: 'Profitability', enabled: 2, total: 2 },
  { category: 'Growth', enabled: 0, total: 1 },
  { category: 'Liquidity', enabled: 1, total: 1 },
]

function renderDial(overrides: { value?: string; reduced?: boolean } = {}) {
  const onValueChange = vi.fn()
  render(
    <Provider>
      <CategoryDial
        segments={segments}
        value={overrides.value ?? 'Valuation'}
        onValueChange={onValueChange}
        reduced={overrides.reduced ?? false}
      />
    </Provider>,
  )
  return { onValueChange }
}

describe('CategoryDial', () => {
  it('renders one radio per segment and marks the active one', () => {
    renderDial()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(segments.length)
    expect(screen.getByRole('radiogroup', { name: 'Ratio category' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Valuation' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Growth' })).toHaveAttribute('aria-checked', 'false')
  })

  it('keeps roving tabindex on the active wedge only', () => {
    renderDial()
    expect(screen.getByRole('radio', { name: 'Valuation' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'Growth' })).toHaveAttribute('tabindex', '-1')
  })

  it('turns the ring so the active wedge sits under the notch', () => {
    renderDial({ value: 'Growth' })
    const ring = screen.getByTestId('category-dial-ring')
    expect(ring).toHaveAttribute('data-rotation', String(rotationFor(2, segments.length)))
    expect(ring).toHaveAttribute('data-motion', 'animated')
  })

  it('turns the ring with a composited transform', () => {
    renderDial({ value: 'Growth' })
    const ring = screen.getByTestId('category-dial-ring')
    expect(ring).toHaveStyle({ transform: `rotate(${rotationFor(2, segments.length)}deg)` })
  })

  it('renders a finger hole per wedge inside the turning ring', () => {
    renderDial()
    const ring = screen.getByTestId('category-dial-ring')
    const holes = screen.getAllByTestId('dial-hole')
    expect(holes).toHaveLength(segments.length)
    expect(holes[0]).toHaveAttribute('data-category', 'Valuation')
    expect(holes[0]).toHaveAttribute('data-active', 'true')
    for (const hole of holes) expect(ring.contains(hole)).toBe(true)
  })

  it('tells the user the dial is clickable', () => {
    renderDial()
    expect(screen.getByTestId('dial-hint')).toHaveTextContent(/click a segment/i)
  })

  it('reports a pick from a wedge click', () => {
    const { onValueChange } = renderDial()
    fireEvent.click(screen.getByRole('radio', { name: 'Profitability' }))
    expect(onValueChange).toHaveBeenCalledWith('Profitability')
  })

  it('moves with the arrow keys, wraps, and jumps with home and end', () => {
    const { onValueChange } = renderDial()
    const active = screen.getByRole('radio', { name: 'Valuation' })

    fireEvent.keyDown(active, { key: 'ArrowRight' })
    expect(onValueChange).toHaveBeenLastCalledWith('Profitability')

    fireEvent.keyDown(active, { key: 'ArrowLeft' })
    expect(onValueChange).toHaveBeenLastCalledWith('Liquidity')

    fireEvent.keyDown(active, { key: 'End' })
    expect(onValueChange).toHaveBeenLastCalledWith('Liquidity')

    fireEvent.keyDown(active, { key: 'Home' })
    expect(onValueChange).toHaveBeenLastCalledWith('Valuation')
  })

  it('marks the enabled share on the wedges that hold enabled criteria', () => {
    renderDial()
    const marks = screen.getAllByTestId('dial-mark')
    expect(marks.map((mark) => mark.dataset.category)).toEqual([
      'Valuation',
      'Profitability',
      'Liquidity',
    ])
    expect(marks[0]).toHaveAttribute('data-share', '0.5')
    expect(marks[1]).toHaveAttribute('data-share', '1')
  })

  it('shows the active category and its tally in the hub, previewing a hover', () => {
    renderDial()
    const hub = screen.getByTestId('dial-hub')
    expect(hub).toHaveTextContent('Valuation')
    expect(hub).toHaveTextContent('1/2')

    fireEvent.mouseEnter(screen.getByRole('radio', { name: 'Growth' }))
    expect(hub).toHaveTextContent('Growth')
    expect(hub).toHaveTextContent('0/1')

    fireEvent.mouseLeave(screen.getByRole('radio', { name: 'Growth' }))
    expect(hub).toHaveTextContent('Valuation')
  })

  it('stays static under reduced motion while still pointing at the active wedge', () => {
    renderDial({ value: 'Profitability', reduced: true })
    const ring = screen.getByTestId('category-dial-ring')
    expect(ring).toHaveAttribute('data-motion', 'static')
    expect(ring).toHaveAttribute('data-rotation', String(rotationFor(1, segments.length)))
    expect(screen.getByRole('radio', { name: 'Profitability' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })
})
