import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for the abroad-ui end-to-end suite (`e2e/`).
 *
 * The suite drives a real Vite server. By default that is the dev server,
 * which needs no prior build — run `npm run e2e` and it boots on its own.
 * Set `E2E_PREVIEW=true` to serve the production bundle from `dist/` instead
 * (`npm run build` first); that is the cheaper option anywhere the UI has
 * already been built, and it exercises the bundle users actually get.
 *
 * Browsers are not vendored: run `npx playwright install chromium` once
 * (`--with-deps` on CI) before the first run.
 */

const usePreview = process.env.E2E_PREVIEW === 'true'
const port = Number(process.env.E2E_PORT ?? (usePreview ? 4173 : 5173))
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`
const isCI = Boolean(process.env.CI)

export default defineConfig({
  expect: { timeout: 15_000 },

  forbidOnly: isCI,

  fullyParallel: true,
  // visual-smoke.spec.ts writes its own screenshots to `e2e-results/` using
  // paths relative to the cwd, so Playwright's own failure artifacts are
  // pointed at the same directory instead of the default `test-results/`.
  outputDir: './e2e-results',
  // Single browser on purpose: the noise filters in e2e/helpers.ts key off
  // Chromium-specific message text (e.g. `net::ERR_FAILED`).
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { height: 900, width: 1440 },
    },
  }],
  reporter: [isCI ? ['github'] : ['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],

  retries: isCI ? 2 : 0,

  testDir: './e2e',
  // The specs stack `waitForLoadState('networkidle')` on top of explicit 2–5s
  // settle waits, and the first hit on a cold dev server pays for on-demand
  // transforms of the whole dependency graph. The 30s default is not enough.
  timeout: 90_000,

  use: {
    baseURL,
    // console-health.spec.ts documents that failure artifacts are configured
    // here rather than per-test.
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },

  webServer: {
    command: usePreview
      ? `npm run preview -- --port ${port} --strictPort`
      : `npm run dev -- --port ${port} --strictPort`,
    env: {
      // Pins i18n to the source-controlled English fallbacks: no Tolgee API
      // calls, so none of the CORS noise e2e/helpers.ts exists to filter out,
      // and the copy the specs see does not depend on a remote translation.
      VITE_STANDALONE_UI: 'true',
      // src/main.tsx falls back to https://api.abroad.finance when this is
      // unset, so an unconfigured run talks to production. Set E2E_API_URL to
      // aim the suite at a local or staging API instead.
      ...(process.env.E2E_API_URL ? { VITE_API_URL: process.env.E2E_API_URL } : {}),
    },
    reuseExistingServer: !isCI,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: 180_000,
    url: baseURL,
  },

  workers: isCI ? 2 : undefined,
})
