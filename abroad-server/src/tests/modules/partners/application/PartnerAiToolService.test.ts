import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, TargetCurrency, TransactionStatus } from '@prisma/client'

import { PartnerAiAccessPrincipal } from '../../../../modules/partners/application/PartnerAiTokenService'
import { PartnerAiToolService } from '../../../../modules/partners/application/PartnerAiToolService'
import { PartnerAiWebhookDiagnosticsService } from '../../../../modules/partners/application/PartnerAiWebhookDiagnosticsService'
import { PartnerTransactionQueryService } from '../../../../modules/transactions/application/PartnerTransactionQueryService'

const principal: PartnerAiAccessPrincipal = {
  accessTokenId: 'access-token-id',
  clientId: 'client-id',
  clientName: 'Assistant',
  connectionExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
  connectionId: 'connection-id',
  partnerId: 'partner-1',
  partnerName: 'Atlas Payments',
  scopes: ['account:read', 'docs:read', 'requests:validate', 'transactions:read', 'webhooks:read'],
  tokenExpiresAt: new Date('2026-08-02T19:00:00.000Z'),
}

const buildHarness = () => {
  const getById = jest.fn(async () => ({ id: 'transaction-1' }))
  const search = jest.fn(async () => ({
    items: [], page: 1, pageSize: 20, statusCounts: [], total: 0,
  }))
  const getWebhookDiagnostics = jest.fn(async () => ({
    configured: true,
    deliveries: [],
    destinationHost: 'partner.example',
    latest: null,
    lookbackHours: 24,
  }))
  return {
    getById,
    getWebhookDiagnostics,
    search,
    service: new PartnerAiToolService(
      { getById, search } as unknown as PartnerTransactionQueryService,
      { get: getWebhookDiagnostics } as unknown as PartnerAiWebhookDiagnosticsService,
    ),
  }
}

describe('PartnerAiToolService', () => {
  it('validates public request shapes without invoking a transaction or provider service', () => {
    const harness = buildHarness()

    expect(harness.service.validateRequest('CREATE_QUOTE', {
      amount: 100,
      crypto_currency: CryptoCurrency.USDC,
      network: BlockchainNetwork.CELO,
      payment_method: 'PIX',
      target_currency: TargetCurrency.BRL,
    })).toEqual({ issues: [], valid: true })
    expect(harness.service.validateRequest('ACCEPT_TRANSACTION', {
      account_number: 'manual-pix-key',
      quote_id: 'quote-1',
      user_id: 'partner-user-1',
    })).toEqual({ issues: [], valid: true })

    const invalid = harness.service.validateRequest('ACCEPT_TRANSACTION', {
      quote_id: 'quote-1',
      user_id: 'partner-user-1',
    })
    expect(invalid.valid).toBe(false)
    expect(invalid.issues).toContainEqual(expect.objectContaining({
      path: 'account_number',
    }))
    expect(JSON.stringify(invalid)).not.toContain('manual-pix-key')
    expect(harness.search).not.toHaveBeenCalled()
    expect(harness.getById).not.toHaveBeenCalled()
    expect(harness.getWebhookDiagnostics).not.toHaveBeenCalled()
  })

  it('searches only the bounded in-memory documentation catalog', () => {
    const harness = buildHarness()

    const result = harness.service.searchDocumentation('How do I revoke an OAuth MCP connection?')

    expect(result.results[0]).toEqual(expect.objectContaining({
      title: 'Connect Abroad to AI',
      url: 'https://abroad-docs.web.app/ai-integration',
    }))
    expect(result.matched).toBe(true)
    expect(result.results.length).toBeLessThanOrEqual(5)
    expect(harness.search).not.toHaveBeenCalled()
    expect(harness.getWebhookDiagnostics).not.toHaveBeenCalled()
  })

  it('hands back the documentation index instead of an empty dead end', () => {
    const harness = buildHarness()

    const result = harness.service.searchDocumentation('kubernetes sidecar tuning')

    expect(result.matched).toBe(false)
    expect(result.results).toHaveLength(1)
    expect(result.results[0].url).toBe('https://abroad-docs.web.app/')
    expect(result.note).toContain('No catalog entry matched')
  })

  it('covers the operational topics partners actually ask about', () => {
    const harness = buildHarness()

    const topics = {
      'PIX payouts to Brazil': 'Supported assets',
      'transaction limits per day': 'Limits and validation',
      'what fields does the quote endpoint take': 'API reference',
      'which memo do I send on Stellar': 'Send funds',
    }
    for (const [query, expectedTitle] of Object.entries(topics)) {
      const result = harness.service.searchDocumentation(query)
      expect(result.matched).toBe(true)
      expect(result.results.map(entry => entry.title)).toContain(expectedTitle)
    }
  })

  it('does not let a short keyword match an unrelated word', () => {
    const harness = buildHarness()

    // "available" contains "ai" and "rapid" contains "api"; neither is a topic hit.
    const result = harness.service.searchDocumentation('available')

    expect(result.matched).toBe(false)
  })

  it('passes the authenticated tenant identity to transaction reads', async () => {
    const harness = buildHarness()

    await harness.service.listTransactions(principal, {
      page: 2,
      pageSize: 25,
      status: TransactionStatus.PAYMENT_FAILED,
    })
    await harness.service.getTransaction(principal, 'transaction-1')

    expect(harness.search).toHaveBeenCalledWith('partner-1', {
      page: 2,
      pageSize: 25,
      status: TransactionStatus.PAYMENT_FAILED,
    })
    expect(harness.getById).toHaveBeenCalledWith('partner-1', 'transaction-1')
  })

  it('passes only the authenticated tenant and bounded lookback to webhook diagnostics', async () => {
    const harness = buildHarness()

    await harness.service.getWebhookDiagnostics(principal, 24)

    expect(harness.getWebhookDiagnostics).toHaveBeenCalledWith('partner-1', 24)
  })
})
