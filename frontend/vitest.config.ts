import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // The suite runs on a loaded dev machine; jsdom + motion + three lazy
    // imports push individual renders past the 5 s default under full load.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
})
