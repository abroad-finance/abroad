import 'reflect-metadata'
import { type AxiosResponse } from 'axios'
import axios from 'axios'

import type { ISecretManager, Secret } from '../../../../../platform/secrets/ISecretManager'

import { DEFAULT_TRANSFERO_WEBHOOK_URL, TransferoCallbackRegistrar } from '../../../../../modules/treasury/infrastructure/exchangeProviders/TransferoCallbackRegistrar'
import { createMockLogger } from '../../../../setup/mockFactories'

jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

const BASE = 'https://transfero.example.com'
const WEBHOOK_URL = 'https://abroad.example.com/webhook/transfero/balance'

const SECRETS: Record<string, string> = {
  TRANSFERO_BASE_URL: BASE,
  TRANSFERO_CLIENT_ID: 'client-id',
  TRANSFERO_CLIENT_SCOPE: 'scope',
  TRANSFERO_CLIENT_SECRET: 'client-secret',
  TRANSFERO_WEBHOOK_URL: WEBHOOK_URL,
}

const makeSecretManager = (overrides: Record<string, string> = {}): ISecretManager => {
  const secrets = { ...SECRETS, ...overrides }
  return {
    getSecret: jest.fn(async (name: Secret) => secrets[name] ?? ''),
    getSecrets: jest.fn(async <T extends readonly Secret[]>(names: T) =>
      Object.fromEntries(names.map(name => [name, secrets[name] ?? ''])) as Record<T[number], string>),
  }
}

// 1841 = BRL (no depositAddress); 1842/1843 = crypto (deposit-capable).
const ACCOUNTS = [
  { accountId: '1841', currency: 'BRL', depositAddress: null },
  { accountId: '1842', currency: 'USDT', depositAddress: { Tron: 'Tabc' } },
  { accountId: '1843', currency: 'USDC', depositAddress: { Solana: 'B7Agt' } },
]

const setupAxios = (existingSubsByAccount: Record<string, unknown[]> = {}): void => {
  ;(mockedAxios.post as jest.Mock).mockImplementation(async (url: string) => {
    if (url.endsWith('/auth/token')) return { data: { access_token: 'tok' } } as AxiosResponse
    return { data: { subscriptionId: 'new' } } as AxiosResponse
  })
  ;(mockedAxios.get as jest.Mock).mockImplementation(async (url: string) => {
    if (url.endsWith('/api/v2.0/accounts')) return { data: ACCOUNTS } as AxiosResponse
    const matched = url.match(/subscription\/accounts\/(\w+)/)
    const account = matched ? matched[1] : ''
    return { data: existingSubsByAccount[account] ?? [] } as AxiosResponse
  })
}

const subscribeCalls = (): string[] =>
  (mockedAxios.post as jest.Mock).mock.calls
    .map(call => String(call[0]))
    .filter(url => url.includes('/callback/v2.0/subscribe/'))

beforeEach(() => {
  mockedAxios.get.mockReset()
  mockedAxios.post.mockReset()
})

describe('TransferoCallbackRegistrar', () => {
  it('subscribes deposit + credit callbacks on the crypto accounts, not the BRL account', async () => {
    setupAxios({})

    await new TransferoCallbackRegistrar(makeSecretManager(), createMockLogger()).ensureSubscriptions()

    const urls = subscribeCalls()
    expect(urls).toEqual(expect.arrayContaining([
      `${BASE}/callback/v2.0/subscribe/credittransactions/accounts/1842`,
      `${BASE}/callback/v2.0/subscribe/credittransactions/accounts/1843`,
      `${BASE}/callback/v2.0/subscribe/depositorders/accounts/1842`,
      `${BASE}/callback/v2.0/subscribe/depositorders/accounts/1843`,
    ]))
    // The BRL account (1841) must NOT get deposit/credit subscriptions.
    expect(urls.some(url => url.includes('/accounts/1841'))).toBe(false)
    const depositCall = (mockedAxios.post as jest.Mock).mock.calls.find(call => String(call[0]).includes('depositorders/accounts/1843'))
    expect(depositCall?.[1]).toMatchObject({ notification: WEBHOOK_URL, notificationType: 'Webhook' })
  })

  it('is idempotent: skips crypto accounts already subscribed to our URL', async () => {
    const subs = [
      { entityType: 'DepositOrder', notificationTo: WEBHOOK_URL, notificationType: 'Webhook' },
      { entityType: 'Transaction', notificationTo: WEBHOOK_URL, notificationType: 'Webhook' },
    ]
    setupAxios({ 1842: subs, 1843: subs })

    await new TransferoCallbackRegistrar(makeSecretManager(), createMockLogger()).ensureSubscriptions()

    expect(subscribeCalls()).toHaveLength(0)
  })

  it('falls back to the default webhook URL when TRANSFERO_WEBHOOK_URL is unset', async () => {
    setupAxios({})

    await new TransferoCallbackRegistrar(makeSecretManager({ TRANSFERO_WEBHOOK_URL: '' }), createMockLogger()).ensureSubscriptions()

    const depositCall = (mockedAxios.post as jest.Mock).mock.calls.find(call => String(call[0]).includes('depositorders/accounts/1843'))
    expect(depositCall?.[1]).toMatchObject({ notification: DEFAULT_TRANSFERO_WEBHOOK_URL, notificationType: 'Webhook' })
  })
})
