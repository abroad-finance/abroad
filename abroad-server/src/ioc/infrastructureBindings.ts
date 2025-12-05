import { Container } from 'inversify'

import { CachedSecretManager } from '../environment'
import { PrismaClientProvider } from '../infrastructure/db'
import { GCPPubSubQueueHandler } from '../infrastructure/gcpPubSubQueueHandler'
import { RedisLockManager } from '../infrastructure/RedisLockManager'
import { ConsoleLogger } from '../services/consoleLogger'
import { PartnerService } from '../services/partnerService'
import { PersonaKycService } from '../services/PersonaKycService'
import { SlackNotifier } from '../services/slackNotifier'
import { SocketIOWebSocketService } from '../services/SocketIOWebSocketService'
import { WebhookNotifier } from '../services/WebhookNotifier'
import { TYPES } from '../types'
import { BindingRegistration, registerBindings } from './bindingSupport'

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
