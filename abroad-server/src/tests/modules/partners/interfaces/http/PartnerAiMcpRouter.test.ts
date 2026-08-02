import 'reflect-metadata'

import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import express from 'express'
import { once } from 'node:events'

import { ILogger } from '../../../../../core/logging/types'
import { PartnerAiConnectionService } from '../../../../../modules/partners/application/PartnerAiConnectionService'
import { PartnerAiAccessPrincipal, PartnerAiTokenService } from '../../../../../modules/partners/application/PartnerAiTokenService'
import { PartnerAiToolService } from '../../../../../modules/partners/application/PartnerAiToolService'
import { PartnerAiMcpRouter } from '../../../../../modules/partners/interfaces/http/PartnerAiMcpRouter'

const principal: PartnerAiAccessPrincipal = {
  accessTokenId: 'access-token-id',
  clientId: 'abroad_mcp_client_public',
  clientName: 'Operations Assistant',
  connectionExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
  connectionId: 'connection-1',
  partnerId: 'partner-1',
  partnerName: 'Atlas Payments',
  scopes: ['account:read', 'docs:read'],
  tokenExpiresAt: new Date('2026-08-02T19:00:00.000Z'),
}

const buildHarness = async () => {
  const authenticateAccessToken = jest.fn(async () => principal)
  const getAccountMetadata = jest.fn(() => ({
    connectionId: 'connection-1',
    organizationName: 'Atlas Payments',
    resource: 'https://api.abroad.finance/mcp',
    scopes: ['account:read', 'docs:read'],
    serverVersion: '1.0.0',
    status: 'ACTIVE',
  }))
  const searchDocumentation = jest.fn(() => ({ results: [] }))
  const getTransaction = jest.fn()
  const listTransactions = jest.fn()
  const getWebhookDiagnostics = jest.fn()
  const validateRequest = jest.fn()
  const warn = jest.fn()
  const error = jest.fn()
  const router = new PartnerAiMcpRouter(
    { authenticateAccessToken } as unknown as PartnerAiTokenService,
    { getAccountMetadata } as unknown as PartnerAiConnectionService,
    {
      getTransaction,
      getWebhookDiagnostics,
      listTransactions,
      searchDocumentation,
      validateRequest,
    } as unknown as PartnerAiToolService,
    { error, warn } as unknown as ILogger,
  )
  const app = express()
  app.use(express.json({ limit: '64kb' }))
  app.use(router.router)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  return {
    authenticateAccessToken,
    baseUrl: `http://127.0.0.1:${address.port}`,
    error,
    getAccountMetadata,
    getTransaction,
    getWebhookDiagnostics,
    listTransactions,
    searchDocumentation,
    server,
    validateRequest,
    warn,
  }
}

const closeServer = async (server: Server): Promise<void> => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
}

const mcpRequest = async (
  baseUrl: string,
  body: Readonly<Record<string, unknown>>,
  accessToken = 'valid-access-token',
): Promise<Response> => fetch(`${baseUrl}/mcp`, {
  body: JSON.stringify(body),
  headers: {
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': '2025-06-18',
  },
  method: 'POST',
})

describe('PartnerAiMcpRouter', () => {
  it('publishes a protected stateless endpoint with a resource-metadata challenge', async () => {
    const harness = await buildHarness()
    try {
      const unauthorized = await fetch(`${harness.baseUrl}/mcp`, {
        body: JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'tools/list',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const getResponse = await fetch(`${harness.baseUrl}/mcp`)

      expect(unauthorized.status).toBe(401)
      expect(unauthorized.headers.get('www-authenticate')).toBe(
        'Bearer resource_metadata="https://api.abroad.finance/.well-known/oauth-protected-resource/mcp"',
      )
      await expect(unauthorized.json()).resolves.toEqual(expect.objectContaining({
        error: expect.objectContaining({ message: 'Authorization required' }),
        jsonrpc: '2.0',
      }))
      expect(getResponse.status).toBe(405)
      expect(harness.authenticateAccessToken).not.toHaveBeenCalled()
    }
    finally {
      await closeServer(harness.server)
    }
  })

  it('negotiates MCP and exposes only tools granted by the access token', async () => {
    const harness = await buildHarness()
    try {
      const initialize = await mcpRequest(harness.baseUrl, {
        id: 1,
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
          protocolVersion: '2025-06-18',
        },
      })
      const tools = await mcpRequest(harness.baseUrl, {
        id: 2,
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
      })

      expect(initialize.status).toBe(200)
      await expect(initialize.json()).resolves.toEqual(expect.objectContaining({
        result: expect.objectContaining({
          serverInfo: { name: 'abroad-partner-ai', version: '1.0.0' },
        }),
      }))
      expect(tools.status).toBe(200)
      const toolsPayload = await tools.json() as {
        result: { tools: Array<{ annotations: { readOnlyHint: boolean }, name: string }> }
      }
      expect(toolsPayload.result.tools.map(tool => tool.name).sort()).toEqual([
        'get_account_metadata',
        'search_documentation',
      ])
      expect(toolsPayload.result.tools.every(tool => tool.annotations.readOnlyHint)).toBe(true)
      expect(JSON.stringify(toolsPayload)).not.toContain('get_transaction')
      expect(JSON.stringify(toolsPayload)).not.toContain('validate_api_request')
      expect(harness.authenticateAccessToken).toHaveBeenCalledWith('valid-access-token')
    }
    finally {
      await closeServer(harness.server)
    }
  })

  it('performs the safe account-metadata connection test without any financial or diagnostic read', async () => {
    const harness = await buildHarness()
    try {
      const response = await mcpRequest(harness.baseUrl, {
        id: 3,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {},
          name: 'get_account_metadata',
        },
      })

      expect(response.status).toBe(200)
      const payload = await response.json()
      expect(JSON.stringify(payload)).toContain('Atlas Payments')
      expect(JSON.stringify(payload)).not.toContain('transactionId')
      expect(JSON.stringify(payload)).not.toContain('webhook')
      expect(harness.getAccountMetadata).toHaveBeenCalledWith(principal)
      expect(harness.getTransaction).not.toHaveBeenCalled()
      expect(harness.listTransactions).not.toHaveBeenCalled()
      expect(harness.getWebhookDiagnostics).not.toHaveBeenCalled()
      expect(harness.validateRequest).not.toHaveBeenCalled()
    }
    finally {
      await closeServer(harness.server)
    }
  })

  it('rejects an invalid access token without logging or reflecting it', async () => {
    const harness = await buildHarness()
    harness.authenticateAccessToken.mockRejectedValueOnce(new Error('invalid token'))
    try {
      const response = await mcpRequest(harness.baseUrl, {
        id: 4,
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
      }, 'secret-invalid-token')

      expect(response.status).toBe(401)
      expect(JSON.stringify(await response.json())).not.toContain('secret-invalid-token')
      expect(harness.warn).not.toHaveBeenCalled()
      expect(harness.error).not.toHaveBeenCalled()
    }
    finally {
      await closeServer(harness.server)
    }
  })
})
