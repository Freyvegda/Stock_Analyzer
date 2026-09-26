import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/webgl', () => ({ hasWebGL: () => false }))

import RunVisual from '../RunVisual'

describe('RunVisual', () => {
  it('renders nothing without WebGL', () => {
    const { container } = render(<RunVisual />)
    expect(container).toBeEmptyDOMElement()
  })
})
