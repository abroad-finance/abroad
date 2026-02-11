import { Partner, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { buildPartnerApiKeyCandidate } from './partnerApiKey'

const API_KEY_RETRY_ATTEMPTS = 5

export type OpsPartnerCreateInput = {
  company: string
  country: string
  email: string
  firstName: string
  lastName: string
  phone?: string
}

export type OpsPartnerListParams = {
  page: number
  pageSize: number
}

export type OpsPartnerSummary = {
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

export type OpsPartnerListResult = {
  items: OpsPartnerSummary[]
  page: number
  pageSize: number
  total: number
}

export type OpsPartnerCreateResult = {
  apiKey: string
  partner: OpsPartnerSummary
}

export type OpsPartnerRotateApiKeyResult = {
  apiKey: string
  partner: OpsPartnerSummary
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

@injectable()
export class OpsPartnerService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
  ) {}

  public async createPartner(input: OpsPartnerCreateInput): Promise<OpsPartnerCreateResult> {
    const prisma = await this.dbProvider.getClient()

    try {
      for (let attempt = 1; attempt <= API_KEY_RETRY_ATTEMPTS; attempt += 1) {
        const candidate = buildPartnerApiKeyCandidate()
        try {
          const created = await prisma.partner.create({
            data: {
              apiKey: candidate.hashed,
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
      if (error instanceof OpsPartnerValidationError) {
        throw error
      }
      throw new OpsPartnerValidationError('Failed to create partner in the database')
    }
  }

  public async listPartners(params: OpsPartnerListParams): Promise<OpsPartnerListResult> {
    const prisma = await this.dbProvider.getClient()
    const skip = (params.page - 1) * params.pageSize

    const [partners, total] = await Promise.all([
      prisma.partner.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.pageSize,
      }),
      prisma.partner.count(),
    ])

    return {
      items: partners.map(partner => this.toSummary(partner)),
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

  private toSummary(partner: Partner): OpsPartnerSummary {
    return {
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
