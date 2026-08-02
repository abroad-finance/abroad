import 'reflect-metadata'

import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import express from 'express'
import { once } from 'node:events'

import { PartnerAiAbuseProtectionService, PartnerAiRateLimitError } from '../../../../../modules/partners/application/PartnerAiAbuseProtectionService'
import { PartnerAiAuthorizationService } from '../../../../../modules/partners/application/PartnerAiAuthorizationService'
import { PartnerAiTokenService } from '../../../../../modules/partners/application/PartnerAiTokenService'
import { PartnerAiOAuthRouter } from '../../../../../modules/partners/interfaces/http/PartnerAiOAuthRouter'

const buildHarness = async () => {
  const createAuthorizationRequest = jest.fn(async () => (
    'https://app.abroad.finance/partner/integration/ai/authorize?request=11111111-1111-4111-8111-111111111111'
  ))
  const registerClient = jest.fn(async () => ({
    client_id: 'abroad_mcp_client_public',
    client_id_issued_at: 1_785_690_000,
    client_name: 'Operations Assistant',
    grant_types: ['authorization_code', 'refresh_token'] as const,
    redirect_uris: ['https://assistant.example/callback'],
    response_types: ['code'] as const,
    scope: 'account:read docs:read',
    token_endpoint_auth_method: 'none' as const,
  }))
  const exchange = jest.fn(async () => ({
    access_token: 'returned-access-token',
    expires_in: 3_600,
    scope: 'account:read',
    token_type: 'Bearer' as const,
  }))
  const revoke = jest.fn(async () => undefined)
  const assertTokenRequestAllowed = jest.fn(async () => undefined)
  const router = new PartnerAiOAuthRouter(
    { createAuthorizationRequest, registerClient } as unknown as PartnerAiAuthorizationService,
    { exchange, revoke } as unknown as PartnerAiTokenService,
    { assertTokenRequestAllowed } as unknown as PartnerAiAbuseProtectionService,
  )
  const app = express()
  app.use(express.json({ limit: '32kb' }))
  app.use(router.router)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  return {
    assertTokenRequestAllowed,
    baseUrl: `http://127.0.0.1:${address.port}`,
    createAuthorizationRequest,
    exchange,
    registerClient,
    revoke,
    server,
  }
}

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
}

