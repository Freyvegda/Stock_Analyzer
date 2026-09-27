import { describe, expect, it } from 'vitest'
import { bonfirePalette, bonfirePaletteFor, dark, light } from '../tokens'

function channels(hex: string): number[] {
  const value = hex.replace('#', '')
  return [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)].map((part) => parseInt(part, 16))
}

function relativeLuminance(hex: string): number {
  const linear = channels(hex).map((channel) => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

/** WCAG contrast ratio; independent of argument order. */
function contrast(a: string, b: string): number {
  const [bright, dim] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (bright + 0.05) / (dim + 0.05)
}

describe('bonfirePaletteFor', () => {
  it('selects the night fire for dark mode', () => {
    expect(bonfirePaletteFor('dark')).toBe(bonfirePalette.dark)
  })

  it('falls back to the day fire otherwise', () => {
    expect(bonfirePaletteFor('light')).toBe(bonfirePalette.light)
    expect(bonfirePaletteFor(undefined)).toBe(bonfirePalette.light)
    expect(bonfirePaletteFor('system')).toBe(bonfirePalette.light)
  })
})

describe('bonfire visibility', () => {
  it('keeps embers legible against the page background', () => {
    expect(contrast(bonfirePalette.dark.ember, dark.background)).toBeGreaterThanOrEqual(3)
    expect(contrast(bonfirePalette.light.ember, light.background)).toBeGreaterThanOrEqual(3)
  })

  it('brightens the flame from tip through mid to core, in both fires', () => {
    for (const palette of [bonfirePalette.dark, bonfirePalette.light]) {
      expect(relativeLuminance(palette.flameCore)).toBeGreaterThan(
        relativeLuminance(palette.flameMid),
      )
      expect(relativeLuminance(palette.flameMid)).toBeGreaterThan(
        relativeLuminance(palette.flameTip),
      )
    }
  })

  it('keeps every fire colour on the warm side of the palette', () => {
    for (const palette of [bonfirePalette.dark, bonfirePalette.light]) {
      for (const hex of [
        palette.flameCore,
        palette.flameMid,
        palette.flameTip,
        palette.ember,
        palette.emberHot,
        palette.glow,
      ]) {
        const [red, , blue] = channels(hex)
        expect(red).toBeGreaterThan(blue)
      }
    }
  })
})
