import axios from 'axios'

import type { ISecretManager } from '../../../platform/secrets/ISecretManager'

import { RuntimeConfig } from '../../../app/config/runtime'
import { SlackNotifier } from '../../../platform/notifications/slackNotifier'
import { createMockLogger } from '../../setup/mockFactories'

jest.mock('axios')

describe('SlackNotifier', () => {
  let secretManager: ISecretManager
  const logger = createMockLogger()

  beforeEach(() => {
    jest.clearAllMocks()
    secretManager = {
      getSecret: jest.fn(async () => 'https://slack.example.com/webhook'),
      getSecrets: jest.fn(),
    }
  })

  it('posts to slack when a webhook is configured', async () => {
    (axios.post as jest.Mock).mockResolvedValueOnce(undefined)
    const notifier = new SlackNotifier(secretManager, logger, RuntimeConfig)

    await notifier.sendMessage('hello')

    expect(secretManager.getSecret).toHaveBeenCalledWith('SLACK_WEBHOOK_URL')
    expect(axios.post).toHaveBeenCalledWith(
      'https://slack.example.com/webhook',
      { text: 'hello' },
      { timeout: RuntimeConfig.axiosTimeoutMs },
    )
  })

  it('returns early when webhook secret is missing', async () => {
    secretManager.getSecret = jest.fn(async () => '')
    const notifier = new SlackNotifier(secretManager, logger, RuntimeConfig)

    await notifier.sendMessage('no-op')

    expect(axios.post).not.toHaveBeenCalled()
  })

  it('logs a warning when the post fails', async () => {
    ;(axios.post as jest.Mock).mockRejectedValueOnce(new Error('boom'))
    const notifier = new SlackNotifier(secretManager, logger, RuntimeConfig)

    await notifier.sendMessage('warn')

    expect(logger.warn).toHaveBeenCalledWith('Failed to send message to Slack', expect.any(Error))
  })
})
