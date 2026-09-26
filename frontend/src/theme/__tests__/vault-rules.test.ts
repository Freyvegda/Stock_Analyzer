/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dark, light, paletteFor } from '../tokens'

// Vitest runs from `frontend/` (see AGENTS.md).
const SRC = resolve(process.cwd(), 'src')

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name))
    .filter((path) => /\.(ts|tsx|css)$/.test(path))
    .filter((path) => !path.includes('__tests__'))
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

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

describe('vault design rules', () => {
  it('contains no emerald references anywhere in src', () => {
    const offenders = sourceFiles().filter((path) => /emerald/i.test(read(path)))
    expect(offenders).toEqual([])
  })

  it('keeps hex colour literals out of the 3D components', () => {
    const threeFiles = sourceFiles().filter((path) => path.includes('components\\three'))
    expect(threeFiles.length).toBeGreaterThan(0)
    const offenders = threeFiles.filter((path) => /#[0-9a-fA-F]{6}\b/.test(read(path)))
    expect(offenders).toEqual([])
  })

  it('contains no raw palette utility classes', () => {
    const pattern =
      /(?:text|bg|border|ring|fill|stroke)-(?:zinc|slate|gray|grey|neutral|stone|red|green|blue|indigo|violet|purple|pink|rose|orange|yellow|lime|teal|cyan|sky|amber|emerald)-\d{2,3}\b/
    const offenders = sourceFiles().filter((path) => pattern.test(read(path)))
    expect(offenders).toEqual([])
  })
})

describe('paletteFor', () => {
  it('selects the dark palette for dark mode', () => {
    expect(paletteFor('dark')).toBe(dark)
  })

  it('falls back to the light palette otherwise', () => {
    expect(paletteFor('light')).toBe(light)
    expect(paletteFor(undefined)).toBe(light)
    expect(paletteFor('system')).toBe(light)
  })
})

describe('obsidian dark surfaces', () => {
  const surfaces = [dark.background, dark.card, dark.muted, dark.secondary, dark.accent, dark.popover]

  it('keeps dark surfaces near-black', () => {
    for (const hex of surfaces) {
      expect(relativeLuminance(hex)).toBeLessThan(0.02)
    }
  })

  it('keeps dark surfaces free of a navy cast', () => {
    for (const hex of surfaces) {
      const [red, , blue] = channels(hex)
      expect(blue - red).toBeLessThanOrEqual(8)
    }
  })
})
