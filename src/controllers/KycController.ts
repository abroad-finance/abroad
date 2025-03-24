// src/controllers/KycController.ts
import { KycStatus } from '@prisma/client'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Post,
  Response,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IKycService } from '../interfaces/IKycService'
import { TYPES } from '../types'

interface KycRequest {
  user_id: string
}

interface KycResponse {
  kyc_link: string
  kyc_status: KycStatus
  user_id: string
}

@Route('kyc')
@Security('ApiKeyAuth')
export class KycController extends Controller {
  public constructor(
    @inject(TYPES.IKycService) private kycService: IKycService,
    @inject(TYPES.IDatabaseClientProvider) private databaseClientProvider: IDatabaseClientProvider,
  ) {
    super()
  }

  /**
   * Checks or initiates the KYC flow for a given user.
   *
   * @param requestBody - Contains the user identifier (user_id).
   * @returns Current KYC status and a link to complete KYC if needed.
   */
  @Post()
  @Response('400', 'Bad Request')
  @Response('401', 'Unauthorized')
  @Response('404', 'Not Found')
  @Response('500', 'Internal Server Error')
  @SuccessResponse('200', 'KYC status response')
  public async checkKyc(@Body() requestBody: KycRequest): Promise<KycResponse> {
    if (!requestBody.user_id) {
      this.setStatus(400)
      throw new Error('user_id is required')
    }

    try {
      const dbClient = await this.databaseClientProvider.getClient()
      const user = await dbClient.partnerUser.findUnique({
        where: {
          id: requestBody.user_id,
        },
      })

      if (!user) {
        this.setStatus(404)
        throw new Error('User not found')
      }

      const { kycLink, status } = await this.kycService.getKycStatus(user.id)

      return {
        kyc_link: kycLink,
        kyc_status: status,
        user_id: requestBody.user_id,
      }
    }
    catch (error) {
      if (error instanceof Error) {
        this.setStatus(500)
        throw new Error(error.message)
      }
      else {
        this.setStatus(500)
        throw new Error('An unexpected error occurred')
      }
    }
  }
}
