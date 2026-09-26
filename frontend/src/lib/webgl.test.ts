import { describe, expect, it, vi } from 'vitest'
import { hasWebGL } from './webgl'

describe('hasWebGL', () => {
  it('returns false when a context cannot be created', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(hasWebGL()).toBe(false)
  })

  it('returns true when a webgl context exists', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never)
    expect(hasWebGL()).toBe(true)
  })
})
