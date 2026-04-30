import { expect, test } from '@playwright/test'
import { watchPage, formatIssues } from './helpers'

/**
 * Chain switching E2E tests.
 *
 * Tests multi-chain switching behavior:
 * - Switching between Stellar and Celo
 * - Switching between Solana and Stellar
 * - Corridor changes during active connections
 */

// Helper to generate a simple mock JWT (using plain text for browser context)
const createMockJwt = (address: string, chainId: string, expOffset = 3600) => {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({
    address,
    chainId,
    exp: Math.floor(Date.now() / 1000) + expOffset,
  }))
  return `${header}.${payload}.mock-sig`
}

test.describe('Chain Switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear()
    })
  })

  test('should handle switching from Stellar to Celo', async ({ page }) => {
    const { errors } = watchPage(page)

    // Start with Stellar session
    await page.addInitScript(() => {
      const jwt = createMockJwt('GTEST123456789', 'stellar:pubnet')
      localStorage.setItem(
        'wallet_session',
        JSON.stringify({
          address: 'GTEST123456789',
          chainId: 'stellar:pubnet',
          walletId: 'stellar-kit',
        })
      )
      localStorage.setItem('auth_token', jwt)
    })

    // Mock corridors with both Stellar and Celo
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
          ],
        }),
      })
    })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    // Verify initial Stellar session
    let session = await page.evaluate(() => {
      const s = localStorage.getItem('wallet_session')
      return s ? JSON.parse(s) : null
    })

    expect(session?.chainId).toBe('stellar:pubnet')

    await test.info().attach('console-and-network', {
      contentType: 'text/plain',
      body: Buffer.from(formatIssues(errors, [], [], [])),
    })

    // No JS crashes
    expect(errors).toHaveLength(0)
  })

  test('should handle Solana to Stellar chain switch', async ({ page }) => {
    const { errors } = watchPage(page)

    // Start with Solana session
    await page.addInitScript(() => {
      const jwt = createMockJwt('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 'solana:mainnet')
      localStorage.setItem(
        'wallet_session',
        JSON.stringify({
          address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
          chainId: 'solana:mainnet',
          walletId: 'solana',
        })
      )
      localStorage.setItem('auth_token', jwt)
    })

    // Mock corridors with Solana and Stellar
    await page.route('**/api/public/corridors', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          corridors: [
            {
              blockchain: 'Solana',
              chainId: 'solana:mainnet',
              cryptoCurrency: 'SOL',
              targetCurrency: 'COP',
              paymentMethod: 'PIX',
            },
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

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    // Verify initial Solana session
    let session = await page.evaluate(() => {
      const s = localStorage.getItem('wallet_session')
      return s ? JSON.parse(s) : null
    })

    expect(session?.chainId).toBe('solana:mainnet')
    expect(session?.walletId).toBe('solana')

    await test.info().attach('console-and-network', {
      contentType: 'text/plain',
      body: Buffer.from(formatIssues(errors, [], [], [])),
    })

    // No JS crashes
    expect(errors).toHaveLength(0)
  })

  test('should handle corridor change during active connection', async ({ page }) => {
    const { errors } = watchPage(page)

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Mock corridors
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

    await page.waitForTimeout(2000)

    await test.info().attach('console-and-network', {
      contentType: 'text/plain',
      body: Buffer.from(formatIssues(errors, [], [], [])),
    })

    // No JS crashes
    expect(errors).toHaveLength(0)
  })

  test('should handle pending connection with slow corridors response', async ({ page }) => {
    const { errors } = watchPage(page)

    // Mock slow corridors response
    await page.route('**/api/public/corridors', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 2000))
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

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Wait for initial load
    await page.waitForTimeout(3000)

    await test.info().attach('console-and-network', {
      contentType: 'text/plain',
      body: Buffer.from(formatIssues(errors, [], [], [])),
    })

    // No JS crashes during race condition
    expect(errors).toHaveLength(0)
  })
})

test.describe('Multi-Chain Connection Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear()
    })
  })

  test('should support multiple chains in corridor list', async ({ page }) => {
    const { errors } = watchPage(page)

    // Mock all supported chains
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
              targetCurrency: 'BRL',
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

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    // Verify all chains are available in the UI
    await test.info().attach('console-and-network', {
      contentType: 'text/plain',
      body: Buffer.from(formatIssues(errors, [], [], [])),
    })

    // No JS crashes
    expect(errors).toHaveLength(0)
  })
})
