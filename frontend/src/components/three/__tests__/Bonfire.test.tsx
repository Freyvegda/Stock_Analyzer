import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ hasWebGL: false, mode: 'dark' }))

vi.mock('@/lib/webgl', () => ({ hasWebGL: () => env.hasWebGL }))

vi.mock('@/components/ui/color-mode', () => ({
  useColorMode: () => ({ colorMode: env.mode, setColorMode: vi.fn(), toggleColorMode: vi.fn() }),
}))

// The canvas mock drops its children: the scene tree only ever renders through
// react-three-fiber, which jsdom cannot host.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="bonfire-canvas" />,
  useFrame: () => {},
  useThree: () => ({ viewport: { width: 10, height: 5.6 }, size: { width: 1280, height: 720 } }),
}))

import { Bonfire } from '../Bonfire'

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

describe('Bonfire', () => {
  it('renders nothing without WebGL', () => {
    env.hasWebGL = false
    mockMedia()
    const { container } = render(<Bonfire />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing below md', () => {
    env.hasWebGL = true
    mockMedia({ desktop: false })
    const { container } = render(<Bonfire />)
    expect(container).toBeEmptyDOMElement()
  })

  it('paints a click-through fixed layer in the bottom-right corner zone', () => {
    env.hasWebGL = true
    mockMedia()
    render(<Bonfire />)
    const layer = screen.getByTestId('bonfire')
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(layer.className).toContain('fixed')
    expect(layer.className).toContain('inset-0')
    expect(layer.className).toContain('pointer-events-none')
    expect(layer.className).toContain('-z-10')
  })

  it('reports the fire it is burning for', () => {
    env.hasWebGL = true
    env.mode = 'dark'
    mockMedia()
    const { rerender } = render(<Bonfire />)
    expect(screen.getByTestId('bonfire')).toHaveAttribute('data-mode', 'dark')
    env.mode = 'light'
    rerender(<Bonfire />)
    expect(screen.getByTestId('bonfire')).toHaveAttribute('data-mode', 'light')
  })

  it('freezes to a still frame under reduced motion instead of disappearing', () => {
    env.hasWebGL = true
    mockMedia({ reduced: true })
    render(<Bonfire />)
    expect(screen.getByTestId('bonfire')).toHaveAttribute('data-reduced', 'true')
    expect(screen.getByTestId('bonfire-canvas')).toBeInTheDocument()
  })

  it('animates the canvas when motion is allowed', () => {
    env.hasWebGL = true
    mockMedia()
    render(<Bonfire />)
    expect(screen.getByTestId('bonfire')).not.toHaveAttribute('data-reduced')
    expect(screen.getByTestId('bonfire-canvas')).toBeInTheDocument()
  })
})
