// src/controllers/PaymentsController.ts

import { Country, PaymentMethod } from '@prisma/client'
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

import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
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

// Define the response for the liquidity endpoint
interface LiquidityResponse {
  liquidity: number
  message?: string
  success: boolean
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
    @inject(TYPES.IDatabaseClientProvider) private dbClientProvider: IDatabaseClientProvider,
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
   * Gets the liquidity for a specific payment method.
   *
   * @param paymentMethod - The payment method to get liquidity for (MOVII, NEQUI, etc.)
   * @returns The liquidity of the payment method
   */
  @Get('liquidity')
  @Response('400', 'Bad Request')
  @SuccessResponse('200', 'Liquidity retrieved successfully')
  public async getLiquidity(@Query() paymentMethod?: PaymentMethod): Promise<LiquidityResponse> {
    try {
      // If no payment method is provided, default to MOVII
      const method = paymentMethod || PaymentMethod.MOVII
      const clientDb = await this.dbClientProvider.getClient()
      const paymentProvider = await clientDb.paymentProvider.upsert({
        create: {
          country: Country.CO,
          id: method,
          liquidity: 0,
          name: method,
        },
        update: {},
        where: {
          id: method,
        },
      })

      if (paymentProvider.liquidity !== 0) {
        return {
          liquidity: paymentProvider.liquidity,
          message: 'Liquidity retrieved successfully',
          success: true,
        }
      }
      const paymentService = this.paymentServiceFactory.getPaymentService(method)
      const liquidity = await paymentService.getLiquidity()
      if (liquidity) {
        await clientDb.paymentProvider.update({
          data: { liquidity },
          where: { id: method },
        })
      }

      return {
        liquidity: liquidity || 0,
        message: 'Liquidity retrieved successfully',
        success: true,
      }
    }
    catch (error) {
      this.setStatus(400)
      return { liquidity: 0, message: error instanceof Error ? error.message : 'Unknown error', success: false }
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
