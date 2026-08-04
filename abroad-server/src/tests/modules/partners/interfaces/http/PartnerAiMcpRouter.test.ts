import 'reflect-metadata'

import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { OutboxStatus, TransactionStatus, WebhookDeliveryPurpose } from '@prisma/client'
import express from 'express'
import { once } from 'node:events'

import { ILogger } from '../../../../../core/logging/types'
import { PartnerAiAbuseProtectionService, PartnerAiRateLimitError } from '../../../../../modules/partners/application/PartnerAiAbuseProtectionService'
import { PARTNER_AI_MCP_SERVER_VERSION } from '../../../../../modules/partners/application/partnerAiConfiguration'
import { PartnerAiConnectionService } from '../../../../../modules/partners/application/PartnerAiConnectionService'
import { PartnerAiScopeName } from '../../../../../modules/partners/application/partnerAiScopes'
import { PartnerAiAccessPrincipal, PartnerAiTokenService } from '../../../../../modules/partners/application/PartnerAiTokenService'
import { PartnerAiToolService } from '../../../../../modules/partners/application/PartnerAiToolService'
import { PartnerAiWebhookDiagnostics } from '../../../../../modules/partners/application/PartnerAiWebhookDiagnosticsService'
import { PartnerPortalAuditService } from '../../../../../modules/partners/application/PartnerPortalAuditService'
import { PartnerAiMcpRouter } from '../../../../../modules/partners/interfaces/http/PartnerAiMcpRouter'
import {
  PartnerTransactionDetailDto,
  PartnerTransactionListResponse,
  PartnerTransactionNotFoundError,
  PartnerTransactionQueryValidationError,
  PartnerTransactionSummaryDto,
} from '../../../../../modules/transactions/application/PartnerTransactionQueryService'
import { WebhookEvent } from '../../../../../platform/notifications/IWebhookNotifier'

const allScopes: PartnerAiScopeName[] = [
  'account:read',
  'docs:read',
  'requests:validate',
  'transactions:read',
  'webhooks:read',
]

const principalWith = (scopes: PartnerAiScopeName[]): PartnerAiAccessPrincipal => ({
  accessTokenId: 'access-token-id',
  clientId: 'abroad_mcp_client_public',
  clientName: 'Operations Assistant',
  connectionExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
  connectionId: 'connection-1',
  partnerId: 'partner-1',
  partnerName: 'Atlas Payments',
  scopes,
  tokenExpiresAt: new Date('2026-08-02T19:00:00.000Z'),
})

// Typed against the real DTOs on purpose: TypeScript then guarantees these
// fixtures track the services, and the schema assertions below turn that into a
// guard on the declared MCP output schemas.
const transactionSummary: PartnerTransactionSummaryDto = {
  createdAt: new Date('2026-08-01T10:00:00.000Z'),
  id: '0f1d3a5c-1111-4222-8333-444455556666',
  onChainId: 'stellar-hash',
  quote: {
    country: 'BR',
    cryptoCurrency: 'USDC',
    network: 'STELLAR',
    paymentMethod: 'PIX',
    sourceAmount: 100.5,
    targetAmount: 512.75,
    targetCurrency: 'BRL',
  },
  status: TransactionStatus.PAYMENT_FAILED,
  userReference: 'partner-user-1',
}

const transactionDetail: PartnerTransactionDetailDto = {
  ...transactionSummary,
  deliveries: [{
    attempts: 3,
    canRedeliver: true,
    durationMs: 1_204,
    event: WebhookEvent.TRANSACTION_UPDATED,
    failureCode: 'http_error',
    httpStatus: 500,
    id: 'delivery-1',
    lastAttemptAt: new Date('2026-08-01T10:05:00.000Z'),
    nextAttemptAt: null,
    purpose: WebhookDeliveryPurpose.TRANSACTION,
    sourceDeliveryId: null,
    status: OutboxStatus.FAILED,
  }],
  failureReason: 'The payout provider reported that the payment failed.',
  lifecycle: [{
    occurredAt: new Date('2026-08-01T10:00:00.000Z'),
    status: TransactionStatus.AWAITING_PAYMENT,
    type: 'CREATED',
  }],
  payoutDestinationHint: '•••• 4321',
  pixEndToEndId: 'E12345678202608011000',
  refund: { onChainId: null, status: 'NOT_STARTED' },
}

const transactionList: PartnerTransactionListResponse = {
  items: [transactionSummary],
  page: 1,
  pageSize: 20,
  statusCounts: [{ count: 1, status: TransactionStatus.PAYMENT_FAILED }],
  total: 1,
}

const webhookDiagnostics: PartnerAiWebhookDiagnostics = {
  configured: true,
  deliveries: [
    { count: 4, status: OutboxStatus.DELIVERED },
    { count: 1, status: OutboxStatus.FAILED },
  ],
  destinationHost: 'partner.example',
  latest: {
    attemptedAt: new Date('2026-08-01T10:05:00.000Z'),
    durationMs: 1_204,
    failureCode: 'HTTP_REJECTED',
    httpStatus: 500,
    status: OutboxStatus.FAILED,
  },
  lookbackHours: 24,
}

