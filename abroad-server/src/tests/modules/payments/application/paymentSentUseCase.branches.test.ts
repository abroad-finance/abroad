import 'reflect-metadata'
import { CryptoCurrency, SupportedCurrency, TargetCurrency } from '@prisma/client'

import { PaymentSentUseCase } from '../../../../modules/payments/application/paymentSentUseCase'

const buildUseCase = () => {
  const logger = { error: jest.fn(), info: jest.fn() }
  const walletHandlerFactory = {
    getWalletHandler: jest.fn(() => ({
      send: jest.fn(async () => ({ success: true, transactionId: 'tx-1' })),
    })),
  }
  const slackNotifier = { sendMessage: jest.fn() }
  const dbClientProvider = {
    getClient: jest.fn(async () => ({
      pendingConversions: { upsert: jest.fn() },
    })),
  }
  const exchangeProviderFactory = {
    getExchangeProvider: jest.fn(() => ({
      getExchangeAddress: jest.fn(async () => ({ address: 'addr', memo: '' })),
    })),
  }

  return new PaymentSentUseCase(
    logger as never,
    walletHandlerFactory as never,
    slackNotifier as never,
    dbClientProvider as never,
    exchangeProviderFactory as never,
  )
}

describe('PaymentSentUseCase branch helpers', () => {
  it('builds pending conversions for BRL and non-USDC assets', () => {
    const useCase = buildUseCase()
    const builder = useCase as unknown as {
      buildPendingConversionUpdates: (crypto: CryptoCurrency, target: TargetCurrency) => unknown[]
    }

    const brlConversions = builder.buildPendingConversionUpdates(SupportedCurrency.USDC, TargetCurrency.BRL)
    expect(brlConversions).toEqual([{ source: SupportedCurrency.USDC, symbol: 'USDCBRL', target: SupportedCurrency.BRL }])

    const unrelated = builder.buildPendingConversionUpdates('BTC' as CryptoCurrency, TargetCurrency.BRL)
    expect(unrelated).toEqual([])
  })
})
