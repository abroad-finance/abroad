// src/services/slackNotifier.ts
import axios from 'axios'
import { inject, injectable } from 'inversify'

import { RuntimeConfiguration } from '../config/runtime'
import { ILogger, ISlackNotifier } from '../interfaces'
import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

@injectable()
export class SlackNotifier implements ISlackNotifier {
  constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.ILogger) private logger: ILogger,
    @inject(TYPES.AppConfig) private readonly config: RuntimeConfiguration,
  ) { }

  async sendMessage(message: string): Promise<void> {
    try {
      const webhookUrl = await this.secretManager.getSecret('SLACK_WEBHOOK_URL')

      if (!webhookUrl) {
        this.logger.warn('Slack webhook URL not configured; skipping notification')
        return
      }

      await axios.post(webhookUrl, { text: message }, { timeout: this.config.axiosTimeoutMs })
      this.logger.info('Message sent to Slack', { length: message.length })
    }
    catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      this.logger.warn('Failed to send message to Slack', normalizedError)
    }
  }
}
