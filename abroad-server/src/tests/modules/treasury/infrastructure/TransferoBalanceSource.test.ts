import 'reflect-metadata'
import axios from 'axios'

import type { ILogger } from '../../../../core/logging/types'
import type { ISecretManager } from '../../../../platform/secrets/ISecretManager'

import { TransferoBalanceSource } from '../../../../modules/treasury/infrastructure/balanceSources/TransferoBalanceSource'

jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

const makeLogger = (): ILogger => ({
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}) as unknown as ILogger

const makeSecretManager = (): ISecretManager => ({
  getSecret: jest.fn(async () => 'https://transfero.example'),
  getSecrets: jest.fn(async () => ({
    TRANSFERO_BASE_URL: 'https://transfero.example',
    TRANSFERO_CLIENT_ID: 'id',
    TRANSFERO_CLIENT_SCOPE: 'scope',
    TRANSFERO_CLIENT_SECRET: 'secret',
  })),
}) as unknown as ISecretManager

describe('TransferoBalanceSource', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'token', expires_in: 900 } })
  })

  it('enumerates every account and reports one balance per usable payload', async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v2.0/accounts')) {
        return {
          data: [
            { accountId: 'brl-account', currency: 'BRL', depositAddress: null },
            { accountId: 'usdc-account', currency: 'USDC', depositAddress: { solana: 'addr' } },
            { currency: 'ghost' },
          ],
        }
      }
      if (url.includes('brl-account')) {
        return { data: { balance: { amount: '1234.56', currency: 'BRL' } } }
      }
      return { data: { balance: { amount: 42, currency: 'USDC' } } }
    })

    const source = new TransferoBalanceSource(makeSecretManager(), makeLogger())
    const balances = await source.getBalances()

    expect(balances).toEqual(expect.arrayContaining([
      { account: 'brl-account', amount: 1234.56, currency: 'BRL', venue: 'TRANSFERO' },
      { account: 'usdc-account', amount: 42, currency: 'USDC', venue: 'TRANSFERO' },
    ]))
    expect(balances).toHaveLength(2)
  })

  it('skips accounts whose balance payload is unusable instead of failing the venue', async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v2.0/accounts')) {
        return { data: [{ accountId: 'broken', currency: 'BRL' }, { accountId: 'ok', currency: 'USDT' }] }
      }
      if (url.includes('broken')) {
        return { data: { balance: { amount: undefined } } }
      }
      return { data: { balance: { amount: 7, currency: 'USDT' } } }
    })

    const source = new TransferoBalanceSource(makeSecretManager(), makeLogger())
    const balances = await source.getBalances()

    expect(balances).toEqual([{ account: 'ok', amount: 7, currency: 'USDT', venue: 'TRANSFERO' }])
  })
})
