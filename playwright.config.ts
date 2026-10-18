import { defineConfig } from '@playwright/test'

// Uses the installed Google Chrome; no browser download needed.
export default defineConfig({
  testDir: 'e2e',
  use: { channel: 'chrome', launchOptions: { args: ['--enable-unsafe-swiftshader'] }, baseURL: 'http://localhost:5173', viewport: { width: 1400, height: 850 } },
  webServer: { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true },
})
