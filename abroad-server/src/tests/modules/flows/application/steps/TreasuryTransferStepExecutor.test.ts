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

const makeExecutor = (opts: { depositNetwork?: string } = {}) => {
  const destinationProvider = {
    getDepositNetwork: jest.fn(() => (Object.prototype.hasOwnProperty.call(opts, 'depositNetwork') ? opts.depositNetwork : 'POLYGON')),
    getExchangeAddress: jest.fn(async () => ({
      address: '0x1111222233334444555566667777888899990000',
      success: true,
    })),
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
  return { destinationProvider, executor }
}

// context.blockchain is CELO (the ORIGINAL USDT deposit chain) — the transfer
// must NOT use it. The bridge chain comes from the destination provider.
const runtime = (sourceAmount: number) => ({
  context: { blockchain: 'CELO', cryptoCurrency: 'USDT', sourceAmount, targetCurrency: 'BRL' },
  stepOutputs: new Map(),
})

describe('TreasuryTransferStepExecutor', () => {
  beforeEach(() => {
    withdrawMock.mockReset()
    allCoinsMock.mockReset()
    MockedWallet.mockClear()
    withdrawMock.mockResolvedValue({ data: async () => ({ id: 'withdraw-1' }) })
    allCoinsMock.mockResolvedValue({
      data: async () => ([{ coin: 'USDC', networkList: [{ network: 'MATIC', withdrawFee: '0.8' }] }]),
    })
  })

  // The deposit address AND the Binance withdraw network must both be derived
  // from the destination provider's bridge chain for the ASSET being moved —
  // never from the origin deposit chain (CELO). Funds must go to Polygon.
  it('bridges on the Ultra destination network (Polygon), ignoring the origin deposit chain (CELO)', async () => {
    const { destinationProvider, executor } = makeExecutor()

    const result = await executor.execute({
      config: { asset: 'USDC', destinationProvider: 'transfero', sourceProvider: 'binance' },
      runtime: runtime(100) as never,
      stepOrder: 6,
    })

    expect(result.outcome).toBe('succeeded')
    expect(destinationProvider.getDepositNetwork).toHaveBeenCalledWith({ cryptoCurrency: 'USDC' })
    // Address resolved on POLYGON + the transferred asset (USDC), NOT CELO/USDT.
    expect(destinationProvider.getExchangeAddress).toHaveBeenCalledWith({
      blockchain: 'POLYGON',
      cryptoCurrency: 'USDC',
    })
    // Binance calls Polygon MATIC; address and network derive from one source.
    expect(withdrawMock).toHaveBeenCalledWith(expect.objectContaining({
      address: '0x1111222233334444555566667777888899990000',
      coin: 'USDC',
      network: 'MATIC',
    }))
  })

  it('reports credited amount = withdrawn minus the bridge-network withdrawal fee', async () => {
    const { executor } = makeExecutor()

    const result = await executor.execute({
      config: { asset: 'USDC', destinationProvider: 'transfero', sourceProvider: 'binance' },
      runtime: runtime(100.46) as never,
      stepOrder: 6,
    })

    expect(result.outcome).toBe('succeeded')
    expect(result.output?.amount).toBeCloseTo(99.66, 6) // 100.46 − 0.8 Polygon network fee
  })

  // Never let Binance default-route the withdraw to the wrong chain: if the
  // bridge network is unresolved, fail BEFORE withdrawing.
  it('fails without withdrawing when the bridge network cannot be resolved', async () => {
    const { executor } = makeExecutor({ depositNetwork: undefined })

    const result = await executor.execute({
      config: { asset: 'USDC', destinationProvider: 'transfero', sourceProvider: 'binance' },
      runtime: runtime(100) as never,
      stepOrder: 6,
    })

    expect(result.outcome).toBe('failed')
    expect(withdrawMock).not.toHaveBeenCalled()
  })
})
