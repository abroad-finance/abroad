import { DocumentType, KycStatus, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { NotFoundError } from '../../../core/errors'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IKycDocumentStorage, KycDocumentDownload } from './contracts/IKycDocumentStorage'

export type OpsKycDisableInput = {
  disabledBy?: string
  partnerUserId: string
  reason?: string
}

export type OpsKycListParams = {
  page: number
  pageSize: number
  status?: KycStatus
}

export type OpsKycListResult = {
  items: OpsKycSummary[]
  page: number
  pageSize: number
  total: number
}

export type OpsKycSummary = {
  address: null | string
  city: null | string
  dateOfBirth: Date | null
  disabledAt: Date | null
  documentNumber: null | string
  documentType: DocumentType | null
  email: null | string
  fullName: null | string
  hasDocument: boolean
  id: string
  nationality: null | string
  partnerId: string
  partnerName: string
  partnerUserId: string
  phone: null | string
  reviewedAt: Date | null
  status: KycStatus
  submittedAt: Date
  userId: string
}

export type OpsKycUserState = {
  disabledAt: Date | null
  partnerUserId: string
}

type KycWithRelations = Prisma.PartnerUserKycGetPayload<{
  include: { partnerUser: { include: { partner: true } } }
}>

@injectable()
export class OpsKycService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.IKycDocumentStorage)
    private readonly documentStorage: IKycDocumentStorage,
  ) {}

  public async disableUser(input: OpsKycDisableInput): Promise<OpsKycUserState> {
    const prisma = await this.dbProvider.getClient()
    try {
      const updated = await prisma.partnerUser.update({
        data: {
          disabledAt: new Date(),
          disabledBy: input.disabledBy ?? null,
          disabledReason: input.reason ?? null,
        },
        select: { disabledAt: true, id: true },
        where: { id: input.partnerUserId },
      })
      return { disabledAt: updated.disabledAt, partnerUserId: updated.id }
    }
    catch (error) {
      throw this.mapNotFound(error, 'User not found')
    }
  }

  public async enableUser(partnerUserId: string): Promise<OpsKycUserState> {
    const prisma = await this.dbProvider.getClient()
    try {
      const updated = await prisma.partnerUser.update({
        data: { disabledAt: null, disabledBy: null, disabledReason: null },
        select: { disabledAt: true, id: true },
        where: { id: partnerUserId },
      })
      return { disabledAt: updated.disabledAt, partnerUserId: updated.id }
    }
    catch (error) {
      throw this.mapNotFound(error, 'User not found')
    }
  }

  public async getDocument(kycId: string): Promise<KycDocumentDownload> {
    const prisma = await this.dbProvider.getClient()
    const kyc = await prisma.partnerUserKyc.findUnique({
      select: { documentImagePath: true },
      where: { id: kycId },
    })
    if (!kyc?.documentImagePath) {
      throw new NotFoundError('KYC document not found')
    }
    return this.documentStorage.download(kyc.documentImagePath)
  }

  public async listSubmissions(params: OpsKycListParams): Promise<OpsKycListResult> {
    const prisma = await this.dbProvider.getClient()
    const skip = (params.page - 1) * params.pageSize

    // Only self-service form submissions (those carry a stored document).
    const where: Prisma.PartnerUserKycWhereInput = {
      documentImagePath: { not: null },
      ...(params.status ? { status: params.status } : {}),
    }

    const [records, total] = await Promise.all([
      prisma.partnerUserKyc.findMany({
        include: { partnerUser: { include: { partner: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.pageSize,
        where,
      }),
      prisma.partnerUserKyc.count({ where }),
    ])

    return {
      items: records.map(record => this.toSummary(record)),
      page: params.page,
      pageSize: params.pageSize,
      total,
    }
  }

  public async rejectKyc(kycId: string): Promise<{ id: string, status: KycStatus }> {
    const prisma = await this.dbProvider.getClient()
    try {
      const updated = await prisma.partnerUserKyc.update({
        data: { reviewedAt: new Date(), status: KycStatus.REJECTED },
        select: { id: true, status: true },
        where: { id: kycId },
      })
      return { id: updated.id, status: updated.status }
    }
    catch (error) {
      throw this.mapNotFound(error, 'KYC submission not found')
    }
  }

  private mapNotFound(error: unknown, message: string): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return new NotFoundError(message)
    }
    return error
  }

  private toSummary(record: KycWithRelations): OpsKycSummary {
    return {
      address: record.address,
      city: record.city,
      dateOfBirth: record.dateOfBirth,
      disabledAt: record.partnerUser.disabledAt,
      documentNumber: record.documentNumber,
      documentType: record.documentType,
      email: record.email,
      fullName: record.fullName,
      hasDocument: Boolean(record.documentImagePath),
      id: record.id,
      nationality: record.nationality,
      partnerId: record.partnerUser.partnerId,
      partnerName: record.partnerUser.partner.name,
      partnerUserId: record.partnerUserId,
      phone: record.phone,
      reviewedAt: record.reviewedAt,
      status: record.status,
      submittedAt: record.createdAt,
      userId: record.partnerUser.userId,
    }
  }
}
