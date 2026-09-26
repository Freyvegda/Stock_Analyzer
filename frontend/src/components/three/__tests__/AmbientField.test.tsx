import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/webgl', () => ({ hasWebGL: () => false }))

import AmbientField from '../AmbientField'

describe('AmbientField', () => {
  it('renders nothing without WebGL', () => {
    const { container } = render(<AmbientField />)
    expect(container).toBeEmptyDOMElement()
  })
})
