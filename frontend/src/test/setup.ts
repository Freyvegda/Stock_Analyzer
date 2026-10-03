import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// vitest.config.ts raises the test timeout, but Testing Library's own
// findBy/waitFor budget is separate and defaults to 1000 ms — too tight once
// jsdom, motion and the lazy three chunks share a loaded machine.
configure({ asyncUtilTimeout: 3000 })

afterEach(() => cleanup())

// AuthContext boots by exchanging the refresh cookie for an access token
// (the access token itself is memory-only, so a test "page load" always starts
// without one). jsdom has no server, so without this every suite that mounts
// AuthProvider would make a real network call and hang.
//
// The default answer is a successful refresh: a signed-in user is the case most
// component tests want. A suite testing the anonymous path stubs `fetch` itself.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ user: { id: 1, username: 'solo' }, access_token: 'test-token' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`))
    }),
  )
})

// jsdom has no matchMedia; next-themes, Chakra, and usePrefersReducedMotion read it.
// Deliberately a plain function (not vi.fn) so vi.resetAllMocks() cannot strip its
// implementation mid-suite.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// Chakra popper (floating-ui) observes element size; jsdom has no ResizeObserver.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
