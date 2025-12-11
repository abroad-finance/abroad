import axios from 'axios'

import type { ISecretManager } from '../../interfaces/ISecretManager'

import { WebhookEvent } from '../../interfaces/IWebhookNotifier'
import { WebhookNotifier } from '../../services/WebhookNotifier'
import { createMockLogger, MockLogger } from '../setup/mockFactories'

jest.mock('axios')

describe('WebhookNotifier', () => {
  let logger: MockLogger
  let secretManager: ISecretManager

  beforeEach(() => {
    logger = createMockLogger()
    secretManager = {
      getSecret: jest.fn(async () => 'secret'),
      getSecrets: jest.fn(),
    }
    jest.clearAllMocks()
  })

  it('skips when url is null', async () => {
    const notifier = new WebhookNotifier(logger, secretManager)

    await notifier.notifyWebhook(null, { data: {}, event: WebhookEvent.TRANSACTION_UPDATED })

    expect(axios.post).not.toHaveBeenCalled()
  })

  it('sends payload with secret header when available', async () => {
    const notifier = new WebhookNotifier(logger, secretManager)

    await notifier.notifyWebhook('https://hook', {
      data: { id: '123' },
      event: WebhookEvent.TRANSACTION_UPDATED,
    })

    expect(axios.post).toHaveBeenCalledWith('https://hook', {
      data: { id: '123' },
      event: WebhookEvent.TRANSACTION_UPDATED,
    }, expect.objectContaining({
      headers: { 'X-Abroad-Webhook-Secret': 'secret' },
      timeout: expect.any(Number),
    }))
  })

  it('logs an error when the webhook post fails', async () => {
    (axios.post as jest.Mock).mockRejectedValueOnce(new Error('fail'))
    const notifier = new WebhookNotifier(logger, secretManager)

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
