import { render, screen } from '@testing-library/react'
import type { CSSProperties } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const webgl = vi.hoisted(() => ({ hasWebGL: false }))

vi.mock('@/lib/webgl', () => ({ hasWebGL: () => webgl.hasWebGL }))

vi.mock('@react-three/fiber', () => ({
  Canvas: (props: { style?: CSSProperties }) => (
    <div data-testid="ambient-canvas" style={props.style} />
  ),
  useFrame: () => {},
}))

import AmbientField from '../AmbientField'

function mockReducedMotion(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches, media: '', onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })
}

afterEach(() => vi.restoreAllMocks())

describe('AmbientField', () => {
  it('renders nothing without WebGL', () => {
    webgl.hasWebGL = false
    const { container } = render(<AmbientField />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing under reduced motion even with WebGL', () => {
    webgl.hasWebGL = true
    mockReducedMotion(true)
    const { container } = render(<AmbientField />)
    expect(container).toBeEmptyDOMElement()
  })

  it('paints a click-through fixed background layer', () => {
    webgl.hasWebGL = true
    mockReducedMotion(false)
    render(<AmbientField />)
    const canvas = screen.getByTestId('ambient-canvas')
    const wrapper = canvas.parentElement!
    expect(wrapper.className).toContain('fixed')
    expect(wrapper.className).toContain('inset-0')
    expect(wrapper.className).toContain('pointer-events-none')
    expect(wrapper.className).toContain('-z-10')
    expect(canvas.style.pointerEvents).toBe('none')
  })
})
