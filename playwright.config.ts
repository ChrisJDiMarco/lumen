import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 2,
  retries: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build:e2e && npm run preview:e2e',
    port: 4175,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
