import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'

const config = defineConfig({
  preflight: false,
  theme: {
    semanticTokens: {
      colors: {
        brand: {
          value: { base: '{colors.emerald.600}', _dark: '{colors.emerald.500}' },
        },
      },
    },
  },
})

export const system = createSystem(defaultConfig, config)
