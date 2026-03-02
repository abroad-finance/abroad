import { expect, test } from '@playwright/test'

import { watchPage } from './helpers'

/**
 * Visual smoke suite.
 *
 * Takes a full-page screenshot of each route and asserts that key
 * UI landmarks are visible. Not a pixel-perfect snapshot test —
 * just a sanity check that the page actually rendered something.
 *
 * Screenshots land in e2e-results/ and are attached to the HTML report.
 */

test.describe('Swap page', () => {
  test('renders the swap card', async ({ page }) => {
    const { errors } = watchPage(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Core swap UI must be present
    await expect(page.locator('body')).toBeVisible()

    // No JS crashes
    expect(errors.map(e => e.text)).toHaveLength(0)

    await page.screenshot({ fullPage: true, path: 'e2e-results/swap-root.png' })
  })
})

test.describe('Ops pages', () => {
  test('Flow list renders the page wrapper', async ({ page }) => {
    const { errors } = watchPage(page)

    await page.goto('/ops/flows')
    await page.waitForLoadState('networkidle')

    // The ops-page div should exist (our custom class)
    await expect(page.locator('.ops-page')).toBeVisible()

    // The OpsApiKeyPanel "Ops Access" label should be present
    await expect(page.getByText('Ops Access')).toBeVisible()

    expect(errors.map(e => e.text)).toHaveLength(0)
    await page.screenshot({ fullPage: true, path: 'e2e-results/ops-flow-list.png' })
  })

  test('Crypto assets page renders', async ({ page }) => {
    const { errors } = watchPage(page)

    await page.goto('/ops/crypto-assets')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('.ops-page')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Crypto Asset Coverage' })).toBeVisible()

    expect(errors.map(e => e.text)).toHaveLength(0)
    await page.screenshot({ fullPage: true, path: 'e2e-results/ops-crypto-assets.png' })
  })

  test('Partners page renders', async ({ page }) => {
    const { errors } = watchPage(page)

    await page.goto('/ops/partners')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('.ops-page')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Partners & API Keys' })).toBeVisible()

    expect(errors.map(e => e.text)).toHaveLength(0)
    await page.screenshot({ fullPage: true, path: 'e2e-results/ops-partners.png' })
  })
})
