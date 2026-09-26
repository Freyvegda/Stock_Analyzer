import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BorderBeam } from '../ui/BorderBeam'

afterEach(() => vi.restoreAllMocks())

describe('BorderBeam', () => {
  it('renders nothing when inactive', () => {
    render(<BorderBeam active={false} />)
    expect(screen.queryByTestId('border-beam')).not.toBeInTheDocument()
    expect(screen.queryByTestId('border-beam-static')).not.toBeInTheDocument()
  })

  it('renders an animated beam by default', () => {
    render(<BorderBeam />)
    expect(screen.getByTestId('border-beam')).toBeInTheDocument()
  })

  it('renders a static ring under reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true, media: '', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })
    render(<BorderBeam />)
    expect(screen.getByTestId('border-beam-static')).toBeInTheDocument()
    expect(screen.queryByTestId('border-beam')).not.toBeInTheDocument()
  })
})
