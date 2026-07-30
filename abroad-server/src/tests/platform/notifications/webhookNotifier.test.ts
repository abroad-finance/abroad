import type { PrismaClient } from '@prisma/client'

import axios from 'axios'

import type { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import type { ISecretManager } from '../../../platform/secrets/ISecretManager'

import { RuntimeConfig } from '../../../app/config/runtime'
import { WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { WebhookNotifier } from '../../../platform/notifications/webhookNotifier'
import { createMockLogger, MockLogger } from '../../setup/mockFactories'

jest.mock('axios')

describe('WebhookNotifier', () => {
  let logger: MockLogger
  let secretManager: ISecretManager
  let databaseClientProvider: IDatabaseClientProvider
  let partnerClient: { findUnique: jest.Mock<Promise<null | { webhookUrl: null | string }>, [unknown]> }
  let prismaClient: { partner: typeof partnerClient }

  beforeEach(() => {
    logger = createMockLogger()
    secretManager = {
      getSecret: jest.fn(async (secretName: Parameters<ISecretManager['getSecret']>[0]) => {
        if (secretName === 'STELLAR_SEP_PARTNER_ID') {
          return 'sep-partner'
        }
        if (secretName === 'ABROAD_WEBHOOK_SECRETS_BY_ORIGIN') {
          return JSON.stringify({
            'https://api-v3.production.decafapi.com': 'decaf-secret',
          })
        }
        return 'secret'
      }),
      getSecrets: jest.fn(),
    }
    partnerClient = {
      findUnique: jest.fn(),
    }
    prismaClient = {
      partner: partnerClient,
    }
    databaseClientProvider = {
      getClient: jest.fn(async () => prismaClient as unknown as PrismaClient),
    }
    jest.clearAllMocks()
  })

  it('skips when no webhook targets exist', async () => {
    partnerClient.findUnique.mockResolvedValueOnce(null)
    const notifier = new WebhookNotifier(logger, secretManager, RuntimeConfig, databaseClientProvider)

    await notifier.notifyWebhook(null, { data: {}, event: WebhookEvent.TRANSACTION_UPDATED })

    expect(axios.post).not.toHaveBeenCalled()
  })

  it('sends payload to primary and SEP webhooks with secret header when available', async () => {
    partnerClient.findUnique.mockResolvedValueOnce({ webhookUrl: 'https://sep-hook' })
    const notifier = new WebhookNotifier(logger, secretManager, RuntimeConfig, databaseClientProvider)

    await notifier.notifyWebhook('https://hook', {
      data: { id: '123' },
      event: WebhookEvent.TRANSACTION_UPDATED,
    })

    expect(axios.post).toHaveBeenCalledTimes(2)
    expect(axios.post).toHaveBeenCalledWith(
      'https://hook',
      {
        data: { id: '123' },
        event: WebhookEvent.TRANSACTION_UPDATED,
      },
      expect.objectContaining({
        headers: { 'X-Abroad-Webhook-Secret': 'secret' },
        timeout: expect.any(Number),
      }),
    )
    expect(axios.post).toHaveBeenCalledWith(
      'https://sep-hook',
      expect.anything(),
      expect.objectContaining({
        headers: { 'X-Abroad-Webhook-Secret': 'secret' },
        timeout: expect.any(Number),
      }),
    )
  })

  it('does not duplicate notifications when SEP webhook matches primary target', async () => {
    partnerClient.findUnique.mockResolvedValueOnce({ webhookUrl: 'https://hook' })
    const notifier = new WebhookNotifier(logger, secretManager, RuntimeConfig, databaseClientProvider)

    await notifier.notifyWebhook('https://hook', {
      data: { id: '123' },
      event: WebhookEvent.TRANSACTION_UPDATED,
    })

    expect(axios.post).toHaveBeenCalledTimes(1)
  })

  it('uses an origin-specific secret without changing the SEP secret', async () => {
    partnerClient.findUnique.mockResolvedValueOnce({ webhookUrl: 'https://sep-hook' })
    const notifier = new WebhookNotifier(logger, secretManager, RuntimeConfig, databaseClientProvider)

    await notifier.notifyWebhook('https://api-v3.production.decafapi.com/abroad/webhook', {
      data: { id: '123' },
      event: WebhookEvent.TRANSACTION_UPDATED,
    })

    expect(axios.post).toHaveBeenCalledWith(
      'https://api-v3.production.decafapi.com/abroad/webhook',
      expect.anything(),
      expect.objectContaining({
        headers: { 'X-Abroad-Webhook-Secret': 'decaf-secret' },
      }),
    )
    expect(axios.post).toHaveBeenCalledWith(
      'https://sep-hook',
      expect.anything(),
      expect.objectContaining({
        headers: { 'X-Abroad-Webhook-Secret': 'secret' },
      }),
    )
  })

  it('falls back to the default secret when the per-origin configuration is invalid', async () => {
    jest.mocked(secretManager.getSecret).mockImplementation(async (secretName) => {
      if (secretName === 'STELLAR_SEP_PARTNER_ID') {
        return 'sep-partner'
      }
      if (secretName === 'ABROAD_WEBHOOK_SECRETS_BY_ORIGIN') {
        return 'invalid-json'
      }
      return 'secret'
    })
    partnerClient.findUnique.mockResolvedValueOnce(null)
    const notifier = new WebhookNotifier(logger, secretManager, RuntimeConfig, databaseClientProvider)

    await notifier.notifyWebhook('https://api-v3.production.decafapi.com/abroad/webhook', {
      data: {},
      event: WebhookEvent.TRANSACTION_UPDATED,
    })

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
    (axios.post as jest.Mock).mockRejectedValueOnce(new Error('fail'))
    partnerClient.findUnique.mockResolvedValueOnce(null)
    const notifier = new WebhookNotifier(logger, secretManager, RuntimeConfig, databaseClientProvider)

    await expect(notifier.notifyWebhook('https://hook/private/path', {
      data: { id: 'x' },
      event: WebhookEvent.TRANSACTION_UPDATED,
    })).rejects.toThrow('Webhook delivery failed')

    expect(logger.error).toHaveBeenCalledWith('Failed to notify webhook', expect.objectContaining({
      event: WebhookEvent.TRANSACTION_UPDATED,
      targetOrigin: 'https://hook',
    }))
  })
})
