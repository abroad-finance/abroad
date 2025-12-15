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
  let partnerClient: { findUnique: jest.Mock<Promise<{ webhookUrl: string | null } | null>, [unknown]> }
  let prismaClient: { partner: typeof partnerClient }

  beforeEach(() => {
    logger = createMockLogger()
    secretManager = {
      getSecret: jest.fn(async (secretName: Parameters<ISecretManager['getSecret']>[0]) => {
        if (secretName === 'STELLAR_SEP_PARTNER_ID') {
          return 'sep-partner'
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

  it('logs an error when the webhook post fails', async () => {
    (axios.post as jest.Mock).mockRejectedValueOnce(new Error('fail'))
    partnerClient.findUnique.mockResolvedValueOnce(null)
    const notifier = new WebhookNotifier(logger, secretManager, RuntimeConfig, databaseClientProvider)

    await notifier.notifyWebhook('https://hook', {
      data: { id: 'x' },
      event: WebhookEvent.TRANSACTION_UPDATED,
    })

    expect(logger.error).toHaveBeenCalledWith('Failed to notify webhook', expect.objectContaining({
      event: WebhookEvent.TRANSACTION_UPDATED,
      url: 'https://hook',
    }))
  })
})