const buildHarness = async (scopes: PartnerAiScopeName[] = ['account:read', 'docs:read']) => {
  const principal = principalWith(scopes)
  const authenticateAccessToken = jest.fn(async () => principal)
  const getAccountMetadata = jest.fn(() => ({
    connectionId: 'connection-1',
    organizationName: 'Atlas Payments',
    resource: 'https://api.abroad.finance/mcp',
    scopes,
    serverVersion: PARTNER_AI_MCP_SERVER_VERSION,
    status: 'ACTIVE',
  }))
  const searchDocumentation = jest.fn(() => ({
    matched: true,
    results: [{ excerpt: 'Validate webhook signatures.', title: 'Webhooks', url: 'https://abroad-docs.web.app/reference/webhooks' }],
  }))
  const getTransaction = jest.fn(async () => transactionDetail)
  const listTransactions = jest.fn(async () => transactionList)
  const getWebhookDiagnostics = jest.fn(async () => webhookDiagnostics)
  const validateRequest = jest.fn(() => ({
    issues: [{ code: 'invalid_type', message: 'Required', path: 'account_number' }],
    valid: false,
  }))
  const assertToolCallAllowed = jest.fn(async () => undefined)
  const record = jest.fn(async () => undefined)
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
    { assertToolCallAllowed } as unknown as PartnerAiAbuseProtectionService,
    { record } as unknown as PartnerPortalAuditService,
    { error, warn } as unknown as ILogger,
  )
  const app = express()
  app.use(express.json({ limit: '64kb' }))
  app.use(router.router)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  return {
    assertToolCallAllowed,
    authenticateAccessToken,
    baseUrl: `http://127.0.0.1:${address.port}`,
    error,
    getAccountMetadata,
    getTransaction,
    getWebhookDiagnostics,
    listTransactions,
    principal,
    record,
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

type ToolCallPayload = {
  result?: {
    content: Array<{ text: string }>
    isError?: boolean
    structuredContent?: Record<string, unknown>
  }
}

const callTool = async (
  baseUrl: string,
  name: string,
  args: Readonly<Record<string, unknown>> = {},
): Promise<ToolCallPayload> => {
  const response = await mcpRequest(baseUrl, {
    id: 10,
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { arguments: args, name },
  })
  expect(response.status).toBe(200)
  return await response.json() as ToolCallPayload
}

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
      expect(harness.assertToolCallAllowed).not.toHaveBeenCalled()
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
          serverInfo: { name: 'abroad-partner-ai', version: PARTNER_AI_MCP_SERVER_VERSION },
        }),
      }))
      expect(tools.status).toBe(200)
      const toolsPayload = await tools.json() as {
        result: { tools: Array<{ annotations: { readOnlyHint: boolean }, name: string, outputSchema?: unknown }> }
      }
      expect(toolsPayload.result.tools.map(tool => tool.name).sort()).toEqual([
        'get_account_metadata',
        'search_documentation',
      ])
      expect(toolsPayload.result.tools.every(tool => tool.annotations.readOnlyHint)).toBe(true)
      expect(toolsPayload.result.tools.every(tool => tool.outputSchema)).toBe(true)
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
      const payload = await callTool(harness.baseUrl, 'get_account_metadata')

      expect(payload.result?.structuredContent).toEqual(expect.objectContaining({
        organizationName: 'Atlas Payments',
        status: 'ACTIVE',
      }))
      expect(JSON.stringify(payload)).not.toContain('transactionId')
      expect(harness.getAccountMetadata).toHaveBeenCalledWith(harness.principal)
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

  it('meters authenticated tool traffic and surfaces a retryable rejection', async () => {
    const harness = await buildHarness(allScopes)
    harness.assertToolCallAllowed.mockRejectedValueOnce(new PartnerAiRateLimitError(42))
    try {
      const response = await mcpRequest(harness.baseUrl, {
        id: 5,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: { page: 1 }, name: 'list_transactions' },
      })

      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBe('42')
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        error: expect.objectContaining({ data: { retryAfterSeconds: 42 } }),
      }))
      expect(harness.assertToolCallAllowed).toHaveBeenCalledWith('connection-1', 'partner-1')
      expect(harness.listTransactions).not.toHaveBeenCalled()
    }
    finally {
      await closeServer(harness.server)
    }
  })

  it('returns schema-valid structured content for every granted tenant-scoped tool', async () => {
    const harness = await buildHarness(allScopes)
    try {
      const list = await callTool(harness.baseUrl, 'list_transactions', { page: 1, pageSize: 20 })
      const detail = await callTool(harness.baseUrl, 'get_transaction', {
        transactionId: transactionSummary.id,
      })
      const diagnostics = await callTool(harness.baseUrl, 'get_webhook_diagnostics', { lookbackHours: 24 })
      const validation = await callTool(harness.baseUrl, 'validate_api_request', {
        operation: 'ACCEPT_TRANSACTION',
        payload: { quote_id: 'quote-1' },
      })
      const documentation = await callTool(harness.baseUrl, 'search_documentation', { query: 'webhooks' })

      // A schema mismatch surfaces as isError, so this asserts the declared
      // output schemas still describe what the services actually return.
      for (const payload of [list, detail, diagnostics, validation, documentation]) {
        expect(payload.result?.isError).toBeFalsy()
        expect(payload.result?.structuredContent).toBeDefined()
      }
      expect(list.result?.structuredContent).toEqual(expect.objectContaining({ total: 1 }))
      expect(detail.result?.structuredContent).toEqual(expect.objectContaining({
        createdAt: '2026-08-01T10:00:00.000Z',
        pixEndToEndId: 'E12345678202608011000',
      }))
      expect(diagnostics.result?.structuredContent).toEqual(expect.objectContaining({ configured: true }))
      expect(validation.result?.structuredContent).toEqual(expect.objectContaining({ valid: false }))
      expect(harness.listTransactions).toHaveBeenCalledWith(harness.principal, expect.objectContaining({
        page: 1,
        pageSize: 20,
      }))
      expect(harness.getTransaction).toHaveBeenCalledWith(harness.principal, transactionSummary.id)
    }
    finally {
      await closeServer(harness.server)
    }
  })

  it('audits tenant ledger reads but not documentation or validation calls', async () => {
    const harness = await buildHarness(allScopes)
    try {
      await callTool(harness.baseUrl, 'get_transaction', { transactionId: transactionSummary.id })
      await callTool(harness.baseUrl, 'search_documentation', { query: 'webhooks' })
      await callTool(harness.baseUrl, 'validate_api_request', {
        operation: 'CREATE_QUOTE',
        payload: {},
      })

      expect(harness.record).toHaveBeenCalledTimes(1)
      expect(harness.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'AI_TOOL_INVOKED',
        metadata: expect.objectContaining({
          connectionId: 'connection-1',
          source: 'MCP',
          tool: 'get_transaction',
        }),
        partnerId: 'partner-1',
        resourceId: transactionSummary.id,
        resourceType: 'AI_TOOL_CALL',
      }))
    }
    finally {
      await closeServer(harness.server)
    }
  })

  it('tells the model what to correct instead of returning one opaque failure', async () => {
    const harness = await buildHarness(allScopes)
    harness.getTransaction.mockRejectedValueOnce(new PartnerTransactionNotFoundError())
    harness.listTransactions.mockRejectedValueOnce(
      new PartnerTransactionQueryValidationError('Start date must be on or before end date'),
    )
    harness.getWebhookDiagnostics.mockRejectedValueOnce(new Error('connection terminated unexpectedly'))
    try {
      const missing = await callTool(harness.baseUrl, 'get_transaction', {
        transactionId: transactionSummary.id,
      })
      const invalid = await callTool(harness.baseUrl, 'list_transactions', { page: 1 })
      const unknown = await callTool(harness.baseUrl, 'get_webhook_diagnostics', { lookbackHours: 24 })

      expect(missing.result?.isError).toBe(true)
      expect(missing.result?.content[0].text).toContain('list_transactions')
      expect(invalid.result?.isError).toBe(true)
      expect(invalid.result?.content[0].text).toContain('Start date must be on or before end date')
      // Unknown failures stay opaque and are the only ones worth logging.
      expect(unknown.result?.isError).toBe(true)
      expect(unknown.result?.content[0].text).not.toContain('connection terminated')
      expect(harness.warn).toHaveBeenCalledTimes(1)
    }
    finally {
      await closeServer(harness.server)
    }
  })

  it('offers the diagnosis playbook only to connections that can read transactions', async () => {
    const granted = await buildHarness(allScopes)
    const withheld = await buildHarness(['account:read', 'docs:read'])
    try {
      const prompts = await mcpRequest(granted.baseUrl, {
        id: 6,
        jsonrpc: '2.0',
        method: 'prompts/list',
        params: {},
      })
      const promptsPayload = await prompts.json() as {
        result: { prompts: Array<{ name: string }> }
      }
      const rendered = await mcpRequest(granted.baseUrl, {
        id: 7,
        jsonrpc: '2.0',
        method: 'prompts/get',
        params: {
          arguments: { transactionId: transactionSummary.id },
          name: 'diagnose_failed_transaction',
        },
      })
      const renderedPayload = await rendered.json() as {
        result: { messages: Array<{ content: { text: string } }> }
      }
      const withheldPrompts = await mcpRequest(withheld.baseUrl, {
        id: 8,
        jsonrpc: '2.0',
        method: 'prompts/list',
        params: {},
      })

      expect(promptsPayload.result.prompts.map(prompt => prompt.name)).toEqual([
        'diagnose_failed_transaction',
      ])
      const text = renderedPayload.result.messages[0].content.text
      expect(text).toContain(transactionSummary.id)
      expect(text).toContain('get_webhook_diagnostics')
      // Without webhooks:read the playbook must not send the model to a tool it cannot call.
      expect(JSON.stringify(await withheldPrompts.json())).not.toContain('diagnose_failed_transaction')
    }
    finally {
      await closeServer(granted.server)
      await closeServer(withheld.server)
    }
  })
})
