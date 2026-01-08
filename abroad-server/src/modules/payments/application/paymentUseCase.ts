import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ValidationError } from '../../../core/errors'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IPaymentService } from './contracts/IPaymentService'
import { IPaymentServiceFactory } from './contracts/IPaymentServiceFactory'
import { LiquidityCacheService } from './LiquidityCacheService'
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

@injectable()
export class PaymentUseCase implements IPaymentUseCase {
  private readonly successMessage = 'Liquidity retrieved successfully'

  public constructor(
    @inject(TYPES.IPaymentServiceFactory)
    private readonly paymentServiceFactory: IPaymentServiceFactory,
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbClientProvider: IDatabaseClientProvider,
    @inject(LiquidityCacheService)
    private readonly liquidityCacheService: LiquidityCacheService,
    @inject(TYPES.ILogger)
    private readonly logger: ILogger,
  ) { }

  public async getLiquidity(paymentMethod?: SupportedPaymentMethod): Promise<LiquidityResult> {
    const { method, service } = this.resolvePaymentService(paymentMethod)
    try {
      const cached = await this.liquidityCacheService.getLiquidity({
        fetchLiquidity: () => service.getLiquidity(),
        method,
      })

      if (!cached.success && cached.message) {
        this.logger.error('[PaymentUseCase] Failed to retrieve liquidity', cached.message)
      }

      return {
        liquidity: cached.liquidity,
        message: cached.message ?? this.successMessage,
        success: cached.success,
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
    const service = this.paymentServiceFactory.getPaymentServiceForCapability?.({
      paymentMethod: method,
      targetCurrency: baseService.currency,
    }) ?? baseService

    if (!service.isEnabled) {
      throw new ValidationError(`Payment method ${method} is currently unavailable`)
    }

    return { method, service }
  }
}
