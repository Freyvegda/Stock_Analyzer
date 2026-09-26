import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ValueFlash } from '../ui/ValueFlash'

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

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('ValueFlash', () => {
  it('does not flash on first render', () => {
    render(
      <ValueFlash value={1}>
        <span>1</span>
      </ValueFlash>,
    )
    expect(screen.getByTestId('value-flash')).not.toHaveAttribute('data-flash')
  })

  it('flashes with the tone after the value changes', () => {
    const { rerender } = render(
      <ValueFlash value={1} tone="gain">
        <span>1</span>
      </ValueFlash>,
    )
    rerender(
      <ValueFlash value={2} tone="gain">
        <span>2</span>
      </ValueFlash>,
    )
    expect(screen.getByTestId('value-flash')).toHaveAttribute('data-flash', 'gain')
  })

  it('clears the flash after 300ms', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <ValueFlash value={1}>
        <span>1</span>
      </ValueFlash>,
    )
    rerender(
      <ValueFlash value={2}>
        <span>2</span>
      </ValueFlash>,
    )
    expect(screen.getByTestId('value-flash')).toHaveAttribute('data-flash', 'neutral')
    act(() => {
      vi.advanceTimersByTime(320)
    })
    expect(screen.getByTestId('value-flash')).not.toHaveAttribute('data-flash')
  })

  it('never flashes under reduced motion', () => {
    mockReducedMotion(true)
    const { rerender } = render(
      <ValueFlash value={1}>
        <span>1</span>
      </ValueFlash>,
    )
    rerender(
      <ValueFlash value={2}>
        <span>2</span>
      </ValueFlash>,
    )
    expect(screen.getByTestId('value-flash')).not.toHaveAttribute('data-flash')
  })
})
