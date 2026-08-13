import { DocumentType, KycStatus, OpsRole, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ApplicationError, NotFoundError } from '../../../core/errors'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { getOpsRolePermissions } from '../../operations/application/opsPermissions'
import { IKycDocumentStorage, KycDocumentDownload } from './contracts/IKycDocumentStorage'

export type OpsKycAssignment = {
  id: string
  reviewer: null | OpsKycReviewer
  version: number
}

export type OpsKycDetail = {
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
  reviewer: null | OpsKycReviewer
  status: KycStatus
  submittedAt: Date
  userId: string
  version: number
}

export type OpsKycListResult = {
  items: OpsKycSummary[]
  page: number
  pageSize: number
  total: number
}

export type OpsKycReviewer = {
  displayName: string
  id: string
  role: OpsRole
}

/** The customer identity behind a transaction, masked as the queue is. */
export type OpsKycTransactionLink = {
  /**
   * The submission on file when the transaction was created — what the
   * transaction was actually accepted against. A later resubmission is still
   * listed, but it is not the evidence behind this transaction. Null when the
   * user only ever submitted KYC after the transaction.
   */
  effectiveSubmissionId: null | string
  partnerUser: {
    disabledAt: Date | null
    id: string
    partnerId: string
    partnerName: string
    userId: string
  }
  submissions: OpsKycSummary[]
  transactionId: string
}

export type OpsKycUserState = {
  disabledAt: Date | null
  partnerUserId: string
}

type KycWithRelations = Prisma.PartnerUserKycGetPayload<{
  include: {
    opsReviewer: { select: { displayName: true, id: true, role: true } }
    partnerUser: { include: { partner: true } }
  }
}>

type OpsKycDisableInput = {
  disabledBy?: string
  partnerUserId: string
  reason?: string
}

type OpsKycListParams = {
  ageHoursGte?: number
  createdFrom?: Date
  createdTo?: Date
  documentType?: DocumentType
  kycId?: string
  nationality?: string
  page: number
  pageSize: number
  partnerId?: string
  query?: string
  reviewer?: string
  status?: KycStatus
}

type OpsKycSummary = {
  disabledAt: Date | null
  documentNumberMasked: null | string
  documentType: DocumentType | null
  emailMasked: null | string
  fullNameMasked: null | string
  hasDocument: boolean
  id: string
  nationality: null | string
  partnerId: string
  partnerName: string
  partnerUserId: string
  reviewedAt: Date | null
  reviewer: null | OpsKycReviewer
  status: KycStatus
  submittedAt: Date
  version: number
}

class OpsKycConflictError extends ApplicationError {
  public constructor() {
    super(409, 'ops_kyc_conflict', 'This KYC review changed after it was loaded')
    this.name = 'OpsKycConflictError'
  }
}

class OpsKycValidationError extends ApplicationError {
  public constructor(message: string) {
    super(400, 'ops_kyc_invalid', message)
    this.name = 'OpsKycValidationError'
  }
}

