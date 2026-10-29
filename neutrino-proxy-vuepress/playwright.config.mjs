import { defineConfig } from '@playwright/test'
import { normalizeBase } from './scripts/routes.mjs'

const base = normalizeBase(process.env.DOCS_BASE || '/')
const liveURL = process.env.DOCS_TEST_URL
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  timeout: liveURL ? 60000 : 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: liveURL || `http://127.0.0.1:4179${base}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL || undefined } }],
  webServer: liveURL ? undefined : {
    command: 'npm run preview -- --port 4179 --strictPort',
    url: `http://127.0.0.1:4179${base}`,
    reuseExistingServer: false,
    timeout: 30000,
  },
})
