// src/controllers/PaymentsController.ts

import { PaymentMethod } from '@prisma/client'
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

import { IPaymentServiceFactory } from '../interfaces/IPaymentServiceFactory'
import { TYPES } from '../types'

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
export class PaymentsController extends Controller {
  constructor(
    @inject(TYPES.IPaymentServiceFactory)
    private paymentServiceFactory: IPaymentServiceFactory,
  ) {
    super()
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
      // For example purposes, we use the MOVII payment service.
      // In a real scenario you might select a service based on some business logic.
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