@injectable()
export class OpsKycService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.IKycDocumentStorage)
    private readonly documentStorage: IKycDocumentStorage,
  ) {}

  public async assignReviewer(
    kycId: string,
    reviewerUserId: null | string,
    expectedVersion: number,
  ): Promise<OpsKycAssignment> {
    const prisma = await this.dbProvider.getClient()
    return prisma.$transaction(async (transaction) => {
      if (reviewerUserId) {
        const reviewer = await transaction.opsUser.findUnique({ where: { id: reviewerUserId } })
        if (
          !reviewer
          || reviewer.disabledAt
          || !getOpsRolePermissions(reviewer.role).includes('kyc:decide')
        ) {
          throw new OpsKycValidationError('Reviewer must be an enabled KYC decision maker')
        }
      }

      const update = await transaction.partnerUserKyc.updateMany({
        data: {
          opsReviewerUserId: reviewerUserId,
          opsReviewVersion: { increment: 1 },
        },
        where: { id: kycId, opsReviewVersion: expectedVersion },
      })
      if (update.count !== 1) {
        const exists = await transaction.partnerUserKyc.count({ where: { id: kycId } })
        if (exists === 0) throw new NotFoundError('KYC submission not found')
        throw new OpsKycConflictError()
      }
      const assigned = await transaction.partnerUserKyc.findUnique({
        include: {
          opsReviewer: { select: { displayName: true, id: true, role: true } },
        },
        where: { id: kycId },
      })
      if (!assigned) throw new NotFoundError('KYC submission not found')
      return {
        id: assigned.id,
        reviewer: assigned.opsReviewer,
        version: assigned.opsReviewVersion,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  }

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

  public async getSubmission(kycId: string): Promise<OpsKycDetail> {
    const prisma = await this.dbProvider.getClient()
    const record = await prisma.partnerUserKyc.findUnique({
      include: {
        opsReviewer: { select: { displayName: true, id: true, role: true } },
        partnerUser: { include: { partner: true } },
      },
      where: { id: kycId },
    })
    if (!record) throw new NotFoundError('KYC submission not found')
    return this.toDetail(record)
  }

  /**
   * Resolves who is behind a transaction. Everything returned is masked to the
   * same degree as the review queue: identifying the customer is a `kyc:read`
   * task, reading their identity evidence stays a separate audited reveal.
   */
  public async getTransactionKyc(transactionId: string): Promise<OpsKycTransactionLink> {
    const prisma = await this.dbProvider.getClient()
    const transaction = await prisma.transaction.findUnique({
      select: {
        createdAt: true,
        partnerUser: { include: { partner: true } },
      },
      where: { id: transactionId },
    })
    if (!transaction) throw new NotFoundError('Transaction not found')

    const records = await prisma.partnerUserKyc.findMany({
      include: {
        opsReviewer: { select: { displayName: true, id: true, role: true } },
        partnerUser: { include: { partner: true } },
      },
      orderBy: { createdAt: 'desc' },
      where: { partnerUserId: transaction.partnerUser.id },
    })
    const effective = records.find(record => record.createdAt <= transaction.createdAt)

    return {
      effectiveSubmissionId: effective?.id ?? null,
      partnerUser: {
        disabledAt: transaction.partnerUser.disabledAt,
        id: transaction.partnerUser.id,
        partnerId: transaction.partnerUser.partnerId,
        partnerName: transaction.partnerUser.partner.name,
        userId: transaction.partnerUser.userId,
      },
      submissions: records.map(record => this.toSummary(record)),
      transactionId,
    }
  }

  public async listReviewers(): Promise<OpsKycReviewer[]> {
    const prisma = await this.dbProvider.getClient()
    return prisma.opsUser.findMany({
      orderBy: [{ displayName: 'asc' }, { email: 'asc' }],
      select: { displayName: true, id: true, role: true },
      where: {
        disabledAt: null,
        role: { in: [OpsRole.COMPLIANCE, OpsRole.ADMINISTRATOR] },
      },
    })
  }

  public async listSubmissions(params: OpsKycListParams): Promise<OpsKycListResult> {
    const prisma = await this.dbProvider.getClient()
    const skip = (params.page - 1) * params.pageSize

    // Only self-service form submissions (those carry a stored document).
    const ageCutoff = params.ageHoursGte
      ? new Date(Date.now() - params.ageHoursGte * 60 * 60 * 1_000)
      : undefined
    const upperCreatedAt = [params.createdTo, ageCutoff]
      .filter((date): date is Date => Boolean(date))
      .sort((left, right) => left.getTime() - right.getTime())[0]
    const query = params.query?.trim()
    const where: Prisma.PartnerUserKycWhereInput = {
      createdAt: params.createdFrom || upperCreatedAt
        ? { gte: params.createdFrom, lte: upperCreatedAt }
        : undefined,
      // The queue is self-service review work, which always stores a document.
      // An explicit id is a targeted lookup instead — following the link from a
      // transaction, say — so it must also resolve the historical rows that
      // predate the self-service form and carry no document.
      documentImagePath: params.kycId ? undefined : { not: null },
      documentType: params.documentType,
      id: params.kycId,
      nationality: params.nationality
        ? { equals: params.nationality, mode: 'insensitive' }
        : undefined,
      opsReviewerUserId: params.reviewer === 'UNASSIGNED'
        ? null
        : params.reviewer || undefined,
      OR: query
        ? [
            { documentNumber: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
            { fullName: { contains: query, mode: 'insensitive' } },
            { partnerUser: { userId: { contains: query, mode: 'insensitive' } } },
          ]
        : undefined,
      partnerUser: params.partnerId
        ? { partnerId: params.partnerId }
        : undefined,
      status: params.status,
    }

    const [records, total] = await Promise.all([
      prisma.partnerUserKyc.findMany({
        include: {
          opsReviewer: { select: { displayName: true, id: true, role: true } },
          partnerUser: { include: { partner: true } },
        },
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

  private maskDocumentNumber(value: null | string): null | string {
    const normalized = value?.trim()
    if (!normalized) return null
    return `•••• ${normalized.slice(-4)}`
  }

  private maskEmail(value: null | string): null | string {
    const normalized = value?.trim()
    if (!normalized) return null
    const separator = normalized.lastIndexOf('@')
    if (separator <= 0) return '••••'
    return `${normalized.charAt(0)}•••${normalized.slice(separator)}`
  }

  private maskName(value: null | string): null | string {
    const normalized = value?.trim()
    if (!normalized) return null
    return normalized.split(/\s+/).map(part => `${part.charAt(0)}••`).join(' ')
  }

  private toDetail(record: KycWithRelations): OpsKycDetail {
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
      reviewer: record.opsReviewer,
      status: record.status,
      submittedAt: record.createdAt,
      userId: record.partnerUser.userId,
      version: record.opsReviewVersion,
    }
  }

  private toSummary(record: KycWithRelations): OpsKycSummary {
    return {
      disabledAt: record.partnerUser.disabledAt,
      documentNumberMasked: this.maskDocumentNumber(record.documentNumber),
      documentType: record.documentType,
      emailMasked: this.maskEmail(record.email),
      fullNameMasked: this.maskName(record.fullName),
      hasDocument: Boolean(record.documentImagePath),
      id: record.id,
      nationality: record.nationality,
      partnerId: record.partnerUser.partnerId,
      partnerName: record.partnerUser.partner.name,
      partnerUserId: record.partnerUserId,
      reviewedAt: record.reviewedAt,
      reviewer: record.opsReviewer,
      status: record.status,
      submittedAt: record.createdAt,
      version: record.opsReviewVersion,
    }
  }
}
