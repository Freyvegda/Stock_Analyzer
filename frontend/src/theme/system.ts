import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'
import { amberScale, dark, light } from './tokens'

// Chakra has no built-in `amber` palette: the scale and its virtual colour tokens are
// defined here from the single token source (`tokens.ts`). Dark primary = amber.400
// (#FFB454); light primary = amber.700 (#B45309). Gain/loss keep their own semantic
// tokens so P&L never borrows the brand hue.
const amber = Object.fromEntries(
  Object.entries(amberScale).map(([step, value]) => [step, { value }]),
)

const config = defineConfig({
  preflight: false,
  theme: {
    tokens: {
      colors: { amber },
    },
    semanticTokens: {
      colors: {
        brand: { value: { base: light.primary, _dark: dark.primary } },
        gain: { value: { base: light.gain, _dark: dark.gain } },
        loss: { value: { base: light.loss, _dark: dark.loss } },
        // Virtual colour tokens that make `colorPalette="amber"` valid.
        amber: {
          contrast: { value: { _light: light.primaryForeground, _dark: dark.primaryForeground } },
          fg: { value: { _light: '{colors.amber.800}', _dark: '{colors.amber.300}' } },
          subtle: { value: { _light: '{colors.amber.100}', _dark: 'rgba(255, 180, 84, 0.12)' } },
          muted: { value: { _light: '{colors.amber.200}', _dark: 'rgba(255, 180, 84, 0.20)' } },
          emphasized: {
            value: { _light: '{colors.amber.300}', _dark: 'rgba(255, 180, 84, 0.32)' },
          },
          solid: { value: { _light: light.primary, _dark: dark.primary } },
          focusRing: { value: { _light: light.ring, _dark: dark.ring } },
          border: { value: { _light: '{colors.amber.600}', _dark: '{colors.amber.500}' } },
        },
      },
    },
  },
})

export const system = createSystem(defaultConfig, config)
