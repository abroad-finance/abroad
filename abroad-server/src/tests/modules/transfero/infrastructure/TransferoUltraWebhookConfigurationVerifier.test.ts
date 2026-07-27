import 'reflect-metadata'

import type { ISecretManager } from '../../../../platform/secrets/ISecretManager'

import { TransferoUltraClient } from '../../../../modules/transfero/infrastructure/TransferoUltraClient'
import { REQUIRED_TRANSFERO_ULTRA_WEBHOOK_EVENTS, TransferoUltraWebhookConfigurationVerifier } from '../../../../modules/transfero/infrastructure/TransferoUltraWebhookConfigurationVerifier'
import { createMockLogger } from '../../../setup/mockFactories'

type UltraClientMock = jest.Mocked<
  Pick<TransferoUltraClient, 'get' | 'patch' | 'post'>
>

const WEBHOOK_URL = 'https://api.abroad.finance/webhook/transfero'

const createUltraClient = (): UltraClientMock => ({
  get: jest.fn(),
  patch: jest.fn(),
  post: jest.fn(),
})

const createSecretManager = (): ISecretManager => ({
  getSecret: jest.fn(async () => WEBHOOK_URL),
  getSecrets: jest.fn(async names => Object.fromEntries(
    names.map(name => [name, WEBHOOK_URL]),
  ) as Record<(typeof names)[number], string>),
})

const endpoint = (overrides: Record<string, unknown> = {}) => ({
  createdAt: '2026-07-27T10:00:00.000Z',
  description: 'Abroad production webhook',
  eventTypes: [...REQUIRED_TRANSFERO_ULTRA_WEBHOOK_EVENTS],
  id: '11111111-2222-4333-8444-555555555555',
  isActive: true,
  secretPrefix: 'whsec_1234',
  updatedAt: '2026-07-27T10:00:00.000Z',
  url: WEBHOOK_URL,
  ...overrides,
})

describe('TransferoUltraWebhookConfigurationVerifier', () => {
  it('accepts the exact active endpoint with every required Ultra event', async () => {
    const ultraClient = createUltraClient()
    const logger = createMockLogger()
    ultraClient.get.mockResolvedValue({ items: [endpoint()] })
    const verifier = new TransferoUltraWebhookConfigurationVerifier(
      ultraClient as unknown as TransferoUltraClient,
      createSecretManager(),
      logger,
    )

    await expect(verifier.verify()).resolves.toBeUndefined()
    expect(ultraClient.get).toHaveBeenCalledWith('/api/v1/webhooks/endpoints')
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Transfero Ultra webhook configuration verified'),
      {
        endpointId: '11111111-2222-4333-8444-555555555555',
        eventCount: REQUIRED_TRANSFERO_ULTRA_WEBHOOK_EVENTS.length,
        secretPrefix: 'whsec_1234',
      },
    )
  })

  it('rejects a missing endpoint instead of provisioning a legacy fallback', async () => {
    const ultraClient = createUltraClient()
    ultraClient.get.mockResolvedValue({ items: [endpoint({ url: 'https://other.example/webhook' })] })
    const verifier = new TransferoUltraWebhookConfigurationVerifier(
      ultraClient as unknown as TransferoUltraClient,
      createSecretManager(),
      createMockLogger(),
    )

    await expect(verifier.verify()).rejects.toThrow(
      'Transfero Ultra webhook endpoint is not provisioned',
    )
  })

  it('rejects inactive endpoints and non-exact subscriptions', async () => {
    const ultraClient = createUltraClient()
    const verifier = new TransferoUltraWebhookConfigurationVerifier(
      ultraClient as unknown as TransferoUltraClient,
      createSecretManager(),
      createMockLogger(),
    )
    ultraClient.get.mockResolvedValueOnce({
      items: [endpoint({ isActive: false })],
    })
    await expect(verifier.verify()).rejects.toThrow('endpoint is inactive')

    ultraClient.get.mockResolvedValueOnce({
      items: [endpoint({
        eventTypes: REQUIRED_TRANSFERO_ULTRA_WEBHOOK_EVENTS.filter(
          eventType => eventType !== 'crypto.deposit.credit_failed',
        ),
      })],
    })
    await expect(verifier.verify()).rejects.toThrow(
      'crypto.deposit.credit_failed',
    )

    ultraClient.get.mockResolvedValueOnce({
      items: [endpoint({
        eventTypes: [
          ...REQUIRED_TRANSFERO_ULTRA_WEBHOOK_EVENTS,
          'pix.deposit.completed',
        ],
      })],
    })
    await expect(verifier.verify()).rejects.toThrow(
      'pix.deposit.completed',
    )
  })
})
