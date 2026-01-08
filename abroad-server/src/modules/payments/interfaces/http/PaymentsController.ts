// src/modules/payments/interfaces/http/PaymentsController.ts

import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  Hidden,
  Post,
  Query,
  Response,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

import { TYPES } from '../../../../app/container/types'
import { mapErrorToHttpResponse } from '../../../../core/errors'
import { IPaymentUseCase, LiquidityResult, OnboardResult } from '../../application/paymentUseCase'
import { DEFAULT_PAYMENT_METHOD, SupportedPaymentMethod } from '../../application/supportedPaymentMethods'

// Define the response for the liquidity endpoint
type LiquidityResponse = LiquidityResult

// Define the request body schema.
interface OnboardRequest {
  account: string
}

// Define the expected response from onboardUser.
type OnboardResponse = OnboardResult

@Route('payments')
@Security('ApiKeyAuth')
@Security('BearerAuth')
export class PaymentsController extends Controller {
  constructor(
    @inject(TYPES.PaymentUseCase)
    private readonly paymentUseCase: IPaymentUseCase,
  ) {
    super()
  }

  /**
   * Gets the liquidity for a specific payment method.
   *
   * @param paymentMethod - The payment method to get liquidity for (BREB, PIX)
   * @returns The liquidity of the payment method
   */
  @Get('liquidity')
  @Response('400', 'Bad Request')
  @SuccessResponse('200', 'Liquidity retrieved successfully')
  public async getLiquidity(@Query() paymentMethod?: SupportedPaymentMethod): Promise<LiquidityResponse> {
    try {
      const result = await this.paymentUseCase.getLiquidity(paymentMethod)
      if (!result.success) {
        this.setStatus(400)
      }
      return result
    }
    catch (error) {
      const mapped = mapErrorToHttpResponse(error)
      this.setStatus(mapped.status)
      return mapped.body as LiquidityResponse
    }
  }

  /**
   * Onboards a user by calling the payment service's onboardUser method.
   * @param requestBody - Contains the account string.
   * @returns The result of the onboardUser operation.
   */
  @Hidden()
  @Post('onboard')
  @Response('400', 'Bad Request')
  @SuccessResponse('200', 'User onboarded')
  public async onboardUser(@Body() requestBody: OnboardRequest): Promise<OnboardResponse> {
    try {
      if (!requestBody.account) {
        this.setStatus(400)
        return { message: 'Account is required', success: false }
      }

      const result = await this.paymentUseCase.onboardUser(requestBody.account, DEFAULT_PAYMENT_METHOD)
      if (!result.success) {
        this.setStatus(400)
      }
      return result
    }
    catch (error) {
      const mapped = mapErrorToHttpResponse(error)
      this.setStatus(mapped.status)
      return mapped.body as OnboardResponse
    }
  }
}
