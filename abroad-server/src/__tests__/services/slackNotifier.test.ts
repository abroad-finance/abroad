import axios from 'axios'

import type { ISecretManager } from '../../interfaces/ISecretManager'

import { SlackNotifier } from '../../services/slackNotifier'

jest.mock('axios')

describe('SlackNotifier', () => {
  let secretManager: ISecretManager

  beforeEach(() => {
    jest.clearAllMocks()
    secretManager = {
      getSecret: jest.fn(async () => 'https://slack.example.com/webhook'),
      getSecrets: jest.fn(),
    }
  })

  it('posts to slack when a webhook is configured', async () => {
    (axios.post as jest.Mock).mockResolvedValueOnce(undefined)
    const notifier = new SlackNotifier(secretManager)

    await notifier.sendMessage('hello')

    expect(secretManager.getSecret).toHaveBeenCalledWith('SLACK_WEBHOOK_URL')
    expect(axios.post).toHaveBeenCalledWith('https://slack.example.com/webhook', { text: 'hello' })
  })

  it('returns early when webhook secret is missing', async () => {
    secretManager.getSecret = jest.fn(async () => '')
    const notifier = new SlackNotifier(secretManager)

    await notifier.sendMessage('no-op')

    expect(axios.post).not.toHaveBeenCalled()
  })

  it('logs a warning when the post fails', async () => {
    ;(axios.post as jest.Mock).mockRejectedValueOnce(new Error('boom'))
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const notifier = new SlackNotifier(secretManager)

    await notifier.sendMessage('warn')

    expect(warnSpy).toHaveBeenCalledWith('Failed to send message to Slack:', 'boom')
    warnSpy.mockRestore()
  })
})
