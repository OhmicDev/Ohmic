import { defineConfig } from '@playwright/test'

// End-to-end tests run the production build (`vite preview`) against the demo scooter (MockTransport),
// so they need no hardware. They drive an installed Edge by default; set PW_CHANNEL=chrome to use Chrome,
// or PW_CHANNEL=chromium after `npx playwright install chromium`.
const PORT = 4173
const channel = process.env.PW_CHANNEL ?? 'msedge'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One at a time: the performance test measures frame times and shouldn't share the CPU.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: channel === 'chromium' ? undefined : channel,
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
