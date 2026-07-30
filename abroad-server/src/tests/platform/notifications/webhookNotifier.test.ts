import axios from 'axios'

import type { ISecretManager } from '../../../platform/secrets/ISecretManager'

import { RuntimeConfig } from '../../../app/config/runtime'
import { WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { WebhookNotifier } from '../../../platform/notifications/webhookNotifier'
import { createMockLogger, MockLogger } from '../../setup/mockFactories'

jest.mock('axios')

describe('WebhookNotifier', () => {
  let logger: MockLogger
  let secretManager: ISecretManager

  beforeEach(() => {
    logger = createMockLogger()
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
    jest.clearAllMocks()
  })

  it('skips when the target is absent or blank', async () => {
    const notifier = new WebhookNotifier(logger, secretManager, RuntimeConfig)

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
    const notifier = new WebhookNotifier(logger, secretManager, RuntimeConfig)
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
  })

  it('uses the secret configured for the target origin', async () => {
    const notifier = new WebhookNotifier(logger, secretManager, RuntimeConfig)

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
    const notifier = new WebhookNotifier(logger, secretManager, RuntimeConfig)

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
    const notifier = new WebhookNotifier(logger, secretManager, RuntimeConfig)

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
  })
})
