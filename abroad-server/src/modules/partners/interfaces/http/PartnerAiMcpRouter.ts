import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { TransactionStatus } from '@prisma/client'
import { Request, Response, Router } from 'express'
import { z } from 'zod'

import type { PartnerAiAccessPrincipal } from '../../application/PartnerAiTokenService'

import { ILogger } from '../../../../core/logging/types'
import { PartnerTransactionNotFoundError, PartnerTransactionQueryValidationError } from '../../../transactions/application/PartnerTransactionQueryService'
import { PartnerAiAbuseProtectionService, PartnerAiRateLimitError } from '../../application/PartnerAiAbuseProtectionService'
import { PARTNER_AI_MCP_SERVER_NAME, PARTNER_AI_MCP_SERVER_VERSION, PARTNER_AI_PROTECTED_RESOURCE_METADATA_URL } from '../../application/partnerAiConfiguration'
import { PartnerAiConnectionService } from '../../application/PartnerAiConnectionService'
import { PartnerAiTokenService } from '../../application/PartnerAiTokenService'
import { PartnerAiToolService, partnerAiValidationOperations } from '../../application/PartnerAiToolService'
import { PartnerPortalAuditService } from '../../application/PartnerPortalAuditService'
import {
  accountMetadataOutputSchema,
  documentationOutputSchema,
  transactionDetailOutputSchema,
  transactionListOutputSchema,
  validationOutputSchema,
  webhookDiagnosticsOutputSchema,
} from './partnerAiMcpSchemas'

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

const GENERIC_TOOL_FAILURE = 'The read-only Abroad request could not be completed. Verify the input and try again.'

// The SDK validates `structuredContent` against the declared output schema, and
// Date instances are not what a client receives over the wire. Normalising
// through JSON makes the validated value identical to the transmitted one.
const toolResult = (value: unknown) => {
  const serialized = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  return {
    content: [{ text: JSON.stringify(serialized), type: 'text' as const }],
    structuredContent: serialized,
  }
}

const toolFailure = (text: string) => ({
  content: [{ text, type: 'text' as const }],
  isError: true,
})

