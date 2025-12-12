import { Country, PaymentMethod } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { ILogger } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IPaymentService } from '../interfaces/IPaymentService'
import { IPaymentServiceFactory } from '../interfaces/IPaymentServiceFactory'
import { TYPES } from '../types'

export interface BanksResult {
  banks: BankSummary[]
}

export interface IPaymentUseCase {
  getBanks(paymentMethod?: PaymentMethod): BanksResult
  getLiquidity(paymentMethod?: PaymentMethod): Promise<LiquidityResult>
  onboardUser(account: string, paymentMethod?: PaymentMethod): Promise<OnboardResult>
}

export interface LiquidityResult {
  liquidity: number
  message?: string
  success: boolean
}

export interface OnboardResult {
  message?: string
  success: boolean
}

type BankSummary = {
  bankCode: number
  bankName: string
}

@injectable()
export class PaymentUseCase implements IPaymentUseCase {
  private readonly successMessage = 'Liquidity retrieved successfully'

  public constructor(
    @inject(TYPES.IPaymentServiceFactory)
    private readonly paymentServiceFactory: IPaymentServiceFactory,
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger)
    private readonly logger: ILogger,
  ) { }

  public getBanks(paymentMethod?: PaymentMethod): BanksResult {
    const { service } = this.resolvePaymentService(paymentMethod)
    return { banks: service.banks }
  }

  public async getLiquidity(paymentMethod?: PaymentMethod): Promise<LiquidityResult> {
    const { method, service } = this.resolvePaymentService(paymentMethod)
    try {
      const clientDb = await this.dbClientProvider.getClient()
      const providerRecord = await clientDb.paymentProvider.upsert({
        create: {
          country: Country.CO,
          id: method,
          liquidity: 0,
          name: method,
        },
        update: {},
        where: { id: method },
      })

      const persistedLiquidity = providerRecord.liquidity
      if (persistedLiquidity !== 0) {
        return {
          liquidity: persistedLiquidity,
          message: this.successMessage,
          success: true,
        }
      }

      const liquidity = await service.getLiquidity()
      if (liquidity) {
        await clientDb.paymentProvider.update({
          data: { liquidity },
          where: { id: method },
        })
      }

      return {
        liquidity: liquidity || 0,
        message: this.successMessage,
        success: true,
      }
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error'
      this.logger.error('[PaymentUseCase] Failed to retrieve liquidity', reason)
      return { liquidity: 0, message: reason, success: false }
    }
  }

  public async onboardUser(account: string, paymentMethod?: PaymentMethod): Promise<OnboardResult> {
    try {
      const { service } = this.resolvePaymentService(paymentMethod)
      return await service.onboardUser({ account })
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error'
      this.logger.error('[PaymentUseCase] Failed to onboard user', reason)
      return { message: reason, success: false }
    }
  }

  private resolvePaymentService(paymentMethod?: PaymentMethod): { method: PaymentMethod, service: IPaymentService } {
    const method = paymentMethod ?? PaymentMethod.MOVII
    const service = this.paymentServiceFactory.getPaymentService(method)

    if (!service.isEnabled) {
      throw new Error(`Payment method ${method} is currently unavailable`)
    }

    return { method, service }
  }
}
