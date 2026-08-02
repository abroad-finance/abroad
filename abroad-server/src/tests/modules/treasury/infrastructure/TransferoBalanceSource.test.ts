import 'reflect-metadata'

import { TransferoUltraClient } from '../../../../modules/transfero/infrastructure/TransferoUltraClient'
import { TransferoBalanceSource } from '../../../../modules/treasury/infrastructure/balanceSources/TransferoBalanceSource'

type UltraClientMock = jest.Mocked<
  Pick<TransferoUltraClient, 'get' | 'patch' | 'post'>
>

const createUltraClient = (): UltraClientMock => ({
  get: jest.fn(),
  patch: jest.fn(),
  post: jest.fn(),
})

const balanceRow = (asset: string, available: string) => ({
  asset,
  available,
  blocked: '0',
  credit: '0',
  ledgerBalance: available,
  openDebt: '0',
  openWithdrawals: '0',
  overdueDebt: '0',
  owedDue: '0',
  processing: '0',
})

describe('TransferoBalanceSource', () => {
  it('maps every Ultra asset available balance into treasury inventory', async () => {
    const ultraClient = createUltraClient()
    ultraClient.get.mockResolvedValue([
      balanceRow('BRZ', '1234.56'),
      balanceRow('USDC', '42.000001'),
    ])
    const source = new TransferoBalanceSource(
      ultraClient as unknown as TransferoUltraClient,
    )

    await expect(source.getBalances()).resolves.toEqual([
      {
        account: 'BRZ',
        amount: 1234.56,
        availableAmount: 1234.56,
        blockedAmount: 0,
        currency: 'BRZ',
        outstandingAmount: 0,
        reservedAmount: 0,
        venue: 'TRANSFERO',
      },
      {
        account: 'USDC',
        amount: 42.000001,
        availableAmount: 42.000001,
        blockedAmount: 0,
        currency: 'USDC',
        outstandingAmount: 0,
        reservedAmount: 0,
        venue: 'TRANSFERO',
      },
    ])
    expect(ultraClient.get).toHaveBeenCalledWith('/api/v1/balance')
  })

  it('fails the complete snapshot when any Ultra balance row is malformed', async () => {
    const ultraClient = createUltraClient()
    ultraClient.get.mockResolvedValue([
      balanceRow('BRZ', '10'),
      { asset: 'USDC', available: 5 },
    ])
    const source = new TransferoBalanceSource(
      ultraClient as unknown as TransferoUltraClient,
    )

    await expect(source.getBalances()).rejects.toThrow()
  })
})
