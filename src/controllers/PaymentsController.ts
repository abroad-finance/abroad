// src/controllers/PaymentsController.ts

import { PaymentMethod } from '@prisma/client'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Response,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

import { IPaymentServiceFactory } from '../interfaces/IPaymentServiceFactory'
import { TYPES } from '../types'

// Define the response for the banks list endpoint
interface Bank {
  bankCode: number
  bankName: string
}

interface BanksResponse {
  banks: Bank[]
}

// Define the request body schema.
interface OnboardRequest {
  account: string
}

// Define the expected response from onboardUser.
interface OnboardResponse {
  message?: string
  success: boolean
}

@Route('payments')
@Security('ApiKeyAuth')
@Security('BearerAuth')
export class PaymentsController extends Controller {
  constructor(
    @inject(TYPES.IPaymentServiceFactory)
    private paymentServiceFactory: IPaymentServiceFactory,
  ) {
    super()
  }

  /**
   * Lists all banks available for a specific payment method.
   *
   * @param paymentMethod - The payment method to get banks for (MOVII, NEQUI, etc.)
   * @returns List of banks supported by the payment method
   */
  @Get('banks')
  @Response('400', 'Bad Request')
  @SuccessResponse('200', 'Banks retrieved successfully')
  public async getBanks(@Query() paymentMethod?: PaymentMethod): Promise<BanksResponse> {
    try {
      // If no payment method is provided, default to MOVII
      const method = paymentMethod || PaymentMethod.MOVII

      const paymentService = this.paymentServiceFactory.getPaymentService(method)
      return {
        banks: paymentService.banks,
      }
    }
    catch {
      this.setStatus(400)
      return { banks: [] }
    }
  }

  /**
   * Onboards a user by calling the payment service's onboardUser method.
   * @param requestBody - Contains the account string.
   * @returns The result of the onboardUser operation.
   */
  @Post('onboard')
  @Response('400', 'Bad Request')
  @SuccessResponse('200', 'User onboarded')
  public async onboardUser(@Body() requestBody: OnboardRequest): Promise<OnboardResponse> {
    if (!requestBody.account) {
      this.setStatus(400)
      return { message: 'Account is required', success: false }
    }

    try {
      const paymentService = this.paymentServiceFactory.getPaymentService(PaymentMethod.MOVII)
      const result = await paymentService.onboardUser({ account: requestBody.account })
      return result
    }
    catch (error) {
      this.setStatus(400)
      return { message: error instanceof Error ? error.message : 'Unknown error', success: false }
    }
  }
}
