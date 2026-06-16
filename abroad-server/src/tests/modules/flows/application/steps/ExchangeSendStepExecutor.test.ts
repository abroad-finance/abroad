import { ExchangeSendStepExecutor } from '../../../../../modules/flows/application/steps/ExchangeSendStepExecutor'

describe('ExchangeSendStepExecutor', () => {
  const baseLogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

  const makeExecutor = () => {
    const exchangeProvider = {
      getExchangeAddress: jest.fn(async () => ({ address: 'binance-deposit-addr', memo: null, success: true })),
    }
    const exchangeProviderFactory = {
      getExchangeProvider: jest.fn(() => exchangeProvider),
      getExchangeProviderForCapability: jest.fn(() => exchangeProvider),
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
    return { exchangeProvider, executor, walletHandler }
  }

  // Multi-venue BRL corridor (e.g. USDT/CELO → Binance → Transfero → BRL): the
  // FIRST hop sends to Binance even though the target currency is BRL. The step
  // must not reject it just because BRL's settlement provider is Transfero.
  it('sends the first hop to its configured venue on a multi-venue BRL flow', async () => {
    const { executor, walletHandler } = makeExecutor()

    const result = await executor.execute({
      config: { provider: 'binance' },
      runtime: { context: { blockchain: 'CELO', cryptoCurrency: 'USDT', sourceAmount: 100, targetCurrency: 'BRL' } } as never,
      stepOrder: 1,
    })

    expect(result.outcome).toBe('succeeded')
    expect(walletHandler.send).toHaveBeenCalled()
  })
})
