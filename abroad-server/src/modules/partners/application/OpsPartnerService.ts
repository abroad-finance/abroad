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
import { roundToDecimals } from '../../../platform/money/round'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { normalizeClientDomainInput } from '../domain/clientDomain'
import { buildPartnerApiKeyCandidate } from './partnerApiKey'
import { fromDatabasePartnerApiKeyScope, PartnerApiKeyScopeName } from './partnerApiKeyScopes'

const API_KEY_RETRY_ATTEMPTS = 5
const LEGACY_KEY_ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1_000
const MAX_CREDENTIAL_HISTORY_EVENTS = 100

export type OpsPartnerClientDomainInput = {
  clientDomain: null | string
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

export type OpsPartnerCredentialHistory = {
  events: OpsPartnerCredentialEvent[]
  legacyCredential: {
    active: boolean
    overlapExpiresAt?: Date
  }
  managedCredentials: OpsPartnerManagedCredential[]
  partner: OpsPartnerSummary
}

export type OpsPartnerKybApprovalInput = {
  isKybApproved: boolean
}

export type OpsPartnerKycRequirementInput = {
  needsKyc: boolean
}

export type OpsPartnerListResult = {
  items: OpsPartnerListItem[]
  maximumStablecoinAmount: number
  page: number
  pageSize: number
  total: number
}

/** Every field optional: omitted keys are left untouched, `null` clears. */
export type OpsPartnerProfileInput = {
  country?: null | string
  email?: null | string
  firstName?: null | string
  lastName?: null | string
  name?: string
  phone?: null | string
}

export type OpsPartnerRotateApiKeyResult = {
  apiKey: string
  partner: OpsPartnerSummary
}

export type OpsPartnerStatusInput = {
  disabled: boolean
  reason?: null | string
}

export type OpsPartnerSummary = {
  clientDomain?: string
  country?: string
  createdAt: Date
  disabledAt?: Date
  disabledBy?: string
  disabledReason?: string
  email?: string
  firstName?: string
  hasApiKey: boolean
  id: string
  isKybApproved: boolean
  lastName?: string
  legacyKeyOverlapExpiresAt?: Date
  name: string
  needsKyc: boolean
  phone?: string
  webhookUrl?: string
}

export type OpsPartnerWebhookInput = {
  webhookUrl: null | string
}

type MutablePartnerVolume = {
  completedTransactions: number
  payout: Map<TargetCurrency, number>
  source: Map<CryptoCurrency, number>
  stablecoinAmount: number
}

type OpsPartnerCompletedVolume = {
  completedTransactions: number
  payout: OpsPartnerPayoutVolume[]
  source: OpsPartnerSourceVolume[]
  stablecoinAmount: number
}

type OpsPartnerCredentialEvent = {
  action: string
  actorLabel: string
  createdAt: Date
  id: string
  reason?: string
  reference?: string
  source: 'OPS' | 'PARTNER_PORTAL'
}

type OpsPartnerListItem = OpsPartnerSummary & {
  completedVolume: OpsPartnerCompletedVolume
}

type OpsPartnerListParams = {
  page: number
  pageSize: number
}

type OpsPartnerManagedCredential = {
  createdAt: Date
  displayPrefix: string
  expiresAt?: Date
  id: string
  lastUsedAt?: Date
  name: string
  revokedAt?: Date
  rotatedFromId?: string
  rotatedToId?: string
  scopes: PartnerApiKeyScopeName[]
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED'
}

type OpsPartnerPayoutVolume = {
  amount: number
  currency: TargetCurrency
}

type OpsPartnerSourceVolume = {
  amount: number
  currency: CryptoCurrency
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

const roundAmount = (value: number): number => roundToDecimals(value, 6)

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

  public async getCredentialHistory(partnerId: string): Promise<OpsPartnerCredentialHistory> {
    const prisma = await this.dbProvider.getClient()
    const [partner, managedCredentials, opsEvents, portalEvents] = await Promise.all([
      prisma.partner.findUnique({ where: { id: partnerId } }),
      prisma.partnerApiKey.findMany({
        include: { rotatedTo: { select: { id: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: { partnerId },
      }),
      prisma.opsAuditEvent.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_CREDENTIAL_HISTORY_EVENTS,
        where: {
          OR: [
            { action: { startsWith: 'credentials.' } },
            { action: { startsWith: 'partner.' } },
          ],
          resourceId: partnerId,
          resourceType: 'partner',
        },
      }),
      prisma.partnerPortalAuditEvent.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_CREDENTIAL_HISTORY_EVENTS,
        where: {
          action: { startsWith: 'api_key.' },
          partnerId,
        },
      }),
    ])
    if (!partner) throw new OpsPartnerNotFoundError('Partner not found')

    const now = new Date()
    const events: OpsPartnerCredentialEvent[] = [
      ...opsEvents.map(event => ({
        action: event.action,
        actorLabel: event.actorLabel,
        createdAt: event.createdAt,
        id: event.id,
        reason: event.reason ?? undefined,
        reference: event.reference ?? undefined,
        source: 'OPS' as const,
      })),
      ...portalEvents.map(event => ({
        action: event.action,
        actorLabel: 'Partner administrator',
        createdAt: event.createdAt,
        id: event.id,
        source: 'PARTNER_PORTAL' as const,
      })),
    ]
      .sort((left, right) => (
        right.createdAt.getTime() - left.createdAt.getTime()
        || right.id.localeCompare(left.id)
      ))
      .slice(0, MAX_CREDENTIAL_HISTORY_EVENTS)

    return {
      events,
      legacyCredential: {
        active: Boolean(partner.apiKey),
        overlapExpiresAt: partner.previousApiKey
          && partner.previousApiKeyExpiresAt
          && partner.previousApiKeyExpiresAt > now
          ? partner.previousApiKeyExpiresAt
          : undefined,
      },
      managedCredentials: managedCredentials.map(key => ({
        createdAt: key.createdAt,
        displayPrefix: key.displayPrefix,
        expiresAt: key.expiresAt ?? undefined,
        id: key.id,
        lastUsedAt: key.lastUsedAt ?? undefined,
        name: key.name,
        revokedAt: key.revokedAt ?? undefined,
        rotatedFromId: key.rotatedFromId ?? undefined,
        rotatedToId: key.rotatedTo?.id,
        scopes: key.scopes.map(fromDatabasePartnerApiKeyScope),
        status: key.revokedAt
          ? 'REVOKED'
          : key.expiresAt && key.expiresAt <= now
            ? 'EXPIRED'
            : 'ACTIVE',
      })),
      partner: this.toSummary(partner),
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
        data: {
          apiKey: null,
          previousApiKey: null,
          previousApiKeyExpiresAt: null,
        },
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
        const updatedPartner = await prisma.$transaction(async (transaction) => {
          const existing = await transaction.partner.findUnique({ where: { id: partnerId } })
          if (!existing) throw new OpsPartnerNotFoundError('Partner not found')

          const now = new Date()
          if (
            existing.previousApiKey
            && existing.previousApiKeyExpiresAt
            && existing.previousApiKeyExpiresAt > now
          ) {
            throw new OpsPartnerValidationError(
              'A 24-hour credential overlap is already active. Wait for it to end or revoke both keys.',
            )
          }

          return transaction.partner.update({
            data: {
              apiKey: candidate.hashed,
              previousApiKey: existing.apiKey,
              previousApiKeyExpiresAt: existing.apiKey
                ? new Date(now.getTime() + LEGACY_KEY_ROTATION_OVERLAP_MS)
                : null,
            },
            where: { id: partnerId },
          })
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
        return {
          apiKey: candidate.plaintext,
          partner: this.toSummary(updatedPartner),
        }
      }
      catch (error) {
        if (error instanceof OpsPartnerNotFoundError || this.isNotFoundError(error)) {
          throw new OpsPartnerNotFoundError('Partner not found')
        }
        if (error instanceof OpsPartnerValidationError) throw error
        if (this.isRetryableApiKeyRotationError(error) && attempt < API_KEY_RETRY_ATTEMPTS) {
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

  /**
   * Approves or revokes KYB. While unapproved, enforcePartnerKybThreshold caps
   * the partner at $100 of lifetime completed volume, so this is what lets a
   * newly onboarded partner transact at full size.
   */
  public async updateKybApproval(
    partnerId: string,
    input: OpsPartnerKybApprovalInput,
  ): Promise<OpsPartnerSummary> {
    return this.applyPartnerUpdate(partnerId, { isKybApproved: input.isKybApproved }, 'Failed to update KYB approval')
  }

  /**
   * Toggles whether this partner's users are asked to complete KYC.
   * `shouldRequestKyc` short-circuits on `needsKyc === false`, so turning this
   * off lets every user of the partner transact unverified at any amount.
   */
  public async updateKycRequirement(
    partnerId: string,
    input: OpsPartnerKycRequirementInput,
  ): Promise<OpsPartnerSummary> {
    const prisma = await this.dbProvider.getClient()

    try {
      const updatedPartner = await prisma.partner.update({
        data: { needsKyc: input.needsKyc },
        where: { id: partnerId },
      })

      return this.toSummary(updatedPartner)
    }
    catch (error) {
      if (this.isNotFoundError(error)) {
        throw new OpsPartnerNotFoundError('Partner not found')
      }
      throw new OpsPartnerValidationError('Failed to update the partner KYC requirement')
    }
  }

  /**
   * Edits the partner's descriptive fields. Credentials, KYB, KYC and status
   * each have their own endpoint so a profile edit can never change them by
   * accident; omitted keys are left untouched and `null` clears a value.
   */
  public async updateProfile(
    partnerId: string,
    input: OpsPartnerProfileInput,
  ): Promise<OpsPartnerSummary> {
    const data: Prisma.PartnerUpdateInput = {}
    if (input.name !== undefined) data.name = input.name.trim()
    if (input.email !== undefined) data.email = this.normalizeOptionalText(input.email)?.toLowerCase() ?? null
    if (input.phone !== undefined) data.phone = this.normalizeOptionalText(input.phone) ?? null
    if (input.firstName !== undefined) data.firstName = this.normalizeOptionalText(input.firstName) ?? null
    if (input.lastName !== undefined) data.lastName = this.normalizeOptionalText(input.lastName) ?? null
    if (input.country !== undefined) data.country = this.normalizeOptionalText(input.country)?.toUpperCase() ?? null

    if (Object.keys(data).length === 0) {
      throw new OpsPartnerValidationError('No partner profile fields were provided')
    }

    try {
      const prisma = await this.dbProvider.getClient()
      return this.toSummary(await prisma.partner.update({ data, where: { id: partnerId } }))
    }
    catch (error) {
      if (this.isNotFoundError(error)) {
        throw new OpsPartnerNotFoundError('Partner not found')
      }
      if (this.isUniqueConstraintFor(error, 'email')) {
        throw new OpsPartnerValidationError('Another partner already uses that email')
      }
      throw new OpsPartnerValidationError('Failed to update the partner profile')
    }
  }

  /**
   * Suspends or restores the whole partner. Every API key and client-domain
   * session for it stops authenticating while `disabledAt` is set.
   */
  public async updateStatus(
    partnerId: string,
    input: OpsPartnerStatusInput,
    actor: null | string,
  ): Promise<OpsPartnerSummary> {
    const data = input.disabled
      ? {
          disabledAt: new Date(),
          disabledBy: actor ?? null,
          disabledReason: this.normalizeOptionalText(input.reason) ?? null,
        }
      : { disabledAt: null, disabledBy: null, disabledReason: null }

    return this.applyPartnerUpdate(partnerId, data, 'Failed to update the partner status')
  }

  /**
   * Sets the partner-wide webhook endpoint used for transaction callbacks.
   */
  public async updateWebhookUrl(
    partnerId: string,
    input: OpsPartnerWebhookInput,
  ): Promise<OpsPartnerSummary> {
    const webhookUrl = this.normalizeOptionalText(input.webhookUrl) ?? null
    if (webhookUrl !== null && !this.isHttpsUrl(webhookUrl)) {
      throw new OpsPartnerValidationError('Webhook URL must be an absolute https:// URL')
    }

    return this.applyPartnerUpdate(partnerId, { webhookUrl }, 'Failed to update the partner webhook URL')
  }

  private async applyPartnerUpdate(
    partnerId: string,
    data: Prisma.PartnerUpdateInput,
    failureMessage: string,
  ): Promise<OpsPartnerSummary> {
    try {
      const prisma = await this.dbProvider.getClient()
      return this.toSummary(await prisma.partner.update({ data, where: { id: partnerId } }))
    }
    catch (error) {
      if (this.isNotFoundError(error)) {
        throw new OpsPartnerNotFoundError('Partner not found')
      }
      throw new OpsPartnerValidationError(failureMessage)
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

  private isHttpsUrl(value: string): boolean {
    try {
      return new URL(value).protocol === 'https:'
    }
    catch {
      return false
    }
  }

  private isNotFoundError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025'
  }

  private isRetryableApiKeyRotationError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === 'P2002' || error.code === 'P2034')
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

  private normalizeOptionalText(value: null | string | undefined): string | undefined {
    if (value === null || value === undefined) return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
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
      disabledAt: partner.disabledAt ?? undefined,
      disabledBy: partner.disabledBy ?? undefined,
      disabledReason: partner.disabledReason ?? undefined,
      email: partner.email ?? undefined,
      firstName: partner.firstName ?? undefined,
      hasApiKey: Boolean(partner.apiKey),
      id: partner.id,
      isKybApproved: partner.isKybApproved ?? false,
      lastName: partner.lastName ?? undefined,
      legacyKeyOverlapExpiresAt: partner.previousApiKey
        && partner.previousApiKeyExpiresAt
        && partner.previousApiKeyExpiresAt > new Date()
        ? partner.previousApiKeyExpiresAt
        : undefined,
      name: partner.name,
      needsKyc: partner.needsKyc ?? false,
      phone: partner.phone ?? undefined,
      webhookUrl: partner.webhookUrl ?? undefined,
    }
  }
}
