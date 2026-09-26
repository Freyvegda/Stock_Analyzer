import { describe, expect, it } from 'vitest'
import { system } from './system'

describe('chakra theme system', () => {
  it('defines the sakura scale', () => {
    expect(system.token('colors.sakura.400')).toBeDefined()
    expect(system.token('colors.sakura.700')).toBeDefined()
  })

  it('registers sakura as a colorPalette with virtual tokens', () => {
    expect(system.token('colors.sakura.solid')).toBeDefined()
    expect(system.token('colors.sakura.contrast')).toBeDefined()
    expect(system.token('colors.sakura.subtle')).toBeDefined()
    expect(system.token('colors.sakura.focusRing')).toBeDefined()
  })

  it('renders the auth panel on its own sand-tinted surface', () => {
    expect(system.token('colors.bg.panel')).toBeDefined()
  })

  it('resolves brand, gain and loss semantic tokens', () => {
    expect(system.token('colors.brand')).toBeDefined()
    expect(system.token('colors.gain')).toBeDefined()
    expect(system.token('colors.loss')).toBeDefined()
  })
})
