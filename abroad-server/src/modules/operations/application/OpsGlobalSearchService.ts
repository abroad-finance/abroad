import { Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ApplicationError } from '../../../core/errors'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { OpsPrincipal, requireOpsPermission } from './opsIdentity'

const MAX_QUERY_LENGTH = 200
const MAX_RESULTS_PER_KIND = 8

export type OpsGlobalSearchResponse = {
  items: OpsGlobalSearchResultDto[]
  query: string
  truncated: boolean
}

export type OpsGlobalSearchResultDto = {
  context: string
  kind: 'CASE' | 'FLOW' | 'PARTNER' | 'TRANSACTION'
  matchedFields: string[]
  route: string
  secondary: string
  title: string
}

export class OpsGlobalSearchValidationError extends ApplicationError {
  public constructor(message: string) {
    super(400, 'ops_search_invalid', message)
    this.name = 'OpsGlobalSearchValidationError'
  }
}

@injectable()
export class OpsGlobalSearchService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async search(principal: OpsPrincipal, input: string): Promise<OpsGlobalSearchResponse> {
    requireOpsPermission(principal, 'search:read')
    const query = input.trim()
    if (query.length < 2) throw new OpsGlobalSearchValidationError('Enter at least 2 characters')
    if (query.length > MAX_QUERY_LENGTH) {
      throw new OpsGlobalSearchValidationError(`Search must be ${MAX_QUERY_LENGTH} characters or fewer`)
    }

    const prismaClient = await this.databaseClientProvider.getClient()
    const stringFilter: Prisma.StringFilter = { contains: query, mode: 'insensitive' }
    const [transactions, flows, partners, cases] = await Promise.all([
      prismaClient.transaction.findMany({
        include: {
          partnerUser: { select: { partner: { select: { id: true, name: true } }, userId: true } },
          quote: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_RESULTS_PER_KIND + 1,
        where: {
          OR: [
            { id: stringFilter },
            { quoteId: stringFilter },
            { onChainId: stringFilter },
            { refundOnChainId: stringFilter },
            { pixEndToEndId: stringFilter },
            { externalId: stringFilter },
            { partnerUser: { userId: stringFilter } },
            { partnerUser: { partner: { id: stringFilter } } },
            { partnerUser: { partner: { name: stringFilter } } },
          ],
        },
      }),
      prismaClient.flowInstance.findMany({
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, status: true, transactionId: true, updatedAt: true },
        take: MAX_RESULTS_PER_KIND + 1,
        where: { OR: [{ id: stringFilter }, { transactionId: stringFilter }] },
      }),
      prismaClient.partner.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { country: true, id: true, name: true },
        take: MAX_RESULTS_PER_KIND + 1,
        where: { OR: [{ id: stringFilter }, { name: stringFilter }] },
      }),
      prismaClient.opsCase.findMany({
        include: {
          owner: { select: { displayName: true } },
          transaction: {
            include: { partnerUser: { select: { partner: { select: { name: true } } } } },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: MAX_RESULTS_PER_KIND + 1,
        where: { OR: [{ id: stringFilter }, { transactionId: stringFilter }] },
      }),
    ])

    const normalizedQuery = query.toLocaleLowerCase('en-US')
    const items: OpsGlobalSearchResultDto[] = [
      ...transactions.slice(0, MAX_RESULTS_PER_KIND).map((transaction): OpsGlobalSearchResultDto => ({
        context: `${transaction.partnerUser.partner.name} · ${transaction.quote.paymentMethod}`,
        kind: 'TRANSACTION',
        matchedFields: this.transactionMatchLabels(transaction, normalizedQuery),
        route: `/ops/transactions/${transaction.id}`,
        secondary: `${transaction.quote.targetAmount} ${transaction.quote.targetCurrency} · ${this.humanize(transaction.status)}`,
        title: `Transaction ${this.shortId(transaction.id)}`,
      })),
      ...flows.slice(0, MAX_RESULTS_PER_KIND).map((flow): OpsGlobalSearchResultDto => ({
        context: `Updated ${flow.updatedAt.toISOString()}`,
        kind: 'FLOW',
        matchedFields: [this.includes(flow.id, normalizedQuery) ? 'Flow ID' : 'Transaction ID'],
        route: `/ops/flows/${flow.id}`,
        secondary: this.humanize(flow.status),
        title: `Flow ${this.shortId(flow.id)}`,
      })),
      ...partners.slice(0, MAX_RESULTS_PER_KIND).map((partner): OpsGlobalSearchResultDto => ({
        context: partner.country ?? 'Country not set',
        kind: 'PARTNER',
        matchedFields: [this.includes(partner.id, normalizedQuery) ? 'Partner ID' : 'Partner name'],
        route: `/ops/partners?partnerId=${encodeURIComponent(partner.id)}`,
        secondary: `Partner ${this.shortId(partner.id)}`,
        title: partner.name,
      })),
      ...cases.slice(0, MAX_RESULTS_PER_KIND).map((caseItem): OpsGlobalSearchResultDto => ({
        context: `${caseItem.transaction.partnerUser.partner.name} · ${this.humanize(caseItem.priority)} priority`,
        kind: 'CASE',
        matchedFields: [this.includes(caseItem.id, normalizedQuery) ? 'Case ID' : 'Transaction ID'],
        route: `/ops/transactions/${caseItem.transactionId}?case=${encodeURIComponent(caseItem.id)}`,
        secondary: caseItem.owner ? `Owned by ${caseItem.owner.displayName}` : 'Unassigned',
        title: `Case ${this.shortId(caseItem.id)}`,
      })),
    ]

    return {
      items,
      query,
      truncated: [transactions, flows, partners, cases].some(rows => rows.length > MAX_RESULTS_PER_KIND),
    }
  }

  private humanize(value: string): string {
    return value.replace(/[._-]+/g, ' ').toLowerCase().replace(/(^|\s)\S/g, character => character.toUpperCase())
  }

  private includes(value: null | string, query: string): boolean {
    return value?.toLocaleLowerCase('en-US').includes(query) ?? false
  }

  private shortId(value: string): string {
    return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`
  }

  private transactionMatchLabels(
    transaction: {
      externalId: null | string
      id: string
      onChainId: null | string
      partnerUser: { partner: { id: string, name: string }, userId: string }
      pixEndToEndId: null | string
      quoteId: string
      refundOnChainId: null | string
    },
    query: string,
  ): string[] {
    const labels = [
      ['Transaction ID', transaction.id],
      ['Quote ID', transaction.quoteId],
      ['On-chain ID', transaction.onChainId],
      ['Refund ID', transaction.refundOnChainId],
      ['PIX E2E ID', transaction.pixEndToEndId],
      ['Provider reference', transaction.externalId],
      ['Partner ID', transaction.partnerUser.partner.id],
      ['Partner name', transaction.partnerUser.partner.name],
      ['Partner user reference', transaction.partnerUser.userId],
    ] as const
    return labels.filter(([, value]) => this.includes(value, query)).map(([label]) => label)
  }
}
