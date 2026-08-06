import 'reflect-metadata'
import { Horizon } from '@stellar/stellar-sdk'

import { StablebondBalanceSource } from '../../../../modules/treasury/infrastructure/balanceSources/StablebondBalanceSource'

jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: { Server: jest.fn() },
}))

const ISSUER = 'GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC'

const secretManager = {
  getSecret: jest.fn(async (name: string) => (name === 'STELLAR_ACCOUNT_ID' ? 'GACCOUNT' : 'https://horizon.test')),
  getSecrets: jest.fn(async () => ({})),
}

const mockAccount = (balances: unknown[]) => {
  jest.mocked(Horizon.Server).mockImplementation(() => ({
    loadAccount: jest.fn(async () => ({ balances })),
  }) as unknown as Horizon.Server)
}

const mockAccountFailure = (error: Error) => {
  jest.mocked(Horizon.Server).mockImplementation(() => ({
    loadAccount: jest.fn(async () => { throw error }),
  }) as unknown as Horizon.Server)
}

describe('StablebondBalanceSource', () => {
  const previousEnv = { ...process.env }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STABLEBOND_ISSUER = ISSUER
    process.env.STABLEBOND_JIT_UNWIND_CAP_USDC = '5000'
  })

  afterEach(() => {
    process.env = { ...previousEnv }
  })

  // Disabled means the venue does not exist. Returning a zero-valued cell would
  // put an empty Stablebond row on every operator's treasury board.
  it('reports no cells at all when the position is disabled', async () => {
    delete process.env.STABLEBOND_JIT_UNWIND_CAP_USDC
    const source = new StablebondBalanceSource(secretManager as never)

    expect(await source.getBalances()).toEqual([])
    expect(secretManager.getSecret).not.toHaveBeenCalled()
  })

  it('reports the whole position as blocked and none of it as available', async () => {
    mockAccount([{ asset_code: 'TESOURO', asset_issuer: ISSUER, balance: '2479998.1030731' }])
    const source = new StablebondBalanceSource(secretManager as never)

    // A bond position cannot fund a payout until it is unwound, so nothing
    // downstream may read it as spendable float.
    expect(await source.getBalances()).toEqual([expect.objectContaining({
      amount: 2479998.1030731,
      availableAmount: 0,
      blockedAmount: 2479998.1030731,
      currency: 'TESOURO',
      venue: 'STABLEBOND_POSITION',
    })])
  })

  it('ignores a trustline for the same code from a different issuer', async () => {
    mockAccount([{ asset_code: 'TESOURO', asset_issuer: 'GIMPOSTOR', balance: '999999' }])
    const source = new StablebondBalanceSource(secretManager as never)

    const balances = await source.getBalances()
    expect(balances[0].amount).toBe(0)
  })

  it('treats a missing trustline as a genuine zero position', async () => {
    mockAccount([{ asset_code: 'USDC', asset_issuer: 'GUSDC', balance: '100' }])
    const source = new StablebondBalanceSource(secretManager as never)

    expect((await source.getBalances())[0].amount).toBe(0)
  })

  // The difference that matters: a failed read is not a zero balance.
  it('throws when Horizon cannot be read rather than reporting zero', async () => {
    mockAccountFailure(new Error('horizon unreachable'))
    const source = new StablebondBalanceSource(secretManager as never)

    await expect(source.getBalances()).rejects.toThrow('horizon unreachable')
  })

  it('throws when Horizon reports an unusable balance', async () => {
    mockAccount([{ asset_code: 'TESOURO', asset_issuer: ISSUER, balance: 'not-a-number' }])
    const source = new StablebondBalanceSource(secretManager as never)

    await expect(source.getBalances()).rejects.toThrow(/unusable TESOURO trustline balance/)
  })
})
