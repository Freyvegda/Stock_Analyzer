import { beforeEach, describe, expect, it } from 'vitest'

import { clearStage, readStage, writeStage } from '../scrollMemory'

/**
 * Scroll memory for the landing page.
 *
 * `sessionStorage` on purpose: the auth token store already forbids persisting
 * anything in `localStorage`, and a scroll position that outlives the tab would
 * drop a returning visitor mid-story with no memory of how they got there.
 */
beforeEach(() => {
  window.sessionStorage.clear()
})

describe('scrollMemory', () => {
  it('returns nothing when the session has never been here', () => {
    expect(readStage()).toBeNull()
  })

  it('round-trips a stage', () => {
    writeStage(3)
    expect(readStage()).toBe(3)
  })

  it('round-trips the hero', () => {
    writeStage(0)
    expect(readStage()).toBe(0)
  })

  it('rejects a value that is not a stage', () => {
    // Storage is shared and hand-editable; a bad value must not put the page in
    // a state it cannot render.
    for (const junk of ['nonsense', '{}', 'NaN', 'Infinity', '-1']) {
      window.sessionStorage.setItem('landing.stage', junk)
      expect(readStage(), junk).toBeNull()
    }
  })

  it('forgets the stage on request', () => {
    writeStage(2)
    clearStage()
    expect(readStage()).toBeNull()
  })

  it('survives a storage that throws', () => {
    // Storage throws in real configurations: Safari in private mode on
    // `setItem`, some enterprise policies on `getItem`. A missing scroll memory
    // is a cosmetic loss; a thrown error here would take the landing page down.
    //
    // `sessionStorage` is replaced wholesale rather than spied on: jsdom backs it
    // with a proxy, so `vi.spyOn(window.sessionStorage, 'setItem')` does not
    // intercept anything and the test would pass without ever exercising the
    // guard.
    const real = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get: () => ({
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('quota')
        },
        removeItem: () => {
          throw new Error('blocked')
        },
      }),
    })

    try {
      expect(() => writeStage(1)).not.toThrow()
      expect(readStage()).toBeNull()
      expect(() => clearStage()).not.toThrow()
    } finally {
      if (real) Object.defineProperty(window, 'sessionStorage', real)
    }
  })
})
