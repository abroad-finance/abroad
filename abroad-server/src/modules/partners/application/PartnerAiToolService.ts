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
  matched: boolean
  note?: string
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
  {
    excerpt: 'Abroad converts between fiat (COP, BRL) and crypto (USDC, USDT), pays out over local rails, and handles KYC/KYB.',
    keywords: ['introduction', 'overview', 'abroad', 'about', 'platform'],
    title: 'Introduction',
    url: `${PARTNER_AI_DOCUMENTATION_ORIGIN}/`,
  },
  {
    excerpt: 'Base URL, the X-API-Key and Bearer header schemes, JSON content types, and the shared enums used across endpoints.',
    keywords: ['basics', 'base', 'url', 'header', 'headers', 'enum', 'enums', 'json', 'environment'],
    title: 'Integration basics',
    url: `${PARTNER_AI_DOCUMENTATION_ORIGIN}/integration-basics`,
  },
  {
    excerpt: 'Every endpoint with request and response fields: quotes, reverse quotes, transactions, and payment notifications.',
    keywords: ['reference', 'endpoint', 'endpoints', 'request', 'response', 'field', 'fields', 'swagger', 'openapi', 'schema'],
    title: 'API reference',
    url: `${PARTNER_AI_DOCUMENTATION_ORIGIN}/reference/api`,
  },
  {
    excerpt: 'Supported blockchains, cryptocurrencies, fiat currencies, and which payment method pairs with each network.',
    keywords: ['asset', 'assets', 'currency', 'currencies', 'network', 'networks', 'usdc', 'usdt', 'stellar', 'solana', 'celo', 'brl', 'cop', 'pix', 'breb', 'corridor'],
    title: 'Supported assets',
    url: `${PARTNER_AI_DOCUMENTATION_ORIGIN}/resources/supported-assets`,
  },
  {
    excerpt: 'Per-transaction and per-day payment caps, one-hour quote validity, liquidity rejections, and the 400 reason strings.',
    keywords: ['limit', 'limits', 'cap', 'caps', 'maximum', 'validation', 'liquidity', 'expiration', 'reason', 'rejected'],
    title: 'Limits and validation',
    url: `${PARTNER_AI_DOCUMENTATION_ORIGIN}/resources/limits`,
  },
  {
    excerpt: 'The three-step quote, accept, and pay lifecycle, with a sequence diagram of the full transaction flow.',
    keywords: ['workflow', 'workflows', 'flow', 'lifecycle', 'sequence', 'steps', 'integration'],
    title: 'Workflows overview',
    url: `${PARTNER_AI_DOCUMENTATION_ORIGIN}/workflows/overview`,
  },
  {
    excerpt: 'Call POST /quote for a target fiat amount, or the reverse quote endpoint to quote by crypto amount.',
    keywords: ['quote', 'quotes', 'rate', 'pricing', 'reverse', 'fee', 'fees', 'exchange'],
    title: 'Create a quote',
    url: `${PARTNER_AI_DOCUMENTATION_ORIGIN}/workflows/create-quote`,
  },
  {
    excerpt: 'Call POST /transaction with a quote_id, user_id, and payout details to lock the rate and get a transaction reference.',
    keywords: ['accept', 'transaction', 'quote_id', 'user_id', 'account', 'bank', 'tax', 'payout', 'recipient'],
    title: 'Accept a transaction',
    url: `${PARTNER_AI_DOCUMENTATION_ORIGIN}/workflows/accept-transaction`,
  },
  {
    excerpt: 'Send crypto to Abroad: Stellar requires the transaction reference as the memo; Solana and Celo use the payment notification endpoints.',
    keywords: ['send', 'funds', 'deposit', 'memo', 'reference', 'notify', 'notification', 'stellar', 'solana', 'celo', 'wallet', 'address'],
    title: 'Send funds',
    url: `${PARTNER_AI_DOCUMENTATION_ORIGIN}/workflows/send-funds`,
  },
] as const

const documentationFallback = {
  excerpt: 'Browse the full Abroad integration documentation index.',
  title: 'Abroad documentation',
  url: `${PARTNER_AI_DOCUMENTATION_ORIGIN}/`,
}

// Containment matching exists to absorb plurals ("webhooks" -> "webhook"), but
// short keywords are substrings of unrelated words: `ai` matches "available"
// and `api` matches "rapid". Require enough length for containment to mean
// something in each direction.
const MIN_CONTAINED_KEYWORD_LENGTH = 4
const MIN_CONTAINED_TERM_LENGTH = 3

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
          entry.keywords.some(keyword => this.matchesKeyword(term, keyword)) ? 2 : 0
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
    // An empty result set is a dead end for a calling model, which cannot tell
    // "no such topic" from "search is broken". Always hand back somewhere to go.
    if (ranked.length === 0) {
      return {
        matched: false,
        note: 'No catalog entry matched this query. Browse the documentation index, or retry with a narrower keyword such as "quote", "webhook", "limits", or "status".',
        results: [documentationFallback],
      }
    }
    return { matched: true, results: ranked }
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

  private matchesKeyword(term: string, keyword: string): boolean {
    if (term === keyword) return true
    if (term.length >= MIN_CONTAINED_TERM_LENGTH && keyword.includes(term)) return true
    return keyword.length >= MIN_CONTAINED_KEYWORD_LENGTH && term.includes(keyword)
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
