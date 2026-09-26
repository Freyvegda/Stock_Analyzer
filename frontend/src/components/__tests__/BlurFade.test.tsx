import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlurFade } from '../ui/BlurFade'

afterEach(() => vi.restoreAllMocks())

describe('BlurFade', () => {
  it('renders children', () => {
    render(<BlurFade><span>content</span></BlurFade>)
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('renders children with reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true, media: '', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })
    render(<BlurFade><span>content</span></BlurFade>)
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
