import { Country } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IPaymentService } from './contracts/IPaymentService'
import { IPaymentServiceFactory } from './contracts/IPaymentServiceFactory'
import { assertSupportedPaymentMethod, DEFAULT_PAYMENT_METHOD, SupportedPaymentMethod } from './supportedPaymentMethods'

export interface IPaymentUseCase {
  getLiquidity(paymentMethod?: SupportedPaymentMethod): Promise<LiquidityResult>
  onboardUser(account: string, paymentMethod?: SupportedPaymentMethod): Promise<OnboardResult>
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

const LIQUIDITY_CACHE_TTL_MS = 5 * 60 * 1000

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

  public async getLiquidity(paymentMethod?: SupportedPaymentMethod): Promise<LiquidityResult> {
    const { method, service } = this.resolvePaymentService(paymentMethod)
    try {
      const clientDb = await this.dbClientProvider.getClient()
      const providerRecord = await clientDb.paymentProvider.findUnique({ where: { id: method } })
      const now = Date.now()

      if (!providerRecord) {
        await clientDb.paymentProvider.create({
          data: {
            country: Country.CO,
            id: method,
            liquidity: 0,
            name: method,
          },
        })
      }

      const persistedLiquidity = providerRecord?.liquidity ?? 0
      const lastUpdatedAt = providerRecord?.updatedAt?.getTime()
      const isFresh = typeof lastUpdatedAt === 'number' && now - lastUpdatedAt <= LIQUIDITY_CACHE_TTL_MS

      if (persistedLiquidity !== 0 && isFresh) {
        return {
          liquidity: persistedLiquidity,
          message: this.successMessage,
          success: true,
        }
      }

      const liquidity = await service.getLiquidity()
      if (typeof liquidity === 'number') {
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

  public async onboardUser(account: string, paymentMethod?: SupportedPaymentMethod): Promise<OnboardResult> {
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

  private resolvePaymentService(paymentMethod?: SupportedPaymentMethod): { method: SupportedPaymentMethod, service: IPaymentService } {
    const method: SupportedPaymentMethod = paymentMethod ?? DEFAULT_PAYMENT_METHOD
    assertSupportedPaymentMethod(method)
    const baseService = this.paymentServiceFactory.getPaymentService(method)
    const service = this.paymentServiceFactory.getPaymentServiceForCapability({
      paymentMethod: method,
      targetCurrency: baseService.currency,
    })

    if (!service.isEnabled) {
      throw new Error(`Payment method ${method} is currently unavailable`)
    }

    return { method, service }
  }
}
