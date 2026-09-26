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
