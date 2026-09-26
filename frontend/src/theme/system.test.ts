import { describe, expect, it } from 'vitest'
import { system } from './system'

describe('chakra theme system', () => {
  it('defines the emerald scale', () => {
    expect(system.token('colors.emerald.500')).toBeDefined()
    expect(system.token('colors.emerald.600')).toBeDefined()
  })

  it('registers emerald as a colorPalette with semantic tokens', () => {
    expect(system.token('colors.emerald.solid')).toBeDefined()
    expect(system.token('colors.emerald.contrast')).toBeDefined()
    expect(system.token('colors.emerald.subtle')).toBeDefined()
  })

  it('resolves the brand semantic token', () => {
    expect(system.token('colors.brand')).toBeDefined()
  })
})