// A single opaque failure string leaves the calling model unable to tell a bad
// argument from an outage, so it retries the same call. These errors are
// already partner-safe and carry no tenant data.
const describeToolError = (error: unknown): null | string => {
  if (error instanceof PartnerTransactionNotFoundError) {
    return 'No transaction with that id belongs to this organization. Confirm the id, or use list_transactions to find it.'
  }
  if (error instanceof PartnerTransactionQueryValidationError) {
    return `The arguments were rejected: ${error.message}`
  }
  if (error instanceof PartnerAiRateLimitError) {
    return `This connection is temporarily rate limited. Retry after ${error.retryAfterSeconds} seconds.`
  }
  return null
}

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
    private readonly abuseProtectionService: PartnerAiAbuseProtectionService,
    private readonly auditService: PartnerPortalAuditService,
    private readonly logger: ILogger,
  ) {
    this.router = Router()
    this.router.post('/mcp', (request, response) => {
      void this.handlePost(request, response)
    })
    this.router.get('/mcp', (_request, response) => this.methodNotAllowed(response))
    this.router.delete('/mcp', (_request, response) => this.methodNotAllowed(response))
  }

  /**
   * Records that an AI client read tenant data. Reads of the transaction ledger
   * and delivery diagnostics are auditable events for a payments operator; the
   * documentation and validation tools touch no tenant state and are skipped.
   */
  private async audit(
    principal: PartnerAiAccessPrincipal,
    tool: string,
    resourceId?: string,
  ): Promise<void> {
    try {
      await this.auditService.record({
        action: 'AI_TOOL_INVOKED',
        metadata: {
          clientId: principal.clientId,
          clientName: principal.clientName,
          connectionId: principal.connectionId,
          source: 'MCP',
          tool,
        },
        partnerId: principal.partnerId,
        resourceId: resourceId ?? principal.connectionId,
        resourceType: 'AI_TOOL_CALL',
      })
    }
    catch (error) {
      this.logger.warn('[PartnerAiMcp] Failed to record tool audit event', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        tool,
      })
    }
  }

  private createServer(principal: PartnerAiAccessPrincipal): McpServer {
    const server = new McpServer({
      name: PARTNER_AI_MCP_SERVER_NAME,
      version: PARTNER_AI_MCP_SERVER_VERSION,
    })
    const run = async (operation: () => Promise<unknown> | unknown) => {
      try {
        return toolResult(await operation())
      }
      catch (error) {
        const described = describeToolError(error)
        if (described) return toolFailure(described)
        this.logger.warn('[PartnerAiMcp] Read-only tool failed', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        })
        return toolFailure(GENERIC_TOOL_FAILURE)
      }
    }

    if (principal.scopes.includes('account:read')) {
      server.registerTool('get_account_metadata', {
        annotations: readOnlyAnnotations,
        description: 'Verify the Abroad connection by reading organization metadata and granted permissions only.',
        inputSchema: {},
        outputSchema: accountMetadataOutputSchema,
        title: 'Get Abroad account metadata',
      }, async () => run(() => this.connectionService.getAccountMetadata(principal)))
    }

    if (principal.scopes.includes('docs:read')) {
      server.registerTool('search_documentation', {
        annotations: readOnlyAnnotations,
        description: 'Search Abroad public integration documentation covering quotes, transactions, payouts, webhooks, supported assets, and limits. Returns the documentation index when nothing matches. Search text is processed in memory and is not stored.',
        inputSchema: {
          query: z.string().trim().min(2).max(160).describe('Documentation question or keywords'),
        },
        outputSchema: documentationOutputSchema,
        title: 'Search Abroad documentation',
      }, async ({ query }) => run(() => this.toolService.searchDocumentation(query)))
    }

    if (principal.scopes.includes('requests:validate')) {
      server.registerTool('validate_api_request', {
        annotations: readOnlyAnnotations,
        description: 'Validate an Abroad API request body without sending it or creating a financial operation. Returns the specific fields that would be rejected.',
        inputSchema: {
          operation: z.enum(partnerAiValidationOperations)
            .describe('The Abroad API operation the payload is intended for'),
          payload: z.record(z.string(), z.unknown()).describe('Request body to validate; it is never stored'),
        },
        outputSchema: validationOutputSchema,
        title: 'Validate an Abroad API request',
      }, async ({ operation, payload }) => run(() => (
        this.toolService.validateRequest(operation, payload)
      )))
    }

    if (principal.scopes.includes('transactions:read')) {
      server.registerTool('list_transactions', {
        annotations: readOnlyAnnotations,
        description: 'List transactions belonging to the connected Abroad organization, newest first. Also returns counts per status across the whole filtered set.',
        inputSchema: {
          createdFrom: z.string().date().optional()
            .describe('Earliest creation date, inclusive, as YYYY-MM-DD'),
          createdTo: z.string().date().optional()
            .describe('Latest creation date, exclusive, as YYYY-MM-DD'),
          page: z.number().int().min(1).max(10_000).default(1),
          pageSize: z.number().int().min(1).max(50).default(20),
          query: z.string().trim().max(200).optional()
            .describe('Case-insensitive partial match against transaction id, on-chain id, PIX end-to-end id, refund on-chain id, and the partner-supplied user id'),
          status: z.enum(partnerTransactionStatuses).optional()
            .describe('Restrict results to one lifecycle status; statusCounts still covers every status'),
        },
        outputSchema: transactionListOutputSchema,
        title: 'List Abroad transactions',
      }, async input => run(async () => {
        await this.audit(principal, 'list_transactions')
        return this.toolService.listTransactions(principal, {
          createdFrom: input.createdFrom,
          createdTo: input.createdTo,
          page: input.page,
          pageSize: input.pageSize,
          query: input.query,
          status: input.status,
        })
      }))
      server.registerTool('get_transaction', {
        annotations: readOnlyAnnotations,
        description: 'Get one tenant-scoped transaction, including lifecycle, PIX E2E, failure, refund, and delivery diagnostics.',
        inputSchema: {
          transactionId: z.string().uuid()
            .describe('Abroad transaction id; use list_transactions to find one'),
        },
        outputSchema: transactionDetailOutputSchema,
        title: 'Get an Abroad transaction',
      }, async ({ transactionId }) => run(async () => {
        await this.audit(principal, 'get_transaction', transactionId)
        return this.toolService.getTransaction(principal, transactionId)
      }))
    }

    if (principal.scopes.includes('webhooks:read')) {
      server.registerTool('get_webhook_diagnostics', {
        annotations: readOnlyAnnotations,
        description: 'Read aggregate webhook delivery health without URLs, payloads, signing secrets, tests, or replays.',
        inputSchema: {
          lookbackHours: z.number().int().min(1).max(168).default(24)
            .describe('How far back to aggregate, between 1 and 168 hours'),
        },
        outputSchema: webhookDiagnosticsOutputSchema,
        title: 'Get Abroad webhook diagnostics',
      }, async ({ lookbackHours }) => run(async () => {
        await this.audit(principal, 'get_webhook_diagnostics')
        return this.toolService.getWebhookDiagnostics(principal, lookbackHours)
      }))
    }

    this.registerPrompts(server, principal)
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

    // Authenticated does not mean unmetered: every tool call fans out into
    // tenant-scoped database reads, and a model in a retry loop will hammer
    // them. The OAuth endpoints are metered; this one has to be too.
    try {
      await this.abuseProtectionService.assertToolCallAllowed(
        principal.connectionId,
        principal.partnerId,
      )
    }
    catch (error) {
      if (error instanceof PartnerAiRateLimitError) {
        this.rateLimited(response, error)
        return
      }
      this.logger.error('[PartnerAiMcp] Rate-limit check failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      this.internalError(response)
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
        this.internalError(response)
      }
    }
  }

  private internalError(response: Response): void {
    response.status(500).json({
      error: { code: -32603, message: 'Internal server error' },
      id: null,
      jsonrpc: '2.0',
    })
  }

  private methodNotAllowed(response: Response): void {
    response.status(405).json({
      error: { code: -32000, message: 'Method not allowed' },
      id: null,
      jsonrpc: '2.0',
    })
  }

  private rateLimited(response: Response, error: PartnerAiRateLimitError): void {
    response
      .set('Retry-After', String(error.retryAfterSeconds))
      .status(429)
      .json({
        error: {
          code: -32000,
          data: { retryAfterSeconds: error.retryAfterSeconds },
          message: 'Too many Abroad MCP requests. Retry after the interval in Retry-After.',
        },
        id: null,
        jsonrpc: '2.0',
      })
  }

  /**
   * Encodes the support playbook once, server-side, rather than relying on each
   * client's model to rediscover the right sequence of reads.
   */
  private registerPrompts(server: McpServer, principal: PartnerAiAccessPrincipal): void {
    if (!principal.scopes.includes('transactions:read')) return
    const canReadWebhooks = principal.scopes.includes('webhooks:read')
    const canReadDocs = principal.scopes.includes('docs:read')

    server.registerPrompt('diagnose_failed_transaction', {
      argsSchema: {
        transactionId: z.string().describe('The Abroad transaction id to diagnose'),
      },
      description: 'Walk through why one Abroad transaction failed, stalled, or did not reach the recipient.',
      title: 'Diagnose a failed Abroad transaction',
    }, ({ transactionId }) => {
      const steps = [
        `1. Call get_transaction with transactionId "${transactionId}". Read \`status\`, \`failureReason\`, and the \`lifecycle\` entries to establish what happened and when.`,
        '2. If `status` is PAYMENT_FAILED or WRONG_AMOUNT, check `refund` to see whether funds are already on their way back, and report its status verbatim.',
        '3. If `status` is AWAITING_PAYMENT, the payer has not sent funds yet, or sent them without the required reference. Say so rather than treating it as a failure.',
        '4. Inspect `deliveries` on the transaction. A FAILED delivery means Abroad processed the payment but the partner endpoint did not accept the notification — that is a partner-side integration issue, not a payment failure.',
      ]
      if (canReadWebhooks) {
        steps.push('5. If any delivery failed, call get_webhook_diagnostics to see whether this is isolated or part of a wider outage on the partner endpoint.')
      }
      if (canReadDocs) {
        steps.push(`${canReadWebhooks ? '6' : '5'}. Call search_documentation for the relevant status or error to cite the documented meaning and remedy.`)
      }
      steps.push(
        `${steps.length + 1}. Summarize: what happened, whether money moved, whether it is recoverable, and the single next action for the partner. Never speculate beyond the returned data.`,
      )
      return {
        messages: [{
          content: { text: steps.join('\n'), type: 'text' as const },
          role: 'user' as const,
        }],
      }
    })
  }

  private unauthorized(response: Response): void {
    response
      .set('WWW-Authenticate', `Bearer resource_metadata="${PARTNER_AI_PROTECTED_RESOURCE_METADATA_URL}"`)
      .status(401)
      .json({
        error: { code: -32001, message: 'Authorization required' },
        id: null,
        jsonrpc: '2.0',
      })
  }
}
