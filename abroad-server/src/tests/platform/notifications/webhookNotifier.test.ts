import type { AxiosResponse } from 'axios'
import type { Agent } from 'node:https'

import { WebhookCredentialMode } from '@prisma/client'
import axios from 'axios'

import type { ISecretManager } from '../../../platform/secrets/ISecretManager'

import { RuntimeConfig } from '../../../app/config/runtime'
import { PartnerWebhookSecretResolver } from '../../../modules/partners/application/PartnerWebhookSecretResolver'
import { WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { WebhookNotifier } from '../../../platform/notifications/webhookNotifier'
import { ValidatedWebhookTarget, WebhookTargetPolicy } from '../../../platform/notifications/WebhookTargetPolicy'
import { createMockLogger, MockLogger } from '../../setup/mockFactories'

jest.mock('axios')

describe('WebhookNotifier', () => {
  let destroyAgent: jest.Mock<void, []>
  let logger: MockLogger
  let partnerSecretResolver: jest.Mocked<Pick<PartnerWebhookSecretResolver, 'resolve'>>
  let secretManager: ISecretManager
  let targetPolicy: jest.Mocked<Pick<WebhookTargetPolicy, 'validate'>>

  beforeEach(() => {
    jest.clearAllMocks()
    destroyAgent = jest.fn<void, []>()
    logger = createMockLogger()
    partnerSecretResolver = { resolve: jest.fn() }
    secretManager = {
      getSecret: jest.fn(async (secretName: Parameters<ISecretManager['getSecret']>[0]) => {
        if (secretName === 'ABROAD_WEBHOOK_SECRETS_BY_ORIGIN') {
          return JSON.stringify({
            'https://api-v3.production.decafapi.com': 'decaf-secret',
          })
        }
        return 'secret'
      }),
      getSecrets: jest.fn(),
    }
    targetPolicy = {
      validate: jest.fn<Promise<ValidatedWebhookTarget>, [string]>(async rawUrl => ({
        httpsAgent: { destroy: destroyAgent } as unknown as Agent,
        url: rawUrl,
      })),
    }
    jest.mocked(axios.post).mockResolvedValue({ status: 204 } as AxiosResponse)
  })

  const buildNotifier = (): WebhookNotifier => new WebhookNotifier(
    logger,
    secretManager,
    RuntimeConfig,
    partnerSecretResolver as unknown as PartnerWebhookSecretResolver,
    targetPolicy as unknown as WebhookTargetPolicy,
  )

  it('skips when the target is absent or blank', async () => {
    const notifier = buildNotifier()

    await notifier.notifyWebhook(null, {
      data: {},
      event: WebhookEvent.TRANSACTION_UPDATED,
    })
    await notifier.notifyWebhook('   ', {
      data: {},
      event: WebhookEvent.TRANSACTION_UPDATED,
    })

    expect(axios.post).not.toHaveBeenCalled()
  })

  it('sends exactly one request to the supplied target', async () => {
    const notifier = buildNotifier()
    const payload = {
      data: { id: '123' },
      event: WebhookEvent.TRANSACTION_UPDATED,
    }

    await notifier.notifyWebhook(' https://hook ', payload)

    expect(axios.post).toHaveBeenCalledTimes(1)
    expect(axios.post).toHaveBeenCalledWith(
      'https://hook',
      payload,
      expect.objectContaining({
        headers: { 'X-Abroad-Webhook-Secret': 'secret' },
        timeout: expect.any(Number),
      }),
    )
    expect(destroyAgent).toHaveBeenCalledTimes(1)
  })

  it('uses the secret configured for the target origin', async () => {
    const notifier = buildNotifier()

    await notifier.notifyWebhook(
      'https://api-v3.production.decafapi.com/abroad/webhook',
      {
        data: { id: '123' },
        event: WebhookEvent.TRANSACTION_UPDATED,
      },
    )

    expect(axios.post).toHaveBeenCalledTimes(1)
    expect(axios.post).toHaveBeenCalledWith(
      'https://api-v3.production.decafapi.com/abroad/webhook',
      expect.anything(),
      expect.objectContaining({
        headers: { 'X-Abroad-Webhook-Secret': 'decaf-secret' },
      }),
    )
  })

  it('falls back to the default secret when the per-origin configuration is invalid', async () => {
    jest.mocked(secretManager.getSecret).mockImplementation(async secretName => (
      secretName === 'ABROAD_WEBHOOK_SECRETS_BY_ORIGIN'
        ? 'invalid-json'
        : 'secret'
    ))
    const notifier = buildNotifier()

    await notifier.notifyWebhook(
      'https://api-v3.production.decafapi.com/abroad/webhook',
      { data: {}, event: WebhookEvent.TRANSACTION_UPDATED },
    )

    expect(axios.post).toHaveBeenCalledWith(
      'https://api-v3.production.decafapi.com/abroad/webhook',
      expect.anything(),
      expect.objectContaining({
        headers: { 'X-Abroad-Webhook-Secret': 'secret' },
      }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to resolve per-origin webhook secrets; using default webhook secret',
    )
  })

  it('logs a safe error and propagates delivery failure to the outbox', async () => {
    jest.mocked(axios.post).mockRejectedValueOnce(new Error('fail'))
    const notifier = buildNotifier()

    await expect(notifier.notifyWebhook('https://hook/private/path', {
      data: { id: 'x' },
      event: WebhookEvent.TRANSACTION_UPDATED,
    })).rejects.toThrow('Webhook delivery failed')

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to notify webhook',
      expect.objectContaining({
        event: WebhookEvent.TRANSACTION_UPDATED,
        targetOrigin: 'https://hook',
      }),
    )
    expect(destroyAgent).toHaveBeenCalledTimes(1)
  })

  it('uses the exact managed partner secret without consulting legacy configuration', async () => {
    partnerSecretResolver.resolve.mockResolvedValueOnce('managed-secret')
    const notifier = buildNotifier()

    await notifier.notifyWebhook(
      'https://hooks.partner.example/events',
      { data: {}, event: WebhookEvent.TRANSACTION_UPDATED },
      {
        credentialMode: WebhookCredentialMode.PARTNER_CURRENT,
        partnerId: 'partner-1',
      },
    )

    expect(partnerSecretResolver.resolve).toHaveBeenCalledWith(
      'partner-1',
      WebhookCredentialMode.PARTNER_CURRENT,
    )
    expect(secretManager.getSecret).not.toHaveBeenCalled()
    expect(axios.post).toHaveBeenCalledWith(
      'https://hooks.partner.example/events',
      expect.anything(),
      expect.objectContaining({
        headers: { 'X-Abroad-Webhook-Secret': 'managed-secret' },
      }),
    )
  })

  it('fails closed when a managed secret is unavailable', async () => {
    partnerSecretResolver.resolve.mockResolvedValueOnce(undefined)
    const notifier = buildNotifier()

    await expect(notifier.notifyWebhook(
      'https://hooks.partner.example/events',
      { data: {}, event: WebhookEvent.TRANSACTION_UPDATED },
      {
        credentialMode: WebhookCredentialMode.PARTNER_PENDING,
        partnerId: 'partner-1',
      },
    )).rejects.toThrow('Webhook delivery failed')

    expect(secretManager.getSecret).not.toHaveBeenCalled()
    expect(axios.post).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to notify webhook',
      expect.objectContaining({ failureCode: 'credential_unavailable' }),
    )
    expect(destroyAgent).toHaveBeenCalledTimes(1)
  })
})
