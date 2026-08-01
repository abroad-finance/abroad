import {
  CryptoCurrency,
  type Partner,
  Prisma,
  type PrismaClient,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { normalizeClientDomainInput } from '../domain/clientDomain'
import { buildPartnerApiKeyCandidate } from './partnerApiKey'

const API_KEY_RETRY_ATTEMPTS = 5

export type OpsPartnerClientDomainInput = {
  clientDomain: null | string
}

export type OpsPartnerCompletedVolume = {
  completedTransactions: number
  payout: OpsPartnerPayoutVolume[]
  source: OpsPartnerSourceVolume[]
  stablecoinAmount: number
}

export type OpsPartnerCreateInput = {
  clientDomain?: string
  company: string
  country: string
  email: string
  firstName: string
  lastName: string
  phone?: string
}

export type OpsPartnerCreateResult = {
  apiKey: string
  partner: OpsPartnerSummary
}

export type OpsPartnerListItem = OpsPartnerSummary & {
  completedVolume: OpsPartnerCompletedVolume
}

export type OpsPartnerListParams = {
  page: number
  pageSize: number
}

export type OpsPartnerListResult = {
  items: OpsPartnerListItem[]
  maximumStablecoinAmount: number
  page: number
  pageSize: number
  total: number
}

export type OpsPartnerPayoutVolume = {
  amount: number
  currency: TargetCurrency
}

export type OpsPartnerRotateApiKeyResult = {
  apiKey: string
  partner: OpsPartnerSummary
}

export type OpsPartnerSourceVolume = {
  amount: number
  currency: CryptoCurrency
}

export type OpsPartnerSummary = {
  clientDomain?: string
  country?: string
  createdAt: Date
  email?: string
  firstName?: string
  hasApiKey: boolean
  id: string
  isKybApproved: boolean
  lastName?: string
  name: string
  needsKyc: boolean
  phone?: string
}

type MutablePartnerVolume = {
  completedTransactions: number
  payout: Map<TargetCurrency, number>
  source: Map<CryptoCurrency, number>
  stablecoinAmount: number
}

type RankedPartnerPage = {
  ids: string[]
  maximumStablecoinAmount: number
}

type RankedPartnerRow = {
  id: string
  maximumStablecoinAmount: number
}

export class OpsPartnerNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpsPartnerNotFoundError'
  }
}

export class OpsPartnerValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpsPartnerValidationError'
  }
}

const roundAmount = (value: number): number => (
  Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
)

const addAmount = <TCurrency extends string>(
  amounts: Map<TCurrency, number>,
  currency: TCurrency,
  amount: number,
): void => {
  amounts.set(currency, (amounts.get(currency) ?? 0) + amount)
}

const toSortedAmounts = <TCurrency extends string>(
  amounts: Map<TCurrency, number>,
): Array<{ amount: number, currency: TCurrency }> => (
  [...amounts.entries()]
    .map(([currency, amount]) => ({ amount: roundAmount(amount), currency }))
    .sort((left, right) => left.currency.localeCompare(right.currency))
)

