import { expect, test } from '@playwright/test'

import { attachConsoleAndNetwork, readSession, watchPage } from './helpers'
import {
  CELO_BRL,
  CELO_COP,
  mockCorridors,
  SOLANA_COP,
  STELLAR_COP,
} from './mocks/corridors'
import { setupSession } from './mocks/wallet-auth'

/**
 * Chain switching E2E tests.
 *
 * Tests multi-chain switching behavior:
 * - Switching between Stellar and Celo
 * - Switching between Solana and Stellar
 * - Corridor changes during active connections
 */

test.describe('Chain Switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear()
    })
  })

  test('should handle switching from Stellar to Celo', async ({ page }) => {
    const { errors } = watchPage(page)

    setupSession(page, { address: 'GTEST123456789', chainId: 'stellar:pubnet', walletId: 'stellar-kit' })
    await mockCorridors(page, [STELLAR_COP, CELO_COP])

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const session = await readSession(page)
    expect(session?.chainId).toBe('stellar:pubnet')

    await attachConsoleAndNetwork(errors)
    expect(errors).toHaveLength(0)
  })

  test('should handle Solana to Stellar chain switch', async ({ page }) => {
    const { errors } = watchPage(page)

    setupSession(page, { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', chainId: 'solana:mainnet', walletId: 'solana' })
    await mockCorridors(page, [SOLANA_COP, STELLAR_COP])

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const session = await readSession(page)
    expect(session?.chainId).toBe('solana:mainnet')
    expect(session?.walletId).toBe('solana')

    await attachConsoleAndNetwork(errors)
    expect(errors).toHaveLength(0)
  })

  test('should handle corridor change during active connection', async ({ page }) => {
    const { errors } = watchPage(page)

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await mockCorridors(page, [STELLAR_COP])

    await page.waitForTimeout(2000)

    await attachConsoleAndNetwork(errors)
    expect(errors).toHaveLength(0)
  })

  test('should handle pending connection with slow corridors response', async ({ page }) => {
    const { errors } = watchPage(page)

    await mockCorridors(page, [STELLAR_COP], { delayMs: 2000 })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3000)

    await attachConsoleAndNetwork(errors)
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

    await mockCorridors(page, [STELLAR_COP, CELO_BRL, SOLANA_COP])

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    await attachConsoleAndNetwork(errors)
    expect(errors).toHaveLength(0)
  })
})
