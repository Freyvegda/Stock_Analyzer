import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StairTowerLoader } from '../ui/StairTowerLoader'

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
  })
}

afterEach(() => vi.restoreAllMocks())

describe('StairTowerLoader', () => {
  it('exposes a polite status with a label and 8 steps + 1 dot', () => {
    const { container } = render(<StairTowerLoader size={20} label="Signing in…" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('Signing in…')).toBeInTheDocument()
    expect(container.querySelectorAll('.stair-tower__step')).toHaveLength(8)
    expect(container.querySelectorAll('.stair-tower__dot')).toHaveLength(1)
  })

  it('flags the reduced-motion pose', () => {
    mockReducedMotion(true)
    render(<StairTowerLoader />)
    expect(screen.getByRole('status')).toHaveAttribute('data-reduced', 'true')
  })

  it('does not flag reduced motion by default', () => {
    mockReducedMotion(false)
    render(<StairTowerLoader />)
    expect(screen.getByRole('status')).not.toHaveAttribute('data-reduced')
  })

  it('scales via the tower-size custom property', () => {
    render(<StairTowerLoader size={140} />)
    expect(screen.getByRole('status')).toHaveStyle({ '--tower-size': '140px' })
  })
})
