import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// vitest.config.ts raises the test timeout, but Testing Library's own
// findBy/waitFor budget is separate and defaults to 1000 ms — too tight once
// jsdom, motion and the lazy three chunks share a loaded machine.
configure({ asyncUtilTimeout: 3000 })

afterEach(() => cleanup())

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
