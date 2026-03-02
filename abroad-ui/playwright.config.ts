import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E config for abroad-ui.
 *
 * The dev server starts automatically before any test run.
 * Set E2E_BASE_URL env var to override the default (useful in CI).
 *
 * Usage:
 *   npx playwright test                    – run all E2E tests
 *   npx playwright test --headed           – run with visible browser
 *   npx playwright test --ui               – interactive UI mode
 *   npx playwright show-report             – open last HTML report
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e-report', open: 'never' }],
  ],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5174',
    /* Capture screenshot + trace on every failure */
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    /* Give pages time to settle before assertions */
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },

  /* Auto-start the Vite dev server */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5174',
    reuseExistingServer: true,   // reuse if already running locally
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
