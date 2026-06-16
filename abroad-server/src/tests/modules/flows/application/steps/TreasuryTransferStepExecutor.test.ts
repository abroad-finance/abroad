import { Wallet } from '@binance/wallet'

import { TreasuryTransferStepExecutor } from '../../../../../modules/flows/application/steps/TreasuryTransferStepExecutor'

const withdrawMock = jest.fn()
const allCoinsMock = jest.fn()
jest.mock('@binance/wallet', () => ({
  Wallet: jest.fn().mockImplementation(() => ({
    restAPI: { allCoinsInformation: allCoinsMock, withdraw: withdrawMock },
  })),
}))

const MockedWallet = Wallet as unknown as jest.Mock

const baseLogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

const makeExecutor = () => {
  const destinationProvider = {
    getExchangeAddress: jest.fn(async () => ({ address: 'dest-addr', memo: null, success: true })),
  }
  const exchangeProviderFactory = {
    getExchangeProvider: jest.fn(() => destinationProvider),
    getExchangeProviderForCapability: jest.fn(() => destinationProvider),
  }
  const secretManager = {
    getSecret: jest.fn(async () => 'secret'),
    getSecrets: jest.fn(async () => ({})),
  }
  const executor = new TreasuryTransferStepExecutor(
    exchangeProviderFactory as never,
    secretManager as never,
    baseLogger as never,
  )
  return { executor }
}

const runtime = (sourceAmount: number) => ({
  context: { blockchain: 'CELO', cryptoCurrency: 'USDC', sourceAmount, targetCurrency: 'BRL' },
  stepOutputs: new Map(),
})

describe('TreasuryTransferStepExecutor', () => {
  beforeEach(() => {
    withdrawMock.mockReset()
    allCoinsMock.mockReset()
    MockedWallet.mockClear()
    withdrawMock.mockResolvedValue({ data: async () => ({ id: 'withdraw-1' }) })
    allCoinsMock.mockResolvedValue({
      data: async () => ([{ coin: 'USDC', networkList: [{ isDefault: true, network: 'MATIC', withdrawFee: '0.8' }] }]),
    })
  })

  // The next hop (final Transfero convert) must convert what actually ARRIVES,
  // so the transfer must report the credited amount = withdrawn − network fee,
  // not the gross withdrawal amount.
  it('outputs the credited amount = withdrawn minus the network withdrawal fee', async () => {
    const { executor } = makeExecutor()

    const result = await executor.execute({
      config: { asset: 'USDC', destinationProvider: 'transfero', sourceProvider: 'binance' },
      runtime: runtime(100.46) as never,
      stepOrder: 6,
    })

    expect(result.outcome).toBe('succeeded')
    expect(withdrawMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 100.46, coin: 'USDC' }))
    expect(result.output?.amount).toBeCloseTo(99.66, 6) // 100.46 withdrawn − 0.8 network fee
    expect(result.output?.withdrawId).toBe('withdraw-1')
  })

  // If the fee can't be determined, fall back to the gross amount (never strand).
  it('falls back to the gross amount when the withdrawal fee is unavailable', async () => {
    const { executor } = makeExecutor()
    allCoinsMock.mockResolvedValue({ data: async () => ([]) })

    const result = await executor.execute({
      config: { asset: 'USDC', destinationProvider: 'transfero', sourceProvider: 'binance' },
      runtime: runtime(100.46) as never,
      stepOrder: 6,
    })

    expect(result.outcome).toBe('succeeded')
    expect(result.output?.amount).toBeCloseTo(100.46, 6)
  })
})
