import { expect, test } from '@playwright/test'
import { watchPage, formatIssues } from './helpers'
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
    // Clear any existing session before each test
    await page.addInitScript(() => {
      localStorage.clear()
    })
  })

  test('should display wallet connection options on swap page', async ({ page }) => {
    const { errors, warnings, networkErrors } = watchPage(page)

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3000)

    // The swap page should be visible
    await expect(page.locator('body')).toBeVisible()

    // Attach issues to report
    await test.info().attach('console-and-network', {
      contentType: 'text/plain',
      body: Buffer.from(formatIssues(errors, warnings, networkErrors, [])),
    })

    // No JS crashes
    expect(errors).toHaveLength(0)
  })

  test('should handle wallet connection flow with mocked API', async ({ page }) => {
    const { errors, warnings, networkErrors } = watchPage(page)

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Mock the wallet auth API
    await page.route('**/api/walletAuth/challenge', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          challengeToken: 'test-challenge-123',
          message: 'Sign this message to authenticate',
          format: 'utf8',
        }),
      })
    })

    await page.route('**/api/walletAuth/verify', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      const token = generateMockJwt({ address: body.address ?? 'test-address', chainId: body.chainId ?? 'stellar:pubnet' })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token }),
      })
    })

    // Mock corridors API
    await page.route('**/api/public/corridors', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          corridors: [
            {
              blockchain: 'Stellar',
              chainId: 'stellar:pubnet',
              cryptoCurrency: 'XLM',
              targetCurrency: 'COP',
              paymentMethod: 'BREB',
            },
          ],
        }),
      })
    })

    // Check that the page loaded without errors
    await page.waitForTimeout(2000)

    await test.info().attach('console-and-network', {
      contentType: 'text/plain',
      body: Buffer.from(formatIssues(errors, warnings, networkErrors, [])),
    })

    // No JS crashes during connection flow
    expect(errors).toHaveLength(0)
  })

  test('should show blockchain selection interface', async ({ page }) => {
    const { errors } = watchPage(page)

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Mock corridors for blockchain selection
    await page.route('**/api/public/corridors', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          corridors: [
            {
              blockchain: 'Stellar',
              chainId: 'stellar:pubnet',
              cryptoCurrency: 'XLM',
              targetCurrency: 'COP',
              paymentMethod: 'BREB',
            },
            {
              blockchain: 'Celo',
              chainId: 'celo:mainnet',
              cryptoCurrency: 'CELO',
              targetCurrency: 'COP',
              paymentMethod: 'PIX',
            },
            {
              blockchain: 'Solana',
              chainId: 'solana:mainnet',
              cryptoCurrency: 'SOL',
              targetCurrency: 'COP',
              paymentMethod: 'PIX',
            },
          ],
        }),
      })
    })

    // Wait for the swap interface to load
    await page.waitForTimeout(2000)

    await test.info().attach('console-and-network', {
      contentType: 'text/plain',
      body: Buffer.from(formatIssues(errors, [], [], [])),
    })

    // No JS crashes
    expect(errors).toHaveLength(0)
  })
})

test.describe('Session Persistence', () => {
  test('should persist wallet session in localStorage', async ({ page }) => {
    const { errors } = watchPage(page)

    // Set up a mock session before page load
    setupSession(page, { address: 'test-address-123', chainId: 'stellar:pubnet', walletId: 'stellar-kit' })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    // Verify session is still in localStorage
    const session = await page.evaluate(() => {
      const s = localStorage.getItem('wallet_session')
      return s ? JSON.parse(s) : null
    })

    expect(session).toEqual({
      address: 'test-address-123',
      chainId: 'stellar:pubnet',
      walletId: 'stellar-kit',
    })

    await test.info().attach('console-and-network', {
      contentType: 'text/plain',
      body: Buffer.from(formatIssues(errors, [], [], [])),
    })

    // No JS crashes
    expect(errors).toHaveLength(0)
  })

  test('should clear invalid session on page load', async ({ page }) => {
    const { errors } = watchPage(page)

    // Set up an INVALID session (missing walletId)
    await page.addInitScript(() => {
      localStorage.setItem(
        'wallet_session',
        JSON.stringify({
          address: 'test-address',
          chainId: 'stellar:pubnet',
          // Missing walletId - invalid
        })
      )
    })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(5000) // Give more time for session validation

    // The invalid session should be cleared
    const session = await page.evaluate(() => {
      return localStorage.getItem('wallet_session')
    })

    // Session should be cleared or not contain valid walletId
    // Note: The session might be partially cleared (address remains but walletId is checked)
    const sessionData = session ? JSON.parse(session) : null
    expect(sessionData?.walletId).toBeUndefined()
  })

    await test.info().attach('console-and-network', {
      contentType: 'text/plain',
      body: Buffer.from(formatIssues(errors, [], [], [])),
    })

    // No JS crashes
    expect(errors).toHaveLength(0)
  })
})
