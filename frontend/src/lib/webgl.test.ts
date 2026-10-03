import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasWebGL } from './webgl'

afterEach(() => vi.restoreAllMocks())

describe('hasWebGL', () => {
  it('returns false when a context cannot be created', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(hasWebGL()).toBe(false)
  })

  it('returns true when a webgl context exists', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never)
    expect(hasWebGL()).toBe(true)
  })

  it('releases the probe context it created', () => {
    // Browsers cap live contexts (Chromium ~16) and silently drop the oldest at
    // the cap. A probe that never releases its context eats that budget and the
    // symptom shows up much later as a black canvas on an unrelated page.
    const loseContext = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension: vi.fn().mockReturnValue({ loseContext }),
    } as never)

    expect(hasWebGL()).toBe(true)
    expect(loseContext).toHaveBeenCalled()
  })

  it('does not throw when the context cannot be released', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension: vi.fn().mockReturnValue(null),
    } as never)
    expect(() => hasWebGL()).not.toThrow()
    expect(hasWebGL()).toBe(true)
  })
})
