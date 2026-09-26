import { render, screen } from '@testing-library/react'
import type { CSSProperties } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const webgl = vi.hoisted(() => ({ hasWebGL: true }))

vi.mock('@/lib/webgl', () => ({ hasWebGL: () => webgl.hasWebGL }))

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

function mockReducedMotion(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches,
    media: '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList)
}

afterEach(() => vi.restoreAllMocks())

describe('MarketRingLoader', () => {
  it('announces loading with an sr-only label', () => {
    webgl.hasWebGL = true
    mockReducedMotion(false)
    render(<MarketRingLoader label="Running screen…" />)
    expect(screen.getByRole('status')).toHaveTextContent('Running screen…')
  })

  it('renders a continuous 3D loop by default', () => {
    webgl.hasWebGL = true
    mockReducedMotion(false)
    render(<MarketRingLoader />)
    expect(screen.getByTestId('market-ring-canvas')).toHaveAttribute('data-frameloop', 'always')
  })

  it('freezes to a demand-rendered static frame under reduced motion', () => {
    webgl.hasWebGL = true
    mockReducedMotion(true)
    render(<MarketRingLoader />)
    expect(screen.getByTestId('market-ring-canvas')).toHaveAttribute('data-frameloop', 'demand')
    expect(screen.getByTestId('market-ring-loader')).toHaveAttribute('data-reduced', 'true')
  })

  it('falls back to the vault pulse ring without WebGL', () => {
    webgl.hasWebGL = false
    mockReducedMotion(false)
    render(<MarketRingLoader />)
    expect(screen.getByTestId('vault-pulse')).toBeInTheDocument()
    expect(screen.queryByTestId('market-ring-canvas')).not.toBeInTheDocument()
  })
})
