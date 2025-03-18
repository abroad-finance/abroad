// src/services/slackNotifier.ts
import axios from 'axios'
import { inject } from 'inversify'

import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

export interface ISlackNotifier {
  sendMessage(message: string): Promise<void>
}

export class SlackNotifier implements ISlackNotifier {
  constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) { }

  async sendMessage(message: string): Promise<void> {
    try {
      const webhookUrl = await this.secretManager.getSecret('SLACK_WEBHOOK_URL')

      if (!webhookUrl) {
        return
      }

      await axios.post(webhookUrl, { text: message })
      console.log('Message sent to Slack successfully.')
    }
    catch (error) {
      if (error instanceof Error) {
        console.warn('Failed to send message to Slack:', error.message)
      }
      return
    }
  }
}
