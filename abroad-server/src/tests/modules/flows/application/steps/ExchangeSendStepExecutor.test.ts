import { ExchangeSendStepExecutor } from '../../../../../modules/flows/application/steps/ExchangeSendStepExecutor'

describe('ExchangeSendStepExecutor', () => {
  const baseLogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

  const makeExecutor = () => {
    const binanceProvider = {
      getExchangeAddress: jest.fn(async () => ({ address: 'binance-deposit-addr', memo: null, success: true })),
    }
    const transferoProvider = {
      getExchangeAddress: jest.fn(async () => ({
        code: 'validation',
        reason: 'transfero_ultra_unsupported_blockchain',
        success: false,
      })),
    }
    const exchangeProviderFactory = {
      getExchangeProvider: jest.fn(() => transferoProvider),
      getExchangeProviderById: jest.fn((providerId: 'binance' | 'transfero') =>
        providerId === 'binance' ? binanceProvider : transferoProvider),
      getExchangeProviderForCapability: jest.fn(() => transferoProvider),
    }
    const walletHandler = {
      send: jest.fn(async () => ({ success: true, transactionId: 'send-tx-1' })),
    }
    const walletHandlerFactory = {
      getWalletHandler: jest.fn(() => walletHandler),
      getWalletHandlerForCapability: jest.fn(() => walletHandler),
    }
    const executor = new ExchangeSendStepExecutor(
      exchangeProviderFactory as never,
      walletHandlerFactory as never,
      baseLogger as never,
    )
    return { binanceProvider, exchangeProviderFactory, executor, transferoProvider, walletHandler }
  }

  it.each(['CELO', 'SOLANA', 'STELLAR'] as const)(
    'routes a %s-funded BRL first hop to the explicitly configured Binance venue',
    async (blockchain) => {
      const {
        binanceProvider,
        exchangeProviderFactory,
        executor,
        transferoProvider,
        walletHandler,
      } = makeExecutor()

      const result = await executor.execute({
        config: { provider: 'binance' },
        runtime: {
          context: {
            blockchain,
            cryptoCurrency: 'USDC',
            sourceAmount: 100,
            targetCurrency: 'BRL',
          },
        } as never,
        stepOrder: 1,
      })

      expect(result.outcome).toBe('succeeded')
      expect(exchangeProviderFactory.getExchangeProviderById).toHaveBeenCalledWith('binance')
      expect(exchangeProviderFactory.getExchangeProviderForCapability).not.toHaveBeenCalled()
      expect(binanceProvider.getExchangeAddress).toHaveBeenCalledWith({
        blockchain,
        cryptoCurrency: 'USDC',
      })
      expect(transferoProvider.getExchangeAddress).not.toHaveBeenCalled()
      expect(walletHandler.send).toHaveBeenCalled()
    },
  )

  it('fails closed when the provider identity is missing', async () => {
    const { exchangeProviderFactory, executor, walletHandler } = makeExecutor()

    const result = await executor.execute({
      config: {},
      runtime: {
        context: {
          blockchain: 'STELLAR',
          cryptoCurrency: 'USDC',
          sourceAmount: 100,
          targetCurrency: 'BRL',
        },
      } as never,
      stepOrder: 1,
    })

    expect(result.outcome).toBe('failed')
    expect(exchangeProviderFactory.getExchangeProviderById).not.toHaveBeenCalled()
    expect(walletHandler.send).not.toHaveBeenCalled()
  })
})
