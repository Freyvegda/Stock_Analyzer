import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'
import { dark, light, sakuraScale } from './tokens'

// Chakra has no sakura palette out of the box: the scale and its virtual colour tokens
// are defined here from the single token source (`tokens.ts`), so
// `colorPalette="sakura"` resolves to the brand scale in both modes. Gain/loss keep
// their own semantic tokens so P&L never borrows the brand hue.
const brand = Object.fromEntries(
  Object.entries(sakuraScale).map(([step, value]) => [step, { value }]),
)

const config = defineConfig({
  preflight: false,
  theme: {
    tokens: {
      colors: { sakura: brand },
    },
    semanticTokens: {
      colors: {
        brand: { value: { base: light.primary, _dark: dark.primary } },
        gain: { value: { base: light.gain, _dark: dark.gain } },
        loss: { value: { base: light.loss, _dark: dark.loss } },
        // The auth card floats over the 3D scene: its surface is the warmer `panel`
        // tint, not the page's card white (see DESIGN.md → Sakura Garden). Declared as
        // `_light`/`_dark` rather than `base`, so it emits into the same `:root, .light`
        // layer as Chakra's default `bg.panel` and overrides it; a `base` value would
        // land in the weaker `:where(html, .chakra-theme)` layer and lose.
        bg: {
          panel: { value: { _light: light.panel, _dark: dark.panel } },
        },
        // Virtual colour tokens that make `colorPalette="sakura"` valid. Values track
        // the sakura scale steps so the palette is pink in both modes.
        sakura: {
          contrast: { value: { _light: '{colors.sakura.50}', _dark: '{colors.sakura.950}' } },
          fg: { value: { _light: '{colors.sakura.800}', _dark: '{colors.sakura.300}' } },
          subtle: { value: { _light: '{colors.sakura.100}', _dark: 'rgba(244, 114, 165, 0.12)' } },
          muted: { value: { _light: '{colors.sakura.200}', _dark: 'rgba(244, 114, 165, 0.20)' } },
          emphasized: {
            value: { _light: '{colors.sakura.300}', _dark: 'rgba(244, 114, 165, 0.32)' },
          },
          solid: { value: { _light: '{colors.sakura.700}', _dark: '{colors.sakura.400}' } },
          focusRing: { value: { _light: '{colors.sakura.700}', _dark: '{colors.sakura.400}' } },
          border: { value: { _light: '{colors.sakura.600}', _dark: '{colors.sakura.500}' } },
        },
      },
    },
  },
})

export const system = createSystem(defaultConfig, config)
