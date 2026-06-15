import 'reflect-metadata'
import { type AxiosResponse } from 'axios'
import axios from 'axios'

import type { ISecretManager, Secret } from '../../../../../platform/secrets/ISecretManager'

import { DEFAULT_TRANSFERO_WEBHOOK_URL, TransferoCallbackRegistrar } from '../../../../../modules/treasury/infrastructure/exchangeProviders/TransferoCallbackRegistrar'
import { createMockLogger } from '../../../../setup/mockFactories'

jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

const WEBHOOK_URL = 'https://abroad.example.com/webhook/transfero/balance'

const SECRETS: Record<string, string> = {
  TRANSFERO_ACCOUNT_ID: 'acc-1',
  TRANSFERO_BASE_URL: 'https://transfero.example.com',
  TRANSFERO_CLIENT_ID: 'client-id',
  TRANSFERO_CLIENT_SCOPE: 'payments',
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

const tokenResponse = { data: { access_token: 'tok', expires_in: 900 } } as AxiosResponse
const subscribeUrls = () =>
  mockedAxios.post.mock.calls
    .map(call => String(call[0]))
    .filter(url => url.includes('/callback/v2.0/subscribe/'))

beforeEach(() => {
  mockedAxios.get.mockReset()
  mockedAxios.post.mockReset()
})

describe('TransferoCallbackRegistrar', () => {
  it('subscribes deposit and credit callbacks when none exist for our URL', async () => {
    mockedAxios.post.mockResolvedValueOnce(tokenResponse)
    mockedAxios.get.mockResolvedValueOnce({
      data: [{ entityType: 'Payment', id: 'p', notificationTo: 'https://abroad.example.com/webhook/transfero', notificationType: 'Webhook' }],
    } as AxiosResponse)
    mockedAxios.post.mockResolvedValue({ data: { subscriptionId: 'new' } } as AxiosResponse)

    await new TransferoCallbackRegistrar(makeSecretManager(), createMockLogger()).ensureSubscriptions()

    const urls = subscribeUrls()
    expect(urls).toEqual(expect.arrayContaining([
      'https://transfero.example.com/callback/v2.0/subscribe/credittransactions/accounts/acc-1',
      'https://transfero.example.com/callback/v2.0/subscribe/depositorders/accounts/acc-1',
    ]))
    const depositCall = mockedAxios.post.mock.calls.find(call => String(call[0]).includes('depositorders'))
    expect(depositCall?.[1]).toMatchObject({ notification: WEBHOOK_URL, notificationType: 'Webhook' })
  })

  it('is idempotent: skips event types already pointing at our URL', async () => {
    mockedAxios.post.mockResolvedValueOnce(tokenResponse)
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        // Real entityTypes Transfero returns: deposit-order callbacks are
        // "DepositOrder"; credit-transaction callbacks are "Transaction".
        { entityType: 'DepositOrder', id: 'd', notificationTo: WEBHOOK_URL, notificationType: 'Webhook' },
        { entityType: 'Transaction', id: 'c', notificationTo: WEBHOOK_URL, notificationType: 'Webhook' },
      ],
    } as AxiosResponse)

    await new TransferoCallbackRegistrar(makeSecretManager(), createMockLogger()).ensureSubscriptions()

    expect(subscribeUrls()).toHaveLength(0)
  })

  it('falls back to the default webhook URL when TRANSFERO_WEBHOOK_URL is unset', async () => {
    mockedAxios.post.mockResolvedValueOnce(tokenResponse)
    mockedAxios.get.mockResolvedValueOnce({ data: [] } as AxiosResponse)
    mockedAxios.post.mockResolvedValue({ data: { subscriptionId: 'new' } } as AxiosResponse)

    await new TransferoCallbackRegistrar(makeSecretManager({ TRANSFERO_WEBHOOK_URL: '' }), createMockLogger()).ensureSubscriptions()

    expect(subscribeUrls()).toHaveLength(2)
    const depositCall = mockedAxios.post.mock.calls.find(call => String(call[0]).includes('depositorders'))
    expect(depositCall?.[1]).toMatchObject({ notification: DEFAULT_TRANSFERO_WEBHOOK_URL, notificationType: 'Webhook' })
  })
})
