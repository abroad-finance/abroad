import { inject, injectable } from 'inversify'
import { z } from 'zod'

import type { PartnerAiAccessPrincipal } from './PartnerAiTokenService'

import { quoteRequestSchema, reverseQuoteRequestSchema } from '../../quotes/interfaces/http/contracts'
import { PartnerTransactionDetailDto, PartnerTransactionListResponse, PartnerTransactionQueryService, PartnerTransactionSearchFilters } from '../../transactions/application/PartnerTransactionQueryService'
import { acceptTransactionRequestSchema } from '../../transactions/interfaces/http/contracts'
import { PARTNER_AI_DOCUMENTATION_ORIGIN, PARTNER_AI_DOCUMENTATION_URL } from './partnerAiConfiguration'
import { PartnerAiWebhookDiagnostics, PartnerAiWebhookDiagnosticsService } from './PartnerAiWebhookDiagnosticsService'

export const partnerAiValidationOperations = [
  'ACCEPT_TRANSACTION',
  'CREATE_QUOTE',
  'CREATE_REVERSE_QUOTE',
] as const

type DocumentationEntry = {
  excerpt: string
  keywords: readonly string[]
  title: string
  url: string
}

type PartnerAiDocumentationResult = {
  results: Array<{
    excerpt: string
    title: string
    url: string
  }>
}

type PartnerAiValidationOperation = typeof partnerAiValidationOperations[number]

type PartnerAiValidationResult = {
  issues: Array<{
    code: string
    message: string
    path: string
  }>
  valid: boolean
}

const documentationCatalog: readonly DocumentationEntry[] = [
  {
    excerpt: 'Connect a compatible AI client with Abroad OAuth, review read-only permissions, test the connection, and revoke it from the partner portal.',
    keywords: ['ai', 'mcp', 'oauth', 'connect', 'assistant', 'permissions', 'revoke'],
    title: 'Connect Abroad to AI',
    url: PARTNER_AI_DOCUMENTATION_URL,
  },
  {
    excerpt: 'Create and authenticate a production partner workspace, verify email, enable MFA, and manage integration access.',
    keywords: ['workspace', 'signup', 'email', 'mfa', 'administrator', 'production'],
    title: 'Self-service setup',
    url: `${PARTNER_AI_DOCUMENTATION_ORIGIN}/self-service-setup`,
  },
  {
    excerpt: 'Authenticate public API requests with a scoped production API key created in the partner portal.',
    keywords: ['authentication', 'api', 'key', 'scope', 'header'],
    title: 'Authentication',
    url: `${PARTNER_AI_DOCUMENTATION_ORIGIN}/authentication`,
  },
  {
    excerpt: 'Create a quote, accept a transaction, send funds on the selected network, and track status safely.',
    keywords: ['quickstart', 'quote', 'transaction', 'payout', 'send', 'funds'],
    title: 'Quickstart',
    url: `${PARTNER_AI_DOCUMENTATION_ORIGIN}/quickstart`,
  },
  {
    excerpt: 'Validate webhook signatures, process transaction lifecycle events idempotently, and diagnose delivery failures.',
    keywords: ['webhook', 'signature', 'event', 'delivery', 'retry', 'diagnostics'],
    title: 'Webhooks',
    url: `${PARTNER_AI_DOCUMENTATION_ORIGIN}/reference/webhooks`,
  },
  {
    excerpt: 'Understand awaiting, processing, completed, failed, expired, and wrong-amount transaction states.',
    keywords: ['status', 'lifecycle', 'failed', 'expired', 'completed', 'transaction'],
    title: 'Status lifecycle',
    url: `${PARTNER_AI_DOCUMENTATION_ORIGIN}/workflows/status-lifecycle`,
  },
] as const

const validationSchemaByOperation: Readonly<Record<PartnerAiValidationOperation, z.ZodType>> = {
  ACCEPT_TRANSACTION: acceptTransactionRequestSchema,
  CREATE_QUOTE: quoteRequestSchema,
  CREATE_REVERSE_QUOTE: reverseQuoteRequestSchema,
}

@injectable()
export class PartnerAiToolService {
  public constructor(
    @inject(PartnerTransactionQueryService)
    private readonly transactionQueryService: PartnerTransactionQueryService,
    @inject(PartnerAiWebhookDiagnosticsService)
    private readonly webhookDiagnosticsService: PartnerAiWebhookDiagnosticsService,
  ) {}

  public async getTransaction(
    principal: PartnerAiAccessPrincipal,
    transactionId: string,
  ): Promise<PartnerTransactionDetailDto> {
    return this.transactionQueryService.getById(principal.partnerId, transactionId)
  }

  public async getWebhookDiagnostics(
    principal: PartnerAiAccessPrincipal,
    lookbackHours: number,
  ): Promise<PartnerAiWebhookDiagnostics> {
    return this.webhookDiagnosticsService.get(principal.partnerId, lookbackHours)
  }

  public async listTransactions(
    principal: PartnerAiAccessPrincipal,
    filters: PartnerTransactionSearchFilters,
  ): Promise<PartnerTransactionListResponse> {
    return this.transactionQueryService.search(principal.partnerId, filters)
  }

  public searchDocumentation(query: string): PartnerAiDocumentationResult {
    const terms = this.normalizeSearchTerms(query)
    const ranked = documentationCatalog
      .map(entry => ({
        entry,
        score: terms.reduce((score, term) => score + (
          entry.title.toLowerCase().includes(term) ? 3 : 0
        ) + (
          entry.keywords.some(keyword => keyword.includes(term) || term.includes(keyword)) ? 2 : 0
        ) + (
          entry.excerpt.toLowerCase().includes(term) ? 1 : 0
        ), 0),
      }))
      .filter(result => result.score > 0)
      .sort((left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title))
      .slice(0, 5)
      .map(result => ({
        excerpt: result.entry.excerpt,
        title: result.entry.title,
        url: result.entry.url,
      }))
    return { results: ranked }
  }

  public validateRequest(
    operation: PartnerAiValidationOperation,
    payload: Readonly<Record<string, unknown>>,
  ): PartnerAiValidationResult {
    const result = validationSchemaByOperation[operation].safeParse(payload)
    if (result.success) return { issues: [], valid: true }
    return {
      issues: result.error.issues.slice(0, 20).map(issue => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.map(segment => String(segment)).join('.'),
      })),
      valid: false,
    }
  }

  private normalizeSearchTerms(query: string): string[] {
    return [...new Set(query
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(term => term.length >= 2))]
  }
}
