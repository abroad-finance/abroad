// src/controllers/KycController.ts
import { KycStatus } from '@prisma/client'
import {
  Body,
  Controller,
  Post,
  Response,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

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
  /**
   * Checks or initiates the KYC flow for a given user.
   *
   * @param requestBody - Contains the user identifier (`user_id`).
   * @returns Current KYC status and a link to complete KYC if needed.
   */
  @Post()
  @Response('400', 'Bad Request')
  @Response('401', 'Unauthorized')
  @Response('404', 'Not Found')
  @Response('500', 'Internal Server Error')
  @SuccessResponse('200', 'KYC status response')
  public async checkKyc(@Body() requestBody: KycRequest): Promise<KycResponse> {
    // Dummy response
    return {
      kyc_link: 'https://kycprovider.com/start?user=' + requestBody.user_id,
      kyc_status: 'PENDING',
      user_id: requestBody.user_id,
    }
  }
}
