import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const webgl = vi.hoisted(() => ({ hasWebGL: true, calls: 0 }))

vi.mock('@/lib/webgl', () => ({
  hasWebGL: () => {
    webgl.calls += 1
    return webgl.hasWebGL
  },
}))

vi.mock('@react-three/fiber', () => ({
  Canvas: (props: { frameloop?: string }) => (
    <div data-testid="ribbon-rail-canvas" data-frameloop={props.frameloop} />
  ),
  useFrame: () => {},
}))

import { RibbonRail } from '../RibbonRail'

const items = [
  { key: 'pe', label: 'PE' },
  { key: 'roe', label: 'ROE' },
]

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

beforeEach(() => {
  webgl.calls = 0
  webgl.hasWebGL = true
})

afterEach(() => vi.restoreAllMocks())

describe('RibbonRail', () => {
  it('renders nothing without WebGL support', () => {
    webgl.hasWebGL = false
    mockMedia()
    render(<RibbonRail items={items} />)
    expect(screen.queryByTestId('ribbon-rail')).not.toBeInTheDocument()
  })

  it('renders nothing below md', () => {
    mockMedia({ desktop: false })
    render(<RibbonRail items={items} />)
    expect(screen.queryByTestId('ribbon-rail')).not.toBeInTheDocument()
  })

  it('renders nothing when there are no bookmarks', () => {
    mockMedia()
    render(<RibbonRail items={[]} />)
    expect(screen.queryByTestId('ribbon-rail')).not.toBeInTheDocument()
  })

  it('renders one accessible ribbon per item', () => {
    mockMedia()
    render(<RibbonRail items={items} />)
    expect(screen.getByTestId('ribbon-rail')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'PE' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ROE' })).toBeInTheDocument()
  })

  it('is static under reduced motion', () => {
    mockMedia({ reduced: true })
    render(<RibbonRail items={items} />)
    expect(screen.getByTestId('ribbon-rail')).toHaveAttribute('data-motion', 'static')
    expect(screen.getByTestId('ribbon-rail-canvas')).toHaveAttribute('data-frameloop', 'demand')
  })

  it('calls onSelect when a ribbon is activated', async () => {
    mockMedia()
    const onSelect = vi.fn()
    render(<RibbonRail items={items} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: 'ROE' }))
    expect(onSelect).toHaveBeenCalledWith('roe')
  })

  it('probes WebGL once, not on every render', () => {
    mockMedia()
    const { rerender } = render(<RibbonRail items={items} />)
    rerender(<RibbonRail items={items.slice(0, 1)} />)
    rerender(<RibbonRail items={items} />)
    expect(webgl.calls).toBe(1)
  })
})
