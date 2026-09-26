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

function mockMedia({ reduced = false, desktop = true }: { reduced?: boolean; desktop?: boolean } = {}) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('min-width') ? desktop : reduced,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('AmbientField', () => {
  it('renders nothing without WebGL', () => {
    webgl.hasWebGL = false
    mockMedia()
    const { container } = render(<AmbientField />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing under reduced motion even with WebGL', () => {
    webgl.hasWebGL = true
    mockMedia({ reduced: true })
    const { container } = render(<AmbientField />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing below md', () => {
    webgl.hasWebGL = true
    mockMedia({ desktop: false })
    const { container } = render(<AmbientField />)
    expect(container).toBeEmptyDOMElement()
  })

  it('paints a click-through fixed background layer', () => {
    webgl.hasWebGL = true
    mockMedia()
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
