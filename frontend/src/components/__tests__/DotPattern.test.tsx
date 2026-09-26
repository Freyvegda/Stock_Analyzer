import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DotPattern } from '../ui/DotPattern'

describe('DotPattern', () => {
  it('renders a decorative svg', () => {
    const { container } = render(<DotPattern />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