describe('PartnerAiOAuthRouter', () => {
  it('publishes resource and authorization metadata for credential-free discovery', async () => {
    const harness = await buildHarness()
    try {
      const protectedResource = await fetch(
        `${harness.baseUrl}/.well-known/oauth-protected-resource/mcp`,
      )
      const authorizationServer = await fetch(
        `${harness.baseUrl}/.well-known/oauth-authorization-server`,
      )

      await expect(protectedResource.json()).resolves.toEqual(expect.objectContaining({
        authorization_servers: ['https://api.abroad.finance'],
        resource: 'https://api.abroad.finance/mcp',
        resource_documentation: 'https://api.abroad.finance/ai-integration',
      }))
      await expect(authorizationServer.json()).resolves.toEqual(expect.objectContaining({
        authorization_endpoint: 'https://api.abroad.finance/oauth/authorize',
        code_challenge_methods_supported: ['S256'],
        registration_endpoint: 'https://api.abroad.finance/oauth/register',
        token_endpoint_auth_methods_supported: ['none'],
      }))
    }
    finally {
      await closeServer(harness.server)
    }
  })

  it('registers a public client and uses only the trusted ingress address for abuse controls', async () => {
    const harness = await buildHarness()
    try {
      const response = await fetch(`${harness.baseUrl}/oauth/register`, {
        body: JSON.stringify({
          client_name: 'Operations Assistant',
          redirect_uris: ['https://assistant.example/callback'],
          scope: 'account:read docs:read',
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.0.2.200, 203.0.113.20, 35.191.0.1',
        },
        method: 'POST',
      })

      expect(response.status).toBe(201)
      expect(response.headers.get('cache-control')).toBe('no-store')
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        client_id: 'abroad_mcp_client_public',
        token_endpoint_auth_method: 'none',
      }))
      expect(harness.registerClient).toHaveBeenCalledWith(expect.objectContaining({
        clientName: 'Operations Assistant',
      }), '203.0.113.20')
    }
    finally {
      await closeServer(harness.server)
    }
  })

  it('never redirects malformed authorization input to an unvalidated client destination', async () => {
    const harness = await buildHarness()
    try {
      const query = new URLSearchParams({
        client_id: 'abroad_mcp_client_public',
        code_challenge: 'a'.repeat(43),
        code_challenge_method: 'S256',
        redirect_uri: 'https://attacker.example/callback',
        resource: 'https://api.abroad.finance/not-mcp',
        response_type: 'code',
        scope: 'account:read',
        state: 'sensitive-state',
      })
      const response = await fetch(`${harness.baseUrl}/oauth/authorize?${query.toString()}`, {
        redirect: 'manual',
      })

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe(
        'https://app.abroad.finance/partner/integration/ai/authorize?error=unsupported-client',
      )
      expect(response.headers.get('location')).not.toContain('sensitive-state')
      expect(response.headers.get('location')).not.toContain('attacker.example')
      expect(harness.createAuthorizationRequest).not.toHaveBeenCalled()
    }
    finally {
      await closeServer(harness.server)
    }
  })

  it('redirects a valid PKCE request only to the Abroad consent page', async () => {
    const harness = await buildHarness()
    try {
      const query = new URLSearchParams({
        client_id: 'abroad_mcp_client_public',
        code_challenge: 'a'.repeat(43),
        code_challenge_method: 'S256',
        redirect_uri: 'https://assistant.example/callback',
        resource: 'https://api.abroad.finance/mcp',
        response_type: 'code',
        scope: 'account:read transactions:read',
        state: 'opaque-state',
      })
      const response = await fetch(`${harness.baseUrl}/oauth/authorize?${query.toString()}`, {
        headers: { 'X-Forwarded-For': '203.0.113.20, 35.191.0.1' },
        redirect: 'manual',
      })

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toContain(
        'https://app.abroad.finance/partner/integration/ai/authorize?request=',
      )
      expect(harness.createAuthorizationRequest).toHaveBeenCalledWith(expect.objectContaining({
        redirectUri: 'https://assistant.example/callback',
        resource: 'https://api.abroad.finance/mcp',
        state: 'opaque-state',
      }), '203.0.113.20')
    }
    finally {
      await closeServer(harness.server)
    }
  })

  it('accepts only a strict form token grant and applies no-store responses', async () => {
    const harness = await buildHarness()
    try {
      const response = await fetch(`${harness.baseUrl}/oauth/token`, {
        body: new URLSearchParams({
          client_id: 'abroad_mcp_client_public',
          code: 'c'.repeat(43),
          code_verifier: 'v'.repeat(43),
          grant_type: 'authorization_code',
          redirect_uri: 'https://assistant.example/callback',
          resource: 'https://api.abroad.finance/mcp',
        }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Forwarded-For': '203.0.113.20, 35.191.0.1',
        },
        method: 'POST',
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('pragma')).toBe('no-cache')
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        access_token: 'returned-access-token',
        token_type: 'Bearer',
      }))
      expect(harness.exchange).toHaveBeenCalledWith(expect.objectContaining({
        grant_type: 'authorization_code',
      }), '203.0.113.20')
    }
    finally {
      await closeServer(harness.server)
    }
  })

  it('returns a bounded retry response when public registration is rate-limited', async () => {
    const harness = await buildHarness()
    harness.registerClient.mockRejectedValueOnce(new PartnerAiRateLimitError(120))
    try {
      const response = await fetch(`${harness.baseUrl}/oauth/register`, {
        body: JSON.stringify({
          client_name: 'Operations Assistant',
          redirect_uris: ['https://assistant.example/callback'],
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })

      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBe('120')
      await expect(response.json()).resolves.toEqual({
        error: 'temporarily_unavailable',
        error_description: 'Client registration is temporarily limited',
      })
    }
    finally {
      await closeServer(harness.server)
    }
  })
})
