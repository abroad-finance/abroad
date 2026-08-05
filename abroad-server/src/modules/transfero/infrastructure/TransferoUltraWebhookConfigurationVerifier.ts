import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { ISecretManager, Secrets } from '../../../platform/secrets/ISecretManager'
import { TransferoUltraClient } from './TransferoUltraClient'
import { transferoUltraWebhookEndpointListSchema } from './transferoUltraSchemas'

export const REQUIRED_TRANSFERO_ULTRA_WEBHOOK_EVENTS = [
  'pix.withdrawal.submitted',
  'pix.withdrawal.settled',
  'pix.withdrawal.returned',
  'pix.withdrawal.failed',
  'crypto.deposit.confirmed',
  'crypto.deposit.credit_failed',
  // The onramp's only delivery trigger. Only `completed` is subscribed:
  // `pix.deposit.paid` means the money arrived but is not yet spendable, so
  // acting on it would release crypto against a credit that has not landed.
  'pix.deposit.completed',
] as const

@injectable()
export class TransferoUltraWebhookConfigurationVerifier {
  private readonly logger: ScopedLogger

  public constructor(
    @inject(TransferoUltraClient) private readonly ultraClient: TransferoUltraClient,
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, {
      scope: 'TransferoUltraWebhookConfiguration',
    })
  }

  public async verify(): Promise<void> {
    const webhookUrl = await this.secretManager.getSecret(
      Secrets.TRANSFERO_ULTRA_WEBHOOK_URL,
    )
    const response = await this.ultraClient.get('/api/v1/webhooks/endpoints')
    const endpoints = transferoUltraWebhookEndpointListSchema.parse(response)
    const endpoint = endpoints.items.find(candidate => candidate.url === webhookUrl)
    if (!endpoint) {
      throw new Error('Transfero Ultra webhook endpoint is not provisioned at the configured URL')
    }
    if (!endpoint.isActive) {
      throw new Error('Transfero Ultra webhook endpoint is inactive')
    }

    const requiredEvents = new Set<string>(REQUIRED_TRANSFERO_ULTRA_WEBHOOK_EVENTS)
    const configuredEvents = new Set(endpoint.eventTypes)
    const missingEvents = REQUIRED_TRANSFERO_ULTRA_WEBHOOK_EVENTS.filter(
      eventType => !configuredEvents.has(eventType),
    )
    const unexpectedEvents = endpoint.eventTypes.filter(
      eventType => !requiredEvents.has(eventType),
    )
    if (missingEvents.length > 0) {
      throw new Error(
        `Transfero Ultra webhook endpoint is missing required events: ${missingEvents.join(', ')}`,
      )
    }
    if (unexpectedEvents.length > 0) {
      throw new Error(
        `Transfero Ultra webhook endpoint has unexpected events: ${unexpectedEvents.join(', ')}`,
      )
    }

    this.logger.info('Transfero Ultra webhook configuration verified', {
      endpointId: endpoint.id,
      eventCount: endpoint.eventTypes.length,
      secretPrefix: endpoint.secretPrefix,
    })
  }
}
