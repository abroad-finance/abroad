import 'reflect-metadata'

import type { PrismaClient } from '@prisma/client'

import { OpsRole, TransactionStatus } from '@prisma/client'

import { OpsGlobalSearchService, OpsGlobalSearchValidationError } from '../../../../modules/operations/application/OpsGlobalSearchService'
import { OpsUserPrincipal } from '../../../../modules/operations/application/opsIdentity'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const principal: OpsUserPrincipal = {
  authTime: new Date(),
  displayName: 'Support User',
  email: 'support@abroad.finance',
  kind: 'ops_user',
  permissions: ['search:read'],
  role: OpsRole.SUPPORT,
  sessionVersion: 1,
  userId: 'ops-1',
}

const buildService = () => {
  const prisma = {
    flowInstance: { findMany: jest.fn(async () => []) },
    opsCase: { findMany: jest.fn(async () => []) },
    partner: { findMany: jest.fn(async () => []) },
    transaction: {
      findMany: jest.fn(async () => [{
        externalId: 'provider-match',
        id: 'transaction-1',
        onChainId: null,
        partnerUser: {
          partner: { id: 'partner-1', name: 'Partner One' },
          userId: 'private-user-reference',
        },
        pixEndToEndId: null,
        quote: {
          paymentMethod: 'PIX',
          targetAmount: 100,
          targetCurrency: 'BRL',
        },
        quoteId: 'quote-1',
        refundOnChainId: null,
        status: TransactionStatus.PROCESSING_PAYMENT,
      }]),
    },
  }
  const provider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as PrismaClient),
  }
  return { prisma, service: new OpsGlobalSearchService(provider) }
}

describe('OpsGlobalSearchService', () => {
  it('searches every operational identifier but returns no unrelated PII', async () => {
    const { prisma, service } = buildService()

    const result = await service.search(principal, 'provider-match')

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: expect.any(Array) },
    }))
    expect(result.items[0]).toEqual(expect.objectContaining({
      kind: 'TRANSACTION',
      matchedFields: ['Provider reference'],
      route: '/ops/transactions/transaction-1',
    }))
    expect(JSON.stringify(result)).not.toContain('private-user-reference')
  })

  it('requires a bounded deliberate query', async () => {
    const { service } = buildService()

    await expect(service.search(principal, 'x')).rejects.toBeInstanceOf(OpsGlobalSearchValidationError)
    await expect(service.search(principal, 'x'.repeat(201))).rejects.toBeInstanceOf(OpsGlobalSearchValidationError)
  })
})