@injectable()
export class OpsPartnerService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
  ) {}

  public async createPartner(input: OpsPartnerCreateInput): Promise<OpsPartnerCreateResult> {
    const prisma = await this.dbProvider.getClient()
    const clientDomainRecord = this.normalizeClientDomain(input.clientDomain)

    try {
      for (let attempt = 1; attempt <= API_KEY_RETRY_ATTEMPTS; attempt += 1) {
        const candidate = buildPartnerApiKeyCandidate()
        try {
          const created = await prisma.partner.create({
            data: {
              apiKey: candidate.hashed,
              clientDomain: clientDomainRecord.clientDomain,
              clientDomainHash: clientDomainRecord.clientDomainHash,
              country: input.country,
              email: input.email,
              firstName: input.firstName,
              lastName: input.lastName,
              name: input.company,
              phone: input.phone,
            },
          })

          return {
            apiKey: candidate.plaintext,
            partner: this.toSummary(created),
          }
        }
        catch (error) {
          if (this.isUniqueConstraintFor(error, 'apiKey') && attempt < API_KEY_RETRY_ATTEMPTS) {
            continue
          }
          throw error
        }
      }
      throw new OpsPartnerValidationError('Failed to generate a unique partner API key')
    }
    catch (error) {
      if (this.isUniqueConstraintFor(error, 'email')) {
        throw new OpsPartnerValidationError('Partner email already exists')
      }
      if (
        this.isUniqueConstraintFor(error, 'clientDomain')
        || this.isUniqueConstraintFor(error, 'clientDomainHash')
      ) {
        throw new OpsPartnerValidationError('Client domain already exists')
      }
      if (error instanceof OpsPartnerValidationError) {
        throw error
      }
      throw new OpsPartnerValidationError('Failed to create partner in the database')
    }
  }

  public async listPartners(params: OpsPartnerListParams): Promise<OpsPartnerListResult> {
    const prisma = await this.dbProvider.getClient()
    const skip = (params.page - 1) * params.pageSize

    const [rankedPartnerPage, total] = await Promise.all([
      this.readRankedPartnerPage(prisma, skip, params.pageSize),
      prisma.partner.count(),
    ])
    const rankedPartnerIds = rankedPartnerPage.ids

    if (rankedPartnerIds.length === 0) {
      return {
        items: [],
        maximumStablecoinAmount: 0,
        page: params.page,
        pageSize: params.pageSize,
        total,
      }
    }

    const [unorderedPartners, completedVolumeByPartner] = await Promise.all([
      prisma.partner.findMany({
        where: { id: { in: rankedPartnerIds } },
      }),
      this.readCompletedVolume(prisma, rankedPartnerIds),
    ])
    const partnerById = new Map(unorderedPartners.map(partner => [partner.id, partner]))
    const partners = rankedPartnerIds.map((partnerId) => {
      const partner = partnerById.get(partnerId)
      if (!partner) {
        throw new Error(`Ranked partner ${partnerId} was not returned by the database`)
      }
      return partner
    })

    return {
      items: partners.map(partner => ({
        ...this.toSummary(partner),
        completedVolume: completedVolumeByPartner.get(partner.id) ?? this.emptyCompletedVolume(),
      })),
      maximumStablecoinAmount: roundAmount(rankedPartnerPage.maximumStablecoinAmount),
      page: params.page,
      pageSize: params.pageSize,
      total,
    }
  }

  public async revokeApiKey(partnerId: string): Promise<void> {
    const prisma = await this.dbProvider.getClient()
    try {
      await prisma.partner.update({
        data: { apiKey: null },
        where: { id: partnerId },
      })
    }
    catch (error) {
      if (this.isNotFoundError(error)) {
        throw new OpsPartnerNotFoundError('Partner not found')
      }
      throw error
    }
  }

  public async rotateApiKey(partnerId: string): Promise<OpsPartnerRotateApiKeyResult> {
    const prisma = await this.dbProvider.getClient()

    for (let attempt = 1; attempt <= API_KEY_RETRY_ATTEMPTS; attempt += 1) {
      const candidate = buildPartnerApiKeyCandidate()
      try {
        const updatedPartner = await prisma.partner.update({
          data: { apiKey: candidate.hashed },
          where: { id: partnerId },
        })
        return {
          apiKey: candidate.plaintext,
          partner: this.toSummary(updatedPartner),
        }
      }
      catch (error) {
        if (this.isNotFoundError(error)) {
          throw new OpsPartnerNotFoundError('Partner not found')
        }
        if (this.isUniqueConstraintFor(error, 'apiKey') && attempt < API_KEY_RETRY_ATTEMPTS) {
          continue
        }
        throw new OpsPartnerValidationError('Failed to rotate partner API key')
      }
    }

    throw new OpsPartnerValidationError('Failed to generate a unique partner API key')
  }

  public async updateClientDomain(
    partnerId: string,
    input: OpsPartnerClientDomainInput,
  ): Promise<OpsPartnerSummary> {
    const prisma = await this.dbProvider.getClient()
    const clientDomainRecord = this.normalizeClientDomain(input.clientDomain)

    try {
      const updatedPartner = await prisma.partner.update({
        data: {
          clientDomain: clientDomainRecord.clientDomain,
          clientDomainHash: clientDomainRecord.clientDomainHash,
        },
        where: { id: partnerId },
      })

      return this.toSummary(updatedPartner)
    }
    catch (error) {
      if (this.isNotFoundError(error)) {
        throw new OpsPartnerNotFoundError('Partner not found')
      }
      if (
        this.isUniqueConstraintFor(error, 'clientDomain')
        || this.isUniqueConstraintFor(error, 'clientDomainHash')
      ) {
        throw new OpsPartnerValidationError('Client domain already exists')
      }
      if (error instanceof OpsPartnerValidationError) {
        throw error
      }
      throw new OpsPartnerValidationError('Failed to update partner client domain')
    }
  }

  private emptyCompletedVolume(): OpsPartnerCompletedVolume {
    return {
      completedTransactions: 0,
      payout: [],
      source: [],
      stablecoinAmount: 0,
    }
  }

  private isNotFoundError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025'
  }

  private isUniqueConstraintFor(error: unknown, field: string): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false
    }

    const target = error.meta?.target
    if (Array.isArray(target)) {
      return target.includes(field)
    }
    if (typeof target === 'string') {
      return target.includes(field)
    }
    return false
  }

  private normalizeClientDomain(
    value: null | string | undefined,
  ): { clientDomain: null | string, clientDomainHash: null | string } {
    try {
      return normalizeClientDomainInput(value)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Client domain is invalid'
      throw new OpsPartnerValidationError(message)
    }
  }

  private async readCompletedVolume(
    prisma: PrismaClient,
    partnerIds: string[],
  ): Promise<Map<string, OpsPartnerCompletedVolume>> {
    if (partnerIds.length === 0) return new Map()

    const rows = await prisma.quote.groupBy({
      _count: { _all: true },
      _sum: {
        sourceAmount: true,
        targetAmount: true,
      },
      by: ['partnerId', 'cryptoCurrency', 'targetCurrency'],
      where: {
        partnerId: { in: partnerIds },
        transaction: {
          is: { status: TransactionStatus.PAYMENT_COMPLETED },
        },
      },
    })
    const mutableByPartner = new Map<string, MutablePartnerVolume>()

    for (const row of rows) {
      const volume = mutableByPartner.get(row.partnerId) ?? {
        completedTransactions: 0,
        payout: new Map<TargetCurrency, number>(),
        source: new Map<CryptoCurrency, number>(),
        stablecoinAmount: 0,
      }
      const sourceAmount = row._sum.sourceAmount ?? 0
      volume.completedTransactions += row._count._all
      volume.stablecoinAmount += sourceAmount
      addAmount(volume.source, row.cryptoCurrency, sourceAmount)
      addAmount(volume.payout, row.targetCurrency, row._sum.targetAmount ?? 0)
      mutableByPartner.set(row.partnerId, volume)
    }

    return new Map(
      [...mutableByPartner.entries()].map(([partnerId, volume]) => [
        partnerId,
        {
          completedTransactions: volume.completedTransactions,
          payout: toSortedAmounts(volume.payout),
          source: toSortedAmounts(volume.source),
          stablecoinAmount: roundAmount(volume.stablecoinAmount),
        },
      ]),
    )
  }

  private async readRankedPartnerPage(
    prisma: PrismaClient,
    skip: number,
    take: number,
  ): Promise<RankedPartnerPage> {
    const rows = await prisma.$queryRaw<RankedPartnerRow[]>(Prisma.sql`
      WITH partner_volume AS (
        SELECT
          partner."id",
          partner."createdAt",
          COALESCE(
            SUM(quote."sourceAmount") FILTER (WHERE completed_transaction."id" IS NOT NULL),
            0
          ) AS "stablecoinAmount"
        FROM "Partner" AS partner
        LEFT JOIN "Quote" AS quote
          ON quote."partnerId" = partner."id"
        LEFT JOIN "Transaction" AS completed_transaction
          ON completed_transaction."quoteId" = quote."id"
          AND completed_transaction."status" = ${TransactionStatus.PAYMENT_COMPLETED}::"TransactionStatus"
        GROUP BY partner."id", partner."createdAt"
      )
      SELECT
        "id",
        MAX("stablecoinAmount") OVER () AS "maximumStablecoinAmount"
      FROM partner_volume
      ORDER BY
        "stablecoinAmount" DESC,
        "createdAt" DESC,
        "id" ASC
      LIMIT ${take}
      OFFSET ${skip}
    `)

    return {
      ids: rows.map(row => row.id),
      maximumStablecoinAmount: rows[0]?.maximumStablecoinAmount ?? 0,
    }
  }

  private toSummary(partner: Partner): OpsPartnerSummary {
    return {
      clientDomain: partner.clientDomain ?? undefined,
      country: partner.country ?? undefined,
      createdAt: partner.createdAt,
      email: partner.email ?? undefined,
      firstName: partner.firstName ?? undefined,
      hasApiKey: Boolean(partner.apiKey),
      id: partner.id,
      isKybApproved: partner.isKybApproved ?? false,
      lastName: partner.lastName ?? undefined,
      name: partner.name,
      needsKyc: partner.needsKyc ?? false,
      phone: partner.phone ?? undefined,
    }
  }
}
