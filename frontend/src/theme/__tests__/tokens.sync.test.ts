/// <reference types="node" />
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dark, light, renderTokenBlock } from '../tokens'

// Vitest is invoked from `frontend/` (see AGENTS.md), and Vite rewrites
// `import.meta.url` into a non-file URL, so resolve from the working directory.
const cssPath = resolve(process.cwd(), 'src', 'index.css')
const START = '/* @vault-tokens:start */'
const END = '/* @vault-tokens:end */'

function extractBlock(css: string): string {
  const start = css.indexOf(START)
  const end = css.indexOf(END)
  if (start === -1 || end === -1) {
    throw new Error('vault token markers missing from src/index.css')
  }
  return css.slice(start, end + END.length)
}

describe('vault token sync', () => {
  it('index.css marked block matches tokens.ts', () => {
    const css = readFileSync(cssPath, 'utf8')
    const expected = renderTokenBlock(light, dark)

    // `VAULT_SYNC=1` rewrites the marked block from tokens.ts instead of failing.
    if (process.env.VAULT_SYNC === '1') {
      writeFileSync(cssPath, css.replace(extractBlock(css), expected))
    }

    expect(extractBlock(readFileSync(cssPath, 'utf8'))).toBe(expected)
  })
})
