import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    manifest: 'vite-manifest.json',
  },
  server: {
    port: 4173,
    strictPort: true,
  },
  preview: {
    port: 4174,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/game/core/**/*.ts', 'src/game/input/**/*.ts', 'src/game/render/stimulusGeometry.ts', 'src/data/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
})
