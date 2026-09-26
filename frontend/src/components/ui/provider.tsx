"use client"

import { ChakraProvider } from "@chakra-ui/react"
import { system } from "@/theme/system"
import {
  ColorModeProvider,
  type ColorModeProviderProps,
} from "./color-mode"

const THEME_STORAGE_KEY = "stock-analyzer-theme"
const VALID_THEMES = ["light", "dark", "system"]

// A corrupt persisted value would be applied as a class name and throw a DOMException.
function sanitizeStoredTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored !== null && !VALID_THEMES.includes(stored)) {
      window.localStorage.removeItem(THEME_STORAGE_KEY)
    }
  } catch {
    // localStorage unavailable; next-themes falls back to the system preference.
  }
}

export function Provider(props: ColorModeProviderProps) {
  sanitizeStoredTheme()
  return (
    <ChakraProvider value={system}>
      <ColorModeProvider
        attribute="class"
        storageKey={THEME_STORAGE_KEY}
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        {...props}
      />
    </ChakraProvider>
  )
}
