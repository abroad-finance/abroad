import { Container } from 'inversify'

import { ConsoleLogger } from '../../core/logging/consoleLogger'
import { PersonaKycService } from '../../modules/kyc/application/PersonaKycService'
import { PartnerService } from '../../modules/partners/application/partnerService'
import { RedisLockManager } from '../../platform/cacheLock/redisLockManager'
import { GCPPubSubQueueHandler } from '../../platform/messaging/gcpPubSubQueueHandler'
import { SlackNotifier } from '../../platform/notifications/slackNotifier'
import { SocketIOWebSocketService } from '../../platform/notifications/socketIoWebSocketService'
import { WebhookNotifier } from '../../platform/notifications/webhookNotifier'
import { PrismaClientProvider } from '../../platform/persistence/prismaClientProvider'
import { CachedSecretManager } from '../../platform/secrets/CachedSecretManager'
import { BindingRegistration, registerBindings } from './bindingSupport'
import { TYPES } from './types'

const infrastructureBindings: ReadonlyArray<BindingRegistration<unknown>> = [
  { identifier: TYPES.IQueueHandler, implementation: GCPPubSubQueueHandler },
  { identifier: TYPES.IDatabaseClientProvider, implementation: PrismaClientProvider },
  { identifier: TYPES.ISecretManager, implementation: CachedSecretManager },
  { identifier: TYPES.ILogger, implementation: ConsoleLogger },
  { identifier: TYPES.ISlackNotifier, implementation: SlackNotifier },
  { identifier: TYPES.IWebSocketService, implementation: SocketIOWebSocketService },
  { identifier: TYPES.IWebhookNotifier, implementation: WebhookNotifier },
  { identifier: TYPES.ILockManager, implementation: RedisLockManager },
  { identifier: TYPES.IPartnerService, implementation: PartnerService },
  { identifier: TYPES.IKycService, implementation: PersonaKycService },
] as const

export function bindInfrastructure(container: Container): void {
  registerBindings(container, infrastructureBindings)
}
