import { BlockchainNetwork, PaymentMethod, TargetCurrency } from '@prisma/client'

import type { IPaymentService } from '../../../../modules/payments/application/contracts/IPaymentService'
import type { IExchangeProvider } from '../../../../modules/treasury/application/contracts/IExchangeProvider'

import { PaymentServiceFactory } from '../../../../modules/payments/application/PaymentServiceFactory'
import { ExchangeProviderFactory } from '../../../../modules/treasury/application/ExchangeProviderFactory'

const buildPaymentService = (label: string): IPaymentService => ({
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

const buildExchangeProvider = (
  id: string,
  targetCurrency: TargetCurrency,
  blockchain?: BlockchainNetwork,
): IExchangeProvider => ({
  capability: { blockchain, targetCurrency },
  createMarketOrder: async () => ({ success: true }),
  exchangePercentageFee: 0.01,
  getExchangeAddress: async () => ({ address: `${id}-addr`, success: true }),
  getExchangeRate: async () => 1,
})

describe('PaymentServiceFactory', () => {
  const brebService = buildPaymentService('breb')
  const transferoService = buildPaymentService('transfero')

  it('returns the correct payment service for supported methods', () => {
    const factory = new PaymentServiceFactory(brebService, transferoService)

    expect(factory.getPaymentService(PaymentMethod.BREB)).toBe(brebService)
    expect(factory.getPaymentService(PaymentMethod.PIX)).toBe(transferoService)
  })

  it('throws for unsupported payment methods', () => {
    const factory = new PaymentServiceFactory(brebService, transferoService)

    expect(() => factory.getPaymentService('UNSUPPORTED' as PaymentMethod)).toThrow('Unsupported payment method: UNSUPPORTED')
  })

  it('throws when a supported payment method lacks a configured service', () => {
    const factory = new PaymentServiceFactory(brebService, transferoService)
    const mutableFactory = factory as unknown as { serviceByMethod: Partial<Record<PaymentMethod, IPaymentService>> }
    delete mutableFactory.serviceByMethod[PaymentMethod.PIX]

    expect(() => factory.getPaymentService(PaymentMethod.PIX)).toThrow('Payment service not registered for method PIX')
  })

  it('resolves a payment service using capability when the target currency differs from the default', () => {
    const brebWithExplicitCapability: IPaymentService = {
      ...brebService,
      capability: { method: PaymentMethod.BREB, targetCurrency: TargetCurrency.BRL },
    }
    const factory = new PaymentServiceFactory(brebWithExplicitCapability, transferoService)

    const service = factory.getPaymentServiceForCapability({
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.BRL,
    })

    expect(service).toBe(brebWithExplicitCapability)
  })

  it('falls back to a method lookup when no capability matches the requested currency', () => {
    const factory = new PaymentServiceFactory(brebService, transferoService)

    const service = factory.getPaymentServiceForCapability({
      paymentMethod: PaymentMethod.PIX,
      targetCurrency: TargetCurrency.BRL,
    })

    expect(service).toBe(transferoService)
  })

  it('throws when a capability is present but its service mapping is missing', () => {
    const factory = new PaymentServiceFactory(brebService, transferoService)
    const mutableFactory = factory as unknown as { serviceByMethod: Partial<Record<PaymentMethod, IPaymentService>> }
    delete mutableFactory.serviceByMethod[PaymentMethod.BREB]

    expect(() => factory.getPaymentServiceForCapability({
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: brebService.currency,
    })).toThrow('Payment service not registered for method BREB')
  })
})

describe('ExchangeProviderFactory', () => {
  const transferoProvider = buildExchangeProvider('transfero', TargetCurrency.BRL)
  const binanceProvider = buildExchangeProvider('binance', TargetCurrency.COP)
  const binanceBrlProvider = buildExchangeProvider('binance-brl', TargetCurrency.BRL, BlockchainNetwork.CELO)

  it('returns providers based on target currency', () => {
    const factory = new ExchangeProviderFactory(transferoProvider, binanceProvider, binanceBrlProvider)

    expect(factory.getExchangeProvider(TargetCurrency.BRL)).toBe(transferoProvider)
    expect(factory.getExchangeProvider(TargetCurrency.COP)).toBe(binanceProvider)
  })

  it('throws when no provider is configured for a currency', () => {
    const factory = new ExchangeProviderFactory(transferoProvider, binanceProvider, binanceBrlProvider)

    expect(() => factory.getExchangeProvider('USD' as TargetCurrency)).toThrow('No exchange provider found for currency: USD')
  })

  it('falls back to a blockchain-agnostic provider when no explicit chain match exists', () => {
    const factory = new ExchangeProviderFactory(transferoProvider, binanceProvider, binanceBrlProvider)

    const provider = factory.getExchangeProviderForCapability({
      blockchain: BlockchainNetwork.STELLAR,
      targetCurrency: TargetCurrency.COP,
    })

    expect(provider).toBe(binanceProvider)
  })

  it('prefers providers that explicitly support the requested blockchain', () => {
    const copOnStellarProvider = buildExchangeProvider('cop-stellar', TargetCurrency.COP, BlockchainNetwork.STELLAR)
    const copAgnosticProvider = buildExchangeProvider('cop-agnostic', TargetCurrency.COP)
    const factory = new ExchangeProviderFactory(copOnStellarProvider, copAgnosticProvider, binanceBrlProvider)

    const provider = factory.getExchangeProviderForCapability({
      blockchain: BlockchainNetwork.STELLAR,
      targetCurrency: TargetCurrency.COP,
    })

    expect(provider).toBe(copOnStellarProvider)
  })
})
