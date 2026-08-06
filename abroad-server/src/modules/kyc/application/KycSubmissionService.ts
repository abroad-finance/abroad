import { DocumentType, KycStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { assertPartnerUserEnabled } from '../../shared/partnerUserAccess'
import { IKycDocumentStorage } from './contracts/IKycDocumentStorage'

export interface KycSubmissionInput {
  address: string
  city: string
  dateOfBirth: Date
  document: KycDocumentInput
  documentNumber: string
  documentType: DocumentType
  email: string
  fullName: string
  nationality: string
  partnerId: string
  phone: string
  userId: string
}

interface KycDocumentInput {
  buffer: Buffer
  contentType: string
  fileExtension: string
}

interface KycSubmissionResult {
  status: KycStatus
}

/**
 * Handles a self-service KYC form submission. A complete submission is
 * auto-approved: the user is resolved (and checked for being disabled), the
 * document image is stored, and a single current KYC row is written/refreshed
 * with status APPROVED.
 */
@injectable()
export class KycSubmissionService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.IKycDocumentStorage)
    private readonly documentStorage: IKycDocumentStorage,
  ) {}

  public async submit(input: KycSubmissionInput): Promise<KycSubmissionResult> {
    const prisma = await this.dbProvider.getClient()

    const partnerUser = await prisma.partnerUser.upsert({
      create: { partnerId: input.partnerId, userId: input.userId },
      update: {},
      where: {
        partnerId_userId: { partnerId: input.partnerId, userId: input.userId },
      },
    })
    assertPartnerUserEnabled(partnerUser)

    const documentImagePath = await this.documentStorage.upload({
      buffer: input.document.buffer,
      contentType: input.document.contentType,
      fileExtension: input.document.fileExtension,
      partnerUserId: partnerUser.id,
    })

    const data = {
      address: input.address,
      city: input.city,
      dateOfBirth: input.dateOfBirth,
      documentImagePath,
      documentNumber: input.documentNumber,
      documentType: input.documentType,
      email: input.email,
      fullName: input.fullName,
      nationality: input.nationality,
      phone: input.phone,
      reviewedAt: new Date(),
      status: KycStatus.APPROVED,
    }

    // One current KYC record per user: refresh the latest if present, else create.
    const existing = await prisma.partnerUserKyc.findFirst({
      orderBy: { createdAt: 'desc' },
      where: { partnerUserId: partnerUser.id },
    })

    const kyc = existing
      ? await prisma.partnerUserKyc.update({ data, where: { id: existing.id } })
      : await prisma.partnerUserKyc.create({
          data: { ...data, partnerUserId: partnerUser.id },
        })

    return { status: kyc.status }
  }
}
