import { KycStatus } from '@prisma/client'
import { inject } from 'inversify'

import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IKycService } from '../interfaces/IKycService'
import { TYPES } from '../types'

export interface GetKycStatusRequest {
  partnerId: string
  redirectUrl?: string
  userId: string
}

export interface GetKycStatusResponse {
  inquiryId: string
  kycLink: string
  status: KycStatus
}

export class KycUseCase {
  public constructor(
        @inject(TYPES.IKycService) private kycService: IKycService,
        @inject(TYPES.IDatabaseClientProvider) private databaseClientProvider: IDatabaseClientProvider,
  ) { }

  public async getKycStatus({ partnerId, redirectUrl, userId }: GetKycStatusRequest): Promise<GetKycStatusResponse> {
    const dbClient = await this.databaseClientProvider.getClient()

    const partnerUser = await dbClient.partnerUser.upsert({
      create: {
        partnerId,
        userId,
      },
      update: {},
      where: {
        partnerId_userId: {
          partnerId,
          userId,
        },
      },
    })
    // TODO: Check for expired KYC

    if (!partnerUser.kycId) {
      const { inquiryId, kycLink, status } = await this.kycService.startKyc({ redirectUrl, userId: partnerUser.id })

      await dbClient.partnerUser.update({
        data: {
          kycId: inquiryId,
          kycStatus: status,
        },
        where: { id: partnerUser.id },
      })

      return { inquiryId, kycLink, status }
    }

    const { inquiryId, kycLink, status } = await this.kycService.getKycStatus({ inquiryId: partnerUser.kycId, redirectUrl })
    return { inquiryId, kycLink, status }
  }
}
