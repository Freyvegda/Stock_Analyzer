import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'

// Tailwind's emerald scale: Chakra has no built-in `emerald` palette, so both the
// scale and its virtual color tokens are defined here. The 500/600 values match
// the DESIGN.md pinned oklch accents.
const emerald = {
  50: { value: '#ecfdf5' },
  100: { value: '#d1fae5' },
  200: { value: '#a7f3d0' },
  300: { value: '#6ee7b7' },
  400: { value: '#34d399' },
  500: { value: '#10b981' },
  600: { value: '#059669' },
  700: { value: '#047857' },
  800: { value: '#065f46' },
  900: { value: '#064e3b' },
  950: { value: '#022c22' },
}

const config = defineConfig({
  preflight: false,
  theme: {
    tokens: {
      colors: { emerald },
    },
    semanticTokens: {
      colors: {
        brand: {
          value: { base: '{colors.emerald.600}', _dark: '{colors.emerald.500}' },
        },
        // Virtual color tokens that make `colorPalette="emerald"` valid.
        emerald: {
          contrast: { value: { _light: 'white', _dark: 'white' } },
          fg: { value: { _light: '{colors.emerald.700}', _dark: '{colors.emerald.300}' } },
          subtle: { value: { _light: '{colors.emerald.100}', _dark: '{colors.emerald.900}' } },
          muted: { value: { _light: '{colors.emerald.200}', _dark: '{colors.emerald.800}' } },
          emphasized: { value: { _light: '{colors.emerald.300}', _dark: '{colors.emerald.700}' } },
          solid: { value: { _light: '{colors.emerald.600}', _dark: '{colors.emerald.500}' } },
          focusRing: { value: { _light: '{colors.emerald.600}', _dark: '{colors.emerald.500}' } },
          border: { value: { _light: '{colors.emerald.500}', _dark: '{colors.emerald.400}' } },
        },
      },
    },
  },
})

export const system = createSystem(defaultConfig, config)
