import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TOWER_TIERS } from '@/content/tower'

const env = vi.hoisted(() => ({
  user: null as { id: number; username: string } | null,
  desktop: true,
  reduced: false,
  webgl: true,
}))

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: env.user }) }))
vi.mock('@/lib/useIsDesktop', () => ({ useIsDesktop: () => env.desktop }))
vi.mock('@/lib/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => env.reduced }))
vi.mock('@/lib/webgl', () => ({ hasWebGL: () => env.webgl }))
// The scene is a separate chunk and a jsdom canvas is meaningless; the DOM
// story is what this suite is about.
vi.mock('@/components/three/Pagoda', () => ({ default: () => <div data-testid="pagoda-3d" /> }))

const { Landing } = await import('../Landing')

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  env.user = null
  env.desktop = true
  env.reduced = false
  env.webgl = true
})

describe('Landing content', () => {
  it('renders one section per tower storey', () => {
    renderLanding()
    for (const tier of TOWER_TIERS) {
      expect(screen.getByTestId(`tier-${tier.id}`)).toBeInTheDocument()
    }
  })

  it('names every storey and shows its one-liner and cards', () => {
    renderLanding()
    for (const tier of TOWER_TIERS) {
      expect(screen.getAllByText(tier.heading).length).toBeGreaterThan(0)
      expect(screen.getAllByText(tier.tagline).length).toBeGreaterThan(0)
      for (const card of tier.cards) {
        expect(screen.getByText(card.title)).toBeInTheDocument()
        expect(screen.getByText(card.body)).toBeInTheDocument()
      }
    }
  })

  it('marks the storeys that are not built yet', () => {
    renderLanding()
    expect(screen.getAllByText('In progress')).toHaveLength(2)
  })

  it('opens on the hero, with no storey yet expanded', () => {
    renderLanding()
    for (const tier of TOWER_TIERS) {
      expect(screen.getByTestId(`tier-${tier.id}`)).toHaveAttribute('data-open', 'false')
    }
  })
})

describe('Landing calls to action', () => {
  it('sends a signed-out visitor to /login', () => {
    env.user = null
    renderLanding()
    const signIn = screen.getAllByRole('link', { name: /sign in/i })
    expect(signIn.length).toBeGreaterThan(0)
    for (const link of signIn) {
      expect(link.getAttribute('href')).toBe('/login')
    }
  })

  it('sends a signed-in user to the tier route', () => {
    env.user = { id: 1, username: 'solo' }
    renderLanding()
    const [tier] = TOWER_TIERS
    const link = screen.getByRole('link', {
      name: new RegExp(`open ${tier.heading.toLowerCase()}`, 'i'),
    })
    expect(link.getAttribute('href')).toBe(tier.route)
  })

  it('offers the app directly to a signed-in user', () => {
    env.user = { id: 1, username: 'solo' }
    renderLanding()
    const open = screen.getAllByRole('link', { name: /open the analyzer/i })
    expect(open.length).toBeGreaterThan(0)
    expect(open[0].getAttribute('href')).toBe('/fundamentals/criteria')
  })

  it('always offers a way back to the landing page itself', () => {
    renderLanding()
    expect(screen.getByRole('link', { name: /home/i }).getAttribute('href')).toBe('/')
  })
})

describe('Landing 3D gating', () => {
  it('mounts the scene on desktop with WebGL and motion allowed', () => {
    renderLanding()
    expect(screen.getByTestId('pagoda-3d')).toBeInTheDocument()
  })

  it('renders the story without the scene below md', () => {
    // The house rule: no WebGL below md. The content must still be complete.
    env.desktop = false
    renderLanding()
    expect(screen.queryByTestId('pagoda-3d')).not.toBeInTheDocument()
    for (const tier of TOWER_TIERS) {
      expect(screen.getByTestId(`tier-${tier.id}`)).toBeInTheDocument()
    }
  })

  it('renders the story without the scene when WebGL is unavailable', () => {
    env.webgl = false
    renderLanding()
    expect(screen.queryByTestId('pagoda-3d')).not.toBeInTheDocument()
    expect(screen.getAllByText(TOWER_TIERS[0].heading).length).toBeGreaterThan(0)
  })

  it('drops the scene under reduced motion, keeping every word', () => {
    env.reduced = true
    renderLanding()
    expect(screen.queryByTestId('pagoda-3d')).not.toBeInTheDocument()
    for (const tier of TOWER_TIERS) {
      for (const card of tier.cards) {
        expect(screen.getByText(card.title)).toBeInTheDocument()
      }
    }
  })
})
