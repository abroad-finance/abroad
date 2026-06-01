/**
 * Wallet authentication mocks for E2E tests.
 *
 * Provides mock responses for wallet auth API endpoints.
 */

import type { Page } from '@playwright/test'

/**
 * Mock JWT token generator for testing.
 * Creates a valid JWT with configurable expiration.
 */
export function generateMockJwt(payload: {
  address?: string
  chainId?: string
  exp?: number // seconds since epoch
  iat?: number
}): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)

  const body = {
    address: payload.address ?? 'test-address',
    chainId: payload.chainId ?? 'stellar:pubnet',
    exp: payload.exp ?? (now + 3600), // 1 hour default
    iat: payload.iat ?? now,
  }

  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url')

  return `${encode(header)}.${encode(body)}.mock-signature`
}

/**
 * Sets up a mock wallet session in page localStorage via addInitScript.
 * Must be called BEFORE page.goto().
 */
export function setupSession(
  page: Page,
  options: {
    address?: string
    chainId?: string
    walletId?: string
    expOffset?: number // seconds from now; negative = expired
  } = {},
): void {
  const {
    address = 'GTEST123456789',
    chainId = 'stellar:pubnet',
    walletId = 'stellar-kit',
    expOffset = 3600,
  } = options
  const jwt = generateMockJwt({ address, chainId, exp: Math.floor(Date.now() / 1000) + expOffset })
  page.addInitScript(({ address, chainId, walletId, jwt }) => {
    localStorage.clear()
    localStorage.setItem('wallet_session', JSON.stringify({ address, chainId, walletId }))
    localStorage.setItem('auth_token', jwt)
  }, { address, chainId, walletId, jwt })
}

/**
 * Mock challenge response for wallet auth.
 */
export function mockChallengeResponse(challengeToken?: string): {
  challengeToken?: string
  message: string
  format: 'utf8' | 'xdr'
} {
  return {
    challengeToken: challengeToken ?? `challenge-${Date.now()}`,
    message: `Sign this message to authenticate: ${Date.now()}`,
    format: 'utf8',
  }
}

/**
 * Mock verify response with JWT token.
 */
export function mockVerifyResponse(address: string, chainId: string): {
  token: string
} {
  return {
    token: generateMockJwt({ address, chainId }),
  }
}

/**
 * Mock refresh response with new JWT token.
 */
export function mockRefreshResponse(oldToken: string): {
  token: string
} {
  // Extract address from old token for the new token
  try {
    const [, payload] = oldToken.split('.')
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return {
      token: generateMockJwt({
        address: decoded.address,
        chainId: decoded.chainId,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    }
  } catch {
    return {
      token: generateMockJwt({}),
    }
  }
}
