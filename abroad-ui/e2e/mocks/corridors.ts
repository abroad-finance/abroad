/**
 * Corridor fixtures and mock helper for E2E tests.
 */

import type { Page } from '@playwright/test'

export type CorridorFixture = {
  blockchain: string
  chainId: string
  cryptoCurrency: string
  paymentMethod: string
  targetCurrency: string
}

export const STELLAR_COP: CorridorFixture = {
  blockchain: 'Stellar',
  chainId: 'stellar:pubnet',
  cryptoCurrency: 'XLM',
  paymentMethod: 'BREB',
  targetCurrency: 'COP',
}

export const CELO_COP: CorridorFixture = {
  blockchain: 'Celo',
  chainId: 'celo:mainnet',
  cryptoCurrency: 'CELO',
  paymentMethod: 'PIX',
  targetCurrency: 'COP',
}

export const CELO_BRL: CorridorFixture = { ...CELO_COP, targetCurrency: 'BRL' }

export const SOLANA_COP: CorridorFixture = {
  blockchain: 'Solana',
  chainId: 'solana:mainnet',
  cryptoCurrency: 'SOL',
  paymentMethod: 'PIX',
  targetCurrency: 'COP',
}

/**
 * Mocks the GET /api/public/corridors endpoint with the supplied list.
 * Optionally delays the response (ms) to simulate slow networks.
 */
export async function mockCorridors(
  page: Page,
  corridors: CorridorFixture[],
  options: { delayMs?: number } = {},
): Promise<void> {
  await page.route('**/api/public/corridors', async (route) => {
    if (options.delayMs) {
      await new Promise(resolve => setTimeout(resolve, options.delayMs))
    }
    await route.fulfill({
      body: JSON.stringify({ corridors }),
      contentType: 'application/json',
      status: 200,
    })
  })
}
