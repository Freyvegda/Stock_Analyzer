import { describe, expect, it } from 'vitest'
import { scenePalette, scenePaletteFor } from '../tokens'

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
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

describe('scenePaletteFor', () => {
  it('selects the night scene for dark mode', () => {
    expect(scenePaletteFor('dark')).toBe(scenePalette.dark)
  })

  it('falls back to the day scene otherwise', () => {
    expect(scenePaletteFor('light')).toBe(scenePalette.light)
    expect(scenePaletteFor(undefined)).toBe(scenePalette.light)
    expect(scenePaletteFor('system')).toBe(scenePalette.light)
  })
})

describe('sakura scene visibility', () => {
  // The petals spawn in the canopy, which sits in the upper band of the sky, and the
  // celestial body lives in the top-left corner. Both must clear WCAG 3:1 against the
  // sky band they render on — the same floor the vault uses for graphics.
  it('keeps falling petals legible against the top of the sky', () => {
    expect(contrast(scenePalette.dark.petal, scenePalette.dark.skyTop)).toBeGreaterThanOrEqual(3)
    expect(contrast(scenePalette.light.petal, scenePalette.light.skyTop)).toBeGreaterThanOrEqual(3)
  })

  it('keeps the moon and sun legible against the top of the sky', () => {
    expect(contrast(scenePalette.dark.celestial, scenePalette.dark.skyTop)).toBeGreaterThanOrEqual(3)
    expect(contrast(scenePalette.light.celestial, scenePalette.light.skyTop)).toBeGreaterThanOrEqual(
      3,
    )
  })

  it('keeps the horizon lighter than the zenith in both scenes', () => {
    expect(relativeLuminance(scenePalette.dark.skyBottom)).toBeGreaterThan(
      relativeLuminance(scenePalette.dark.skyTop),
    )
    expect(relativeLuminance(scenePalette.light.skyBottom)).toBeGreaterThan(
      relativeLuminance(scenePalette.light.skyTop),
    )
  })
})
