// src/controllers/KycController.ts
import { KycStatus } from '@prisma/client'
import { Request as RequestExpress } from 'express'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Post,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import { z } from 'zod'

import { IPartnerService } from '../interfaces'
import { TYPES } from '../types'
import { KycUseCase } from '../useCases/kycUseCase'

const kycRequestSchema = z.object({
  user_id: z.string(),
})

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
@Security('BearerAuth')
export class KycController extends Controller {
  public constructor(
    @inject(TYPES.KycUseCase) private kycUseCase: KycUseCase,
    @inject(TYPES.IPartnerService) private partnerService: IPartnerService,
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
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('ApiKeyAuth')
  @SuccessResponse('200', 'KYC status response')
  public async checkKyc(
    @Body() requestBody: KycRequest,
    @Request() request: RequestExpress,
    @Res() badRequestResponse: TsoaResponse<400, { reason: string }>,
  ): Promise<KycResponse> {
    const parsed = kycRequestSchema.safeParse(requestBody)
    if (!parsed.success) {
      return badRequestResponse(400, { reason: parsed.error.message })
    }

    try {
      const partner = request.user

      const { kycLink, status } = await this.kycUseCase.getKycStatus({ partnerId: partner.id, userId: parsed.data.user_id })

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
