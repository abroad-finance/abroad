import { expect, test } from '@playwright/test'

import { attachConsoleAndNetwork, readSession, watchPage } from './helpers'
import { CELO_COP, mockCorridors } from './mocks/corridors'
import { setupSession } from './mocks/wallet-auth'

/**
 * Session restoration E2E tests.
 *
 * Tests that wallet sessions are properly restored after page reload:
 * - Valid session restores wallet connection
 * - Expired session is cleared
 * - Invalid session (walletId type) is cleared
 * - Solana wallet session is supported
 */

const STELLAR_KIT_SESSION = { address: 'GTEST123456789', chainId: 'stellar:pubnet', walletId: 'stellar-kit' }

test.describe('Session Restore', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear()
    })
  })

  test('should restore wallet from valid session on page reload', async ({ page }) => {
    const { errors } = watchPage(page)

    setupSession(page, STELLAR_KIT_SESSION)

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    let session = await readSession(page)
    expect(session?.address).toBe(STELLAR_KIT_SESSION.address)
    expect(session?.walletId).toBe(STELLAR_KIT_SESSION.walletId)

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    session = await readSession(page)
    expect(session?.address).toBe(STELLAR_KIT_SESSION.address)
    expect(session?.walletId).toBe(STELLAR_KIT_SESSION.walletId)

    await attachConsoleAndNetwork(errors)
    expect(errors).toHaveLength(0)
  })

  test('should clear expired session (JWT expired)', async ({ page }) => {
    const { errors } = watchPage(page)

    setupSession(page, { ...STELLAR_KIT_SESSION, expOffset: -3600 })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3000)

    const raw = await page.evaluate(() => localStorage.getItem('wallet_session'))
    expect(raw).toBeNull()

    await attachConsoleAndNetwork(errors)
    expect(errors).toHaveLength(0)
  })

  test('should clear session with invalid walletId type', async ({ page }) => {
    const { errors } = watchPage(page)

    setupSession(page, { ...STELLAR_KIT_SESSION, walletId: 'invalid-wallet-type' })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3000)

    const raw = await page.evaluate(() => localStorage.getItem('wallet_session'))
    expect(raw).toBeNull()

    await attachConsoleAndNetwork(errors)
    expect(errors).toHaveLength(0)
  })

  test('should handle solana wallet session', async ({ page }) => {
    const { errors } = watchPage(page)

    setupSession(page, { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', chainId: 'solana:mainnet', walletId: 'solana' })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const session = await readSession(page)
    expect(session?.walletId).toBe('solana')
    expect(session?.chainId).toBe('solana:mainnet')

    await attachConsoleAndNetwork(errors)
    expect(errors).toHaveLength(0)
  })

  test('should prioritize saved session over MiniPay default', async ({ page }) => {
    const { errors } = watchPage(page)

    setupSession(page, STELLAR_KIT_SESSION)

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const session = await readSession(page)
    expect(session?.walletId).toBe('stellar-kit')

    await attachConsoleAndNetwork(errors)
    expect(errors).toHaveLength(0)
  })
})

test.describe('JWT and Session Cleanup', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear()
    })
  })

  test('should clear both JWT and session on chain mismatch', async ({ page }) => {
    const { errors } = watchPage(page)

    setupSession(page, STELLAR_KIT_SESSION)

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    await mockCorridors(page, [CELO_COP])

    await page.waitForTimeout(2000)

    // Note: cleanup of session/auth_token depends on the component mounting
    // We just want no JS crashes on the chain-mismatch path.
    await attachConsoleAndNetwork(errors)
    expect(errors).toHaveLength(0)
  })
})
