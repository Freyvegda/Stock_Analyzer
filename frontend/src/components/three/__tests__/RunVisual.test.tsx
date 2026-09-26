import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const webgl = vi.hoisted(() => ({ hasWebGL: false }))

vi.mock('@/lib/webgl', () => ({ hasWebGL: () => webgl.hasWebGL }))

import RunVisual from '../RunVisual'

function mockReducedMotion(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches, media: '', onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })
}

afterEach(() => vi.restoreAllMocks())

describe('RunVisual', () => {
  it('renders nothing without WebGL', () => {
    webgl.hasWebGL = false
    const { container } = render(<RunVisual />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing under reduced motion even with WebGL', () => {
    webgl.hasWebGL = true
    mockReducedMotion(true)
    const { container } = render(<RunVisual />)
    expect(container).toBeEmptyDOMElement()
  })
})
