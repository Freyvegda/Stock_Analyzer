/**
 * Pure contrast math for the vault palette tests (WCAG 2.x relative luminance).
 * No dependencies; used by `src/theme/__tests__/contrast.test.ts`.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export function hexToRgb(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`contrast: expected a #rrggbb colour, got "${hex}"`)
  }
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  }
}

function channelLuminance(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  )
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}
