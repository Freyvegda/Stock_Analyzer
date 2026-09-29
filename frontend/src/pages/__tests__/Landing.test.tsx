import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TOWER_TIERS } from '@/content/tower'

const env = vi.hoisted(() => ({
  user: null as { id: number; username: string } | null,
  desktop: true,
  reduced: false,
  webgl: true,
  fine: true,
}))

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: env.user }) }))
vi.mock('@/lib/useIsDesktop', () => ({ useIsDesktop: () => env.desktop }))
vi.mock('@/lib/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => env.reduced }))
vi.mock('@/lib/useFinePointer', () => ({ useFinePointer: () => env.fine }))
vi.mock('@/lib/webgl', () => ({ hasWebGL: () => env.webgl }))
// The theme selector is Chakra's, and it reads `next-themes`; the page only has
// to render it, so it is stubbed here and covered by its own suite.
vi.mock('@/components/ui/color-mode', () => ({
  useColorMode: () => ({ colorMode: 'dark', setColorMode: vi.fn(), toggleColorMode: vi.fn() }),
  ColorModeButton: () => <button type="button" aria-label="Toggle color mode" />,
}))
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
  env.fine = true
  window.sessionStorage.clear()
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
    const built = TOWER_TIERS.filter((t) => t.status === 'built')
    const links = screen.getAllByRole('link', { name: /^open it$/i })
    expect(links).toHaveLength(built.length)
    expect(links[0].getAttribute('href')).toBe(built[0].route)
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

describe('honest routes for unbuilt storeys', () => {
  it('never links an unbuilt storey at its own dead route', () => {
    // The rule the design turns on: a storey that does not exist yet must not
    // offer a link into the stub page and pretend it works.
    env.user = { id: 1, username: 'solo' }
    renderLanding()
    const unbuilt = TOWER_TIERS.filter((t) => t.status === 'in-progress')
    expect(unbuilt.length).toBeGreaterThan(0)
    for (const tier of unbuilt) {
      const links = screen.getAllByRole('link')
      const hrefs = links.map((l) => l.getAttribute('href'))
      expect(hrefs).not.toContain(tier.route)
    }
  })

  it('says so plainly, and still offers a way forward', () => {
    env.user = { id: 1, username: 'solo' }
    renderLanding()
    expect(screen.getAllByText('Not built yet')).toHaveLength(2)
    const fallbacks = screen.getAllByRole('link', { name: /see the screen that works/i })
    expect(fallbacks).toHaveLength(2)
    for (const link of fallbacks) {
      expect(link.getAttribute('href')).toBe('/fundamentals/criteria')
    }
  })
})

describe('the overview as a table of contents', () => {
  it('jumps to a storey from the overview list', () => {
    // The overview used to be a static list. It is real navigation now.
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    renderLanding()
    // Scoped to the overview: the storey rail carries the same storey names, and
    // both are legitimately buttons.
    const overview = screen.getByTestId('tier-' + TOWER_TIERS[0].id).closest('main')!
    const rows = within(overview).getAllByRole('button')
    fireEvent.click(rows[2])
    expect(scrollTo).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('the storey rail', () => {
  it('renders alongside the scene, and jumps on click', () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    renderLanding()
    const rail = screen.getByTestId('tower-rail')
    expect(rail).toBeInTheDocument()
    fireEvent.click(within(rail).getByRole('button', { name: TOWER_TIERS[1].heading }))
    expect(scrollTo).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('does not render when the scene does not', () => {
    // With no tower there is no storey to index, and the overview list already
    // does this job.
    env.webgl = false
    renderLanding()
    expect(screen.queryByTestId('tower-rail')).not.toBeInTheDocument()
  })
})

describe('the theme selector', () => {
  it('is offered on the landing page', () => {
    // Light and dark both have to be reachable from here, because the whole
    // scene changes with the theme.
    renderLanding()
    expect(screen.getByRole('button', { name: /toggle color mode/i })).toBeInTheDocument()
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
