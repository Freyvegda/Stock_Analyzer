import { render, screen } from '@testing-library/react'
import type { CSSProperties } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const webgl = vi.hoisted(() => ({ hasWebGL: true, calls: 0 }))

vi.mock('@/lib/webgl', () => ({
  hasWebGL: () => {
    webgl.calls += 1
    return webgl.hasWebGL
  },
}))

vi.mock('@react-three/fiber', () => ({
  Canvas: (props: { frameloop?: string; className?: string; style?: CSSProperties }) => (
    <div
      data-testid="market-ring-canvas"
      data-frameloop={props.frameloop}
      className={props.className}
      style={props.style}
    />
  ),
  useFrame: () => {},
}))

import { MarketRingLoader } from '../MarketRingLoader'

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
})

afterEach(() => vi.restoreAllMocks())

describe('MarketRingLoader', () => {
  it('announces loading with an sr-only label', () => {
    webgl.hasWebGL = true
    mockMedia()
    render(<MarketRingLoader label="Running screen…" />)
    expect(screen.getByRole('status')).toHaveTextContent('Running screen…')
  })

  it('renders a continuous 3D loop by default', () => {
    webgl.hasWebGL = true
    mockMedia()
    render(<MarketRingLoader />)
    expect(screen.getByTestId('market-ring-canvas')).toHaveAttribute('data-frameloop', 'always')
  })

  it('freezes to a demand-rendered static frame under reduced motion', () => {
    webgl.hasWebGL = true
    mockMedia({ reduced: true })
    render(<MarketRingLoader />)
    expect(screen.getByTestId('market-ring-canvas')).toHaveAttribute('data-frameloop', 'demand')
    expect(screen.getByTestId('market-ring-loader')).toHaveAttribute('data-reduced', 'true')
  })

  it('renders only the vault pulse below md — no canvas mounted', () => {
    webgl.hasWebGL = true
    mockMedia({ desktop: false })
    render(<MarketRingLoader />)
    expect(screen.getByTestId('vault-pulse')).toBeInTheDocument()
    expect(screen.queryByTestId('market-ring-canvas')).not.toBeInTheDocument()
  })

  it('falls back to the vault pulse ring without WebGL', () => {
    webgl.hasWebGL = false
    mockMedia()
    render(<MarketRingLoader />)
    expect(screen.getByTestId('vault-pulse')).toBeInTheDocument()
    expect(screen.queryByTestId('market-ring-canvas')).not.toBeInTheDocument()
  })

  it('probes WebGL once, not on every render', () => {
    webgl.hasWebGL = true
    mockMedia()
    const { rerender } = render(<MarketRingLoader label="first" />)
    rerender(<MarketRingLoader label="second" />)
    rerender(<MarketRingLoader label="third" />)
    expect(webgl.calls).toBe(1)
  })
})
