import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { TransactionStatus } from '@prisma/client'
import { Request, Response, Router } from 'express'
import { z } from 'zod'

import type { PartnerAiAccessPrincipal } from '../../application/PartnerAiTokenService'

import { ILogger } from '../../../../core/logging/types'
import { PartnerAiConnectionService } from '../../application/PartnerAiConnectionService'
import { PartnerAiTokenService } from '../../application/PartnerAiTokenService'
import { PartnerAiToolService, partnerAiValidationOperations } from '../../application/PartnerAiToolService'

const partnerTransactionStatuses = [
  TransactionStatus.AWAITING_PAYMENT,
  TransactionStatus.PROCESSING_PAYMENT,
  TransactionStatus.PAYMENT_FAILED,
  TransactionStatus.PAYMENT_EXPIRED,
  TransactionStatus.PAYMENT_COMPLETED,
  TransactionStatus.WRONG_AMOUNT,
] as const

const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
} as const

const jsonContent = (value: unknown) => ({
  content: [{ text: JSON.stringify(value), type: 'text' as const }],
})

const safeToolFailure = () => ({
  content: [{
    text: 'The read-only Abroad request could not be completed. Verify the input and try again.',
    type: 'text' as const,
  }],
  isError: true,
})

const extractBearerToken = (request: Request): null | string => {
  const authorization = request.header('authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  const token = authorization.slice('Bearer '.length).trim()
  return token || null
}

export class PartnerAiMcpRouter {
  public readonly router: Router

  public constructor(
    private readonly tokenService: PartnerAiTokenService,
    private readonly connectionService: PartnerAiConnectionService,
    private readonly toolService: PartnerAiToolService,
    private readonly logger: ILogger,
  ) {
    this.router = Router()
    this.router.post('/mcp', (request, response) => {
      void this.handlePost(request, response)
    })
    this.router.get('/mcp', (_request, response) => this.methodNotAllowed(response))
    this.router.delete('/mcp', (_request, response) => this.methodNotAllowed(response))
  }

  private createServer(principal: PartnerAiAccessPrincipal): McpServer {
    const server = new McpServer({ name: 'abroad-partner-ai', version: '1.0.0' })
    const run = async (operation: () => Promise<unknown> | unknown) => {
      try {
        return jsonContent(await operation())
      }
      catch (error) {
        this.logger.warn('[PartnerAiMcp] Read-only tool failed', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        })
        return safeToolFailure()
      }
    }

    if (principal.scopes.includes('account:read')) {
      server.registerTool('get_account_metadata', {
        annotations: readOnlyAnnotations,
        description: 'Verify the Abroad connection by reading organization metadata and granted permissions only.',
        inputSchema: {},
        title: 'Get Abroad account metadata',
      }, async () => run(() => this.connectionService.getAccountMetadata(principal)))
    }

    if (principal.scopes.includes('docs:read')) {
      server.registerTool('search_documentation', {
        annotations: readOnlyAnnotations,
        description: 'Search Abroad public integration documentation. Search text is processed in memory and is not stored.',
        inputSchema: {
          query: z.string().trim().min(2).max(160).describe('Documentation question or keywords'),
        },
        title: 'Search Abroad documentation',
      }, async ({ query }) => run(() => this.toolService.searchDocumentation(query)))
    }

    if (principal.scopes.includes('requests:validate')) {
      server.registerTool('validate_api_request', {
        annotations: readOnlyAnnotations,
        description: 'Validate an Abroad API request body without sending it or creating a financial operation.',
        inputSchema: {
          operation: z.enum(partnerAiValidationOperations),
          payload: z.record(z.string(), z.unknown()).describe('Request body to validate; it is never stored'),
        },
        title: 'Validate an Abroad API request',
      }, async ({ operation, payload }) => run(() => (
        this.toolService.validateRequest(operation, payload)
      )))
    }

    if (principal.scopes.includes('transactions:read')) {
      server.registerTool('list_transactions', {
        annotations: readOnlyAnnotations,
        description: 'List transactions belonging to the connected Abroad organization.',
        inputSchema: {
          createdFrom: z.string().date().optional(),
          createdTo: z.string().date().optional(),
          page: z.number().int().min(1).max(10_000).default(1),
          pageSize: z.number().int().min(1).max(50).default(20),
          query: z.string().trim().max(200).optional(),
          status: z.enum(partnerTransactionStatuses).optional(),
        },
        title: 'List Abroad transactions',
      }, async input => run(() => this.toolService.listTransactions(principal, {
        createdFrom: input.createdFrom,
        createdTo: input.createdTo,
        page: input.page,
        pageSize: input.pageSize,
        query: input.query,
        status: input.status,
      })))
      server.registerTool('get_transaction', {
        annotations: readOnlyAnnotations,
        description: 'Get one tenant-scoped transaction, including lifecycle, PIX E2E, failure, refund, and delivery diagnostics.',
        inputSchema: {
          transactionId: z.string().uuid(),
        },
        title: 'Get an Abroad transaction',
      }, async ({ transactionId }) => run(() => (
        this.toolService.getTransaction(principal, transactionId)
      )))
    }

    if (principal.scopes.includes('webhooks:read')) {
      server.registerTool('get_webhook_diagnostics', {
        annotations: readOnlyAnnotations,
        description: 'Read aggregate webhook delivery health without URLs, payloads, signing secrets, tests, or replays.',
        inputSchema: {
          lookbackHours: z.number().int().min(1).max(168).default(24),
        },
        title: 'Get Abroad webhook diagnostics',
      }, async ({ lookbackHours }) => run(() => (
        this.toolService.getWebhookDiagnostics(principal, lookbackHours)
      )))
    }

    return server
  }

  private async handlePost(request: Request, response: Response): Promise<void> {
    const accessToken = extractBearerToken(request)
    if (!accessToken) {
      this.unauthorized(response)
      return
    }
    let principal: PartnerAiAccessPrincipal
    try {
      principal = await this.tokenService.authenticateAccessToken(accessToken)
    }
    catch {
      this.unauthorized(response)
      return
    }

    const server = this.createServer(principal)
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: undefined,
    })
    response.once('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(request, response, request.body)
    }
    catch (error) {
      this.logger.error('[PartnerAiMcp] Protocol request failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      if (!response.headersSent) {
        response.status(500).json({
          error: { code: -32603, message: 'Internal server error' },
          id: null,
          jsonrpc: '2.0',
        })
      }
    }
  }

  private methodNotAllowed(response: Response): void {
    response.status(405).json({
      error: { code: -32000, message: 'Method not allowed' },
      id: null,
      jsonrpc: '2.0',
    })
  }

  private unauthorized(response: Response): void {
    response
      .set('WWW-Authenticate', 'Bearer resource_metadata="https://api.abroad.finance/.well-known/oauth-protected-resource/mcp"')
      .status(401)
      .json({
        error: { code: -32001, message: 'Authorization required' },
        id: null,
        jsonrpc: '2.0',
      })
  }
}
