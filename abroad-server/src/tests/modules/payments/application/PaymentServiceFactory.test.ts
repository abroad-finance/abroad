import { PaymentMethod, TargetCurrency } from '@prisma/client'

import type { IPaymentService } from '../../../../modules/payments/application/contracts/IPaymentService'
import type { IExchangeProvider } from '../../../../modules/treasury/application/contracts/IExchangeProvider'

import { PaymentServiceFactory } from '../../../../modules/payments/application/PaymentServiceFactory'
import { ExchangeProviderFactory } from '../../../../modules/treasury/application/ExchangeProviderFactory'

const buildPaymentService = (label: string): IPaymentService => ({
  banks: [],
  currency: TargetCurrency.COP,
  fixedFee: 0,
  getLiquidity: async () => 0,
  isAsync: false,
  isEnabled: true,
  MAX_TOTAL_AMOUNT_PER_DAY: 0,
  MAX_USER_AMOUNT_PER_DAY: 0,
  MAX_USER_AMOUNT_PER_TRANSACTION: 0,
  MAX_USER_TRANSACTIONS_PER_DAY: 0,
  MIN_USER_AMOUNT_PER_TRANSACTION: 0,
  onboardUser: async () => ({ message: label, success: true }),
  percentageFee: 0,
  sendPayment: async () => ({ success: true, transactionId: `tx-${label}` }),
  verifyAccount: async () => true,
})

const buildExchangeProvider = (id: string): IExchangeProvider => ({
  createMarketOrder: async () => ({ success: true }),
  exchangePercentageFee: 0.01,
  getExchangeAddress: async () => ({ address: `${id}-addr` }),
  getExchangeRate: async () => 1,
})

describe('PaymentServiceFactory', () => {
  const moviiService = buildPaymentService('movii')
  const nequiService = buildPaymentService('nequi')
  const brebService = buildPaymentService('breb')
  const transferoService = buildPaymentService('transfero')

  it('returns the correct payment service for supported methods', () => {
    const factory = new PaymentServiceFactory(moviiService, nequiService, brebService, transferoService)

    expect(factory.getPaymentService(PaymentMethod.MOVII)).toBe(moviiService)
    expect(factory.getPaymentService(PaymentMethod.NEQUI)).toBe(nequiService)
    expect(factory.getPaymentService(PaymentMethod.BREB)).toBe(brebService)
    expect(factory.getPaymentService(PaymentMethod.PIX)).toBe(transferoService)
  })

  it('throws for unsupported payment methods', () => {
    const factory = new PaymentServiceFactory(moviiService, nequiService, brebService, transferoService)

    expect(() => factory.getPaymentService('UNSUPPORTED' as PaymentMethod)).toThrow('Unsupported payment method: UNSUPPORTED')
  })
})

describe('ExchangeProviderFactory', () => {
  const transferoProvider = buildExchangeProvider('transfero')
  const binanceProvider = buildExchangeProvider('binance')

  it('returns providers based on target currency', () => {
    const factory = new ExchangeProviderFactory(transferoProvider, binanceProvider)

    expect(factory.getExchangeProvider(TargetCurrency.BRL)).toBe(transferoProvider)
    expect(factory.getExchangeProvider(TargetCurrency.COP)).toBe(binanceProvider)
  })

  it('throws when no provider is configured for a currency', () => {
    const factory = new ExchangeProviderFactory(transferoProvider, binanceProvider)

    expect(() => factory.getExchangeProvider('USD' as TargetCurrency)).toThrow('No exchange provider found for currency: USD')
  })
})
