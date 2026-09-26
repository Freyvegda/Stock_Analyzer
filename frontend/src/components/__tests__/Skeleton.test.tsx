import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Skeleton } from '../ui/Skeleton'

describe('Skeleton', () => {
  it('renders an aria-hidden shimmer block', () => {
    render(<Skeleton />)
    const element = screen.getByTestId('skeleton')
    expect(element).toHaveAttribute('aria-hidden', 'true')
    expect(element.className).toContain('vault-skeleton')
  })

  it('keeps caller class names', () => {
    render(<Skeleton className="h-10 w-full" />)
    const element = screen.getByTestId('skeleton')
    expect(element.className).toContain('h-10')
    expect(element.className).toContain('w-full')
  })
})
