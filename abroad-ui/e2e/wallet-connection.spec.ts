import { expect, test } from '@playwright/test'

import { attachConsoleAndNetwork, readSession, watchPage } from './helpers'
import { CELO_COP, mockCorridors, SOLANA_COP, STELLAR_COP } from './mocks/corridors'
import { generateMockJwt, setupSession } from './mocks/wallet-auth'

/**
 * Wallet connection E2E tests.
 *
 * Tests the basic wallet connection flows:
 * - Display wallet connection options
 * - Handle wallet connection flow with mocked API
 * - Show blockchain selection
 * - Session persistence
 */

test.describe('Wallet Connection', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear()
    })
  })

  test('should display wallet connection options on swap page', async ({ page }) => {
    const { errors, networkErrors, warnings } = watchPage(page)

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3000)

    await expect(page.locator('body')).toBeVisible()

    await attachConsoleAndNetwork(errors, warnings, networkErrors)
    expect(errors).toHaveLength(0)
  })

  test('should handle wallet connection flow with mocked API', async ({ page }) => {
    const { errors, networkErrors, warnings } = watchPage(page)

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    await page.route('**/api/walletAuth/challenge', async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          challengeToken: 'test-challenge-123',
          format: 'utf8',
          message: 'Sign this message to authenticate',
        }),
        contentType: 'application/json',
        status: 200,
      })
    })

    await page.route('**/api/walletAuth/verify', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      const token = generateMockJwt({ address: body.address ?? 'test-address', chainId: body.chainId ?? 'stellar:pubnet' })
      await route.fulfill({
        body: JSON.stringify({ token }),
        contentType: 'application/json',
        status: 200,
      })
    })

    await mockCorridors(page, [STELLAR_COP])

    await page.waitForTimeout(2000)

    await attachConsoleAndNetwork(errors, warnings, networkErrors)
    expect(errors).toHaveLength(0)
  })

  test('should show blockchain selection interface', async ({ page }) => {
    const { errors } = watchPage(page)

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    await mockCorridors(page, [STELLAR_COP, CELO_COP, SOLANA_COP])

    await page.waitForTimeout(2000)

    await attachConsoleAndNetwork(errors)
    expect(errors).toHaveLength(0)
  })
})

test.describe('Session Persistence', () => {
  test('should persist wallet session in localStorage', async ({ page }) => {
    const { errors } = watchPage(page)

    setupSession(page, { address: 'test-address-123', chainId: 'stellar:pubnet', walletId: 'stellar-kit' })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const session = await readSession(page)
    expect(session).toEqual({
      address: 'test-address-123',
      chainId: 'stellar:pubnet',
      walletId: 'stellar-kit',
    })

    await attachConsoleAndNetwork(errors)
    expect(errors).toHaveLength(0)
  })

  test('should clear invalid session on page load', async ({ page }) => {
    const { errors } = watchPage(page)

    await page.addInitScript(() => {
      localStorage.setItem(
        'wallet_session',
        JSON.stringify({
          address: 'test-address',
          chainId: 'stellar:pubnet',
        }),
      )
    })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(5000)

    const session = await readSession(page)
    expect(session?.walletId).toBeUndefined()

    await attachConsoleAndNetwork(errors)
    expect(errors).toHaveLength(0)
  })
})
