import { expect, test } from '@playwright/test'

import { attachIssues, watchPage } from './helpers'

/**
 * Console-health suite.
 *
 * Each test navigates to a route, waits for the page to settle,
 * then asserts that no JS errors appeared in the console.
 * Screenshots + traces are captured automatically on failure
 * (configured in playwright.config.ts).
 */

const SETTLE_MS = 1_500 // ms to wait after networkidle for late React errors

// Routes accessible without authentication
const publicRoutes = [
  { name: 'Swap (root)', path: '/' },
  { name: 'WebSwap embed', path: '/web-swap' },
]

// Ops routes – no auth, but components still mount and CSS must resolve
const opsRoutes = [
  { name: 'Ops – Flow list', path: '/ops/flows' },
  { name: 'Ops – Flow definitions', path: '/ops/flows/definitions' },
  { name: 'Ops – Crypto assets', path: '/ops/crypto-assets' },
  { name: 'Ops – Partners', path: '/ops/partners' },
  { name: 'Ops – Reconcile', path: '/ops/transactions/reconcile' },
]

for (const { name, path } of [...publicRoutes, ...opsRoutes]) {
  test(`no console errors on "${name}"`, async ({ page }, testInfo) => {
    const { errors, warnings, networkErrors, allErrors } = watchPage(page)

    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(SETTLE_MS)

    // Attach everything to the report regardless of pass/fail
    await attachIssues(testInfo, errors, warnings, networkErrors, allErrors)

    expect(
      errors,
      `Console errors found on ${path}:\n${errors.map(e => e.text).join('\n')}`,
    ).toHaveLength(0)
  })
}
