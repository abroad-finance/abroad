// src/modules/payments/interfaces/http/PaymentsController.ts

import { PaymentMethod } from '@prisma/client'
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
import { BanksResult, IPaymentUseCase, LiquidityResult, OnboardResult } from '../../application/paymentUseCase'

// Define the response for the banks list endpoint
type BanksResponse = BanksResult

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
      return this.paymentUseCase.getBanks(paymentMethod)
    }
    catch {
      this.setStatus(400)
      return { banks: [] }
    }
  }

  /**
   * Gets the liquidity for a specific payment method.
   *
   * @param paymentMethod - The payment method to get liquidity for (MOVII, NEQUI, etc.)
   * @returns The liquidity of the payment method
   */
  @Get('liquidity')
  @Response('400', 'Bad Request')
  @SuccessResponse('200', 'Liquidity retrieved successfully')
  public async getLiquidity(@Query() paymentMethod?: PaymentMethod): Promise<LiquidityResponse> {
    const result = await this.paymentUseCase.getLiquidity(paymentMethod)
    if (!result.success) {
      this.setStatus(400)
    }
    return result
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
    if (!requestBody.account) {
      this.setStatus(400)
      return { message: 'Account is required', success: false }
    }

    const result = await this.paymentUseCase.onboardUser(requestBody.account, PaymentMethod.MOVII)
    if (!result.success) {
      this.setStatus(400)
    }
    return result
  }
}
