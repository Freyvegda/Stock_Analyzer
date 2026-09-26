import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../lib/contrast'
import { chartPalette, dark, light, type ThemeTokens } from '../tokens'

const TEXT_MIN = 4.5
const GRAPHIC_MIN = 3

interface ModeCase {
  name: string
  tokens: ThemeTokens
  charts: (typeof chartPalette)['dark']
}

const MODES: ModeCase[] = [
  { name: 'dark', tokens: dark, charts: chartPalette.dark },
  { name: 'light', tokens: light, charts: chartPalette.light },
]

function textPairs(tokens: ThemeTokens): Array<[string, string, string]> {
  return [
    ['foreground/background', tokens.foreground, tokens.background],
    ['card-foreground/card', tokens.cardForeground, tokens.card],
    ['popover-foreground/popover', tokens.popoverForeground, tokens.popover],
    ['primary-foreground/primary', tokens.primaryForeground, tokens.primary],
    ['muted-foreground/background', tokens.mutedForeground, tokens.background],
    ['muted-foreground/card', tokens.mutedForeground, tokens.card],
    ['gain/background', tokens.gain, tokens.background],
    ['gain/card', tokens.gain, tokens.card],
    ['loss/background', tokens.loss, tokens.background],
    ['loss/card', tokens.loss, tokens.card],
  ]
}

function graphicPairs(tokens: ThemeTokens): Array<[string, string, string]> {
  return [
    ['chart-1/card', tokens.chart1, tokens.card],
    ['chart-2/card', tokens.chart2, tokens.card],
    ['chart-3/card', tokens.chart3, tokens.card],
    ['chart-4/card', tokens.chart4, tokens.card],
    ['chart-5/card', tokens.chart5, tokens.card],
    ['primary/background', tokens.primary, tokens.background],
  ]
}

describe.each(MODES)('$name mode contrast', ({ tokens }) => {
  it.each(textPairs(tokens))('text pair %s meets AA (>= 4.5:1)', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(TEXT_MIN)
  })

  it.each(graphicPairs(tokens))('graphic %s meets 3:1', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(GRAPHIC_MIN)
  })
})
