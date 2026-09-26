import { describe, expect, it } from 'vitest'
import { system } from './system'

describe('chakra theme system', () => {
  it('defines the amber scale', () => {
    expect(system.token('colors.amber.400')).toBeDefined()
    expect(system.token('colors.amber.700')).toBeDefined()
  })

  it('registers amber as a colorPalette with virtual tokens', () => {
    expect(system.token('colors.amber.solid')).toBeDefined()
    expect(system.token('colors.amber.contrast')).toBeDefined()
    expect(system.token('colors.amber.subtle')).toBeDefined()
    expect(system.token('colors.amber.focusRing')).toBeDefined()
  })

  it('resolves brand, gain and loss semantic tokens', () => {
    expect(system.token('colors.brand')).toBeDefined()
    expect(system.token('colors.gain')).toBeDefined()
    expect(system.token('colors.loss')).toBeDefined()
  })
})
